import { Router } from 'express';
import { z } from 'zod';
import { query } from './db.js';
import type { AuthRequest } from './auth.js';

export const tournamentsRouter = Router();

function nextPowerOfTwo(n: number) {
  let size = 2;
  while (size < n) size *= 2;
  return size;
}

async function createMatch(creatorId: number, playerA: number, playerB: number, name: string) {
  const created = await query<{ id: number }>(
    `insert into matches (created_by, name, start_score, double_in, double_out, best_of, mode, share_code)
     values ($1,$2,501,false,true,2,'manual', upper(substr(md5(random()::text), 1, 6))) returning id`,
    [creatorId, name],
  );
  const matchId = created.rows[0].id;
  await query('insert into match_players (match_id, player_id, position) values ($1,$2,0), ($1,$3,1)', [
    matchId,
    playerA,
    playerB,
  ]);
  return matchId;
}

interface SlotRow {
  id: number;
  round: number;
  slot: number;
  player_id: number | null;
  player_a_id: number | null;
  player_b_id: number | null;
  match_id: number | null;
  winner_player_id: number | null;
}

async function slotOf(tournamentId: number, round: number, slot: number) {
  const res = await query<SlotRow>(
    `select id, round, slot, player_id, player_a_id, player_b_id, match_id, winner_player_id
       from tournament_slots where tournament_id = $1 and round = $2 and slot = $3`,
    [tournamentId, round, slot],
  );
  return res.rows[0] ?? null;
}

/**
 * Sorgt dafür, dass ein Slot in Runde > 1 ein Match bekommt, sobald beide Zubringer einen Sieger
 * haben, und dass Freilose ohne Match weiterwandern.
 */
async function syncSlot(tournamentId: number, round: number, slot: number, creatorId: number) {
  const current = await slotOf(tournamentId, round, slot);
  if (!current || current.match_id || current.winner_player_id) return;

  let playerA: number | null = null;
  let playerB: number | null = null;
  if (round === 1) {
    playerA = current.player_a_id;
    playerB = current.player_b_id;
  } else {
    const a = await slotOf(tournamentId, round - 1, slot * 2);
    const b = await slotOf(tournamentId, round - 1, slot * 2 + 1);
    if (!a || !b) return;
    playerA = a.winner_player_id;
    playerB = b.winner_player_id;
  }

  // Ab Runde 2 heißt „eine Seite fehlt": das andere Halbfinale ist noch nicht gespielt.
  if (round > 1 && (!playerA || !playerB)) {
    if (playerA || playerB) {
      await query('update tournament_slots set player_a_id = coalesce($2, player_a_id), player_b_id = coalesce($3, player_b_id) where id = $1', [
        current.id,
        playerA,
        playerB,
      ]);
    }
    return;
  }

  // Freilos (nur in Runde 1 möglich): eine Seite besetzt → direkt weiter
  if (playerA && !playerB) {
    await query('update tournament_slots set winner_player_id = $2 where id = $1', [current.id, playerA]);
    await advanceParent(tournamentId, round, slot, creatorId);
    return;
  }
  if (!playerA && playerB) {
    await query('update tournament_slots set winner_player_id = $2 where id = $1', [current.id, playerB]);
    await advanceParent(tournamentId, round, slot, creatorId);
    return;
  }
  if (!playerA || !playerB) return;

  await query('update tournament_slots set player_a_id = $2, player_b_id = $3 where id = $1', [
    current.id,
    playerA,
    playerB,
  ]);
  const tournament = await query<{ name: string }>('select name from tournaments where id = $1', [tournamentId]);
  const matchId = await createMatch(creatorId, playerA, playerB, `${tournament.rows[0]?.name || 'Turnier'} · R${round}`);
  await query('update tournament_slots set match_id = $2 where id = $1', [current.id, matchId]);
}

async function advanceParent(tournamentId: number, round: number, slot: number, creatorId: number) {
  const total = await query<{ max_round: number }>(
    'select max(round)::int as max_round from tournament_slots where tournament_id = $1',
    [tournamentId],
  );
  const maxRound = total.rows[0]?.max_round ?? 1;
  const winner = await slotOf(tournamentId, round, slot);
  if (round >= maxRound) {
    if (winner?.winner_player_id) {
      await query("update tournaments set status = 'finished', winner_player_id = $2 where id = $1", [
        tournamentId,
        winner.winner_player_id,
      ]);
    }
    return;
  }
  const parentRound = round + 1;
  const parentSlot = Math.floor(slot / 2);
  await syncSlot(tournamentId, parentRound, parentSlot, creatorId);
}

