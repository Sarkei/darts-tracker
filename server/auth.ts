import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query } from './db.js';

export interface AuthRequest extends Request {
  userId?: number;
  userEmail?: string;
  userName?: string;
}

const JWT_SECRET = process.env.JWT_SECRET ?? 'darts-dev-secret-bitte-aendern';
const TOKEN_TTL = '30d';

export function signToken(user: { id: number; email: string; token_version: number }) {
  return jwt.sign({ sub: user.id, email: user.email, v: user.token_version }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function readToken(token: string | undefined | null): { userId: number; version: number } | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as unknown as { sub: number; v?: number };
    if (!payload?.sub) return null;
    return { userId: Number(payload.sub), version: Number(payload.v ?? 0) };
  } catch {
    return null;
  }
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
  const token = bearer ?? (typeof req.query.token === 'string' ? req.query.token : null);
  const parsed = readToken(token);
  if (!parsed) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const result = await query<{ id: number; email: string; display_name: string; token_version: number }>(
    'select id, email, display_name, token_version from users where id = $1',
    [parsed.userId],
  );
  const user = result.rows[0];
  if (!user || user.token_version !== parsed.version) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  req.userId = user.id;
  req.userEmail = user.email;
  req.userName = user.display_name;
  next();
}

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Mindestens 8 Zeichen'),
  displayName: z.string().min(1).max(40),
});

authRouter.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid-input', details: parsed.error.flatten() });
    return;
  }
  const email = parsed.data.email.toLowerCase().trim();
  const displayName = parsed.data.displayName.trim();
  const exists = await query('select 1 from users where email = $1', [email]);
  if (exists.rowCount) {
    res.status(409).json({ error: 'email-taken' });
    return;
  }
  const hash = await bcrypt.hash(parsed.data.password, 10);
  const created = await query<{ id: number; email: string; display_name: string; avatar: string; token_version: number }>(
    'insert into users (email, password_hash, display_name) values ($1,$2,$3) returning id, email, display_name, avatar, token_version',
    [email, hash, displayName],
  );
  const user = created.rows[0];
  // Jedes Konto bekommt sofort ein Spielerprofil für Rangliste und Statistik.
  await query('insert into players (owner_id, name, avatar) values ($1,$2,$3) on conflict do nothing', [
    user.id,
    displayName,
    user.avatar,
  ]);
  res.status(201).json({ token: signToken(user), user: { id: user.id, email: user.email, displayName: user.display_name, avatar: user.avatar } });
});

authRouter.post('/login', async (req, res) => {
  const body = req.body as { email?: string; password?: string };
  if (!body.email || !body.password) {
    res.status(400).json({ error: 'invalid-input' });
    return;
  }
  const email = body.email.toLowerCase().trim();
  const found = await query<{ id: number; email: string; password_hash: string; display_name: string; avatar: string; token_version: number }>(
    'select id, email, password_hash, display_name, avatar, token_version from users where email = $1',
    [email],
  );
  const user = found.rows[0];
  if (!user || !(await bcrypt.compare(body.password, user.password_hash))) {
    res.status(401).json({ error: 'invalid-credentials' });
    return;
  }
  res.json({ token: signToken(user), user: { id: user.id, email: user.email, displayName: user.display_name, avatar: user.avatar } });
});

authRouter.get('/me', requireAuth, async (req: AuthRequest, res) => {
  const me = await query<{ id: number; email: string; display_name: string; avatar: string; settings: Record<string, unknown> }>(
    'select id, email, display_name, avatar, settings from users where id = $1',
    [req.userId],
  );
  const profile = await query<{ id: number; name: string; avatar: string }>('select id, name, avatar from players where owner_id = $1', [
    req.userId,
  ]);
  const row = me.rows[0];
  res.json({
    user: { id: row.id, email: row.email, displayName: row.display_name, avatar: row.avatar, settings: row.settings },
    player: profile.rows[0] ?? null,
  });
});

authRouter.patch('/me', requireAuth, async (req: AuthRequest, res) => {
  const schema = z.object({
    displayName: z.string().min(1).max(40).optional(),
    avatar: z.string().min(1).max(8).optional(),
    settings: z.record(z.unknown()).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid-input' });
    return;
  }
  const { displayName, avatar, settings } = parsed.data;
  await query(
    `update users set
       display_name = coalesce($2, display_name),
       avatar = coalesce($3, avatar),
       settings = coalesce($4::jsonb, settings)
     where id = $1`,
    [req.userId, displayName ?? null, avatar ?? null, settings ? JSON.stringify(settings) : null],
  );
  if (displayName) {
    await query('update players set name = $2 where owner_id = $1', [req.userId, displayName]);
  }
  if (avatar) {
    await query('update players set avatar = $2 where owner_id = $1', [req.userId, avatar]);
  }
  res.json({ ok: true });
});

authRouter.post('/password', requireAuth, async (req: AuthRequest, res) => {
  const schema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid-input' });
    return;
  }
  const found = await query<{ password_hash: string }>('select password_hash from users where id = $1', [req.userId]);
  if (!found.rowCount || !(await bcrypt.compare(parsed.data.currentPassword, found.rows[0].password_hash))) {
    res.status(401).json({ error: 'invalid-credentials' });
    return;
  }
  const hash = await bcrypt.hash(parsed.data.newPassword, 10);
  const updated = await query<{ token_version: number }>(
    'update users set password_hash = $2, token_version = token_version + 1 where id = $1 returning token_version',
    [req.userId, hash],
  );
  res.json({ ok: true, token: signToken({ id: req.userId!, email: req.userEmail!, token_version: updated.rows[0].token_version }) });
});
