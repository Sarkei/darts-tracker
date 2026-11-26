/**
 * Benachrichtigungen — gemeinsamer Baustein für alle Apps.
 *
 * **Warum dieses Modul:** Bisher hing an jedem Ereignis ein eigener Aufruf von
 * `sendePushAnNutzer`. Das Ergebnis war ein Sammelsurium: mal sechs Meldungen am
 * Vormittag, dann tagelang nichts, keine Möglichkeit einzelne Arten abzuschalten,
 * und ein Ruhezeit-Filter, der wegen `Number("06 Uhr") === NaN` nie gegriffen hat.
 *
 * Dieses Modul bündelt das. Es gilt für jede App gleich:
 *
 *  - **Kategorien** (`KATEGORIEN`) — der Nutzer entscheidet, welche Arten er will.
 *  - **Rhythmus** — Meldungen haben ein Zeitfenster (`rhythmus: 'morgen' | 'mittag'
 *    | 'abend'`) oder gehen sofort raus (`'sofort'`). Ein Tageslimit verhindert
 *    Dauerfeuer, eine Bündelung fasst mehrere Anlässe derselben Kategorie zusammen.
 *  - **Ruhezeit** — 22–7 Uhr Europe/Berlin, nur `dringend: true` kommt durch.
 *    Die Stunde wird über `formatToParts` gelesen; `Number(format(...))` ergibt
 *    im deutschen Gebietsschema `NaN` und schaltet den Filter stillschweigend aus.
 *  - **Verlauf** — jede Meldung landet in `push_verlauf`, damit die App zeigen
 *    kann, was wann rausging und was gerade unterdrückt wurde.
 *
 * Einbau:
 *   import { benachrichtige, kategorienFuer, verlaufFuer } from './benachrichtigungen';
 *   await benachrichtige(pool, nutzerId, {
 *     kategorie: 'training',
 *     ereignis: 'training-heute',
 *     schluessel: heute,           // verhindert Doppelversand
 *     titel: 'Dein Training heute',
 *     text: 'Push/Pull · 6 Übungen',
 *     url: 'https://…/',
 *   });
 */

import { Router, type Request } from 'express';

/** Minimaler Pool-Typ — das Modul bleibt unabhängig von der DB-Bibliothek. */
export type Pool = {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
};

/* ------------------------------------------------------------- Kategorien */

/**
 * Was der Nutzer einzeln schalten kann.
 *
 * Die Reihenfolge ist die Anzeige-Reihenfolge in der App. `standard: false`
 * heisst: neu angemeldet, noch nie bewusst eingeschaltet — bleibt aus.
 */
export const KATEGORIEN = {
  tagesstart: {
    titel: 'Tagesstart',
    beschreibung: 'Morgens ein Bericht: Nacht, Tagesform und was ansteht.',
    standard: true,
  },
  training: {
    titel: 'Training',
    beschreibung: 'Was heute ansteht, wenn eine Einheit offen bleibt.',
    standard: true,
  },
  ernaehrung: {
    titel: 'Ernährung & Fasten',
    beschreibung: 'Fastenfenster, Mahlzeiten, Kalorien- und Eiweißstand.',
    standard: true,
  },
  gesundheit: {
    titel: 'Gesundheit',
    beschreibung: 'Schlaf, HRV, Ruhepuls — nur wenn es auffällig ist.',
    standard: true,
  },
  plan: {
    titel: 'Plan & Haushalt',
    beschreibung: 'Wochenplan, Einkaufsliste, Änderungen anderer.',
    standard: true,
  },
  wettkampf: {
    titel: 'Wettkampf & live',
    beschreibung: 'Spiele, Anpfiff, Tore, Ergebnisse, Turniere.',
    standard: true,
  },
  erinnerung: {
    titel: 'Erinnerungen',
    beschreibung: 'Fahrten, Termine, Fristen, offene Beträge.',
    standard: true,
  },
  rueckblick: {
    titel: 'Rückblick',
    beschreibung: 'Abends die Zusammenfassung des Tages, sonntags die Woche.',
    standard: true,
  },
  system: {
    titel: 'System',
    beschreibung: 'Anmeldung auf neuem Gerät, Fehler in der App.',
    standard: false,
  },
} as const;

