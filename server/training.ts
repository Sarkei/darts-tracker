import { Router } from 'express';
import { z } from 'zod';
import { query } from './db.js';
import type { AuthRequest } from './auth.js';

export const trainingRouter = Router();

const MODES = ['doubles', 'bobs27', 'around', 'checkout'] as const;

const sessionSchema = z.object({
  mode: z.enum(MODES),
  score: z.number().int().min(-5000).max(20000),
  hits: z.number().int().min(0).max(5000),
  darts: z.number().int().min(0).max(5000),
  detail: z.record(z.unknown()).default({}),
  playerId: z.number().int().positive().optional(),
});

trainingRouter.post('/', async (req: AuthRequest, res) => {
  const parsed = sessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid-input', details: parsed.error.flatten() });
    return;
  }
  let playerId = parsed.data.playerId ?? null;
  if (!playerId) {
    const own = await query<{ id: number }>('select id from players where owner_id = $1', [req.userId]);
    playerId = own.rows[0]?.id ?? null;
  }
  const created = await query<{ id: number }>(
    `insert into training_sessions (user_id, player_id, mode, score, hits, darts, detail)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb) returning id`,
    [
      req.userId,
      playerId,
      parsed.data.mode,
      parsed.data.score,
      parsed.data.hits,
      parsed.data.darts,
      JSON.stringify(parsed.data.detail),
    ],
  );
  res.status(201).json({ id: created.rows[0].id });
});

trainingRouter.get('/', async (req: AuthRequest, res) => {
  const limit = Math.min(100, Number(req.query.limit ?? 30) || 30);
  const rows = await query(
    `select id, mode, score, hits, darts, detail, created_at as "createdAt"
       from training_sessions where user_id = $1 order by id desc limit $2`,
    [req.userId, limit],
  );
  const summary = await query<{ mode: string; sessions: string; best: number; avg: number; hits: string; darts: string }>(
    `select mode,
            count(*)::text as sessions,
            coalesce(max(score),0) as best,
            coalesce(round(avg(score)::numeric, 1), 0)::float as avg,
            coalesce(sum(hits),0)::text as hits,
            coalesce(sum(darts),0)::text as darts
       from training_sessions where user_id = $1 group by mode`,
    [req.userId],
  );
  res.json({ sessions: rows.rows, summary: summary.rows });
});

trainingRouter.delete('/:id', async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  await query('delete from training_sessions where id = $1 and user_id = $2', [id, req.userId]);
  res.json({ ok: true });
});
