import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RotateCcw, UserX } from 'lucide-react';
import { api } from '../lib/api';
import { dartLabel, type MatchState, type Ring } from '../lib/types';
import { useMatchEvents } from '../lib/useMatchEvents';

/** Kompaktes Eingabegerät: nur wer dran ist, Restscore und das Zahlenfeld. */
export function RemotePage({ matchId, onNavigate }: { matchId: number; onNavigate: (to: string) => void }) {
  const [state, setState] = useState<MatchState | null>(null);
  const [ring, setRing] = useState<Ring>('single');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await api<MatchState>(`/matches/${matchId}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Match nicht ladbar');
    }
  }, [matchId]);

  useEffect(() => {
    void load();
  }, [load]);

  useMatchEvents(matchId, load);

  const active = useMemo(
    () => state?.players.find((p) => p.matchPlayerId === state.currentMatchPlayerId) ?? null,
    [state],
  );

  const throwDart = async (r: Ring, number: number) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/matches/${matchId}/darts`, { body: { ring: r, number, source: 'remote' } });
      await load();
      if (navigator.vibrate) navigator.vibrate(12);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Wurf fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  if (!state || !active) {
    return <div className="p-8 text-center text-[var(--muted)]">{error ?? 'lade …'}</div>;
  }

  const lastVisit = state.visits[state.visits.length - 1];
  const dartsInVisit = lastVisit && lastVisit.matchPlayerId === active.matchPlayerId ? lastVisit.darts.length : 0;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <button className="btn !px-3 !py-2 text-xs" onClick={() => onNavigate(`/match/${matchId}`)}>
          <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
        </button>
        <span className="chip">Fernbedienung</span>
      </div>

      <div className="card p-4 text-center">
        <p className="text-xs uppercase tracking-widest text-[var(--muted)]">{active.name}</p>
        <p className="text-6xl font-black leading-none tabular-nums">{active.remaining}</p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {dartsInVisit}/3 Darts{active.checkoutSuggestion?.[0] ? ` · ${active.checkoutSuggestion[0].label}` : ''}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          { key: 'single' as Ring, label: 'Single' },
          { key: 'double' as Ring, label: 'Doppel' },
          { key: 'triple' as Ring, label: 'Triple' },
        ].map((r) => (
          <button key={r.key} className={`ring-btn ${ring === r.key ? 'active' : ''}`} onClick={() => setRing(r.key)}>
            {r.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-5 gap-2">
        {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
          <button key={n} className="num-btn" disabled={busy} onClick={() => throwDart(ring, n)}>
            {ring === 'triple' ? `T${n}` : ring === 'double' ? `D${n}` : n}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button className="num-btn !aspect-auto !py-3" disabled={busy} onClick={() => throwDart('bull', 0)}>
          25
        </button>
        <button className="num-btn !aspect-auto !py-3" disabled={busy} onClick={() => throwDart('bullseye', 0)}>
          Bull
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button className="btn" disabled={busy} onClick={async () => { await api(`/matches/${matchId}/darts/last`, { method: 'DELETE' }); await load(); }}>
          <RotateCcw className="h-4 w-4" /> Undo
        </button>
        <button
          className="btn"
          disabled={busy || dartsInVisit === 0}
          onClick={async () => { await api(`/matches/${matchId}/visits/end`, { method: 'POST' }); await load(); }}
        >
          <UserX className="h-4 w-4" /> Zug fertig
        </button>
      </div>

      {lastVisit && (
        <p className="text-center text-xs text-[var(--muted)]">
          Letzter Zug: {lastVisit.darts.map((d) => dartLabel(d.ring, d.number)).join(' ')} = {lastVisit.bust ? 'Bust' : lastVisit.score}
        </p>
      )}
      {error && <p className="text-center text-sm text-[var(--danger)]">{error}</p>}
    </div>
  );
}
