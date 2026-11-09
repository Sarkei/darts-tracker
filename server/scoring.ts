import { query } from './db.js';

export type Ring = 'single' | 'double' | 'triple' | 'bull' | 'bullseye';

export interface DartInput {
  ring: Ring;
  number: number; // 1..20, bei bull/bullseye 0
}

export interface MatchConfig {
  id: number;
  startScore: number;
  doubleIn: boolean;
  doubleOut: boolean;
  bestOf: number;
  status: string;
}

export interface PlayerState {
  matchPlayerId: number;
  playerId: number;
  name: string;
  avatar: string;
  position: number;
  remaining: number;
  entered: boolean;
  legsWon: number;
  /** Würfe in dieser Leg (für die First-9-Statistik). */
  visitsThisLeg: number;
  pointsThisLeg: number;
  dartsThisLeg: number;
  checkoutSuggestion: CheckoutRoute[] | null;
}

export interface CheckoutThrow {
  label: string;
  ring: Ring;
  number: number;
}

export interface CheckoutRoute {
  label: string;
  throws: CheckoutThrow[];
  darts: number;
}

export interface VisitView {
  id: number;
  matchPlayerId: number;
  legIndex: number;
  score: number;
  remainingAfter: number;
  bust: boolean;
  checkout: boolean;
  endedEarly: boolean;
  source: string;
  darts: Array<{ id: number; ring: Ring; number: number; points: number; source: string }>;
}

export interface MatchState {
  match: MatchConfig & { name: string; mode: string; winnerPlayerId: number | null; shareCode?: string | null };
  players: PlayerState[];
  currentMatchPlayerId: number | null;
  currentLegIndex: number;
  legs: Array<{ legIndex: number; winnerMatchPlayerId: number; dartsThrown: number }>;
  visits: VisitView[];
  lastVisit: VisitView | null;
  finished: boolean;
}

/** Punkte eines Feldes. */
export function dartPoints(ring: Ring, number: number): number {
  if (ring === 'bull') return 25;
  if (ring === 'bullseye') return 50;
  if (number < 1 || number > 20) return 0;
  if (ring === 'double') return number * 2;
  if (ring === 'triple') return number * 3;
  return number;
}

export function isDouble(ring: Ring): boolean {
  return ring === 'double' || ring === 'bullseye';
}

export function dartLabel(ring: Ring, number: number): string {
  if (ring === 'bull') return '25';
  if (ring === 'bullseye') return 'Bull';
  if (ring === 'triple') return `T${number}`;
  if (ring === 'double') return `D${number}`;
  return `S${number}`;
}

// --- Checkout-Vorschläge -----------------------------------------------------

const ALL_THROWS: CheckoutThrow[] = [
  ...Array.from({ length: 20 }, (_, i) => ({ label: `T${i + 1}`, ring: 'triple' as Ring, number: i + 1 })),
  ...Array.from({ length: 20 }, (_, i) => ({ label: `D${i + 1}`, ring: 'double' as Ring, number: i + 1 })),
  ...Array.from({ length: 20 }, (_, i) => ({ label: `S${i + 1}`, ring: 'single' as Ring, number: i + 1 })),
  { label: 'Bull', ring: 'bullseye', number: 0 },
  { label: '25', ring: 'bull', number: 0 },
];

const NICE_DOUBLES = new Set([20, 16, 18, 12, 10, 8, 4, 2, 19, 17]);

const routeCache = new Map<string, CheckoutRoute[]>();

function throwScore(t: CheckoutThrow): number {
  return dartPoints(t.ring, t.number);
}

/** Wie „schön" ist ein Wurf als erster/zweiter Dart? Bevorzugt Triples auf 20/19, meidet Bull früh. */
function setupScore(t: CheckoutThrow): number {
  let s = 0;
  if (t.ring === 'triple') s += 10;
  if (t.number === 20) s += 6;
  if (t.number === 19) s += 4;
  if (t.ring === 'bullseye') s -= 6;
  if (t.ring === 'bull') s -= 8;
  if (t.ring === 'triple' && t.number > 20) s -= 4;
  return s;
}

function finishScore(t: CheckoutThrow): number {
  if (NICE_DOUBLES.has(t.number)) return 10;
  if (t.ring === 'bullseye') return 4;
  if (t.ring === 'double') return 6;
  return 0;
}

/**
 * Alle Finish-Wege für einen Restscore (max. 3 Darts).
 * Bei doubleOut muss der letzte Dart ein Doppel (oder Bullseye) sein.
 */
