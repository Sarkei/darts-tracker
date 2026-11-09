import { Router, type Response } from 'express';
import { readToken } from './auth.js';
import { matchRole } from './access.js';

interface Client {
  res: Response;
  matchId: number | null;
  userId: number;
}

const clients = new Set<Client>();

export const eventsRouter = Router();

eventsRouter.get('/', async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : null;
  const parsed = readToken(token);
  if (!parsed) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const matchId = Number(req.query.matchId ?? 0) || null;
  if (matchId) {
    const role = await matchRole(matchId, parsed.userId);
    if (!role) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ matchId, at: Date.now() })}\n\n`);

  const client: Client = { res, matchId, userId: parsed.userId };
  clients.add(client);

  const ping = setInterval(() => {
    res.write(`event: ping\ndata: ${Date.now()}\n\n`);
  }, 25_000);

  req.on('close', () => {
    clearInterval(ping);
    clients.delete(client);
  });
});

export function broadcast(matchId: number, type: string, payload: Record<string, unknown> = {}) {
  const data = `event: ${type}\ndata: ${JSON.stringify({ matchId, ...payload })}\n\n`;
  for (const client of clients) {
    if (client.matchId === null || client.matchId === matchId) {
      try {
        client.res.write(data);
      } catch {
        clients.delete(client);
      }
    }
  }
}
