import { useEffect, useMemo, useState } from 'react';
import { Check, RotateCcw, Target, X } from 'lucide-react';
import { api } from '../lib/api';

type Mode = 'doubles' | 'bobs27' | 'around' | 'checkout';

interface SessionRow {
  id: number;
  mode: Mode;
  score: number;
  hits: number;
  darts: number;
  createdAt: string;
}

interface SummaryRow {
  mode: Mode;
  sessions: string;
  best: number;
  avg: number;
}

const MODE_INFO: Record<Mode, { title: string; hint: string }> = {
  doubles: { title: 'Doppel-Training', hint: 'D1 bis D20, drei Darts je Doppel. Zählt die Treffer.' },
  bobs27: { title: "Bob's 27", hint: 'Start 27. Treffer addieren den Doppelwert, drei Fehlwürfe ziehen ihn ab — unter 0 ist Schluss.' },
  around: { title: 'Around the Clock', hint: '1 bis 20 und Bull der Reihe nach. Zählt die Darts bis zum Ziel.' },
  checkout: { title: 'Checkout-Training', hint: 'Zufällige Finish-Restscores von 170 bis 41. Wie viele Darts brauchst du?' },
};

const CHECKOUTS = Array.from({ length: 130 }, (_, i) => i + 41).filter(
  (n) => ![169, 168, 166, 165, 163, 162, 159].includes(n),
);

