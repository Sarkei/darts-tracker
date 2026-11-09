import { useEffect, useMemo, useState } from 'react';
import { Bot, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import type { Player, PlayerStats } from '../lib/types';

const BOARD_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

const RADII = {
  bullseye: 6.5,
  bull: 15.9,
  innerSingle: 99,
  triple: 107,
  outerSingle: 162,
  double: 170,
};

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r1: number, r2: number, a1: number, a2: number) {
  const p1 = polar(cx, cy, r2, a1);
  const p2 = polar(cx, cy, r2, a2);
  const p3 = polar(cx, cy, r1, a2);
  const p4 = polar(cx, cy, r1, a1);
  const large = a2 - a1 > 180 ? 1 : 0;
  return `M${p1.x},${p1.y} A${r2},${r2} 0 ${large} 1 ${p2.x},${p2.y} L${p3.x},${p3.y} A${r1},${r1} 0 ${large} 0 ${p4.x},${p4.y} Z`;
}

function heat(count: number, max: number) {
  if (!count) return 'rgba(255,255,255,0.04)';
  const t = Math.min(1, count / Math.max(1, max));
  const alpha = 0.18 + t * 0.75;
  return `rgba(56, 224, 123, ${alpha.toFixed(2)})`;
}

interface H2HRow {
  playerId: number;
  name: string;
  avatar: string;
  wins: number;
  losses: number;
  legsFor: number;
  legsAgainst: number;
}

interface WeekRow {
  week: string;
  average: number;
  checkouts: number;
  attempts: number;
  darts: number;
}

interface AiPlan {
  focus: string[];
  plan: Array<{ title: string; minutes: number; description: string }>;
  encouragement: string;
}

