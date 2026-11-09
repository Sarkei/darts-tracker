import { useEffect, useState } from 'react';
import { ChevronRight, Plus, Trophy } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { MatchSummary, PlayerStats } from '../lib/types';

export function HomePage({ onNavigate }: { onNavigate: (to: string) => void }) {
  const { user } = useAuth();
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [stats, setStats] = useState<PlayerStats | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [m, s] = await Promise.all([
          api<{ matches: MatchSummary[] }>('/matches?status=active'),
          api<{ players: PlayerStats[] }>('/stats'),
        ]);
        setMatches(m.matches);
        setStats(s.players[0] ?? null);
      } catch {
        /* still leer */
      }
    })();
  }, []);

  return (
    <div className="space-y-4">
      <section className="card p-5">
        <p className="text-xs uppercase tracking-[0.2em] text-[--color-muted]">Willkommen zurück</p>
        <h1 className="mt-1 text-2xl font-extrabold">{user?.displayName}</h1>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-white/[0.04] p-3">
            <p className="text-2xl font-extrabold tabular-nums">{stats?.average ?? 0}</p>
            <p className="text-[11px] uppercase tracking-widest text-[--color-muted]">Average</p>
          </div>
          <div className="rounded-xl bg-white/[0.04] p-3">
            <p className="text-2xl font-extrabold tabular-nums">{stats?.checkoutQuote ?? 0}%</p>
            <p className="text-[11px] uppercase tracking-widest text-[--color-muted]">Checkout</p>
          </div>
          <div className="rounded-xl bg-white/[0.04] p-3">
            <p className="text-2xl font-extrabold tabular-nums">{stats?.count180 ?? 0}</p>
            <p className="text-[11px] uppercase tracking-widest text-[--color-muted]">180er</p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button className="btn btn-primary flex-1" onClick={() => onNavigate('/new')}>
            <Plus className="h-4 w-4" /> Neues Match
          </button>
          <button className="btn" onClick={() => onNavigate('/ranking')}>
            <Trophy className="h-4 w-4" /> Rangliste
          </button>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-widest text-[--color-muted]">Laufende Matches</h2>
        <div className="space-y-2">
          {matches.map((m) => (
            <button
              key={m.id}
              onClick={() => onNavigate(`/match/${m.id}`)}
              className="card flex w-full items-center justify-between gap-3 p-4 text-left"
            >
              <div className="min-w-0">
                <p className="truncate font-bold">
                  {m.players.map((p) => p.name).join(' vs ')}
                </p>
                <p className="text-xs text-[--color-muted]">
                  {m.start_score} · Best of {m.best_of} · {m.double_in ? 'Double-In · ' : ''}
                  {m.double_out ? 'Double-Out' : 'Straight-Out'}
                </p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-[--color-muted]" />
            </button>
          ))}
          {matches.length === 0 && (
            <div className="card p-6 text-center text-sm text-[--color-muted]">
              Kein laufendes Match. Starte eins mit „Neues Match".
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