export type Kategorie = keyof typeof KATEGORIEN;

/**
 * Standard-Zeitfenster je Rhythmus (Europe/Berlin).
 *
 * `von`/`bis` sind Stunden des Tages. Ein Fenster von 6 bis 8 heisst: der
 * 15-Minuten-Takt darf zwischen 6:00 und 7:59 zustellen, danach ist der Anlass
 * für heute vorbei (der Aufrufer nutzt `schluessel = heute`, also kein Nachholen).
 */
const RHYTHMUS_FENSTER: Record<string, { von: number; bis: number }> = {
  morgen: { von: 6, bis: 9 },
  mittag: { von: 11, bis: 14 },
  // Eigener Nachmittag: der Ernährungsstand läuft um 15 Uhr, das Mittagsfenster
  // endet um 14 — mit „mittag" wäre die Meldung nie rausgegangen.
  nachmittag: { von: 14, bis: 17 },
  abend: { von: 17, bis: 21 },
  sofort: { von: 0, bis: 24 },
};

/** Harte Ruhezeit — nur `dringend` kommt daran vorbei. */
const RUHE_VON = 22;
const RUHE_BIS = 6;

/* -------------------------------------------------------------- Zeit-Helfer */

/**
 * Stunde, Minute und Datum in Europe/Berlin.
 *
 * **Nicht** `Number(new Intl.DateTimeFormat('de-DE', { hour: 'numeric' }).format(d))`:
 * das liefert `"6 Uhr"`, und `Number("6 Uhr")` ist `NaN`. Jeder Vergleich
 * `stunde >= 22` war damit `false` — der Ruhezeit-Filter hat nie gegriffen.
 */
