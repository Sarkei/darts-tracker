import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
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
            <button
              key={m.id}
              onClick={() => onOpen(m.id)}
              className="card flex w-full items-center justify-between gap-3 p-4 text-left"
            >
              <div className="min-w-0">
                <p className="truncate font-bold">
                  {m.players.map((p) => `$<Avatar value={p.avatar} /> ${p.name}`).join(' vs ')}
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                  {new Date(m.created_at).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: '2-digit' })} ·{' '}
                  {m.start_score} · Bo{m.best_of} · {m.legs_played} Legs
                  {m.status === 'active' && ' · läuft'}
                  {winner && ` · Sieger: ${winner.name}`}
                </p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-[var(--color-muted)]" />
            </button>
          );
        })}
        {shown.length === 0 && (
          <div className="card p-6 text-center text-sm text-[var(--color-muted)]">Noch keine Matches gespeichert.</div>
        )}
      </div>
    </div>
  );
}
