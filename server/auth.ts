import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
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

/**
 * Einfaches Rate-Limit im Speicher: bremst Passwort-Raten und Registrierungs-Spam.
 * Absichtlich grob — es soll den öffentlichen Endpunkt unattraktiv machen, keine Statistik führen.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimit(bucket: string, limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${bucket}:${req.ip ?? 'unknown'}`;
    const now = Date.now();
    const entry = attempts.get(key);
    if (!entry || entry.resetAt < now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    entry.count += 1;
    if (entry.count > limit) {
      res.status(429).json({ error: 'too-many-requests', message: 'Zu viele Versuche — bitte kurz warten.' });
      return;
    }
    next();
  };
}

const INVITE_CODE = (process.env.INVITE_CODE ?? '').trim();

authRouter.get('/config', (_req, res) => {
  res.json({ inviteRequired: Boolean(INVITE_CODE), passwordResetEnabled: true });
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Mindestens 8 Zeichen'),
  displayName: z.string().min(1).max(40),
  inviteCode: z.string().max(64).optional(),
});

authRouter.post('/register', rateLimit('register', 8, 10 * 60_000), async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid-input', details: parsed.error.flatten() });
    return;
  }
  if (INVITE_CODE && (parsed.data.inviteCode ?? '').trim() !== INVITE_CODE) {
    res.status(403).json({ error: 'invite-required', message: 'Einladungscode fehlt oder ist falsch.' });
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

authRouter.post('/login', rateLimit('login', 12, 5 * 60_000), async (req, res) => {
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

/**
 * Passwort vergessen. Antwortet immer gleich, damit die Route nicht verrät, ob es das Konto gibt.
 * Ohne SMTP wird der Link in der Antwort mitgegeben (ALLOW_DEV_RESET_LINK=1).
 */
authRouter.post('/forgot-password', rateLimit('forgot', 6, 10 * 60_000), async (req, res) => {
  const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
  const devLink = process.env.ALLOW_DEV_RESET_LINK === '1';
  if (!parsed.success) {
    res.json({ ok: true, ...(devLink ? { resetPath: null } : {}) });
    return;
  }
  const email = parsed.data.email.toLowerCase().trim();
  const found = await query<{ id: number }>('select id from users where email = $1', [email]);
  let resetPath: string | null = null;
  if (found.rowCount) {
    const token = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    await query(
      "insert into password_reset_tokens (user_id, token_hash, expires_at) values ($1,$2, now() + interval '60 minutes')",
      [found.rows[0].id, hash],
    );
    resetPath = `/#/reset?token=${token}`;
  }
  res.json({ ok: true, ...(devLink ? { resetPath } : {}) });
});

/** Neues Passwort setzen. Token ist einmalig, alte Sitzungen werden über token_version entwertet. */
authRouter.post('/reset-password', rateLimit('reset', 10, 10 * 60_000), async (req, res) => {
  const parsed = z
    .object({ token: z.string().min(20).max(200), password: z.string().min(8, 'Mindestens 8 Zeichen') })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid-input' });
    return;
  }
  const hash = crypto.createHash('sha256').update(parsed.data.token).digest('hex');
  const found = await query<{ id: number; user_id: number }>(
    `select id, user_id from password_reset_tokens
      where token_hash = $1 and used_at is null and expires_at > now()`,
    [hash],
  );
  if (!found.rowCount) {
    res.status(400).json({ error: 'token-invalid', message: 'Der Link ist abgelaufen oder schon benutzt.' });
    return;
  }
  const newHash = await bcrypt.hash(parsed.data.password, 10);
  await query('update users set password_hash = $2, token_version = token_version + 1 where id = $1', [
    found.rows[0].user_id,
    newHash,
  ]);
  await query('update password_reset_tokens set used_at = now() where id = $1', [found.rows[0].id]);
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


/** Demo-Zugang für Portfolio/Demo-Domain: meldet ausschließlich das Demo-Konto an. */
const DEMO_EMAIL = (process.env.DEMO_EMAIL ?? 'demo@example.com').trim().toLowerCase();

async function handleDemo(_req: Request, res: Response) {
  try {
    const row = await query<{ id: number; email: string; display_name: string; avatar: string; token_version: number }>(
      'select id, email, display_name, avatar, token_version from users where lower(email) = $1 limit 1',
      [DEMO_EMAIL],
    );
    if (!row.rowCount) {
      res.status(404).json({ error: 'demo-unavailable', message: 'Demo ist nicht eingerichtet.' });
      return;
    }
    const u = row.rows[0];
    res.json({
      token: signToken(u),
      user: { id: u.id, email: u.email, displayName: u.display_name, avatar: u.avatar },
    });
  } catch (e) {
    console.error('[auth/demo]', e);
    res.status(500).json({ error: 'demo-failed' });
  }
}

authRouter.get('/demo', handleDemo);
authRouter.post('/demo', handleDemo);