export function TrainingPage() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);

  // Laufender Durchgang
  const [index, setIndex] = useState(0);
  const [dartsAtTarget, setDartsAtTarget] = useState(0);
  const [hits, setHits] = useState(0);
  const [darts, setDarts] = useState(0);
  const [score, setScore] = useState(0);
  const [checkoutTarget, setCheckoutTarget] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const load = async () => {
    const data = await api<{ sessions: SessionRow[]; summary: SummaryRow[] }>('/training');
    setSessions(data.sessions);
    setSummary(data.summary);
  };

  useEffect(() => {
    void load();
  }, []);

  const targets = useMemo(() => Array.from({ length: 20 }, (_, i) => i + 1), []);

  const start = (m: Mode) => {
    setMode(m);
    setIndex(0);
    setDartsAtTarget(0);
    setHits(0);
    setDarts(0);
    setScore(m === 'bobs27' ? 27 : 0);
    setDone(false);
    setSaved(null);
    setCheckoutTarget(m === 'checkout' ? CHECKOUTS[Math.floor(Math.random() * CHECKOUTS.length)] : null);
  };

  const finish = async (finalScore: number, finalHits: number, finalDarts: number) => {
    if (!mode) return;
    setDone(true);
    try {
      await api('/training', { body: { mode, score: finalScore, hits: finalHits, darts: finalDarts, detail: {} } });
      setSaved('gespeichert');
      await load();
    } catch {
      setSaved('konnte nicht gespeichert werden');
    }
  };

  const registerDart = (hit: boolean) => {
    if (!mode) return;
    const newDarts = darts + 1;
    const newHits = hits + (hit ? 1 : 0);
    const newDartsAt = dartsAtTarget + 1;
    let newScore = score;

    if (mode === 'bobs27') {
      const value = 2 * targets[index];
      newScore += hit ? value : 0;
      if (newDartsAt === 3) {
        if (newHits === hits) newScore -= value;
      }
    }
    if (mode === 'doubles') newScore = newHits;
    if (mode === 'around') newScore = newDarts;

    setDarts(newDarts);
    setHits(newHits);
    setDartsAtTarget(newDartsAt);
    setScore(newScore);

    if (mode === 'bobs27' && newDartsAt === 3) {
      if (newScore <= 0) return void finish(0, newHits, newDarts);
      if (index >= targets.length - 1) return void finish(newScore, newHits, newDarts);
      setIndex(index + 1);
      setDartsAtTarget(0);
      return;
    }
    if ((mode === 'doubles' || mode === 'around') && hit) {
      if (index >= targets.length - 1) return void finish(newScore, newHits, newDarts);
      setIndex(index + 1);
      setDartsAtTarget(0);
      return;
    }
    if (mode === 'doubles' && newDartsAt === 3) {
      if (index >= targets.length - 1) return void finish(newScore, newHits, newDarts);
      setIndex(index + 1);
      setDartsAtTarget(0);
    }
  };

  const checkoutResult = (used: number | null) => {
    if (!mode) return;
    const newHits = hits + (used ? 1 : 0);
    const newDarts = darts + (used ?? 3);
    setHits(newHits);
    setDarts(newDarts);
    setScore(newHits);
    if (index + 1 >= 10) return void finish(newHits, newHits, newDarts);
    setIndex(index + 1);
    setCheckoutTarget(CHECKOUTS[Math.floor(Math.random() * CHECKOUTS.length)]);
  };

  const targetLabel =
    mode === 'checkout'
      ? String(checkoutTarget ?? '—')
      : mode === 'bobs27'
        ? `D${targets[index]}`
        : mode === 'doubles'
          ? `D${targets[index]}`
          : `${targets[index] ?? 25}${index === 20 ? ' · Bull' : ''}`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Training</h1>
        <p className="text-sm text-[#a9b9d4]">Vier Übungen, Ergebnisse landen in deiner Statistik.</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        {(Object.keys(MODE_INFO) as Mode[]).map((m) => (
          <button
            key={m}
            className={`card p-3 text-left ${mode === m ? 'border-[#3ee383]' : ''}`}
            onClick={() => start(m)}
          >
            <p className="text-sm font-bold">{MODE_INFO[m].title}</p>
            <p className="mt-1 text-[11px] leading-snug text-[#a9b9d4]">{MODE_INFO[m].hint}</p>
          </button>
        ))}
      </div>

      {mode && (
        <div className="card space-y-4 p-5 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-[#a9b9d4]">{MODE_INFO[mode].title}</p>

          {done ? (
            <div className="space-y-2">
              <p className="text-4xl font-black">{score}</p>
              <p className="text-sm text-[#a9b9d4]">
                {hits} Treffer · {darts} Darts {saved ? `· ${saved}` : ''}
              </p>
              <button className="btn btn-primary" onClick={() => start(mode)}>
                <RotateCcw className="h-4 w-4" /> nochmal
              </button>
            </div>
          ) : (
            <>
              <p className="text-6xl font-black tabular-nums">
                {targetLabel}
                {mode === 'bobs27' && <span className="ml-2 text-2xl text-[#a9b9d4]">{score}</span>}
              </p>

              {mode === 'checkout' ? (
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 3].map((n) => (
                    <button key={n} className="btn" onClick={() => checkoutResult(n)}>
                      {n} Dart{n > 1 ? 's' : ''}
                    </button>
                  ))}
                  <button className="btn btn-danger" onClick={() => checkoutResult(null)}>
                    verfehlt
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn btn-primary !py-4" onClick={() => registerDart(true)}>
                    <Check className="h-5 w-5" /> Treffer
                  </button>
                  <button className="btn !py-4" onClick={() => registerDart(false)}>
                    <X className="h-5 w-5" /> daneben
                  </button>
                </div>
              )}

              <div className="flex justify-between text-xs text-[#a9b9d4]">
                <span>
                  Ziel {Math.min(index + 1, mode === 'checkout' ? 10 : 20)}/
                  {mode === 'checkout' ? 10 : 20}
                </span>
                <span>
                  {hits} Treffer · {darts} Darts
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {summary.length > 0 && (
        <div className="card p-4">
          <p className="label">Deine Übungen</p>
          <div className="space-y-1 text-sm">
            {summary.map((s) => (
              <div key={s.mode} className="flex items-center justify-between">
                <span>{MODE_INFO[s.mode]?.title ?? s.mode}</span>
                <span className="text-[#a9b9d4]">
                  {s.sessions}× · Bestwert {s.best} · Ø {s.avg}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {sessions.length > 0 && (
        <div className="card p-4">
          <p className="label">Verlauf</p>
          <div className="max-h-64 space-y-1 overflow-y-auto text-sm">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2">
                <span className="truncate text-[#a9b9d4]">
                  {new Date(s.createdAt).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })} ·{' '}
                  {MODE_INFO[s.mode]?.title ?? s.mode}
                </span>
                <span className="font-bold tabular-nums">
                  {s.score} <span className="text-xs font-normal text-[#a9b9d4]">({s.hits}/{s.darts})</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!mode && sessions.length === 0 && (
        <div className="card flex items-center gap-3 p-5 text-sm text-[#a9b9d4]">
          <Target className="h-5 w-5" /> Wähle oben eine Übung — die Ergebnisse erscheinen hier und in der Statistik.
        </div>
      )}
    </div>
  );
}
