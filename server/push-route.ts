/**
 * Web Push für alle Apps.
 *
 * **Warum nicht Pushover:** Pushover ist ein Umweg über einen Drittanbieter mit
 * eigenem Konto und eigenen Tokens pro App. Web Push ist der Standard des
 * Browsers: Service Worker meldet sich an, der Push-Dienst des Geräts
 * (bei Chrome/Android über FCM, bei Safari über APNs) stellt zu. Kostenlos,
 * kein Fremdkonto, dieselbe Technik in jeder App.
 *
 * Voraussetzungen:
 *   - **HTTPS** (haben alle Apps über Cloudflare)
 *   - **Android/Chrome:** funktioniert direkt
 *   - **iPhone:** nur wenn die App über „Zum Home-Bildschirm" installiert ist
 *     (ab iOS 16.4)
 *   - VAPID-Schlüssel (siehe `vapidSchluessel()`)
 *
 * Was NICHT geht: Gesundheitstdaten vom Handy lesen. Google Fit und Apple Health
 * sind native APIs — kein Browser kommt daran, auch nicht mit Berechtigungen.
 * Der Berechtigungsdialog einer PWA deckt Kamera, Mikrofon, Standort,
 * Benachrichtigungen und Ähnliches ab, aber keine Health-Datenbanken.
 *
 * Einbau in eine App:
 *   app.use('/api/push', pushRouter(pool, (req) => req.userId, 'Fitness-Tracker'));
 */

import { Router, type Request } from 'express';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Minimaler Pool-Typ, damit das Modul nicht an eine DB-Bibliothek gebunden ist. */
type Pool = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
};

/** Ein angemeldetes Gerät. */
type Abo = {
  id: number;
  endpunkt: string;
  p256dh: string;
  auth: string;
};

/**
 * VAPID-Schlüssel aus der Umgebung oder aus `/app/push-keys.env`.
 *
 * Die Datei wird zusätzlich gelesen, weil die Container ihre Variablen aus der
 * docker-compose.yaml bekommen und eine `.env` nicht automatisch geladen wird.
 */
export function vapidSchluessel(): { publicKey: string; privateKey: string; subject: string } | null {
  let pub = process.env.VAPID_PUBLIC_KEY?.trim() ?? '';
  let priv = process.env.VAPID_PRIVATE_KEY?.trim() ?? '';
  let subject = process.env.VAPID_SUBJECT?.trim() ?? 'mailto:noreply@nas-timgreen.com';

  if (!pub || !priv) {
    try {
      const txt = readFileSync('/app/push-keys.env', 'utf8');
      for (const zeile of txt.split('\n')) {
        const m = zeile.match(/^(\w+)\s*=\s*(.+)$/);
        if (!m) continue;
        if (m[1] === 'VAPID_PUBLIC_KEY') pub = m[2].trim();
        if (m[1] === 'VAPID_PRIVATE_KEY') priv = m[2].trim();
        if (m[1] === 'VAPID_SUBJECT') subject = m[2].trim();
      }
    } catch {
      /* keine Datei — dann bleibt es bei der Umgebung */
    }
  }

  if (!pub || !priv) return null;
  return { publicKey: pub, privateKey: priv, subject };
}

/**
 * Web-Push-Endpunkte an einen Router hängen.
 *
 * @param pool    Datenbank-Pool der App
 * @param nutzer  Funktion, die die Nutzer-ID aus dem Request holt (nach Auth)
 * @param appName Name in der Begrüßungsnachricht
 */