export function StatsPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [h2h, setH2h] = useState<H2HRow[]>([]);
  const [planBusy, setPlanBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const data = await api<{ players: Player[] }>('/players');
      setPlayers(data.players);
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const query = new URLSearchParams();
      if (playerId) query.set('playerId', String(playerId));
      if (from) query.set('from', from);
      if (to) query.set('to', to);
      const data = await api<{ players: PlayerStats[] }>(`/stats?${query.toString()}`);
      setStats(data.players[0] ?? null);
    })();
  }, [playerId, from, to]);

  const maxField = useMemo(() => {
    if (!stats) return 1;
    return Math.max(1, ...Object.values(stats.fields));
  }, [stats]);

  const topFields = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.fields)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [stats]);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api<{ opponents: H2HRow[] }>(`/stats/h2h${playerId ? `?playerId=${playerId}` : ''}`);
        setH2h(data.opponents);
      } catch {
        setH2h([]);
      }
    })();
  }, [playerId]);

  const requestPlan = async () => {
    setPlanBusy(true);
    setError(null);
    try {
      const data = await api<AiPlan>('/ai/training-plan', { body: { playerId: playerId ?? undefined } });
      setPlan(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Trainingsplan fehlgeschlagen');
    } finally {
      setPlanBusy(false);
    }
  };

  const cx = 180;
  const cy = 180;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold">Statistik</h1>
          <p className="text-sm text-[var(--color-muted)]">Trefferverteilung, Quoten und Averages.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input !w-auto"
            value={playerId ?? ''}
            onChange={(e) => setPlayerId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Mein Profil</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div>
          <label className="label !mb-1">von</label>
          <input className="input !w-auto" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label !mb-1">bis</label>
          <input className="input !w-auto" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {(from || to) && (
          <button
            className="btn !py-2 text-xs"
            onClick={() => {
              setFrom('');
              setTo('');
            }}
          >
            zurücksetzen
          </button>
        )}
      </div>

      {!stats || stats.darts === 0 ? (
        <div className="card p-6 text-center text-sm text-[var(--color-muted)]">
          Noch keine Würfe im Zeitraum — spiele ein Match, dann füllt sich die Statistik.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: 'Average', value: stats.average },
              { label: 'First 9', value: stats.first9Average },
              { label: 'Doppel-Quote', value: `${stats.doubleQuote}%` },
              { label: 'Checkout %', value: stats.checkoutQuote },
              { label: '180er', value: stats.count180 },
              { label: '140+', value: stats.count140 },
              { label: 'Bester Zug', value: stats.bestVisit },
              { label: 'Busts', value: stats.busts },
            ].map((metric) => (
              <div key={metric.label} className="card p-3 text-center">
                <p className="text-xl font-extrabold tabular-nums">{metric.value}</p>
                <p className="text-[11px] uppercase tracking-widest text-[var(--color-muted)]">{metric.label}</p>
              </div>
            ))}
          </div>

          <div className="card p-4">
            <p className="label">Trefferfelder</p>
            <div className="mx-auto max-w-md">
              <svg viewBox="0 0 360 360" className="w-full">
                {BOARD_ORDER.map((number, index) => {
                  const mid = index * 18;
                  const a1 = mid - 9;
                  const a2 = mid + 9;
                  const bands: Array<{ key: string; r1: number; r2: number }> = [
                    { key: `S${number}`, r1: RADII.bull, r2: RADII.innerSingle },
                    { key: `T${number}`, r1: RADII.innerSingle, r2: RADII.triple },
                    { key: `S${number}`, r1: RADII.triple, r2: RADII.outerSingle },
                    { key: `D${number}`, r1: RADII.outerSingle, r2: RADII.double },
                  ];
                  return bands.map((band, bandIndex) => (
                    <path
                      key={`${number}-${bandIndex}`}
                      d={arcPath(cx, cy, band.r1, band.r2, a1, a2)}
                      fill={heat(stats.fields[band.key] ?? 0, maxField)}
                      stroke="rgba(255,255,255,0.09)"
                      strokeWidth="0.6"
                    />
                  ));
                })}
                <circle cx={cx} cy={cy} r={RADII.bull} fill={heat(stats.fields['25'] ?? 0, maxField)} stroke="rgba(255,255,255,0.09)" />
                <circle cx={cx} cy={cy} r={RADII.bullseye} fill={heat(stats.fields['DB'] ?? 0, maxField)} stroke="rgba(255,255,255,0.09)" />
                {BOARD_ORDER.map((number, index) => {
                  const p = polar(cx, cy, RADII.double + 16, index * 18);
                  return (
                    <text
                      key={`label-${number}`}
                      x={p.x}
                      y={p.y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize="11"
                      fontWeight="700"
                      fill="#8fa0bd"
                    >
                      {number}
                    </text>
                  );
                })}
              </svg>
              <p className="mt-2 text-center text-xs text-[var(--color-muted)]">
                Je dunkler grün, desto häufiger landete ein Dart dort ({stats.darts} Darts gesamt).
              </p>
            </div>
          </div>

          <div className="card p-4">
            <p className="label">Häufigste Felder</p>
            <div className="space-y-1">
              {topFields.map(([field, count]) => (
                <div key={field} className="flex items-center gap-2 text-sm">
                  <span className="w-12 font-mono font-bold">{field}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                    <div
                      className="h-full rounded-full bg-[var(--color-accent)]"
                      style={{ width: `${Math.round((count / maxField) * 100)}%` }}
                    />
                  </div>
                  <span className="w-12 text-right tabular-nums text-[var(--color-muted)]">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {stats.history && stats.history.length > 1 && (
            <div className="card p-4">
              <p className="label">Verlauf (3-Dart-Average pro Woche)</p>
              <div className="flex items-end gap-2">
                {stats.history.slice(-10).map((week) => {
                  const max = Math.max(...stats.history!.map((w) => w.average), 1);
                  return (
                    <div key={week.week} className="flex flex-1 flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t bg-[#3ee383]"
                        style={{ height: `${Math.max(4, (week.average / max) * 90)}px` }}
                        title={`${week.week}: ${week.average} Average`}
                      />
                      <span className="text-[10px] text-[#a9b9d4]">{week.week.split('-')[1]}</span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-[#a9b9d4]">
                Letzte Woche: {stats.history[stats.history.length - 1].average} Average ·{' '}
                {stats.history[stats.history.length - 1].checkouts} Checkouts
              </p>
            </div>
          )}

          {h2h.length > 0 && (
            <div className="card p-4">
              <p className="label">Bilanz gegen Gegner</p>
              <div className="space-y-1 text-sm">
                {h2h.map((row) => (
                  <div key={row.playerId} className="flex items-center justify-between gap-2">
                    <span className="truncate">{row.name}</span>
                    <span className={row.wins >= row.losses ? 'font-bold text-[#3ee383]' : 'font-bold text-[#ff9aa3]'}>
                      {row.wins}:{row.losses}
                    </span>
                    <span className="text-xs text-[#a9b9d4]">
                      Legs {row.legsFor}:{row.legsAgainst}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="label !mb-0">KI-Trainingsplan</p>
              <button className="btn !px-3 !py-2 text-xs" onClick={requestPlan} disabled={planBusy}>
                <Sparkles className="h-3.5 w-3.5" /> {planBusy ? 'denke nach …' : 'erstellen'}
              </button>
            </div>
            {error && <p className="mt-2 text-sm text-[#ffb3ba]">{error}</p>}
            {plan && (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-1">
                  {plan.focus.map((f) => (
                    <span key={f} className="chip chip-on">
                      {f}
                    </span>
                  ))}
                </div>
                {plan.plan.map((step) => (
                  <div key={step.title} className="rounded-xl bg-white/[0.04] p-3">
                    <p className="flex items-center justify-between text-sm font-bold">
                      {step.title}
                      <span className="text-xs text-[var(--color-muted)]">{step.minutes} Min</span>
                    </p>
                    <p className="mt-1 text-sm text-[var(--color-muted)]">{step.description}</p>
                  </div>
                ))}
                <p className="flex items-center gap-2 text-sm text-[var(--color-accent)]">
                  <Bot className="h-4 w-4" /> {plan.encouragement}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
