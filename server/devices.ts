import { Router } from 'express';
import { z } from 'zod';
import { query } from './db.js';
import type { AuthRequest } from './auth.js';
import { loadMatchState, persistDerived, dartPoints } from './scoring.js';
import { broadcast } from './events.js';
import { requireMatchAccess } from './access.js';

export const devicesRouter = Router();

const roleSchema = z.enum(['camera', 'dashboard', 'viewer']);

async function listDevices(matchId: number) {
  const rows = await query(
    `select device_id as "deviceId", role, name, status, last_seen as "lastSeen"
       from match_devices where match_id = $1 order by role, last_seen desc`,
    [matchId],
  );
  return rows.rows;
}

devicesRouter.get('/:id/devices', requireMatchAccess, async (req: AuthRequest, res) => {
  res.json({ devices: await listDevices(Number(req.params.id)) });
});

/**
 * Gerät anmelden oder Rolle wechseln. Es gibt pro Match genau **eine** Kamera:
 * beansprucht ein Gerät die Rolle, wird jedes andere Kamera-Gerät auf „dashboard" zurückgestuft.
 */
devicesRouter.post('/:id/devices', requireMatchAccess, async (req: AuthRequest, res) => {
  const matchId = Number(req.params.id);
  const parsed = z
    .object({ deviceId: z.string().min(4).max(80), role: roleSchema, name: z.string().max(60).default('') })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid-input' });
    return;
  }
  const { deviceId, role, name } = parsed.data;

  if (role === 'camera') {
    await query("update match_devices set role = 'dashboard' where match_id = $1 and role = 'camera' and device_id <> $2", [
      matchId,
      deviceId,
    ]);
  }

  await query(
    `insert into match_devices (match_id, device_id, role, name, last_seen)
     values ($1,$2,$3,$4, now())
     on conflict (match_id, device_id)
     do update set role = excluded.role, name = excluded.name, last_seen = now()`,
    [matchId, deviceId, role, name],
  );

  const devices = await listDevices(matchId);
  broadcast(matchId, 'role', { devices });
  res.json({ devices });
});

devicesRouter.delete('/:id/devices/:deviceId', requireMatchAccess, async (req: AuthRequest, res) => {
  const matchId = Number(req.params.id);
  await query('delete from match_devices where match_id = $1 and device_id = $2', [matchId, req.params.deviceId]);
  const devices = await listDevices(matchId);
  broadcast(matchId, 'role', { devices });
  res.json({ devices });
});

/** Lebenszeichen + Kamerastatus (Qualität, Meldung). Wird vom Kamera-Gerät regelmäßig gesendet. */
devicesRouter.post('/:id/devices/:deviceId/status', requireMatchAccess, async (req: AuthRequest, res) => {
  const matchId = Number(req.params.id);
  const parsed = z
    .object({
      quality: z.enum(['good', 'ok', 'bad']).default('ok'),
      message: z.string().max(160).default(''),
      fps: z.number().min(0).max(120).optional(),
      calibrated: z.boolean().optional(),
    })
    .safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid-input' });
    return;
  }
  await query(
    `update match_devices set status = $3::jsonb, last_seen = now()
      where match_id = $1 and device_id = $2`,
    [matchId, req.params.deviceId, JSON.stringify(parsed.data)],
  );
  broadcast(matchId, 'camera', { deviceId: req.params.deviceId, ...parsed.data });
  res.json({ ok: true });
});

