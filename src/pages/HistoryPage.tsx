import { useEffect, useState } from 'react';
import { ChevronRight, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import type { MatchSummary } from '../lib/types';
import { Avatar } from '../components/Avatar';

export function HistoryPage({ onOpen }: { onOpen: (id: number) => void }) {
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [filter, setFilter] = useState<'all' | 'finished' | 'active'>('all');

  useEffect(() => {
    void (async () => {
      const data = await api<{ matches: MatchSummary[] }>('/matches?limit=60');
      setMatches(data.matches);
    })();
  }, []);

  const shown = matches.filter((m) => (filter === 'all' ? true : m.status === filter));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">Historie</h1>
        <div className="flex gap-1">
          {(['all', 'active', 'finished'] as const).map((f) => (
            <button
              key={f}
              className={`chip ${filter === f ? 'chip-on' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'Alle' : f === 'active' ? 'Laufend' : 'Beendet'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {shown.map((m) => {
          const winner = m.players.find((p) => p.playerId === m.winner_player_id);
          return (
            <div key={m.id} className="card flex w-full items-center justify-between gap-2 p-3">
              <button onClick={() => onOpen(m.id)} className="min-w-0 flex-1 text-left">
                <p className="flex items-center gap-1 truncate font-bold">
                  {m.players.map((p) => (
                    <span key={p.playerId} className="flex items-center gap-1">
                      <Avatar value={p.avatar} className="h-3.5 w-3.5" />
                      {p.name}
                      {p !== m.players[m.players.length - 1] && <span className="px-0.5">vs</span>}
                    </span>
                  ))}
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                  {new Date(m.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: '2-digit' })} ·{' '}
                  {m.start_score} · Bo{m.best_of} · {m.legs_played} Legs
                  {m.status === 'active' && ' · läuft'}
                  {winner && ` · Sieger: ${winner.name}`}
                </p>
              </button>
              <button
                className="btn btn-danger !px-2 !py-1"
                title="Match löschen"
                onClick={async () => {
                  if (!window.confirm('Dieses Match endgültig löschen? Würfe und Statistik dazu verschwinden.')) return;
                  await api(`/matches/${m.id}`, { method: 'DELETE' });
                  setMatches((prev) => prev.filter((x) => x.id !== m.id));
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <ChevronRight className="h-5 w-5 shrink-0 text-[var(--color-muted)] cursor-pointer" onClick={() => onOpen(m.id)} />
            </div>
          );
        })}
        {shown.length === 0 && (
          <div className="card p-6 text-center text-sm text-[var(--color-muted)]">Noch keine Matches gespeichert.</div>
        )}
      </div>
    </div>
  );
}
