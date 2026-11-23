/**
 * Pushover-Endpunkte für beliebige Apps.
 *
 * **Warum das eine eigene Datei ist:** Jede App hatte ihre eigene Lösung oder
 * gar keine. Damit Pushover überall gleich funktioniert — und die Zugangsdaten
 * überall gleich behandelt werden — gibt es diesen Baustein. Er hängt an einer
 * Tabelle `pushover_zugang`, die pro Nutzer eine Zeile hält.
 *
 * Sicherheit: Die Werte bleiben auf dem Server. `GET` liefert nur „verbunden"
 * und ob die Felder gesetzt sind, **nie den Schlüssel selbst** — sonst könnte
 * ihn jeder angemeldete Nutzer auslesen.
 *
 * Einbau in eine App:
 *   app.use('/api/integrations/pushover', pushoverRouter(pool, (req) => req.userId));
 */

import { Router, type Request } from 'express';

const API = 'https://api.pushover.net/1/messages.json';

/** Zugang eines Nutzers. */
type Zugang = { userKey: string; appToken: string };

/** Minimaler Pool-Typ, damit das Modul nicht an eine DB-Bibliothek gebunden ist. */
type Pool = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
};

/**
 * Pushover-Endpunkte an einen Router hängen.
 *
 * @param pool    Datenbank-Pool der App
 * @param nutzer  Funktion, die die Nutzer-ID aus dem Request holt (nach Auth)
 * @param meldung Standardtext der Testnachricht
 */
export function pushoverRouter(
  pool: Pool,
  nutzer: (req: Request) => number | string | null,
  meldung = { titel: 'Test', text: 'Wenn du das siehst, funktioniert Pushover.' },
): Router {
  const router = Router();

  /** Tabelle anlegen, falls sie fehlt — die Apps haben unterschiedliche Migrationen. */
  let tabelleBereit = false;
  const bereitstellen = async () => {
    if (tabelleBereit) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pushover_zugang (
        nutzer_id TEXT PRIMARY KEY,
        user_key TEXT NOT NULL,
        app_token TEXT NOT NULL,
        angelegt_am TIMESTAMPTZ NOT NULL DEFAULT now(),
        letzter_fehler TEXT
      )
    `);
    tabelleBereit = true;
  };

  const lesen = async (id: string): Promise<Zugang | null> => {
    const r = await pool.query('SELECT user_key, app_token FROM pushover_zugang WHERE nutzer_id = $1', [id]);
    const row = r.rows[0];
    if (!row) return null;
    return { userKey: String(row.user_key), appToken: String(row.app_token) };
  };

  /** Status — ohne die Schlüssel selbst. */
  router.get('/', async (req, res) => {
    const id = nutzer(req);
    if (id == null) return res.status(401).json({ verbunden: false, fehler: 'Nicht angemeldet.' });
    try {
      await bereitstellen();
      const z = await lesen(String(id));
      const r = await pool.query('SELECT letzter_fehler FROM pushover_zugang WHERE nutzer_id = $1', [String(id)]);
      res.json({
        verbunden: Boolean(z),
        userKeyGesetzt: Boolean(z?.userKey),
        tokenGesetzt: Boolean(z?.appToken),
        lastError: (r.rows[0]?.letzter_fehler as string | null) ?? null,
      });
    } catch {
      res.json({ verbunden: false });
    }
  });

  /** Zugang speichern. */
  router.post('/', async (req, res) => {
    const id = nutzer(req);
    if (id == null) return res.status(401).json({ fehler: 'Nicht angemeldet.' });

    const userKey = String(req.body?.userKey ?? '').trim();
    const token = String(req.body?.token ?? '').trim();
    if (!userKey || !token) return res.status(400).json({ fehler: 'User Key und App-Token angeben.' });
    // Pushover-Keys haben feste Anfangsbuchstaben — Tippfehler früh abfangen.
    if (!userKey.startsWith('u')) return res.status(400).json({ fehler: 'Der User Key beginnt mit „u".' });
    if (!token.startsWith('a')) return res.status(400).json({ fehler: 'Der App-Token beginnt mit „a".' });

    try {
      await bereitstellen();
      // Vor dem Speichern prüfen, ob Pushover die Werte akzeptiert.
      const probe = await fetch('https://api.pushover.net/1/users/validate.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token, user: userKey }),
        signal: AbortSignal.timeout(12_000),
      });
      const pd = (await probe.json().catch(() => ({}))) as { status?: number; errors?: string[] };
      if (probe.ok && pd.status !== 1) {
        return res.status(400).json({ fehler: pd.errors?.[0] ?? 'Pushover hat die Zugangsdaten abgelehnt.' });
      }

      await pool.query(
        `INSERT INTO pushover_zugang (nutzer_id, user_key, app_token, letzter_fehler)
         VALUES ($1,$2,$3,NULL)
         ON CONFLICT (nutzer_id) DO UPDATE SET user_key = EXCLUDED.user_key, app_token = EXCLUDED.app_token, letzter_fehler = NULL`,
        [String(id), userKey, token],
      );
      res.json({ ok: true, verbunden: true });
    } catch (e) {
      res.status(500).json({ fehler: e instanceof Error ? e.message : 'Speichern fehlgeschlagen.' });
    }
  });

  /** Testnachricht senden. */
  router.post('/test', async (req, res) => {
    const id = nutzer(req);
    if (id == null) return res.status(401).json({ ok: false, fehler: 'Nicht angemeldet.' });
    try {
      await bereitstellen();
      const z = await lesen(String(id));
      if (!z) return res.json({ ok: false, fehler: 'Keine Verbindung gespeichert.' });

      const r = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: z.appToken,
          user: z.userKey,
          title: meldung.titel,
          message: meldung.text,
        }),
        signal: AbortSignal.timeout(12_000),
      });
      const d = (await r.json().catch(() => ({}))) as { status?: number; errors?: string[] };
      if (!r.ok || d.status !== 1) {
        const grund = d.errors?.[0] ?? `HTTP ${r.status}`;
        await pool.query('UPDATE pushover_zugang SET letzter_fehler = $2 WHERE nutzer_id = $1', [String(id), grund]);
        return res.json({ ok: false, fehler: grund });
      }
      await pool.query('UPDATE pushover_zugang SET letzter_fehler = NULL WHERE nutzer_id = $1', [String(id)]);
      res.json({ ok: true });
    } catch (e) {
      res.json({ ok: false, fehler: e instanceof Error ? e.message : 'Versand fehlgeschlagen.' });
    }
  });

  /** Verbindung trennen. */
  router.delete('/', async (req, res) => {
    const id = nutzer(req);
    if (id == null) return res.status(401).json({ fehler: 'Nicht angemeldet.' });
    try {
      await bereitstellen();
      await pool.query('DELETE FROM pushover_zugang WHERE nutzer_id = $1', [String(id)]);
      res.json({ ok: true, verbunden: false });
    } catch {
      res.status(500).json({ fehler: 'Trennen fehlgeschlagen.' });
    }
  });

  return router;
}

/**
 * Nachricht senden — für Anlässe ausserhalb der Endpunkte (z. B. wenn ein Tor
 * fällt oder eine Einheit geplant ist).
 */
export async function sendePush(z: Zugang, nachricht: { titel: string; text: string; url?: string }): Promise<boolean> {
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: z.appToken,
        user: z.userKey,
        title: nachricht.titel,
        message: nachricht.text,
        ...(nachricht.url ? { url: nachricht.url } : {}),
      }),
      signal: AbortSignal.timeout(12_000),
    });
    return r.ok;
  } catch {
    return false;
  }
}
