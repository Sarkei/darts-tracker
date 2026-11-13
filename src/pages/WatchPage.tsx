import { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';
import { dartLabel, type MatchState } from '../lib/types';

/** Zuschauer-Ansicht ohne Konto: nur der Spielstand, groß und ruhig. */
export function WatchPage({ code }: { code: string }) {
  const [state, setState] = useState<MatchState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/watch/${encodeURIComponent(code)}`);
        const data = await res.json();
        if (!res.ok) {
          if (alive) setError(data.message ?? 'Match nicht gefunden.');
          return;
        }
        if (alive) {
          setState(data as MatchState);
          setError(null);
        }
      } catch {
        if (alive) setError('Verbindung verloren — versuche weiter …');
      }
    };
    void load();
    const timer = window.setInterval(load, 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [code]);

  if (error && !state) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 text-center">
        <div className="card p-6">
          <p className="text-lg font-bold">{error}</p>
          <p className="mt-1 text-sm text-[var(--muted)]">Code prüfen — er steht in der App unter dem Match.</p>
        </div>
      </div>
    );
  }
  if (!state) return <div className="p-10 text-center text-[var(--muted)]">lade …</div>;

  const active = state.players.find((p) => p.matchPlayerId === state.currentMatchPlayerId);
  const winner = state.players.find((p) => p.matchPlayerId === state.match.winnerPlayerId);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <span className="chip">
          <Radio className="h-3.5 w-3.5" /> live · {code.toUpperCase()}
        </span>
        <span className="text-xs text-[var(--muted)]">
          {state.match.startScore} · Best of {state.match.bestOf} · Leg {state.currentLegIndex}
        </span>
      </div>

      {winner && (
        <div className="card border-[var(--accent)] p-4 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Beendet</p>
          <p className="text-3xl font-black text-[var(--accent)]">{winner.name} gewinnt</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {state.players.map((p) => {
          const isActive = p.matchPlayerId === state.currentMatchPlayerId;
          return (
            <div
              key={p.matchPlayerId}
              className={`card p-5 text-center ${isActive ? 'border-[var(--accent)]' : ''}`}
            >
              <p className="truncate text-sm font-bold uppercase tracking-widest text-[var(--muted)]">
                {p.name} · {p.legsWon}
              </p>
              <p className={`text-[clamp(3rem,12vw,5.5rem)] font-black leading-none tabular-nums ${isActive ? '' : 'opacity-70'}`}>
                {p.remaining}
              </p>
              {isActive && p.checkoutSuggestion?.[0] && (
                <p className="mt-1 text-sm font-bold text-[var(--accent)]">{p.checkoutSuggestion[0].label}</p>
              )}
            </div>
          );
        })}
      </div>

      {state.visits.length > 0 && (
        <div className="card p-4">
          <p className="label">Letzte Würfe</p>
          <div className="space-y-1">
            {[...state.visits].reverse().slice(0, 6).map((v) => {
              const p = state.players.find((x) => x.matchPlayerId === v.matchPlayerId);
              return (
                <div key={v.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-[var(--muted)]">{p?.name}</span>
                  <span className="font-mono text-xs text-[var(--muted)]">
                    {v.darts.map((d) => dartLabel(d.ring, d.number)).join(' ')}
                  </span>
                  <span className={`w-14 text-right font-bold tabular-nums ${v.bust ? 'text-[var(--danger)]' : ''}`}>
                    {v.bust ? 'Bust' : v.score}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