export function pushRouter(
  pool: Pool,
  nutzer: (req: Request) => number | string | null,
  appName = 'App',
): Router {
  const router = Router();

  let tabelleBereit = false;
  const bereitstellen = async () => {
    if (tabelleBereit) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS push_abos (
        id BIGSERIAL PRIMARY KEY,
        nutzer_id TEXT NOT NULL,
        endpunkt TEXT NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        geraet TEXT,
        angelegt_am TIMESTAMPTZ NOT NULL DEFAULT now(),
        letzter_fehler TEXT,
        UNIQUE (nutzer_id, endpunkt)
      )
    `);
    tabelleBereit = true;
  };

  /** Öffentlichen Schlüssel liefern — der Browser braucht ihn zum Anmelden. */
  router.get('/key', (_req, res) => {
    const k = vapidSchluessel();
    if (!k) return res.status(503).json({ fehler: 'Push ist nicht konfiguriert.' });
    res.json({ publicKey: k.publicKey });
  });

  /** Status: wie viele Geräte sind angemeldet? */
  router.get('/', async (req, res) => {
    const id = nutzer(req);
    if (id == null) return res.status(401).json({ angemeldet: 0, fehler: 'Nicht angemeldet.' });
    try {
      await bereitstellen();
      const r = await pool.query('SELECT COUNT(*)::int AS n FROM push_abos WHERE nutzer_id = $1', [String(id)]);
      res.json({ angemeldet: Number(r.rows[0]?.n ?? 0), konfiguriert: Boolean(vapidSchluessel()) });
    } catch {
      res.json({ angemeldet: 0, konfiguriert: false });
    }
  });

  /** Gerät anmelden. */
  router.post('/subscribe', async (req, res) => {
    const id = nutzer(req);
    if (id == null) return res.status(401).json({ fehler: 'Nicht angemeldet.' });

    const sub = req.body?.subscription as
      | { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
      | undefined;
    const endpunkt = String(sub?.endpoint ?? '').trim();
    const p256dh = String(sub?.keys?.p256dh ?? '').trim();
    const auth = String(sub?.keys?.auth ?? '').trim();
    if (!endpunkt || !p256dh || !auth) {
      return res.status(400).json({ fehler: 'Unvollständige Anmeldung.' });
    }

    try {
      await bereitstellen();
      await pool.query(
        `INSERT INTO push_abos (nutzer_id, endpunkt, p256dh, auth, geraet)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (nutzer_id, endpunkt) DO UPDATE
           SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, geraet = EXCLUDED.geraet, letzter_fehler = NULL`,
        [String(id), endpunkt, p256dh, auth, String(req.body?.geraet ?? '').slice(0, 80) || null],
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ fehler: e instanceof Error ? e.message : 'Anmelden fehlgeschlagen.' });
    }
  });

  /** Gerät abmelden. */
  router.post('/unsubscribe', async (req, res) => {
    const id = nutzer(req);
    if (id == null) return res.status(401).json({ fehler: 'Nicht angemeldet.' });
    const endpunkt = String(req.body?.endpoint ?? '').trim();
    try {
      await bereitstellen();
      if (endpunkt) {
        await pool.query('DELETE FROM push_abos WHERE nutzer_id = $1 AND endpunkt = $2', [String(id), endpunkt]);
      } else {
        await pool.query('DELETE FROM push_abos WHERE nutzer_id = $1', [String(id)]);
      }
      res.json({ ok: true });
    } catch {
      res.status(500).json({ fehler: 'Abmelden fehlgeschlagen.' });
    }
  });

  /** Testnachricht an alle Geräte des Nutzers. */
  router.post('/test', async (req, res) => {
    const id = nutzer(req);
    if (id == null) return res.status(401).json({ ok: false, fehler: 'Nicht angemeldet.' });
    try {
      await bereitstellen();
      const r = await pool.query(
        'SELECT id, endpunkt, p256dh, auth FROM push_abos WHERE nutzer_id = $1',
        [String(id)],
      );
      const abos: Abo[] = r.rows.map((x) => ({
        id: Number(x.id),
        endpunkt: String(x.endpunkt),
        p256dh: String(x.p256dh),
        auth: String(x.auth),
      }));
      if (!abos.length) return res.json({ ok: false, fehler: 'Kein Gerät angemeldet.' });

      const ergebnis = await sendeAnAbos(pool, abos, {
        titel: appName,
        text: 'Wenn du das siehst, funktionieren deine Benachrichtigungen.',
      });
      res.json({ ok: ergebnis.gesendet > 0, gesendet: ergebnis.gesendet, fehler: ergebnis.fehler });
    } catch (e) {
      res.json({ ok: false, fehler: e instanceof Error ? e.message : 'Versand fehlgeschlagen.' });
    }
  });

  return router;
}

/* ------------------------------------------------------------- Versand */

/**
 * Nachricht an mehrere Geräte senden.
 *
 * Nutzt das Web-Push-Protokoll direkt über `fetch`: Der Body wird mit dem
 * `auth`-Secret und dem `p256dh`-Schlüssel des Geräts verschlüsselt (RFC 8291),
 * signiert wird mit dem VAPID-Schlüssel. Kein zusätzliches Paket nötig —
 * `web-push` wäre bequemer, zieht aber Abhängigkeiten nach, die hier nicht sein
 * müssen.
 *
 * Abgelaufene Abos (HTTP 404/410) werden gelöscht.
 */
export async function sendeAnAbos(
  pool: Pool,
  abos: Abo[],
  nachricht: { titel: string; text: string; url?: string },
): Promise<{ gesendet: number; fehler: string | null }> {
  const k = vapidSchluessel();
  if (!k) return { gesendet: 0, fehler: 'VAPID-Schlüssel fehlen.' };

  let gesendet = 0;
  let letzterFehler: string | null = null;

  for (const abo of abos) {
    try {
      const payload = JSON.stringify({
        title: nachricht.titel,
        body: nachricht.text,
        ...(nachricht.url ? { url: nachricht.url } : {}),
      });
      const { verschluesselt, header } = verschluessle(payload, abo.p256dh, abo.auth);
      const jwt = vapidJwt(abo.endpunkt, k);

      const res = await fetch(abo.endpunkt, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Encoding': 'aes128gcm',
          TTL: '86400',
          ...header,
          Authorization: `vapid t=${jwt}, k=${k.publicKey}`,
        },
        body: verschluesselt,
        signal: AbortSignal.timeout(12_000),
      });

      if (res.ok) {
        gesendet += 1;
        await pool.query('UPDATE push_abos SET letzter_fehler = NULL WHERE id = $1', [abo.id]);
      } else if (res.status === 404 || res.status === 410) {
        // Gerät ist weg — Abo entfernen, sonst wächst die Tabelle sinnlos.
        await pool.query('DELETE FROM push_abos WHERE id = $1', [abo.id]);
        letzterFehler = 'Ein Gerät ist nicht mehr erreichbar.';
      } else {
        const t = await res.text().catch(() => '');
        letzterFehler = `Push-Dienst ${res.status}: ${t.slice(0, 120)}`;
        await pool.query('UPDATE push_abos SET letzter_fehler = $2 WHERE id = $1', [abo.id, letzterFehler]);
      }
    } catch (e) {
      letzterFehler = e instanceof Error ? e.message : 'Versand fehlgeschlagen.';
      await pool.query('UPDATE push_abos SET letzter_fehler = $2 WHERE id = $1', [abo.id, letzterFehler]).catch(() => undefined);
    }
  }

  return { gesendet, fehler: letzterFehler };
}

/* ------------------------------------------------- Verschlüsselung (RFC 8291) */

import { createCipheriv, createECDH, createHmac, createPrivateKey, sign } from 'node:crypto';

/** Base64url → Buffer. */
function b64u(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Buffer → Base64url ohne Polsterung. */
function zuB64u(b: Buffer): string {
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Payload nach RFC 8291 verschlüsseln (aes128gcm).
 *
 * Ablauf: eigenes ECDH-Schlüsselpaar erzeugen, mit dem `p256dh` des Geräts das
 * gemeinsame Geheimnis bilden, daraus mit `auth` zwei Schlüssel ableiten, dann
 * mit AES-128-GCM verschlüsseln.
 */
function verschluessle(
  payload: string,
  clientP256dh: string,
  clientAuth: string,
): { verschluesselt: Buffer; header: Record<string, string> } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const serverPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(b64u(clientP256dh));
  const authSecret = b64u(clientAuth);

  // Schlüsselableitung nach RFC 8291, Abschnitt 3.4
  const prk = createHmac('sha256', authSecret).update(shared).digest();
  const schluesselInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    b64u(clientP256dh),
    serverPublic,
  ]);
  const ikm = createHmac('sha256', prk).update(schluesselInfo).digest().subarray(0, 32);

  const salt = randomBytes(16);
  const prk2 = createHmac('sha256', salt).update(ikm).digest();

  const cek = createHmac('sha256', prk2)
    .update(Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0')]))
    .digest()
    .subarray(0, 16);
  const nonce = createHmac('sha256', prk2)
    .update(Buffer.concat([Buffer.from('Content-Encoding: nonce\0')]))
    .digest()
    .subarray(0, 12);

  // Nutzlast + Padding-Trenner (0x02 = letzter Block)
  const klartext = Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([2])]);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const verschluesselt = Buffer.concat([cipher.update(klartext), cipher.final(), cipher.getAuthTag()]);

  /*
   * Kopf nach RFC 8188: salt (16) | rs (4) | idlen (1) | keyid (65 = Server-Public)
   * Der Browser braucht diesen Kopf, um entschlüsseln zu können.
   */
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096, 0);
  const kopf = Buffer.concat([salt, rs, Buffer.from([serverPublic.length]), serverPublic]);

  return { verschluesselt: Buffer.concat([kopf, verschluesselt]), header: {} };
}

/**
 * VAPID-JWT für den Push-Dienst bauen.
 *
 * Der `aud`-Anspruch ist der Ursprung des Endpunkts, `exp` höchstens 24 Stunden.
 */
function vapidJwt(endpunkt: string, k: { privateKey: string; subject: string }): string {
  const url = new URL(endpunkt);
  const kopf = zuB64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const jetzt = Math.floor(Date.now() / 1000);
  const nutz = zuB64u(
    Buffer.from(
      JSON.stringify({
        aud: `${url.protocol}//${url.host}`,
        exp: jetzt + 12 * 3600,
        sub: k.subject,
      }),
    ),
  );
  const daten = Buffer.from(`${kopf}.${nutz}`);

  /*
   * Der private VAPID-Schlüssel liegt als PKCS#8-DER (base64url) vor. Node kann
   * ihn direkt importieren, wenn wir ihn als DER übergeben.
   */
  const priv = createPrivateKey({ key: b64u(k.privateKey), format: 'der', type: 'pkcs8' });
  const sig = sign('sha256', daten, { key: priv, dsaEncoding: 'ieee-p1363' });
  return `${kopf}.${nutz}.${zuB64u(sig)}`;
}
