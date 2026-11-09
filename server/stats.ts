import { Router } from 'express';
import { query } from './db.js';
import type { AuthRequest } from './auth.js';
import { loadMatchState, type MatchState } from './scoring.js';

export const statsRouter = Router();

interface PlayerAggregate {
  playerId: number;
  name: string;
  avatar: string;
  matches: number;
  matchesWon: number;
  legs: number;
  legsWon: number;
  visits: number;
  darts: number;
  points: number;
  first9Points: number;
  first9Darts: number;
  bestVisit: number;
  count180: number;
  count140: number;
  count100: number;
  doubleHits: number;
  doubleAttempts: number;
  checkouts: number;
  checkoutAttempts: number;
  busts: number;
  fields: Record<string, number>;
  numbers: Record<string, number>;
}

function emptyAggregate(playerId: number, name: string, avatar: string): PlayerAggregate {
  return {
    playerId,
    name,
    avatar,
    matches: 0,
    matchesWon: 0,
    legs: 0,
    legsWon: 0,
    visits: 0,
    darts: 0,
    points: 0,
    first9Points: 0,
    first9Darts: 0,
    bestVisit: 0,
    count180: 0,
    count140: 0,
    count100: 0,
    doubleHits: 0,
    doubleAttempts: 0,
    checkouts: 0,
    checkoutAttempts: 0,
    busts: 0,
    fields: {},
    numbers: {},
  };
}

function fieldKey(ring: string, number: number) {
  if (ring === 'bull') return '25';
  if (ring === 'bullseye') return 'DB';
  const prefix = ring === 'triple' ? 'T' : ring === 'double' ? 'D' : 'S';
  return `${prefix}${number}`;
}

function accumulate(agg: PlayerAggregate, state: MatchState, playerId: number) {
  const mp = state.players.find((p) => p.playerId === playerId);
  if (!mp) return;
  agg.matches += 1;
  if (state.match.winnerPlayerId === mp.matchPlayerId) agg.matchesWon += 1;

  const ownLegs = state.legs.filter((l) => l.winnerMatchPlayerId === mp.matchPlayerId).length;
  const legsPlayed = new Set(state.visits.filter((v) => v.matchPlayerId === mp.matchPlayerId).map((v) => v.legIndex));
  agg.legs += legsPlayed.size;
  agg.legsWon += ownLegs;

  let first9Visits = 0;
  for (const visit of state.visits) {
    if (visit.matchPlayerId !== mp.matchPlayerId) continue;
    agg.visits += 1;
    agg.points += visit.bust ? 0 : visit.score;
    if (visit.bust) agg.busts += 1;
    if (visit.score > agg.bestVisit) agg.bestVisit = visit.score;
    if (visit.score === 180) agg.count180 += 1;
    else if (visit.score >= 140) agg.count140 += 1;
    else if (visit.score >= 100) agg.count100 += 1;
    if (visit.checkout) agg.checkouts += 1;
    if (visit.checkout || visit.bust) agg.checkoutAttempts += 1;
    if (first9Visits < 3) {
      agg.first9Points += visit.bust ? 0 : visit.score;
      first9Visits += 1;
    }
    for (const dart of visit.darts) {
      agg.darts += 1;
      if (first9Visits <= 3) agg.first9Darts += 1;
      const key = fieldKey(dart.ring, dart.number);
      agg.fields[key] = (agg.fields[key] ?? 0) + 1;
      agg.numbers[String(dart.number)] = (agg.numbers[String(dart.number)] ?? 0) + 1;
      if (dart.ring === 'double' || dart.ring === 'bullseye') {
        agg.doubleHits += 1;
        agg.doubleAttempts += 1;
      }
    }
  }
}

/** 3-Dart-Average: Punkte pro Dart × 3 (nicht pro Zug — Züge können vorzeitig enden). */
export function average3(agg: PlayerAggregate) {
  return agg.darts ? Math.round(((agg.points / agg.darts) * 3 + Number.EPSILON) * 10) / 10 : 0;
}

/** Average der ersten drei Züge einer Leg. */
export function first9(agg: PlayerAggregate) {
  return agg.first9Darts ? Math.round(((agg.first9Points / agg.first9Darts) * 3 + Number.EPSILON) * 10) / 10 : 0;
}

async function matchesForPlayerIds(playerIds: number[], from: string | null = null, to: string | null = null) {
  const rows = await query<{ id: number }>(
    `select distinct m.id
       from matches m join match_players mp on mp.match_id = m.id
      where mp.player_id = any($1::int[])
        and m.status in ('active','finished')
        and ($2::timestamptz is null or m.created_at >= $2)
        and ($3::timestamptz is null or m.created_at <= $3)
      order by m.id`,
    [playerIds, from ?? null, to ?? null],
  );
  return rows.rows.map((r) => r.id);
}