/** Wurf, den die Kamera erkannt hat: sicher → direkt eintragen, unsicher → als Vorschlag ablegen. */
devicesRouter.post('/:id/candidates', requireMatchAccess, async (req: AuthRequest, res) => {
  const matchId = Number(req.params.id);
  const parsed = z
    .object({
      deviceId: z.string().min(4).max(80),
      ring: z.enum(['single', 'double', 'triple', 'bull', 'bullseye']),
      number: z.number().int().min(0).max(20),
      confidence: z.number().min(0).max(1).default(0.5),
      auto: z.boolean().default(false),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid-input' });
    return;
  }
  const { deviceId, ring, confidence, auto } = parsed.data;
  const number = ring === 'bull' || ring === 'bullseye' ? 0 : parsed.data.number;

  if (auto && confidence >= 0.6) {
    const state = await loadMatchState(matchId);
    if (!state || state.finished) {
      res.status(409).json({ error: 'match-not-active' });
      return;
    }
    const current = state.players.find((p) => p.matchPlayerId === state.currentMatchPlayerId);
    if (!current) {
      res.status(409).json({ error: 'no-active-player' });
      return;
    }
    const own = state.visits.filter(
      (v) => v.legIndex === state.currentLegIndex && v.matchPlayerId === current.matchPlayerId,
    );
    const last = own[own.length - 1];
    let visitId: number | null =
      last && !last.bust && !last.checkout && !last.endedEarly && last.darts.length < 3 ? last.id : null;
    if (!visitId) {
      const created = await query<{ id: number }>(
        `insert into visits (match_id, match_player_id, leg_index, visit_index, source)
         values ($1,$2,$3,(select coalesce(max(visit_index),0)+1 from visits where match_id=$1),'camera') returning id`,
        [matchId, current.matchPlayerId, state.currentLegIndex],
      );
      visitId = created.rows[0].id;
    }
    await query(
      `insert into darts (visit_id, match_id, match_player_id, ring, number, points, source, confidence)
       values ($1,$2,$3,$4,$5,$6,'camera',$7)`,
      [visitId, matchId, current.matchPlayerId, ring, number, dartPoints(ring, number), confidence],
    );
    const next = await loadMatchState(matchId);
    if (next) await persistDerived(matchId, next);
    broadcast(matchId, 'dart', { source: 'camera', ring, number, confidence });
    res.status(201).json({ mode: 'committed', state: next });
    return;
  }

  const created = await query<{ id: number }>(
    `insert into dart_candidates (match_id, device_id, ring, number, confidence)
     values ($1,$2,$3,$4,$5) returning id`,
    [matchId, deviceId, ring, number, confidence],
  );
  broadcast(matchId, 'candidate', { id: created.rows[0].id, ring, number, confidence });
  res.status(201).json({ mode: 'pending', id: created.rows[0].id });
});

devicesRouter.get('/:id/candidates', requireMatchAccess, async (req: AuthRequest, res) => {
  const rows = await query(
    `select id, ring, number, confidence, created_at as "createdAt"
       from dart_candidates where match_id = $1 and status = 'pending' order by id`,
    [Number(req.params.id)],
  );
  res.json({ candidates: rows.rows });
});

/** Vorschlag übernehmen, verwerfen oder korrigiert eintragen. */
devicesRouter.post('/:id/candidates/:candidateId', requireMatchAccess, async (req: AuthRequest, res) => {
  const matchId = Number(req.params.id);
  const candidateId = Number(req.params.candidateId);
  const parsed = z
    .object({
      action: z.enum(['approve', 'reject']),
      ring: z.enum(['single', 'double', 'triple', 'bull', 'bullseye']).optional(),
      number: z.number().int().min(0).max(20).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid-input' });
    return;
  }
  const found = await query<{ ring: string; number: number }>(
    "select ring, number from dart_candidates where id = $1 and match_id = $2 and status = 'pending'",
    [candidateId, matchId],
  );
  if (!found.rowCount) {
    res.status(404).json({ error: 'not-found' });
    return;
  }
  await query("update dart_candidates set status = $2 where id = $1", [
    candidateId,
    parsed.data.action === 'approve' ? 'approved' : 'rejected',
  ]);

  if (parsed.data.action === 'reject') {
    broadcast(matchId, 'candidate', { id: candidateId, action: 'rejected' });
    res.json({ ok: true });
    return;
  }

  const ring = parsed.data.ring ?? (found.rows[0].ring as 'single');
  const number = ring === 'bull' || ring === 'bullseye' ? 0 : parsed.data.number ?? found.rows[0].number;

  const state = await loadMatchState(matchId);
  if (!state || state.finished) {
    res.status(409).json({ error: 'match-not-active' });
    return;
  }
  const current = state.players.find((p) => p.matchPlayerId === state.currentMatchPlayerId);
  if (!current) {
    res.status(409).json({ error: 'no-active-player' });
    return;
  }
  const own = state.visits.filter(
    (v) => v.legIndex === state.currentLegIndex && v.matchPlayerId === current.matchPlayerId,
  );
  const last = own[own.length - 1];
  let visitId: number | null =
    last && !last.bust && !last.checkout && !last.endedEarly && last.darts.length < 3 ? last.id : null;
  if (!visitId) {
    const created = await query<{ id: number }>(
      `insert into visits (match_id, match_player_id, leg_index, visit_index, source)
       values ($1,$2,$3,(select coalesce(max(visit_index),0)+1 from visits where match_id=$1),'camera') returning id`,
      [matchId, current.matchPlayerId, state.currentLegIndex],
    );
    visitId = created.rows[0].id;
  }
  await query(
    `insert into darts (visit_id, match_id, match_player_id, ring, number, points, source, confidence)
     values ($1,$2,$3,$4,$5,$6,'camera',null)`,
    [visitId, matchId, current.matchPlayerId, ring, number, dartPoints(ring, number)],
  );
  const next = await loadMatchState(matchId);
  if (next) await persistDerived(matchId, next);
  broadcast(matchId, 'dart', { source: 'camera', ring, number });
  res.json({ ok: true, state: next });
});
