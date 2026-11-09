import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bot, RotateCcw, Sparkles, Target, UserX } from 'lucide-react';
import { api } from '../lib/api';
import { dartLabel, type MatchState, type Ring } from '../lib/types';
import { useMatchEvents } from '../lib/useMatchEvents';

interface Props {
  matchId: number;
  onNavigate: (to: string) => void;
}

const RINGS: Array<{ key: Ring; label: string }> = [
  { key: 'single', label: 'Single' },
  { key: 'double', label: 'Doppel' },
  { key: 'triple', label: 'Triple' },
];

interface AiSummary {
  headline: string;
  summary: string;
  highlights: string[];
  tips: string[];
}

export function MatchPage({ matchId, onNavigate }: Props) {
  const [state, setState] = useState<MatchState | null>(null);
  const [ring, setRing] = useState<Ring>('single');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AiSummary | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<MatchState>(`/matches/${matchId}`);
      setState(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Match konnte nicht geladen werden');
    }
  }, [matchId]);

  useEffect(() => {
    void load();
  }, [load]);

  useMatchEvents(matchId, load);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Aktion fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  const throwDart = (r: Ring, number: number) =>
    act(() => api(`/matches/${matchId}/darts`, { body: { ring: r, number } }));

  const active = useMemo(
    () => state?.players.find((p) => p.matchPlayerId === state.currentMatchPlayerId) ?? null,
    [state],
  );

  const recentVisits = useMemo(() => {
    if (!state) return [];
    return [...state.visits].reverse().slice(0, 12);
  }, [state]);

  if (!state) {
    return <div className="py-16 text-center text-[var(--color-muted)]">lade Match …</div>;
  }

  const playerById = (matchPlayerId: number) => state.players.find((p) => p.matchPlayerId === matchPlayerId);
  const route = active?.checkoutSuggestion?.[0] ?? null;
  const alternatives = active?.checkoutSuggestion?.slice(1) ?? [];
  const dartsInVisit =
    state.lastVisit && state.lastVisit.matchPlayerId === active?.matchPlayerId ? state.lastVisit.darts.length : 0;

  const requestSummary = async () => {
    setSummaryBusy(true);
    setError(null);
    try {
      const data = await api<AiSummary>('/ai/match-summary', { body: { matchId } });
      setSummary(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'KI-Zusammenfassung fehlgeschlagen');
    } finally {
      setSummaryBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button className="btn !px-3 !py-2" onClick={() => onNavigate('/history')}>
          <ArrowLeft className="h-4 w-4" /> Historie
        </button>
        <div className="flex gap-1 overflow-x-auto scroll-x">
          {state.players.map((p) => (
            <span
              key={p.matchPlayerId}
              className={`chip ${p.matchPlayerId === state.currentMatchPlayerId ? 'chip-on' : ''}`}
            >
              {p.avatar} {p.name} · {p.legsWon}
            </span>
          ))}
        </div>
      </div>

      {state.finished && (
        <div className="card border-[var(--color-accent)] p-4">
          <p className="text-xs uppercase tracking-widest text-[var(--color-muted)]">Match beendet</p>
          <p className="mt-1 text-2xl font-extrabold text-[var(--color-accent)]">
            {state.players.find((p) => p.matchPlayerId === state.match.winnerPlayerId)?.name} gewinnt
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => onNavigate('/new')}>
              Neues Match
            </button>
            <button className="btn" onClick={requestSummary} disabled={summaryBusy}>
              <Sparkles className="h-4 w-4" /> {summaryBusy ? 'analysiere …' : 'KI-Analyse'}
            </button>
          </div>
        </div>
      )}

      {summary && (
        <div className="card space-y-2 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-[var(--color-accent)]">
            <Bot className="h-4 w-4" /> {summary.headline}
          </p>
          <p className="text-sm text-[#cfdaf0]">{summary.summary}</p>
          {summary.highlights.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-muted)]">
              {summary.highlights.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          )}
          {summary.tips.length > 0 && (
            <div className="rounded-xl bg-[var(--color-accent-soft)] p-3 text-sm">
              <p className="mb-1 text-xs font-bold uppercase tracking-widest text-[var(--color-accent)]">Tipps</p>
              <ul className="list-disc space-y-1 pl-5">
                {summary.tips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {active && !state.finished && (
        <div className="card p-5 text-center">
          <div className="flex items-center justify-center gap-2 text-sm text-[var(--color-muted)]">
            <span className="text-xl">{active.avatar}</span>
            <span className="font-bold uppercase tracking-widest">{active.name} ist dran</span>
          </div>
          <p className="mt-1 text-[clamp(3.5rem,18vw,7rem)] font-black leading-none tabular-nums">
            {active.remaining}
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs text-[var(--color-muted)]">
            <span className="chip">Leg {state.currentLegIndex}</span>
            <span className="chip">
              Darts in diesem Zug: {dartsInVisit}/3
            </span>
            {state.match.doubleIn && !active.entered && <span className="chip !text-[var(--color-warn)]">Double-In offen</span>}
            {state.match.doubleOut && <span className="chip">Double-Out</span>}
          </div>

          {route && (
            <div className="mt-4 rounded-2xl border border-[#2c8f56] bg-[#0d3521] p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-accent)]">Checkout</p>
              <p className="mt-1 text-2xl font-extrabold tracking-wide">{route.label}</p>
              {alternatives.length > 0 && (
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  Alternativen: {alternatives.map((a) => a.label).join(' · ')}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {!state.finished && active && (
        <div className="card p-4">
          <div className="mx-auto mb-3 grid max-w-md grid-cols-3 gap-2">
            {RINGS.map((r) => (
              <button
                key={r.key}
                className={`ring-btn ${ring === r.key ? 'active' : ''}`}
                onClick={() => setRing(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>

          <div className="mx-auto grid max-w-md grid-cols-5 gap-2">
            {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
              <button key={n} className="num-btn" disabled={busy} onClick={() => throwDart(ring, n)}>
                {ring === 'triple' ? `T${n}` : ring === 'double' ? `D${n}` : n}
              </button>
            ))}
          </div>

          <div className="mx-auto mt-2 grid max-w-md grid-cols-2 gap-2">
            <button className="num-btn !aspect-auto !py-3" disabled={busy} onClick={() => throwDart('bull', 0)}>
              25 · Bull
            </button>
            <button className="num-btn !aspect-auto !py-3" disabled={busy} onClick={() => throwDart('bullseye', 0)}>
              50 · Bullseye
            </button>
          </div>

          <div className="mx-auto mt-3 flex max-w-md flex-wrap gap-2">
            <button
              className="btn flex-1"
              disabled={busy}
              onClick={() => act(() => api(`/matches/${matchId}/darts/last`, { method: 'DELETE' }))}
            >
              <RotateCcw className="h-4 w-4" /> Undo
            </button>
            <button
              className="btn flex-1"
              disabled={busy || dartsInVisit === 0}
              onClick={() => act(() => api(`/matches/${matchId}/visits/end`, { method: 'POST' }))}
            >
              <UserX className="h-4 w-4" /> Zug beenden
            </button>
          </div>

          {error && <p className="mt-2 text-sm text-[#ffb3ba]">{error}</p>}
        </div>
      )}

      <div className="card p-4">
        <p className="label">Züge</p>
        <div className="space-y-1">
          {recentVisits.map((v) => {
            const p = playerById(v.matchPlayerId);
            return (
              <div key={v.id} className="flex items-center justify-between gap-2 rounded-lg px-1 py-1 text-sm odd:bg-white/[0.03]">
                <span className="flex min-w-0 items-center gap-2">
                  <span>{p?.avatar}</span>
                  <span className="truncate text-[var(--color-muted)]">{p?.name}</span>
                </span>
                <span className="flex items-center gap-1 font-mono text-xs text-[var(--color-muted)]">
                  {v.darts.map((d) => (
                    <span key={d.id} className="rounded bg-white/5 px-1.5 py-0.5">
                      {dartLabel(d.ring, d.number)}
                    </span>
                  ))}
                </span>
                <span
                  className={`w-16 text-right font-bold tabular-nums ${
                    v.checkout ? 'text-[var(--color-accent)]' : v.bust ? 'text-[var(--color-danger)]' : ''
                  }`}
                >
                  {v.bust ? 'Bust' : v.score}
                </span>
              </div>
            );
          })}
          {recentVisits.length === 0 && <p className="text-sm text-[var(--color-muted)]">Noch keine Würfe.</p>}
        </div>
      </div>

      <button
        className="btn w-full !border-transparent !bg-transparent text-xs text-[var(--color-muted)]"
        onClick={() => act(() => api(`/matches/${matchId}/abandon`, { method: 'POST' }))}
      >
        <Target className="h-3 w-3" /> Match abbrechen
      </button>
    </div>
  );
}
