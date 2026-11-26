/**
 * Karte „Push-Benachrichtigungen" für die Einstellungen.
 *
 * Meldet das aktuelle Gerät für Web Push an. Der Browser zeigt beim ersten Mal
 * einen Berechtigungsdialog — ohne Zustimmung passiert nichts.
 *
 * **Auf dem iPhone** funktioniert das nur, wenn die App über „Zum Home-Bildschirm"
 * installiert wurde (ab iOS 16.4). Safari im normalen Tab kann kein Push
 * empfangen; das erkennt die Karte und sagt es klar, statt still zu scheitern.
 *
 * Die Karte ist bewusst unabhängig von Pushover — beides kann parallel laufen.
 */

import { useEffect, useState } from 'react';
import { Bell, BellOff, Check, Loader2, Smartphone } from 'lucide-react';

type Status = { angemeldet: number; konfiguriert: boolean };

type KategorieZeile = { kategorie: string; titel: string; beschreibung: string; aktiv: boolean };

type Verlaufszeile = {
  kategorie: string;
  ereignis: string;
  titel: string;
  text: string;
  url: string | null;
  stand: string;
  grund: string | null;
  zeit: string;
};

/** Wie die Unterdrückungs-Gründe in der App heissen. */
const GRUND_TEXT: Record<string, string> = {
  'kategorie-aus': 'Art ist ausgeschaltet',
  'ausserhalb-zeitfenster': 'nicht im Zeitfenster',
  ruhezeit: 'Ruhezeit (22–6 Uhr)',
  tageslimit: 'Tageslimit der Art erreicht',
  'kein-geraet': 'kein Gerät angemeldet',
};

/**
 * Überschrift in den Listen — als Inline-Stil, weil die Apps unterschiedliche
 * Tailwind-Farbnamen haben (`brand`, `leaf`, `accent`) oder gar keine.
 */
const ueberschrift: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--muted, #55635c)',
};

/** Holt den Auth-Header der jeweiligen App (Token liegt in unterschiedlichen Schlüsseln). */
function authHeader(): Record<string, string> {
  const kandidaten = ['vrtx_jwt', 'token', 'mealplanner.token', 'darts-token', 'auth_token'];
  try {
    for (const k of kandidaten) {
      const v = localStorage.getItem(k);
      if (v) return { Authorization: `Bearer ${v}` };
    }
  } catch {
    /* kein localStorage */
  }
  return {};
}

/** Ob dieser Browser Push kann — und ob er es hier auch darf. */
function faehigkeit(): { moeglich: boolean; grund?: string } {
  if (typeof window === 'undefined') return { moeglich: false };
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { moeglich: false, grund: 'Dieser Browser unterstützt kein Push.' };
  }
  // iPhone: nur als installierte App, nicht im Safari-Tab.
  const istIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const installiert =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (istIos && !installiert) {
    return {
      moeglich: false,
      grund: 'Auf dem iPhone erst über „Teilen → Zum Home-Bildschirm" installieren, dann funktioniert Push.',
    };
  }
  return { moeglich: true };
}

/**
 * Base64url → Bytes für `applicationServerKey`.
 *
 * Der Cast auf `BufferSource` ist nötig, weil sich die Typdefinition von
 * `applicationServerKey` zwischen TypeScript-Versionen unterscheidet.
 */
function schluesselAlsBytes(b64: string): BufferSource {
  const roh = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const arr = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i += 1) arr[i] = roh.charCodeAt(i);
  return arr as unknown as BufferSource;
}

/*
 * Knopf-Stile als Konstanten statt Tailwind-Klassen.
 *
 * **Warum:** Die Apps haben unterschiedliche Farbnamen (`brand`, `leaf`,
 * `accent`) — oder wie Mitfahr gar keine Theme-Farben, nur Zinc-Klassen. Ein
 * Button mit `bg-accent` hat deshalb in mehreren Apps keinen Hintergrund und
 * ist praktisch unsichtbar.
 *
 * Diese Stile nutzen die CSS-Variablen, die in jeder App existieren, mit
 * Rückfallwerten. Damit sieht der Button überall gleich aus.
 */
const knopfPrimaer: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  borderRadius: 8,
  padding: '9px 14px',
  fontSize: 11.5,
  fontWeight: 600,
  background: 'var(--accent, #2f7d5a)',
  color: 'var(--on-accent, #ffffff)',
  border: '1px solid var(--accent, #2f7d5a)',
  cursor: 'pointer',
};

const knopfLeise: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  borderRadius: 8,
  padding: '9px 14px',
  fontSize: 11.5,
  fontWeight: 600,
  background: 'transparent',
  color: 'var(--muted, #55635c)',
  border: '1px solid var(--line, #dde3df)',
  cursor: 'pointer',
};