export function checkoutRoutes(remaining: number, doubleOut: boolean, dartsLeft = 3): CheckoutRoute[] {
  const key = `${remaining}|${doubleOut}|${dartsLeft}`;
  const cached = routeCache.get(key);
  if (cached) return cached;
  if (remaining < 1 || remaining > 170 || dartsLeft < 1) {
    routeCache.set(key, []);
    return [];
  }

  const routes: CheckoutRoute[] = [];
  const seen = new Set<string>();
  const push = (throws: CheckoutThrow[]) => {
    const label = throws.map((t) => t.label).join(' ');
    if (seen.has(label)) return;
    seen.add(label);
    routes.push({ label, throws, darts: throws.length });
  };

  for (const a of ALL_THROWS) {
    const rest1 = remaining - throwScore(a);
    if (rest1 < 0) continue;
    if (doubleOut && rest1 === 1) continue;
    if (rest1 === 0) {
      if (!doubleOut || isDouble(a.ring)) push([a]);
      continue;
    }
    if (dartsLeft < 2) continue;
    for (const b of ALL_THROWS) {
      const rest2 = rest1 - throwScore(b);
      if (rest2 < 0) continue;
      if (doubleOut && rest2 === 1) continue;
      if (rest2 === 0) {
        if (!doubleOut || isDouble(b.ring)) push([a, b]);
        continue;
      }
      if (dartsLeft < 3) continue;
      for (const c of ALL_THROWS) {
        if (throwScore(c) !== rest2) continue;
        if (doubleOut && !isDouble(c.ring)) continue;
        push([a, b, c]);
      }
    }
  }

  routes.sort((x, y) => {
    if (x.darts !== y.darts) return x.darts - y.darts;
    const sx = setupScore(x.throws[0]) + finishScore(x.throws[x.throws.length - 1]);
    const sy = setupScore(y.throws[0]) + finishScore(y.throws[y.throws.length - 1]);
    if (sx !== sy) return sy - sx;
    return y.throws[0].number - x.throws[0].number;
  });

  const top = routes.slice(0, 4);
  routeCache.set(key, top);
  return top;
}

// --- Replay: einzige Wahrheit ist die Wurfliste ------------------------------

interface ReplayRow {
  visit_id: number;
  visit_match_player_id: number;
  visit_leg_index: number;
  visit_ended_early: boolean;
  visit_source: string;
  dart_id: number;
  ring: Ring;
  number: number;
  dart_source: string;
}

/**
 * Rechnet den kompletten Matchzustand aus den gespeicherten Würfen neu.
 * Dadurch sind Korrekturen und Undo trivial — es gibt keinen zweiten Zustand.
 */
export function replayMatch(
  match: MatchState['match'] & { startScore: number; doubleIn: boolean; doubleOut: boolean; bestOf: number },
  players: Array<{ matchPlayerId: number; playerId: number; name: string; avatar: string; position: number }>,
  rows: ReplayRow[],
): MatchState {
  const states = new Map<number, PlayerState>();
  for (const p of players) {
    states.set(p.matchPlayerId, {
      matchPlayerId: p.matchPlayerId,
      playerId: p.playerId,
      name: p.name,
      avatar: p.avatar,
      position: p.position,
      remaining: match.startScore,
      entered: !match.doubleIn,
      legsWon: 0,
      visitsThisLeg: 0,
      pointsThisLeg: 0,
      dartsThisLeg: 0,
      checkoutSuggestion: null,
    });
  }

  const ordered = [...players].sort((a, b) => a.position - b.position);
  const visits: VisitView[] = [];
  const legs: MatchState['legs'] = [];
  let currentLegIndex = 1;
  let turnPointer = 0;
  let finished = false;
  let winnerMatchPlayerId: number | null = null;

  // nach match_player gruppieren, Reihenfolge bleibt die Einfügereihenfolge der Würfe
  const byVisit = new Map<number, { vis: ReplayRow; darts: ReplayRow[] }>();
  for (const row of rows) {
    const entry = byVisit.get(row.visit_id);
    if (entry) entry.darts.push(row);
    else byVisit.set(row.visit_id, { vis: row, darts: [row] });
  }

  for (const { vis, darts } of byVisit.values()) {
    if (finished) break;
    const state = states.get(vis.visit_match_player_id);
    if (!state) continue;

    const startRemaining = state.remaining;
    const startEntered = state.entered;
    let score = 0;
    let bust = false;
    let checkout = false;

    for (const d of darts) {
      const pts = dartPoints(d.ring, d.number);
      let counted = pts;
      if (match.doubleIn && !state.entered) {
        if (isDouble(d.ring)) state.entered = true;
        else counted = 0;
      }
      score += counted;
      const rest = startRemaining - score;
      if (rest < 0) {
        bust = true;
        break;
      }
      if (rest === 1 && match.doubleOut) {
        bust = true;
        break;
      }
      if (rest === 0) {
        if (match.doubleOut && !isDouble(d.ring)) {
          bust = true;
          break;
        }
        checkout = true;
        break;
      }
    }

    let remainingAfter: number;
    if (bust) {
      state.remaining = startRemaining;
      state.entered = startEntered;
      remainingAfter = startRemaining;
    } else {
      state.remaining = startRemaining - score;
      remainingAfter = state.remaining;
    }

    state.visitsThisLeg += 1;
    state.pointsThisLeg += bust ? 0 : score;
    state.dartsThisLeg += darts.length;

    visits.push({
      id: vis.visit_id,
      matchPlayerId: vis.visit_match_player_id,
      legIndex: currentLegIndex,
      score: bust ? 0 : score,
      remainingAfter,
      bust,
      checkout,
      endedEarly: vis.visit_ended_early === true,
      source: vis.visit_source,
      darts: darts.map((d) => ({
        id: d.dart_id,
        ring: d.ring,
        number: d.number,
        points: dartPoints(d.ring, d.number),
        source: d.dart_source,
      })),
    });

    if (checkout) {
      legs.push({
        legIndex: currentLegIndex,
        winnerMatchPlayerId: state.matchPlayerId,
        dartsThrown: darts.length,
      });
      state.legsWon += 1;

      const target = Math.ceil(match.bestOf / 2);
      const legWinner = state.matchPlayerId;
      const matchOver = state.legsWon >= target;

      if (matchOver) {
        finished = true;
        winnerMatchPlayerId = legWinner;
      } else {
        currentLegIndex += 1;
        for (const s of states.values()) {
          s.remaining = match.startScore;
          s.entered = !match.doubleIn;
          s.visitsThisLeg = 0;
          s.pointsThisLeg = 0;
          s.dartsThisLeg = 0;
        }
        // Sieger des Legs wirft das nächste Leg an.
        turnPointer = ordered.findIndex((p) => p.matchPlayerId === legWinner);
      }
    } else if (bust || vis.visit_ended_early === true || darts.length >= 3) {
      // Nur ein abgeschlossener Zug gibt die Runde weiter — ein Zug mit 1–2 Darts läuft weiter.
      turnPointer = (ordered.findIndex((p) => p.matchPlayerId === state.matchPlayerId) + 1) % ordered.length;
    }
  }

  const current = finished ? null : ordered[turnPointer]?.matchPlayerId ?? null;
  const playerStates = [...states.values()].sort((a, b) => a.position - b.position);

  for (const p of playerStates) {
    p.checkoutSuggestion =
      !finished && p.matchPlayerId === current && p.remaining <= 170 && p.remaining > 1
        ? checkoutRoutes(p.remaining, match.doubleOut)
        : p.remaining === 1 && !match.doubleOut
          ? checkoutRoutes(1, false)
          : null;
  }

  return {
    match: { ...match, winnerPlayerId: winnerMatchPlayerId },
    players: playerStates,
    currentMatchPlayerId: current,
    currentLegIndex,
    legs,
    visits,
    lastVisit: visits.length ? visits[visits.length - 1] : null,
    finished,
  };
}

