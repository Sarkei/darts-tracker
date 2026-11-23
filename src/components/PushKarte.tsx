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

/** Base64url → Uint8Array (für `applicationServerKey`). */
function schluesselAlsBytes(b64: string): Uint8Array {
  const roh = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const arr = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i += 1) arr[i] = roh.charCodeAt(i);
  return arr;
}

export default function PushKarte({
  basis = '/api/push',
  titel = 'Push-Benachrichtigungen',
  beschreibung = 'Nachrichten direkt aufs Handy — auch wenn die App geschlossen ist.',
}: {
  basis?: string;
  titel?: string;
  beschreibung?: string;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ art: 'ok' | 'fehler'; text: string } | null>(null);
  const [diesesGeraet, setDiesesGeraet] = useState(false);

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
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[9.5px] font-semibold normal-case tracking-normal text-accent-ink">
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
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[11.5px] font-semibold text-on-accent disabled:opacity-50"
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
                  className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[11.5px] font-semibold text-on-accent disabled:opacity-50"
                >
                  {laeuft ? <Loader2 size={12} className="animate-spin" /> : <Bell size={12} />}
                  Testnachricht
                </button>
                <button
                  type="button"
                  onClick={() => void abmelden()}
                  disabled={laeuft}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[11.5px] font-semibold text-muted transition hover:border-danger hover:text-danger disabled:opacity-50"
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
          className={`mt-2 rounded-lg px-2.5 py-1.5 text-[11px] ${
            meldung.art === 'ok' ? 'bg-accent-soft text-accent-ink' : 'bg-danger-soft text-danger'
          }`}
        >
          {meldung.text}
        </p>
      )}
    </div>
  );
}
