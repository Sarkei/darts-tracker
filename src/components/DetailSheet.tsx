/**
 * Detailansicht für Kennzahlen — Klick auf eine Kachel öffnet Verlauf und
 * Aufschlüsselung. Gleiche Mechanik wie im Fitness-Tracker, nur mit den
 * Bausteinen dieses Projekts.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { X, TrendingUp, TrendingDown, Minus, Loader2 } from 'lucide-react';

export type DetailPunkt = { label: string; wert: number; hint?: string };

export type DetailDef = {
  titel: string;
  einheit?: string;
  /** Beschreibung unter der Überschrift */
  hinweis?: string;
  /** Höher ist besser? Nur für die Trendfarbe. */
  hoeherBesser?: boolean;
  /** Lädt die Punkte (Liste von Werten mit Beschriftung) */
  laden: () => Promise<DetailPunkt[]>;
};

/** Zahl hübsch darstellen. */
function zahl(v: number, einheit?: string): string {
  const gerundet = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${gerundet.toLocaleString('de-DE')}${einheit ? ` ${einheit}` : ''}`;
}

export function DetailSheet({ def, onClose }: { def: DetailDef; onClose: () => void }) {
  const [punkte, setPunkte] = useState<DetailPunkt[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const daten = await def.laden();
        if (alive) setPunkte(daten);
      } catch (e) {
        if (alive) setFehler(e instanceof Error ? e.message : 'Daten konnten nicht geladen werden.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [def]);

  const statistik = useMemo(() => {
    if (!punkte || punkte.length === 0) return null;
    const werte = punkte.map((p) => p.wert);
    const summe = werte.reduce((a, b) => a + b, 0);
    const schnitt = summe / werte.length;
    const min = Math.min(...werte);
    const max = Math.max(...werte);

    // Trend: letzte 3 gegen die 3 davor
    let trend: number | null = null;
    if (werte.length >= 4) {
      const hinten = werte.slice(-3);
      const davor = werte.slice(-6, -3);
      if (davor.length > 0) {
        trend =
          hinten.reduce((a, b) => a + b, 0) / hinten.length -
          davor.reduce((a, b) => a + b, 0) / davor.length;
      }
    }
    return { schnitt, min, max, trend, summe, anzahl: werte.length };
  }, [punkte]);

  const maxWert = punkte && punkte.length > 0 ? Math.max(...punkte.map((p) => p.wert), 1) : 1;

  const trendPfeil = (() => {
    if (!statistik || statistik.trend == null) return null;
    const t = statistik.trend;
    if (Math.abs(t) < 0.01) return { Icon: Minus, farbe: 'var(--muted)', text: 'unverändert' };
    const besser = def.hoeherBesser === false ? t < 0 : t > 0;
    return {
      Icon: t > 0 ? TrendingUp : TrendingDown,
      farbe: besser ? 'var(--accent)' : 'var(--clay)',
      text: `${t > 0 ? '+' : ''}${zahl(t, def.einheit)} zum Vergleichszeitraum`,
    };
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[var(--vv-height,92dvh)] w-full max-w-xl overflow-hidden rounded-t-[1.75rem] bg-[var(--bg)] shadow-2xl sm:rounded-[1.75rem]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] p-4">
          <div>
            <h2 className="font-serif text-lg">{def.titel}</h2>
            {def.hinweis && <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--muted)]">{def.hinweis}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--muted)] transition hover:text-[var(--ink)]"
            aria-label="Schließen"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[calc(var(--vv-height,92dvh)-4.5rem)] overflow-y-auto p-4">
          {fehler ? (
            <p className="py-6 text-center text-sm text-[var(--danger)]">{fehler}</p>
          ) : !punkte ? (
            <p className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--muted)]">
              <Loader2 className="h-4 w-4 animate-spin" /> wird geladen …
            </p>
          ) : !statistik ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">Noch keine Werte vorhanden.</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: 'Schnitt', wert: zahl(statistik.schnitt, def.einheit) },
                  { label: 'Niedrigster', wert: zahl(statistik.min, def.einheit) },
                  { label: 'Höchster', wert: zahl(statistik.max, def.einheit) },
                  { label: 'Anzahl', wert: String(statistik.anzahl) },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl bg-[var(--bg)]-2 px-3 py-2">
                    <p className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-[var(--muted)]">{s.label}</p>
                    <p className="text-[15px] font-semibold tabular-nums">{s.wert}</p>
                  </div>
                ))}
              </div>

              {trendPfeil && (
                <p className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: trendPfeil.farbe }}>
                  <trendPfeil.Icon className="h-3.5 w-3.5" />
                  {trendPfeil.text}
                </p>
              )}

              <div className="rounded-xl border border-[var(--line)] p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Verlauf</p>
                <div className="flex h-28 items-end gap-1">
                  {punkte.slice(-30).map((p, i) => (
                    <div key={`${p.label}-${i}`} className="flex-1" title={`${p.label}: ${zahl(p.wert, def.einheit)}`}>
                      <div
                        className="w-full rounded-t bg-[var(--accent)]/70"
                        style={{ height: `${Math.max(2, (p.wert / maxWert) * 100)}%` }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-[var(--line)]">
                <table className="w-full text-[12px]">
                  <thead className="text-[9.5px] uppercase tracking-[0.1em] text-[var(--muted)]">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Eintrag</th>
                      <th className="px-3 py-2 text-right font-semibold">Wert</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {[...punkte].reverse().map((p, i) => (
                      <tr key={`${p.label}-row-${i}`}>
                        <td className="px-3 py-1.5 text-[var(--muted)]">{p.label}</td>
                        <td className="px-3 py-1.5 text-right font-semibold tabular-nums">
                          {zahl(p.wert, def.einheit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Klickbare Kennzahl-Kachel (Ergänzung zu StatRow). */
export function StatButton(props: {
  key?: string | number;
  value: string;
  label: string;
  onClick: () => void;
}) {
  const { value, label, onClick } = props;
  return (
    <button type="button" onClick={onClick} className="stat group cursor-pointer text-left" title="Details ansehen">
      <dt className="stat__value flex items-center gap-1.5">
        {value}
        <TrendingUp className="h-3 w-3 opacity-0 transition group-hover:opacity-60" aria-hidden />
      </dt>
      <dd className="stat__label">{label}</dd>
    </button>
  );
}

export type { ReactNode };