export async function loadMatchState(matchId: number): Promise<MatchState | null> {
  const m = await query<{
    id: number;
    name: string;
    start_score: number;
    double_in: boolean;
    double_out: boolean;
    best_of: number;
    mode: string;
    status: string;
    winner_player_id: number | null;
    share_code: string | null;
  }>('select id, name, start_score, double_in, double_out, best_of, mode, status, winner_player_id, share_code from matches where id = $1', [matchId]);
  if (!m.rowCount) return null;
  const match = m.rows[0];

  const pl = await query<{ id: number; player_id: number; position: number; name: string; avatar: string }>(
    `select mp.id, mp.player_id, mp.position, p.name, p.avatar
       from match_players mp join players p on p.id = mp.player_id
      where mp.match_id = $1 order by mp.position`,
    [matchId],
  );

  const rows = await query<ReplayRow>(
    `select v.id as visit_id, v.match_player_id as visit_match_player_id, 1 as visit_leg_index,
            v.ended_early as visit_ended_early,
            v.source as visit_source, d.id as dart_id, d.ring, d.number, d.source as dart_source
       from visits v join darts d on d.visit_id = v.id
      where v.match_id = $1
      order by v.id, d.id`,
    [matchId],
  );

  return replayMatch(
    {
      id: match.id,
      name: match.name,
      mode: match.mode,
      status: match.status,
      startScore: match.start_score,
      doubleIn: match.double_in,
      doubleOut: match.double_out,
      bestOf: match.best_of,
      winnerPlayerId: match.winner_player_id,
      shareCode: match.share_code,
    },
    pl.rows.map((r) => ({
      matchPlayerId: r.id,
      playerId: r.player_id,
      name: r.name,
      avatar: r.avatar,
      position: r.position,
    })),
    rows.rows,
  );
}

/** Leg-Gewinner und Matchstatus nach dem Replay in die Tabellen spiegeln. */
export async function persistDerived(matchId: number, state: MatchState) {
  await query('delete from legs where match_id = $1', [matchId]);
  for (const leg of state.legs) {
    await query(
      'insert into legs (match_id, leg_index, winner_match_player_id, darts_thrown) values ($1,$2,$3,$4)',
      [matchId, leg.legIndex, leg.winnerMatchPlayerId, leg.dartsThrown],
    );
  }
  for (const visit of state.visits) {
    await query('update visits set leg_index = $2 where id = $1 and leg_index <> $2', [visit.id, visit.legIndex]);
  }
  const winnerPlayerId = state.match.winnerPlayerId
    ? state.players.find((p) => p.matchPlayerId === state.match.winnerPlayerId)?.playerId ?? null
    : null;
  await query(
    `update matches set status = $2, winner_player_id = $3, finished_at = case when $2 = 'finished' then now() else null end where id = $1`,
    [matchId, state.finished ? 'finished' : 'active', winnerPlayerId],
  );
}
