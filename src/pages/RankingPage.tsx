import { useEffect, useState } from 'react';
import { Crown, TrendingUp } from 'lucide-react';
import { api } from '../lib/api';
import type { RankingEntry } from '../lib/types';

export function RankingPage() {
  const [ranking, setRanking] = useState<RankingEntry[]>([]);

  useEffect(() => {
    void (async () => {
      const data = await api<{ ranking: RankingEntry[] }>('/stats/ranking');
      setRanking(data.ranking);
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Rangliste</h1>
        <p className="text-sm text-[--color-muted]">Elo-Rating (Start 1000, K = 32) aus allen beendeten Matches.</p>
      </div>

      <div className="space-y-2">
        {ranking.map((entry, index) => (
          <div key={entry.playerId} className="card flex items-center gap-3 p-4">
            <span
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-extrabold ${
                index === 0 ? 'bg-[--color-accent] text-[#04160c]' : 'bg-white/5 text-[--color-muted]'
              }`}
            >
              {index === 0 ? <Crown className="h-4 w-4" /> : index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">
                {entry.avatar} {entry.name}
              </p>
              <p className="text-xs text-[--color-muted]">
                {entry.wins}S / {entry.losses}N · Ø {entry.average} · Doppel {entry.doubleQuote}%
              </p>
            </div>
            <span className="flex items-center gap-1 font-extrabold tabular-nums text-[--color-accent]">
              <TrendingUp className="h-4 w-4" />
              {entry.elo}
            </span>
          </div>
        ))}
        {ranking.length === 0 && (
          <div className="card p-6 text-center text-sm text-[--color-muted]">
            Noch keine abgeschlossenen Matches — die Rangliste füllt sich nach dem ersten Sieg.
          </div>
        )}
      </div>
    </div>
  );
}