export function berlinJetzt(d: Date = new Date()): {
  stunde: number;
  minute: number;
  hhmm: string;
  ymd: string;
  wochentag: number;
} {
  const teile = new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour12: false,
    timeZone: 'Europe/Berlin',
  }).formatToParts(d);
  const wert = (typ: string) => teile.find((t) => t.type === typ)?.value ?? '0';
  const stunde = Number(wert('hour')) % 24;
  const minute = Number(wert('minute'));
  const ymd = `${wert('year')}-${wert('month')}-${wert('day')}`;
  // 0 = Montag … 6 = Sonntag, passend zu den Plan-Tabellen der Apps.
  const wt = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return {
    stunde,
    minute,
    hhmm: `${String(stunde).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    ymd,
    wochentag: (wt + 6) % 7,
  };
}

/** Liegt der Zeitpunkt in der Ruhezeit? */
export function istRuhezeit(d: Date = new Date()): boolean {
  const { stunde } = berlinJetzt(d);
  return stunde >= RUHE_VON || stunde < RUHE_BIS;
}

/* --------------------------------------------------------------- Schema */

let schemaBereit = false;

/**
 * Tabellen anlegen. Wird bei jedem Aufruf einmal geprüft, nicht bei jedem Push —
 * der 15-Minuten-Takt soll nicht jedes Mal fünf `CREATE TABLE` schicken.
 */
export async function schemaBereitstellen(pool: Pool): Promise<void> {
  if (schemaBereit) return;
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_einstellungen (
      nutzer_id TEXT NOT NULL,
      kategorie TEXT NOT NULL,
      aktiv BOOLEAN NOT NULL DEFAULT TRUE,
      max_pro_tag INTEGER NOT NULL DEFAULT 12,
      geaendert_am TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (nutzer_id, kategorie)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_verlauf (
      id BIGSERIAL PRIMARY KEY,
      nutzer_id TEXT NOT NULL,
      kategorie TEXT NOT NULL,
      ereignis TEXT NOT NULL,
      titel TEXT NOT NULL,
      text TEXT NOT NULL,
      url TEXT,
      stand TEXT NOT NULL,
      grund TEXT,
      dringend BOOLEAN NOT NULL DEFAULT FALSE,
      angelegt_am TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // Ältere Bestände nachrüsten (Tabelle kann vor der Spalte existiert haben).
  await pool.query(`ALTER TABLE push_verlauf ADD COLUMN IF NOT EXISTS dringend BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_ereignisse (
      nutzer_id TEXT NOT NULL,
      ereignis TEXT NOT NULL,
      schluessel TEXT NOT NULL,
      gemeldet_am TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (nutzer_id, ereignis, schluessel)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS push_verlauf_nutzer_zeit
      ON push_verlauf (nutzer_id, angelegt_am DESC)
  `);
  schemaBereit = true;
}

/* ---------------------------------------------------------- Einstellungen */

export type Einstellung = { kategorie: Kategorie; titel: string; beschreibung: string; aktiv: boolean };

/**
 * Kategorien mit dem Stand des Nutzers.
 *
 * Ohne Zeile in `push_einstellungen` gilt der Standard aus `KATEGORIEN` — so
 * bekommt ein neuer Nutzer sofort etwas, ohne dass er erst Häkchen setzen muss.
 */
export async function kategorienFuer(pool: Pool, nutzerId: number | string): Promise<Einstellung[]> {
  await schemaBereitstellen(pool);
  const r = await pool.query('SELECT kategorie, aktiv FROM push_einstellungen WHERE nutzer_id = $1', [
    String(nutzerId),
  ]);
  const gesetzt = new Map(r.rows.map((x) => [String(x.kategorie), Boolean(x.aktiv)]));
  return (Object.keys(KATEGORIEN) as Kategorie[]).map((k) => ({
    kategorie: k,
    titel: KATEGORIEN[k].titel,
    beschreibung: KATEGORIEN[k].beschreibung,
    aktiv: gesetzt.get(k) ?? KATEGORIEN[k].standard,
  }));
}

/** Kategorie schalten. Unbekannte Namen werden abgewiesen. */
export async function kategorieSetzen(
  pool: Pool,
  nutzerId: number | string,
  kategorie: string,
  aktiv: boolean,
): Promise<boolean> {
  if (!(kategorie in KATEGORIEN)) return false;
  await schemaBereitstellen(pool);
  await pool.query(
    `INSERT INTO push_einstellungen (nutzer_id, kategorie, aktiv, geaendert_am)
     VALUES ($1,$2,$3, now())
     ON CONFLICT (nutzer_id, kategorie) DO UPDATE SET aktiv = EXCLUDED.aktiv, geaendert_am = now()`,
    [String(nutzerId), kategorie, aktiv],
  );
  return true;
}

/** Ist diese Kategorie für den Nutzer an? Unbekannte Kategorie = an (nie blockieren). */
async function kategorieAktiv(pool: Pool, nutzerId: string, kategorie: string): Promise<boolean> {
  const r = await pool.query('SELECT aktiv FROM push_einstellungen WHERE nutzer_id = $1 AND kategorie = $2', [
    nutzerId,
    kategorie,
  ]);
  if (r.rowCount) return Boolean(r.rows[0].aktiv);
  return (KATEGORIEN as Record<string, { standard: boolean }>)[kategorie]?.standard ?? true;
}

/* ---------------------------------------------------------------- Versand */

/** Grenze, wie viele Meldungen einer Kategorie pro Tag rausgehen. */
const TAGESLIMIT = 6;

type Versand = (nachricht: {
  titel: string;
  text: string;
  url?: string;
  tag?: string;
  dringend?: boolean;
}) => Promise<boolean>;

/**
 * Zentraler Einstiegspunkt.
 *
 * Prüf-Reihenfolge — jede Stufe, die greift, landet mit `grund` im Verlauf,
 * damit in der App sichtbar ist, *warum* eine Meldung ausblieb:
 *
 *   1. Kategorie abgeschaltet?        → grund 'kategorie-aus'
 *   2. schon gemeldet (Schlüssel)?    → gar kein Eintrag (kein Rauschen)
 *   3. ausserhalb des Zeitfensters?   → grund 'ausserhalb-zeitfenster'
 *   4. Ruhezeit?                      → grund 'ruhezeit'
 *   5. Tageslimit der Kategorie?      → grund 'tageslimit'
 *   6. kein Gerät angemeldet?         → grund 'kein-geraet'
 */
export async function benachrichtige(
  pool: Pool,
  senden: Versand,
  nutzerId: number | string | null,
  meldung: {
    kategorie: Kategorie;
    ereignis: string;
    schluessel: string;
    titel: string;
    text: string;
    url?: string;
    tag?: string;
    dringend?: boolean;
    rhythmus?: keyof typeof RHYTHMUS_FENSTER;
    /** Nur für Prüfläufe: den Zeitpunkt vorgeben statt „jetzt". */
    jetzt?: Date;
  },
): Promise<boolean> {
  if (nutzerId == null) return false;
  const id = String(nutzerId);
  const zeit = berlinJetzt(meldung.jetzt ?? new Date());

  await schemaBereitstellen(pool);

  const eintrag = async (stand: string, grund: string | null): Promise<void> => {
    try {
      /*
       * Unterdrückungen nur einmal je Anlass und Tag vermerken.
       *
       * Der Takt läuft alle 15 Minuten — ohne diese Sperre stünde für einen
       * verpassten Morgenbericht 24-mal dieselbe Zeile im Verlauf und
       * verdrängte alles andere.
       */
      if (stand === 'unterdrueckt') {
        const schon = await pool.query(
          `SELECT 1 FROM push_verlauf
            WHERE nutzer_id = $1 AND ereignis = $2 AND stand = 'unterdrueckt'
              AND angelegt_am >= date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin'
            LIMIT 1`,
          [id, meldung.ereignis],
        );
        if (schon.rowCount) return;
      }
      await pool.query(
        `INSERT INTO push_verlauf (nutzer_id, kategorie, ereignis, titel, text, url, stand, grund, dringend)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id,
          meldung.kategorie,
          meldung.ereignis,
          meldung.titel,
          meldung.text,
          meldung.url ?? null,
          stand,
          grund,
          Boolean(meldung.dringend),
        ],
      );
      // Verlauf nicht unbegrenzt wachsen lassen — 60 Tage reichen für „was kam an".
      await pool.query(
        `DELETE FROM push_verlauf WHERE nutzer_id = $1 AND angelegt_am < now() - INTERVAL '60 days'`,
        [id],
      );
    } catch {
      /* Verlauf ist Beiwerk — nie den Versand daran scheitern lassen */
    }
  };

  // 1. Kategorie
  if (!(await kategorieAktiv(pool, id, meldung.kategorie))) {
    await eintrag('unterdrueckt', 'kategorie-aus');
    return false;
  }

  // 2. Doppelversand
  const schon = await pool.query(
    'SELECT 1 FROM push_ereignisse WHERE nutzer_id = $1 AND ereignis = $2 AND schluessel = $3',
    [id, meldung.ereignis, meldung.schluessel],
  );
  if (schon.rowCount) return false;

  // 3. Zeitfenster des Rhythmus
  const fenster = RHYTHMUS_FENSTER[meldung.rhythmus ?? 'sofort'];
  if (!meldung.dringend && fenster && !(zeit.stunde >= fenster.von && zeit.stunde < fenster.bis)) {
    await eintrag('unterdrueckt', 'ausserhalb-zeitfenster');
    return false;
  }

  // 4. Ruhezeit
  if (!meldung.dringend && istRuhezeit(meldung.jetzt ?? new Date())) {
    await eintrag('unterdrueckt', 'ruhezeit');
    return false;
  }

  // 5. Tageslimit je Kategorie (dringende Meldungen zählen nicht mit)
  if (!meldung.dringend) {
    const heute = await pool.query(
      `SELECT COUNT(*)::int AS n FROM push_verlauf
        WHERE nutzer_id = $1 AND kategorie = $2 AND stand = 'gesendet' AND NOT dringend
          AND angelegt_am >= date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin'`,
      [id, meldung.kategorie],
    );
    if (Number(heute.rows[0]?.n ?? 0) >= TAGESLIMIT) {
      await eintrag('unterdrueckt', 'tageslimit');
      return false;
    }
  }

  // 6. Versand
  let ok = false;
  try {
    ok = await senden({
      titel: meldung.titel,
      text: meldung.text,
      url: meldung.url,
      tag: meldung.tag ?? `${meldung.kategorie}-${meldung.ereignis}`,
      dringend: meldung.dringend,
    });
  } catch (e) {
    console.error('[push] Versand fehlgeschlagen:', (e as Error).message);
  }

  // Auch ohne Gerät merken — sonst versucht der Takt es endlos neu.
  try {
    await pool.query(
      `INSERT INTO push_ereignisse (nutzer_id, ereignis, schluessel) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [id, meldung.ereignis, meldung.schluessel],
    );
  } catch {
    /* push_ereignisse fehlt in sehr alten Ständen — egal */
  }

  await eintrag(ok ? 'gesendet' : 'ohne-geraet', ok ? null : 'kein-geraet');
  return ok;
}

/* ---------------------------------------------------------------- Verlauf */

export type Verlaufszeile = {
  kategorie: string;
  ereignis: string;
  titel: string;
  text: string;
  url: string | null;
  stand: string;
  grund: string | null;
  zeit: string;
};

/** Die letzten Meldungen eines Nutzers — für „Was kam an" in den Einstellungen. */
export async function verlaufFuer(pool: Pool, nutzerId: number | string, limit = 30): Promise<Verlaufszeile[]> {
  await schemaBereitstellen(pool);
  const r = await pool.query(
    `SELECT kategorie, ereignis, titel, text, url, stand, grund,
            to_char(angelegt_am AT TIME ZONE 'Europe/Berlin', 'DD.MM. HH24:MI') AS zeit
       FROM push_verlauf
      WHERE nutzer_id = $1
      ORDER BY angelegt_am DESC
      LIMIT $2`,
    [String(nutzerId), Math.min(Math.max(limit, 1), 100)],
  );
  return r.rows as unknown as Verlaufszeile[];
}

/* --------------------------------------------------------------- Router */

/**
 * Endpunkte für die Einstellungsseite.
 *
 *   GET    /kategorien        → Liste mit Stand des Nutzers
 *   POST   /kategorien        → { kategorie, aktiv }
 *   GET    /verlauf           → letzte Meldungen inkl. Unterdrückte
 *   GET    /rhythmus          → erklärt den aktuellen Takt (für den Hilfetext)
 */
export function benachrichtigungsRouter(
  pool: Pool,
  nutzer: (req: Request) => number | string | null,
): Router {
  const router = Router();

  router.get('/kategorien', async (req, res) => {
    const id = nutzer(req);
    if (id == null) return res.status(401).json({ fehler: 'Nicht angemeldet.' });
    try {
      res.json({ kategorien: await kategorienFuer(pool, id) });
    } catch (e) {
      res.status(500).json({ fehler: e instanceof Error ? e.message : 'Laden fehlgeschlagen.' });
    }
  });

  router.post('/kategorien', async (req, res) => {
    const id = nutzer(req);
    if (id == null) return res.status(401).json({ fehler: 'Nicht angemeldet.' });
    const kategorie = String(req.body?.kategorie ?? '');
    const aktiv = Boolean(req.body?.aktiv);
    const ok = await kategorieSetzen(pool, id, kategorie, aktiv);
    if (!ok) return res.status(400).json({ fehler: 'Unbekannte Kategorie.' });
    res.json({ ok: true, kategorien: await kategorienFuer(pool, id) });
  });

  router.get('/verlauf', async (req, res) => {
    const id = nutzer(req);
    if (id == null) return res.status(401).json({ fehler: 'Nicht angemeldet.' });
    try {
      res.json({ verlauf: await verlaufFuer(pool, id, Number(req.query.limit ?? 30)) });
    } catch (e) {
      res.status(500).json({ fehler: e instanceof Error ? e.message : 'Laden fehlgeschlagen.' });
    }
  });

  router.get('/rhythmus', (_req, res) => {
    res.json({
      ruhezeit: `${RUHE_VON}:00–${RUHE_BIS}:00`,
      tageslimit: TAGESLIMIT,
      fenster: RHYTHMUS_FENSTER,
      kategorien: KATEGORIEN,
    });
  });

  return router;
}
