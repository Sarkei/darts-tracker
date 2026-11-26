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
import { pushRouter, sendePushAnNutzer } from './push-route.js';
import { benachrichtigungsRouter, benachrichtige } from './benachrichtigungen.js';

/** Versand an einen Nutzer in der Form, die `benachrichtige` erwartet. */
const sendeAn =
  (nutzerId: number | string) =>
  (n: { titel: string; text: string; url?: string; tag?: string; dringend?: boolean }) =>
    sendePushAnNutzer(pool as never, nutzerId, n);

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

/* Kategorien, Ruhezeit und Verlauf der Benachrichtigungen. */
app.use(
  '/api/benachrichtigungen',
  requireAuth,
  benachrichtigungsRouter(pool as never, (req) => (req as { userId?: number }).userId ?? null),
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

/**
 * Täglicher Takt für den Darts-Tracker.
 *
 * Der Tracker meldete sich bisher nur mitten im Spiel (180, Spielende).
 * Wer nicht gerade warf, hörte nie etwas. Dazu kommen zwei Meldungen:
 *
 *  - **Training** (18–20 Uhr): wenn seit drei Tagen keine Aufnahme erfasst
 *    wurde und heute noch nichts lief.
 *  - **Turnier-Zwischenstand** (19–21 Uhr): wer noch im Turnier ist und wie
 *    viele Spiele offen sind.
 */
async function dartsTick(): Promise<void> {
  const teile = new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit',
    hour12: false, timeZone: 'Europe/Berlin',
  }).formatToParts(new Date());
  const wert = (t: string) => teile.find((x) => x.type === t)?.value ?? '0';
  const stunde = Number(wert('hour')) % 24;
  const heute = `${wert('year')}-${wert('month')}-${wert('day')}`;

  // a) Trainingserinnerung — nur wenn drei Tage nichts lief
  if (stunde >= 18 && stunde <= 20) {
    try {
      const letzte = await query<{ user_id: number; tage: string }>(
        `SELECT p.owner_id AS user_id,
                EXTRACT(DAY FROM now() - MAX(t.created_at))::int::text AS tage
           FROM training_sessions t JOIN players p ON p.id = t.player_id
          WHERE p.owner_id IS NOT NULL
          GROUP BY p.owner_id`,
      );
      const heuteSchon = await query<{ user_id: number }>(
        `SELECT DISTINCT p.owner_id AS user_id FROM training_sessions t
           JOIN players p ON p.id = t.player_id
          WHERE t.created_at::date = $1::date`,
        [heute],
      );
      const aktivHeute = new Set(heuteSchon.rows.map((r) => r.user_id));
      // Wer noch gar nichts erfasst hat, steht nicht in `letzte` — den lassen wir in Ruhe.
      for (const r of letzte.rows) {
        if (aktivHeute.has(r.user_id)) continue;
        if (Number(r.tage) < 3) continue;
        await benachrichtige(pool, sendeAn(r.user_id), r.user_id, {
          kategorie: 'training',
          ereignis: 'darts-training',
          schluessel: heute,
          titel: 'Zeit für ein paar Aufnahmen',
          text: `Seit ${r.tage} Tagen keine Aufnahme erfasst. Ein Leg reicht, um dranzubleiben.`,
          url: 'https://darts.nas-timgreen.com/#/training',
          tag: 'darts-training',
          rhythmus: 'abend',
        });
      }
    } catch (e) {
      console.error('[push] Trainingserinnerung:', (e as Error).message);
    }
  }

  // b) Turnier-Zwischenstand
  if (stunde >= 19 && stunde <= 21) {
    try {
      const turniere = await query<{
        id: number; name: string; user_id: number; offen: string; gespielt: string; gesamt: string;
      }>(
        `SELECT t.id, t.name, t.created_by AS user_id,
                COUNT(*) FILTER (WHERE s.match_id IS NULL AND s.player_a_id IS NOT NULL)::text AS offen,
                COUNT(*) FILTER (WHERE s.match_id IS NOT NULL)::text AS gespielt,
                COUNT(*)::text AS gesamt
           FROM tournaments t
           JOIN tournament_slots s ON s.tournament_id = t.id
          WHERE t.status = 'active' AND t.created_by IS NOT NULL
          GROUP BY t.id, t.name, t.created_by
         HAVING COUNT(*) FILTER (WHERE s.match_id IS NULL AND s.player_a_id IS NOT NULL) > 0`,
      );
      for (const t of turniere.rows) {
        await benachrichtige(pool, sendeAn(t.user_id), t.user_id, {
          kategorie: 'wettkampf',
          ereignis: 'turnier-stand',
          schluessel: `${t.id}-${heute}`,
          titel: `${t.name || 'Turnier'} läuft`,
          text: `${Number(t.gespielt)} von ${Number(t.gesamt)} Partien gespielt, ${Number(t.offen)} offen.`,
          url: 'https://darts.nas-timgreen.com/#/tournaments',
          tag: `turnier-${t.id}`,
          rhythmus: 'abend',
        });
      }
    } catch (e) {
      console.error('[push] Turnierstand:', (e as Error).message);
    }
  }
}

initDb()
  .then(() => {
    app.listen(port, () => {
      console.log(`darts-tracker listening on ${port}`);
    });
    // Alle 20 Minuten; der erste Lauf nach 60 s.
    const t = setInterval(() => void dartsTick(), 20 * 60_000);
    t.unref?.();
    setTimeout(() => void dartsTick(), 60_000).unref?.();
  })
  .catch((e) => {
    console.error('DB-Init fehlgeschlagen', e);
    process.exit(1);
  });