async function aggregatePlayers(playerIds: number[], from: string | null = null, to: string | null = null) {
  const meta = await query<{ id: number; name: string; avatar: string }>(
    'select id, name, avatar from players where id = any($1::int[])',
    [playerIds],
  );
  const aggregates = new Map<number, PlayerAggregate>();
  for (const p of meta.rows) aggregates.set(p.id, emptyAggregate(p.id, p.name, p.avatar));

  const matchIds = await matchesForPlayerIds(playerIds, from, to);
  for (const matchId of matchIds) {
    const state = await loadMatchState(matchId);
    if (!state) continue;
    for (const playerId of playerIds) {
      const agg = aggregates.get(playerId);
      if (agg) accumulate(agg, state, playerId);
    }
  }
  return aggregates;
}

statsRouter.get('/', async (req: AuthRequest, res) => {
  const playerId = Number(req.query.playerId ?? 0) || null;
  const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : null;
  const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : null;

  let ids: number[];
  if (playerId) {
    ids = [playerId];
  } else {
    const own = await query<{ id: number }>('select id from players where owner_id = $1', [req.userId]);
    ids = own.rows.map((r) => r.id);
  }
  if (!ids.length) {
    res.json({ players: [] });
    return;
  }

  const aggregates = await aggregatePlayers(ids, from, to);
  const players = [...aggregates.values()].map((agg) => ({
    ...agg,
    average: average3(agg),
    first9Average: first9(agg),
    doubleQuote: agg.darts ? Math.round((agg.doubleHits / agg.darts) * 1000) / 10 : 0,
    dartAverage: agg.darts ? Math.round((agg.points / agg.darts) * 100) / 100 : 0,
    checkoutQuote: agg.checkoutAttempts ? Math.round((agg.checkouts / agg.checkoutAttempts) * 1000) / 10 : 0,
  }));
  res.json({ players, from, to });
});

// --- Rangliste (Elo) ---------------------------------------------------------

const K_FACTOR = 32;

export async function computeRanking() {
  const players = await query<{ id: number; name: string; avatar: string }>('select id, name, avatar from players');
  const ratings = new Map<number, number>();
  const stats = new Map<number, { wins: number; losses: number; matches: number }>();
  for (const p of players.rows) {
    ratings.set(p.id, 1000);
    stats.set(p.id, { wins: 0, losses: 0, matches: 0 });
  }

  const matches = await query<{ id: number; winner_player_id: number | null }>(
    "select id, winner_player_id from matches where status = 'finished' and winner_player_id is not null order by finished_at nulls last, id",
  );

  for (const match of matches.rows) {
    const mps = await query<{ player_id: number }>('select player_id from match_players where match_id = $1', [match.id]);
    const ids = mps.rows.map((r) => r.player_id);
    const winner = match.winner_player_id!;
    if (!ids.includes(winner)) continue;
    for (const id of ids) {
      const entry = stats.get(id);
      if (entry) {
        entry.matches += 1;
        if (id === winner) entry.wins += 1;
        else entry.losses += 1;
      }
    }
    for (const loser of ids.filter((id) => id !== winner)) {
      const ra = ratings.get(winner) ?? 1000;
      const rb = ratings.get(loser) ?? 1000;
      const expected = 1 / (1 + 10 ** ((rb - ra) / 400));
      ratings.set(winner, Math.round(ra + K_FACTOR * (1 - expected)));
      ratings.set(loser, Math.round(rb + K_FACTOR * (0 - (1 - expected))));
    }
  }

  const agg = await aggregatePlayers([...ratings.keys()]);
  const ranking = [...ratings.entries()]
    .map(([id, elo]) => {
      const meta = players.rows.find((p) => p.id === id);
      const a = agg.get(id);
      const s = stats.get(id) ?? { wins: 0, losses: 0, matches: 0 };
      return {
        playerId: id,
        name: meta?.name ?? 'Unbekannt',
        avatar: meta?.avatar ?? '🎯',
        elo,
        wins: s.wins,
        losses: s.losses,
        matches: s.matches,
        average: a ? average3(a) : 0,
        doubleQuote: a && a.darts ? Math.round((a.doubleHits / a.darts) * 1000) / 10 : 0,
        legsWon: a?.legsWon ?? 0,
      };
    })
    .filter((r) => r.matches > 0)
    .sort((a, b) => b.elo - a.elo || b.wins - a.wins);
  return ranking;
}

statsRouter.get('/ranking', async (_req, res) => {
  res.json({ ranking: await computeRanking() });
});
