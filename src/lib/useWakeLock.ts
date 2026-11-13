import { useEffect } from 'react';

interface WakeLockSentinel {
  release: () => Promise<void>;
}

/**
 * Hält den Bildschirm an, solange die Seite offen ist — beim Kamera-Betrieb und beim
 * Scoreboard ist ein schlafendes Display das häufigste Problem. Fällt still zurück,
 * wenn der Browser die API nicht kennt oder die Seite im Hintergrund ist.
 */
export function useWakeLock(active = true) {
  useEffect(() => {
    if (!active) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const request = async () => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> };
        };
        if (!nav.wakeLock || document.visibilityState !== 'visible') return;
        const lock = await nav.wakeLock.request('screen');
        if (cancelled) {
          void lock.release();
          return;
        }
        sentinel = lock;
      } catch {
        /* nicht unterstützt — kein Grund für eine Fehlermeldung */
      }
    };

    void request();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release();
    };
  }, [active]);
}
