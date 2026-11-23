/**
 * Pushover-Verbindung für alle Apps.
 *
 * Pushover schickt Nachrichten aufs Handy. Jede Person hinterlegt ihre eigenen
 * zwei Werte aus dem Pushover-Konto:
 *   - User Key:  identifiziert das Empfängergerät (beginnt mit „u")
 *   - App-Token: identifiziert die Anwendung (beginnt mit „a")
 *
 * Beide Werte bleiben **auf dem Server** und gehen nicht an den Browser zurück —
 * die Maske zeigt nur „gesetzt/nicht gesetzt". Genau wie bei den übrigen
 * Integrationen (Garmin, Intervals, Mealplanner-Kopplung).
 *
 * Der Server braucht zwei Endpunkte:
 *   GET    /api/integrations/pushover   → { verbunden, userKeyGesetzt, tokenGesetzt, lastError }
 *   POST   /api/integrations/pushover   → { userKey, token } speichern
 *   DELETE /api/integrations/pushover   → trennen
 *   POST   /api/integrations/pushover/test → Testnachricht
 */

import { useEffect, useState } from 'react';
import { Bell, BellRing, Check, ExternalLink, Loader2, X } from 'lucide-react';

type Status = {
  verbunden: boolean;
  userKeyGesetzt?: boolean;
  tokenGesetzt?: boolean;
  lastError?: string | null;
};

/** Basispfad der API — die Apps sprechen unterschiedlich, deshalb konfigurierbar. */
export type PushoverProps = {
  /** Pfad der Endpunkte, Standard: /api/integrations/pushover */
  basis?: string;
  /** Überschrift der Karte. */
  titel?: string;
  /** Erklärender Satz, was gepusht wird. */
  beschreibung?: string;
  /** Wird nach dem Speichern gerufen. */
  onGespeichert?: (verbunden: boolean) => void;
};

/**
 * Holt den Auth-Header der jeweiligen App.
 *
 * Die Apps speichern ihr Token an verschiedenen Stellen (localStorage-Schlüssel
 * unterscheiden sich). Deshalb wird hier gesucht statt geraten.
 */
function authHeader(): Record<string, string> {
  const kandidaten = ['vrtx_jwt', 'token', 'mealplanner.token', 'darts-token', 'auth_token'];
  let token = '';
  try {
    for (const k of kandidaten) {
      const v = localStorage.getItem(k);
      if (v) {
        token = v;
        break;
      }
    }
  } catch {
    /* kein localStorage */
  }
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function PushoverKarte({
  basis = '/api/integrations/pushover',
  titel = 'Benachrichtigungen (Pushover)',
  beschreibung = 'Pushover schickt Nachrichten aufs Handy. Beide Werte stehen in deinem Pushover-Konto.',
  onGespeichert,
}: PushoverProps) {
  const [status, setStatus] = useState<Status | null>(null);
  const [userKey, setUserKey] = useState('');
  const [token, setToken] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ art: 'ok' | 'fehler'; text: string } | null>(null);

  const laden = () =>
    fetch(basis, { headers: authHeader() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStatus(d))
      .catch(() => setStatus(null));

  useEffect(() => {
    void laden();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basis]);

  const speichern = async () => {
    setLaeuft(true);
    setMeldung(null);
    try {
      const res = await fetch(basis, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ userKey: userKey.trim(), token: token.trim() }),
      });
      if (!res.ok) throw new Error('Speichern fehlgeschlagen');
      setUserKey('');
      setToken('');
      await laden();
      setMeldung({ art: 'ok', text: 'Verbindung gespeichert.' });
      onGespeichert?.(true);
    } catch {
      setMeldung({ art: 'fehler', text: 'Konnte nicht gespeichert werden.' });
    } finally {
      setLaeuft(false);
    }
  };

  const testen = async () => {
    setLaeuft(true);
    setMeldung(null);
    try {
      const res = await fetch(`${basis}/test`, { method: 'POST', headers: authHeader() });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; fehler?: string };
      if (d.ok) setMeldung({ art: 'ok', text: 'Testnachricht ist raus — schau aufs Handy.' });
      else setMeldung({ art: 'fehler', text: d.fehler ?? 'Pushover hat abgelehnt.' });
    } catch {
      setMeldung({ art: 'fehler', text: 'Test fehlgeschlagen.' });
    } finally {
      setLaeuft(false);
    }
  };

  const trennen = async () => {
    setLaeuft(true);
    try {
      await fetch(basis, { method: 'DELETE', headers: authHeader() });
      await laden();
      setMeldung({ art: 'ok', text: 'Verbindung getrennt.' });
      onGespeichert?.(false);
    } catch {
      setMeldung({ art: 'fehler', text: 'Trennen fehlgeschlagen.' });
    } finally {
      setLaeuft(false);
    }
  };

  const verbunden = status?.verbunden ?? false;

  return (
    <div className="app-card">
      <p className="app-label flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <Bell size={12} /> {titel}
        </span>
        {verbunden && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[9.5px] font-semibold normal-case tracking-normal text-accent-ink">
            <Check size={9} /> verbunden
          </span>
        )}
      </p>

      <p className="mt-2 text-[12px] leading-relaxed text-muted">{beschreibung}</p>

      {verbunden ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void testen()}
              disabled={laeuft}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[11.5px] font-semibold text-on-accent disabled:opacity-50"
            >
              {laeuft ? <Loader2 size={12} className="animate-spin" /> : <BellRing size={12} />}
              Testnachricht senden
            </button>
            <button
              type="button"
              onClick={() => void trennen()}
              disabled={laeuft}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[11.5px] font-semibold text-muted transition hover:border-danger hover:text-danger disabled:opacity-50"
            >
              <X size={12} /> Trennen
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="mt-3 block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">User Key</span>
            <input
              value={userKey}
              onChange={(e) => setUserKey(e.target.value)}
              placeholder="u…"
              autoComplete="off"
              className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 font-mono text-[12px] outline-none focus:border-accent"
            />
          </label>
          <label className="mt-2 block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">App-Token</span>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="a…"
              autoComplete="off"
              className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 font-mono text-[12px] outline-none focus:border-accent"
            />
          </label>
          <button
            type="button"
            onClick={() => void speichern()}
            disabled={!userKey.trim() || !token.trim() || laeuft}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2.5 text-[11.5px] font-semibold text-on-accent disabled:opacity-40"
          >
            {laeuft ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Verbinden
          </button>
        </>
      )}

      {meldung && (
        <p
          className={`mt-2 rounded-lg px-2.5 py-1.5 text-[11px] ${
            meldung.art === 'ok' ? 'bg-accent-soft text-accent-ink' : 'bg-danger-soft text-danger'
          }`}
        >
          {meldung.text}
        </p>
      )}

      {status?.lastError && (
        <p className="mt-2 text-[10.5px] text-danger">Letzter Fehler: {status.lastError}</p>
      )}

      <a
        href="https://pushover.net/"
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex items-center gap-1 text-[10.5px] text-muted underline"
      >
        Werte im Pushover-Konto holen <ExternalLink size={9} />
      </a>
    </div>
  );
}
