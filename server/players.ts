import { Router } from 'express';
import { z } from 'zod';
import { query } from './db.js';
import type { AuthRequest } from './auth.js';

export const playersRouter = Router();

playersRouter.get('/', async (req: AuthRequest, res) => {
  // Sichtbar: eigene Profile, Gäste und Spieler, mit denen man schon gespielt hat
  const rows = await query(
    `select p.id, p.name, p.avatar, p.is_guest, p.owner_id,
            (select count(*) from match_players mp where mp.player_id = p.id) as matches
       from players p
      where (p.owner_id = $1 or p.owner_id is null or exists (
              select 1 from match_players mine
                join players own on own.id = mine.player_id
                join match_players other on other.match_id = mine.match_id
               where own.owner_id = $1 and other.player_id = p.id
            ))
        and coalesce(p.archived, false) = false
      order by p.is_guest, lower(p.name)`,
    [req.userId],
  );
  res.json({ players: rows.rows });
});

playersRouter.post('/', async (req: AuthRequest, res) => {
  const schema = z.object({ name: z.string().min(1).max(40), avatar: z.string().min(1).max(8).default('🎯') });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid-input' });
    return;
  }
  const created = await query<{ id: number; name: string; avatar: string }>(
    "insert into players (owner_id, name, avatar, is_guest) values (null,$1,$2,true) returning id, name, avatar",
    [parsed.data.name.trim(), parsed.data.avatar],
  );
  res.status(201).json({ player: created.rows[0] });
});

playersRouter.patch('/:id', async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const schema = z.object({ name: z.string().min(1).max(40).optional(), avatar: z.string().min(1).max(8).optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid-input' });
    return;
  }
  const own = await query<{ owner_id: number | null }>('select owner_id from players where id = $1', [id]);
  if (!own.rowCount) {
    res.status(404).json({ error: 'not-found' });
    return;
  }
  if (own.rows[0].owner_id !== null && own.rows[0].owner_id !== req.userId) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const updated = await query(
    'update players set name = coalesce($2,name), avatar = coalesce($3,avatar) where id = $1 returning id, name, avatar',
    [id, parsed.data.name ?? null, parsed.data.avatar ?? null],
  );
  res.json({ player: updated.rows[0] });
});

/**
 * Spieler entfernen: Profile mit Konto bleiben (sonst verliert jemand seine Historie), Gäste
 * werden archiviert — sie verschwinden aus Auswahl und Rangliste, bleiben aber in alten Matches.
 */
playersRouter.delete('/:id', async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  const own = await query<{ owner_id: number | null }>('select owner_id from players where id = $1', [id]);
  if (!own.rowCount) {
    res.status(404).json({ error: 'not-found' });
    return;
  }
  const owner = own.rows[0].owner_id;
  if (owner === req.userId) {
    res.status(409).json({
      error: 'own-profile',
      message: 'Dein eigenes Profil hängt am Konto. Ändere den Namen in den Einstellungen.',
    });
    return;
  }
  if (owner !== null) {
    res.status(403).json({ error: 'forbidden', message: 'Das Profil gehört zu einem anderen Konto.' });
    return;
  }
  await query('update players set archived = true where id = $1', [id]);
  res.json({ ok: true, archived: true });
});