export default function PushKarte({
  basis = '/api/push',
  kategorienBasis = '/api/benachrichtigungen',
  titel = 'Benachrichtigungen',
  beschreibung = 'Nachrichten direkt aufs Handy — auch wenn die App geschlossen ist.',
}: {
  basis?: string;
  kategorienBasis?: string;
  titel?: string;
  beschreibung?: string;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ art: 'ok' | 'fehler'; text: string } | null>(null);
  const [diesesGeraet, setDiesesGeraet] = useState(false);
  const [kategorien, setKategorien] = useState<KategorieZeile[]>([]);
  const [verlauf, setVerlauf] = useState<Verlaufszeile[]>([]);
  const [verlaufOffen, setVerlaufOffen] = useState(false);

  const f = faehigkeit();

  const laden = async () => {
    try {
      const r = await fetch(basis, { headers: authHeader() });
      if (r.ok) setStatus((await r.json()) as Status);
    } catch {
      setStatus(null);
    }
    // Ist dieses Gerät schon angemeldet?
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setDiesesGeraet(Boolean(sub));
    } catch {
      setDiesesGeraet(false);
    }
    // Welche Arten sind an, und was ist zuletzt rausgegangen?
    try {
      const k = await fetch(`${kategorienBasis}/kategorien`, { headers: authHeader() });
      if (k.ok) {
        const d = (await k.json()) as { kategorien?: KategorieZeile[] };
        setKategorien(d.kategorien ?? []);
      }
    } catch {
      /* Server ohne Kategorien-Endpunkt — dann bleibt die Liste leer */
    }
    try {
      const v = await fetch(`${kategorienBasis}/verlauf?limit=12`, { headers: authHeader() });
      if (v.ok) {
        const d = (await v.json()) as { verlauf?: Verlaufszeile[] };
        setVerlauf(d.verlauf ?? []);
      }
    } catch {
      /* dito */
    }
  };

  const umschalten = async (kategorie: string, aktiv: boolean) => {
    // Sofort umschalten, damit der Tipp nicht hängt; bei Fehler zurückdrehen.
    setKategorien((alt) => alt.map((k) => (k.kategorie === kategorie ? { ...k, aktiv } : k)));
    try {
      const r = await fetch(`${kategorienBasis}/kategorien`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ kategorie, aktiv }),
      });
      if (!r.ok) throw new Error('abgelehnt');
    } catch {
      setKategorien((alt) => alt.map((k) => (k.kategorie === kategorie ? { ...k, aktiv: !aktiv } : k)));
      setMeldung({ art: 'fehler', text: 'Einstellung konnte nicht gespeichert werden.' });
    }
  };

  useEffect(() => {
    void laden();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basis]);

  const anmelden = async () => {
    setLaeuft(true);
    setMeldung(null);
    try {
      // Berechtigung erfragen
      const erlaubnis = await Notification.requestPermission();
      if (erlaubnis !== 'granted') {
        setMeldung({ art: 'fehler', text: 'Ohne Berechtigung können keine Nachrichten ankommen.' });
        return;
      }

      // Service Worker registrieren (liegt als /sw.js bereit)
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;

      // Öffentlichen Schlüssel vom Server holen
      const kr = await fetch(`${basis}/key`, { headers: authHeader() });
      const { publicKey } = (await kr.json()) as { publicKey?: string };
      if (!publicKey) throw new Error('Kein Schlüssel vom Server.');

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: schluesselAlsBytes(publicKey),
      });

      const sr = await fetch(`${basis}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ subscription: sub.toJSON(), geraet: navigator.userAgent.slice(0, 60) }),
      });
      if (!sr.ok) throw new Error('Server hat die Anmeldung abgelehnt.');

      setDiesesGeraet(true);
      await laden();
      setMeldung({ art: 'ok', text: 'Dieses Gerät ist angemeldet.' });
    } catch (e) {
      setMeldung({ art: 'fehler', text: e instanceof Error ? e.message : 'Anmelden fehlgeschlagen.' });
    } finally {
      setLaeuft(false);
    }
  };

  const testen = async () => {
    setLaeuft(true);
    setMeldung(null);
    try {
      const r = await fetch(`${basis}/test`, { method: 'POST', headers: authHeader() });
      const d = (await r.json()) as { ok?: boolean; fehler?: string };
      setMeldung(
        d.ok
          ? { art: 'ok', text: 'Testnachricht ist raus — schau aufs Handy.' }
          : { art: 'fehler', text: d.fehler ?? 'Versand fehlgeschlagen.' },
      );
    } catch {
      setMeldung({ art: 'fehler', text: 'Test fehlgeschlagen.' });
    } finally {
      setLaeuft(false);
    }
  };

  const abmelden = async () => {
    setLaeuft(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch(`${basis}/unsubscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setDiesesGeraet(false);
      await laden();
      setMeldung({ art: 'ok', text: 'Dieses Gerät ist abgemeldet.' });
    } catch {
      setMeldung({ art: 'fehler', text: 'Abmelden fehlgeschlagen.' });
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <div className="app-card">
      <p className="app-label flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <Bell size={12} /> {titel}
        </span>
        {diesesGeraet && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              borderRadius: 999,
              padding: '2px 8px',
              fontSize: 9.5,
              fontWeight: 700,
              textTransform: 'none',
              letterSpacing: 0,
              background: 'var(--accent-soft, #e6f1eb)',
              color: 'var(--accent-ink, #123a28)',
            }}
          >
            <Check size={9} /> aktiv
          </span>
        )}
      </p>

      <p className="mt-2 text-[12px] leading-relaxed text-muted">{beschreibung}</p>

      {!f.moeglich ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-surface-2 px-2.5 py-2 text-[11.5px] text-muted">
          <Smartphone size={13} className="mt-0.5 shrink-0" />
          {f.grund}
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {!diesesGeraet ? (
              <button
                type="button"
                onClick={() => void anmelden()}
                disabled={laeuft}
                style={knopfPrimaer}
              >
                {laeuft ? <Loader2 size={12} className="animate-spin" /> : <Bell size={12} />}
                Dieses Gerät anmelden
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void testen()}
                  disabled={laeuft}
                  style={knopfPrimaer}
                >
                  {laeuft ? <Loader2 size={12} className="animate-spin" /> : <Bell size={12} />}
                  Testnachricht
                </button>
                <button
                  type="button"
                  onClick={() => void abmelden()}
                  disabled={laeuft}
                  style={knopfLeise}
                >
                  <BellOff size={12} /> Abmelden
                </button>
              </>
            )}
          </div>

          {status && status.angemeldet > 0 && (
            <p className="mt-2 text-[10.5px] text-muted">
              {status.angemeldet} {status.angemeldet === 1 ? 'Gerät' : 'Geräte'} angemeldet.
            </p>
          )}
        </>
      )}

      {meldung && (
        <p
          style={{
            marginTop: 8,
            borderRadius: 8,
            padding: '6px 10px',
            fontSize: 11,
            background:
              meldung.art === 'ok' ? 'var(--accent-soft, #e6f1eb)' : 'var(--danger-soft, #fbecea)',
            color: meldung.art === 'ok' ? 'var(--accent-ink, #123a28)' : 'var(--danger, #b4453a)',
          }}
        >
          {meldung.text}
        </p>
      )}

      {/* ── Was benachrichtigt wird ─────────────────────────────────────── */}
      {kategorien.length > 0 && (
        <div style={{ marginTop: 16, borderTop: '1px solid var(--line, #dde3df)', paddingTop: 12 }}>
          <p style={ueberschrift}>Was du bekommst</p>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column' }}>
            {kategorien.map((k) => (
              <label
                key={k.kategorie}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '8px 0',
                  borderBottom: '1px solid var(--line, #dde3df)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={k.aktiv}
                  onChange={(e) => void umschalten(k.kategorie, e.target.checked)}
                  style={{
                    marginTop: 2,
                    width: 16,
                    height: 16,
                    flexShrink: 0,
                    accentColor: 'var(--accent, #2f7d5a)',
                    cursor: 'pointer',
                  }}
                />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink, #16211c)' }}>
                    {k.titel}
                  </span>
                  <span style={{ display: 'block', fontSize: 10.5, lineHeight: 1.4, color: 'var(--muted, #55635c)' }}>
                    {k.beschreibung}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <p style={{ marginTop: 8, fontSize: 10, lineHeight: 1.4, color: 'var(--muted, #55635c)' }}>
            Ruhezeit 22–6 Uhr. Höchstens sechs Meldungen je Art und Tag. Dringendes (Tore, Anpfiff,
            Freigaben) geht immer durch.
          </p>
        </div>
      )}

      {/* ── Was zuletzt rausging ───────────────────────────────────────── */}
      {verlauf.length > 0 && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--line, #dde3df)', paddingTop: 12 }}>
          <button
            type="button"
            onClick={() => setVerlaufOffen((o) => !o)}
            style={{
              display: 'flex',
              width: '100%',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'transparent',
              border: 0,
              padding: 0,
              cursor: 'pointer',
            }}
          >
            <span style={ueberschrift}>Zuletzt gesendet</span>
            <span style={{ fontSize: 10.5, color: 'var(--muted, #55635c)' }}>
              {verlaufOffen ? 'ausblenden' : `${verlauf.length} ansehen`}
            </span>
          </button>

          {verlaufOffen && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {verlauf.map((v, i) => {
                const angekommen = v.stand === 'gesendet';
                return (
                  <div
                    key={`${v.zeit}-${v.ereignis}-${i}`}
                    style={{
                      borderRadius: 8,
                      padding: '7px 9px',
                      background: 'var(--surface-2, #f4f6f5)',
                      opacity: angekommen ? 1 : 0.72,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink, #16211c)' }}>{v.titel}</span>
                      <span style={{ flexShrink: 0, fontSize: 9.5, color: 'var(--muted, #55635c)' }}>{v.zeit}</span>
                    </div>
                    <p style={{ margin: '2px 0 0', fontSize: 10.5, lineHeight: 1.4, color: 'var(--muted, #55635c)' }}>
                      {v.text}
                    </p>
                    {!angekommen && (
                      <p style={{ margin: '4px 0 0', fontSize: 9.5, fontWeight: 600, color: 'var(--danger, #b4453a)' }}>
                        nicht zugestellt: {v.grund ? (GRUND_TEXT[v.grund] ?? v.grund) : 'unbekannt'}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
