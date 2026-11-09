import { Router } from 'express';
import { z } from 'zod';
import { query } from './db.js';
import type { AuthRequest } from './auth.js';
import { loadMatchState, persistDerived, dartPoints, checkoutRoutes, type Ring } from './scoring.js';
import { broadcast } from './events.js';
import { matchRole, requireMatchAccess } from './access.js';

export const matchesRouter = Router();

const RINGS: Ring[] = ['single', 'double', 'triple', 'bull', 'bullseye'];

const createSchema = z.object({
  name: z.string().max(60).optional(),
  playerIds: z.array(z.number().int().positive()).min(2).max(8),
  startScore: z.number().int().min(101).max(1001).default(501),
  doubleIn: z.boolean().default(false),
  doubleOut: z.boolean().default(true),
  bestOf: z.number().int().min(1).max(15).default(3),
  mode: z.enum(['manual', 'auto']).default('manual'),
  format: z.enum(['legs', 'sets']).default('legs'),
  bestOfSets: z.number().int().min(1).max(9).default(1),
  throwOrder: z.enum(['winner', 'alternate']).default('winner'),
  firstPosition: z.number().int().min(0).max(7).default(0),
});

matchesRouter.get('/', async (req: AuthRequest, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const limit = Math.min(100, Number(req.query.limit ?? 30) || 30);
  const rows = await query(
    `select m.id, m.name, m.start_score, m.double_in, m.double_out, m.best_of, m.mode, m.status,
            m.created_at, m.finished_at, m.winner_player_id, m.share_code,
            coalesce(
              (select json_agg(json_build_object('playerId', p.id, 'name', p.name, 'avatar', p.avatar) order by mp.position)
                 from match_players mp join players p on p.id = mp.player_id where mp.match_id = m.id),
              '[]'::json
            ) as players,
            (select count(*) from legs l where l.match_id = m.id) as legs_played
       from matches m
      where ($1::text is null or m.status = $1)
        and (
          m.created_by = $3
          or exists (
            select 1 from match_players mp join players p on p.id = mp.player_id
             where mp.match_id = m.id and p.owner_id = $3
          )
        )
      order by m.id desc limit $2`,
    [status, limit, req.userId],
  );
  res.json({ matches: rows.rows });
});

matchesRouter.post('/', async (req: AuthRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid-input', details: parsed.error.flatten() });
    return;
  }
  const { name, playerIds, startScore, doubleIn, doubleOut, bestOf, mode, format, bestOfSets, throwOrder } = parsed.data;
  const firstPosition = Math.min(parsed.data.firstPosition, playerIds.length - 1);
  const unique = [...new Set(playerIds)];
  if (unique.length !== playerIds.length) {
    res.status(400).json({ error: 'duplicate-players' });
    return;
  }
  const found = await query<{ id: number }>('select id from players where id = any($1::int[])', [unique]);
  if (found.rowCount !== unique.length) {
    res.status(400).json({ error: 'unknown-player' });
    return;
  }
  const created = await query<{ id: number }>(
    `insert into matches (created_by, name, start_score, double_in, double_out, best_of, mode, share_code,
                          format, best_of_sets, throw_order, first_position)
     values ($1,$2,$3,$4,$5,$6,$7, upper(substr(md5(random()::text), 1, 6)), $8, $9, $10, $11) returning id`,
    [req.userId, name ?? '', startScore, doubleIn, doubleOut, bestOf, mode, format, bestOfSets, throwOrder, firstPosition],
  );
  const matchId = created.rows[0].id;
  for (let i = 0; i < unique.length; i += 1) {
    await query('insert into match_players (match_id, player_id, position) values ($1,$2,$3)', [matchId, unique[i], i]);
  }
  const state = await loadMatchState(matchId);
  broadcast(matchId, 'match', { action: 'created' });
  res.status(201).json(state);
});