tournamentsRouter.post('/', async (req: AuthRequest, res) => {
  const parsed = z
    .object({ name: z.string().max(60).default(''), playerIds: z.array(z.number().int().positive()).min(2).max(8) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid-input', details: parsed.error.flatten() });
    return;
  }
  const ids = [...new Set(parsed.data.playerIds)];
  if (ids.length !== parsed.data.playerIds.length) {
    res.status(400).json({ error: 'duplicate-players' });
    return;
  }
  const size = nextPowerOfTwo(ids.length);
  const rounds = Math.log2(size);

  const created = await query<{ id: number }>('insert into tournaments (created_by, name) values ($1,$2) returning id', [
    req.userId,
    parsed.data.name,
  ]);
  const tournamentId = created.rows[0].id;

  // Freilose ans Ende, echte Paarungen zuerst
  const seeded: Array<number | null> = [...ids];
  while (seeded.length < size) seeded.push(null);
  seeded.sort((a, b) => (a === null ? 1 : 0) - (b === null ? 1 : 0));

  for (let round = 1; round <= rounds; round += 1) {
    const slots = size / 2 ** round;
    for (let slot = 0; slot < slots; slot += 1) {
      const a = round === 1 ? seeded[slot * 2] ?? null : null;
      const b = round === 1 ? seeded[slot * 2 + 1] ?? null : null;
      await query(
        'insert into tournament_slots (tournament_id, round, slot, player_a_id, player_b_id) values ($1,$2,$3,$4,$5)',
        [tournamentId, round, slot, a, b],
      );
    }
  }

  try {
    for (let slot = 0; slot < size / 2; slot += 1) {
      await syncSlot(tournamentId, 1, slot, req.userId!);
    }
  } catch (error) {
    console.error('Turnier-Sync fehlgeschlagen', error);
    res.status(500).json({ error: 'tournament-sync-failed' });
    return;
  }

  res.status(201).json({ id: tournamentId, rounds, size });
});

tournamentsRouter.get('/', async (req: AuthRequest, res) => {
  const rows = await query(
    `select t.id, t.name, t.status, t.winner_player_id as "winnerPlayerId", t.created_at as "createdAt",
            coalesce((select json_agg(json_build_object('round', s.round, 'slot', s.slot,
                                                        'playerId', coalesce(s.winner_player_id, s.player_id, s.player_a_id),
                                                        'matchId', s.match_id, 'winnerPlayerId', s.winner_player_id,
                                                        'nameA', pa.name, 'nameB', pb.name,
                                                        'name', coalesce(pa.name, pb.name)) order by s.round, s.slot)
                        from tournament_slots s
                        left join players pa on pa.id = s.player_a_id
                        left join players pb on pb.id = s.player_b_id
                       where s.tournament_id = t.id), '[]'::json) as slots
       from tournaments t where t.created_by = $1 order by t.id desc limit 20`,
    [req.userId],
  );
  res.json({ tournaments: rows.rows });
});

tournamentsRouter.delete('/:id', async (req: AuthRequest, res) => {
  await query('delete from tournaments where id = $1 and created_by = $2', [Number(req.params.id), req.userId]);
  res.json({ ok: true });
});

/** Nach einem beendeten Match den Sieger im Turnier weiterreichen. */
export async function syncTournamentForMatch(matchId: number, winnerPlayerId: number | null) {
  if (!winnerPlayerId) return;
  const found = await query<{ tournament_id: number; round: number; slot: number }>(
    'select tournament_id, round, slot from tournament_slots where match_id = $1',
    [matchId],
  );
  if (!found.rowCount) return;
  const row = found.rows[0];
  await query('update tournament_slots set winner_player_id = $2 where tournament_id = $1 and round = $3 and slot = $4', [
    row.tournament_id,
    winnerPlayerId,
    row.round,
    row.slot,
  ]);
  const owner = await query<{ created_by: number }>('select created_by from tournaments where id = $1', [row.tournament_id]);
  await advanceParent(row.tournament_id, row.round, row.slot, owner.rows[0]?.created_by ?? 0);
}
