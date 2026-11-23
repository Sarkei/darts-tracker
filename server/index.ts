import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { initDb, query, pool } from './db.js';
import { authRouter, requireAuth } from './auth.js';
import { playersRouter } from './players.js';
import { matchesRouter, watchRouter } from './matches.js';
import { statsRouter } from './stats.js';
import { trainingRouter } from './training.js';
import { tournamentsRouter } from './tournaments.js';
import { aiRouter } from './ai.js';
import { eventsRouter } from './events.js';
import { devicesRouter } from './devices.js';
import { pushoverRouter } from './pushover-route.js';
import { pushRouter } from './push-route.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res) => {
  const started = Date.now();
  try {
    await query('select 1');
    res.json({
      status: 'ok',
      db: 'ok',
      dbLatencyMs: Date.now() - started,
      ai: { enabled: Boolean(process.env.DEEPSEEK_API_KEY), provider: 'deepseek' },
      uptimeSeconds: Math.round(process.uptime()),
    });
  } catch (e) {
    res.status(503).json({ status: 'degraded', db: 'error', message: e instanceof Error ? e.message : 'unbekannt' });
  }
});

/*
 * Pushover: Zugang hinterlegen, testen, trennen.
 */
app.use(
  '/api/integrations/pushover',
  requireAuth,
  pushoverRouter(pool as never, (req) => (req as { userId?: number }).userId ?? null, {
    titel: 'Darts-Tracker',
    text: 'Wenn du das siehst, funktionieren deine Benachrichtigungen.',
  }),
);

/*
 * Web Push: Gerät anmelden, abmelden, testen.
 * Läuft parallel zu Pushover.
 */
app.use(
  '/api/push',
  requireAuth,
  pushRouter(pool as never, (req) => (req as { userId?: number }).userId ?? null, 'Darts-Tracker'),
);

app.use('/api/auth', authRouter);
app.use('/api/events', eventsRouter);

app.use('/api/watch', watchRouter);
app.use('/api/players', requireAuth, playersRouter);
app.use('/api/matches', requireAuth, devicesRouter);
app.use('/api/matches', requireAuth, matchesRouter);
app.use('/api/stats', requireAuth, statsRouter);
app.use('/api/training', requireAuth, trainingRouter);
app.use('/api/tournaments', requireAuth, tournamentsRouter);
app.use('/api/ai', requireAuth, aiRouter);

const dist = path.resolve(process.cwd(), 'dist');
app.use(express.static(dist, { index: false, maxAge: '1h' }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    next();
    return;
  }
  res.sendFile(path.join(dist, 'index.html'));
});

// Ein einzelner fehlgeschlagener Request darf nicht den ganzen Dienst beenden
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection', reason);
});
process.on('uncaughtException', (error) => {
  console.error('uncaughtException', error);
});

const port = Number(process.env.PORT ?? 3000);

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`darts-tracker listening on ${port}`);
    });
  })
  .catch((e) => {
    console.error('DB-Init fehlgeschlagen', e);
    process.exit(1);
  });