matchesRouter.get('/:id', requireMatchAccess, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const state = await loadMatchState(id);
  if (!state) {
    res.status(404).json({ error: 'not-found' });
    return;
  }
  res.json(state);
});

/**
 * Offener Zug des Spielers, der dran ist: letzter Zug dieser Leg mit weniger als
 * drei Darts, der nicht durch Bust, Checkout oder „vorzeitig beenden" abgeschlossen ist.
 */
function openVisit(state: NonNullable<Awaited<ReturnType<typeof loadMatchState>>>, matchPlayerId: number) {
  const own = state.visits.filter(
    (v) => v.legIndex === state.currentLegIndex && v.matchPlayerId === matchPlayerId,
  );
  const last = own[own.length - 1];
  if (!last) return null;
  if (last.bust || last.checkout || last.endedEarly) return null;
  if (last.darts.length >= 3) return null;
  return last.id;
}

matchesRouter.post('/:id/darts', requireMatchAccess, async (req: AuthRequest, res) => {
  const matchId = Number(req.params.id);
  const schema = z.object({
    ring: z.enum(['single', 'double', 'triple', 'bull', 'bullseye']),
    number: z.number().int().min(0).max(20).default(0),
    source: z.enum(['manual', 'camera', 'remote']).default('manual'),
    confidence: z.number().min(0).max(1).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid-input', details: parsed.error.flatten() });
    return;
  }
  const ring = parsed.data.ring;
  if (!RINGS.includes(ring)) {
    res.status(400).json({ error: 'invalid-ring' });
    return;
  }
  const number = ring === 'bull' || ring === 'bullseye' ? 0 : parsed.data.number;
  if ((ring === 'single' || ring === 'double' || ring === 'triple') && (number < 1 || number > 20)) {
    res.status(400).json({ error: 'invalid-number' });
    return;
  }

  const state = await loadMatchState(matchId);
  if (!state) {
    res.status(404).json({ error: 'not-found' });
    return;
  }
  if (state.finished) {
    res.status(409).json({ error: 'match-finished' });
    return;
  }
  const current = state.players.find((p) => p.matchPlayerId === state.currentMatchPlayerId);
  if (!current) {
    res.status(409).json({ error: 'no-active-player' });
    return;
  }

  let visitId = openVisit(state, current.matchPlayerId);
  if (!visitId) {
    const created = await query<{ id: number }>(
      `insert into visits (match_id, match_player_id, leg_index, visit_index, source)
       values ($1,$2,$3,(select coalesce(max(visit_index),0)+1 from visits where match_id=$1),$4) returning id`,
      [matchId, current.matchPlayerId, state.currentLegIndex, parsed.data.source],
    );
    visitId = created.rows[0].id;
  }

  await query(
    'insert into darts (visit_id, match_id, match_player_id, ring, number, points, source, confidence) values ($1,$2,$3,$4,$5,$6,$7,$8)',
    [visitId, matchId, current.matchPlayerId, ring, number, dartPoints(ring, number), parsed.data.source, parsed.data.confidence ?? null],
  );

  const next = await loadMatchState(matchId);
  if (next) await persistDerived(matchId, next);
  broadcast(matchId, 'dart', { matchId, matchPlayerId: current.matchPlayerId });
  res.json(next);
});

matchesRouter.post('/:id/visits/end', requireMatchAccess, async (req: AuthRequest, res) => {
  const matchId = Number(req.params.id);
  const state = await loadMatchState(matchId);
  if (!state || state.finished) {
    res.status(409).json({ error: 'not-active' });
    return;
  }
  const current = state.players.find((p) => p.matchPlayerId === state.currentMatchPlayerId);
  if (!current) {
    res.status(409).json({ error: 'no-active-player' });
    return;
  }
  const lastVisit = state.lastVisit;
  if (!lastVisit || lastVisit.matchPlayerId !== current.matchPlayerId || lastVisit.darts.length === 0) {
    res.status(409).json({ error: 'nothing-to-end' });
    return;
  }
  if (lastVisit.darts.length < 3) {
    // Zug vorzeitig beenden: Bust-Marker verhindert weiteres Anhängen.
    await query('update visits set ended_early = true where id = $1', [lastVisit.id]);
  }
  const next = await loadMatchState(matchId);
  if (next) await persistDerived(matchId, next);
  broadcast(matchId, 'visit', { action: 'ended' });
  res.json(next);
});

matchesRouter.delete('/:id/darts/last', requireMatchAccess, async (req: AuthRequest, res) => {
  const matchId = Number(req.params.id);
  const last = await query<{ id: number; visit_id: number }>(
    `select d.id, d.visit_id from darts d where d.match_id = $1 order by d.id desc limit 1`,
    [matchId],
  );
  if (!last.rowCount) {
    res.status(404).json({ error: 'no-darts' });
    return;
  }
  await query('delete from darts where id = $1', [last.rows[0].id]);
  const rest = await query('select count(*)::int as n from darts where visit_id = $1', [last.rows[0].visit_id]);
  if (rest.rows[0].n === 0) {
    await query('delete from visits where id = $1', [last.rows[0].visit_id]);
  }
  const next = await loadMatchState(matchId);
  if (next) await persistDerived(matchId, next);
  broadcast(matchId, 'dart', { action: 'undone' });
  res.json(next);
});

matchesRouter.patch('/:id/darts/:dartId', requireMatchAccess, async (req: AuthRequest, res) => {
  const matchId = Number(req.params.id);
  const dartId = Number(req.params.dartId);
  const schema = z.object({ ring: z.enum(['single', 'double', 'triple', 'bull', 'bullseye']), number: z.number().int().min(0).max(20) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid-input' });
    return;
  }
  const number = parsed.data.ring === 'bull' || parsed.data.ring === 'bullseye' ? 0 : parsed.data.number;
  const updated = await query(
    'update darts set ring = $3, number = $4, points = $5 where id = $1 and match_id = $2',
    [dartId, matchId, parsed.data.ring, number, dartPoints(parsed.data.ring, number)],
  );
  if (!updated.rowCount) {
    res.status(404).json({ error: 'not-found' });
    return;
  }
  const next = await loadMatchState(matchId);
  if (next) await persistDerived(matchId, next);
  broadcast(matchId, 'dart', { action: 'corrected' });
  res.json(next);
});

matchesRouter.post('/:id/abandon', requireMatchAccess, async (req: AuthRequest, res) => {
  const matchId = Number(req.params.id);
  await query("update matches set status = 'abandoned', finished_at = now() where id = $1 and status = 'active'", [matchId]);
  broadcast(matchId, 'match', { action: 'abandoned' });
  res.json({ ok: true });
});

/** Zuschauer ohne Konto: Code aus der App, liefert nur den Spielstand. */
export const watchRouter = Router();

watchRouter.get('/:code', async (req, res) => {
  const code = String(req.params.code ?? '').toUpperCase().trim();
  if (!/^[A-Z0-9]{4,10}$/.test(code)) {
    res.status(400).json({ error: 'invalid-code' });
    return;
  }
  const found = await query<{ id: number }>('select id from matches where upper(share_code) = $1', [code]);
  if (!found.rowCount) {
    res.status(404).json({ error: 'not-found', message: 'Kein Match mit diesem Code.' });
    return;
  }
  const state = await loadMatchState(found.rows[0].id);
  if (!state) {
    res.status(404).json({ error: 'not-found' });
    return;
  }
  res.json({ ...state, live: true });
});

matchesRouter.get('/:id/checkout', async (req: AuthRequest, res) => {
  const remaining = Number(req.query.remaining ?? 0);
  const doubleOut = req.query.doubleOut !== 'false';
  res.json({ routes: checkoutRoutes(remaining, doubleOut) });
});
