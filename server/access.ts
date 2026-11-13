import type { NextFunction, Response } from 'express';
import { query } from './db.js';
import type { AuthRequest } from './auth.js';

export type MatchRole = 'organizer' | 'player';

/** Rolle eines Nutzers in einem Match: Ersteller, beteiligter Spieler oder nichts. */
export async function matchRole(matchId: number, userId: number): Promise<MatchRole | null> {
  const organizer = await query('select 1 from matches where id = $1 and created_by = $2', [matchId, userId]);
  if (organizer.rowCount) return 'organizer';
  const player = await query(
    `select 1 from match_players mp join players p on p.id = mp.player_id
      where mp.match_id = $1 and p.owner_id = $2 limit 1`,
    [matchId, userId],
  );
  if (player.rowCount) return 'player';
  return null;
}

/**
 * Nur Teilnehmer und Ersteller dürfen ein Match sehen oder verändern.
 * Zuschauer ohne Konto laufen über den Zuschauer-Code (`/api/watch/:code`).
 */
export async function requireMatchAccess(req: AuthRequest, res: Response, next: NextFunction) {
  const matchId = Number(req.params.id);
  if (!Number.isFinite(matchId) || matchId <= 0) {
    res.status(400).json({ error: 'invalid-match' });
    return;
  }
  const exists = await query('select 1 from matches where id = $1', [matchId]);
  if (!exists.rowCount) {
    res.status(404).json({ error: 'not-found' });
    return;
  }
  const role = await matchRole(matchId, req.userId!);
  if (!role) {
    res.status(403).json({ error: 'forbidden', message: 'Dieses Match gehört zu einem anderen Konto.' });
    return;
  }
  (req as AuthRequest & { matchRole?: MatchRole }).matchRole = role;
  next();
}
