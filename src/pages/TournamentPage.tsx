import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Crown, Trash2, Trophy } from 'lucide-react';
import { api } from '../lib/api';
import { Avatar } from '../components/Avatar';
import type { Player } from '../lib/types';

interface Slot {
  round: number;
  slot: number;
  playerId: number | null;
  matchId: number | null;
  winnerPlayerId: number | null;
  name: string | null;
  nameA: string | null;
  nameB: string | null;
  avatar: string | null;
}

interface Tournament {
  id: number;
  name: string;
  status: string;
  winnerPlayerId: number | null;
  createdAt: string;
  slots: Slot[];
}

export function TournamentPage({ onOpenMatch }: { onOpenMatch: (id: number) => void }) {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);

  const load = async () => {
    const [t, p] = await Promise.all([
      api<{ tournaments: Tournament[] }>('/tournaments'),
      api<{ players: Player[] }>('/players'),
    ]);
    setTournaments(t.tournaments);
    setPlayers(p.players);
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    await api('/tournaments', { body: { name, playerIds: selected } });
    setSelected([]);
    setName('');
    setOpen(false);
    await load();
  };

  const rounds = useMemo(() => {
    const map = new Map<number, Slot[]>();
    for (const t of tournaments) {
      for (const s of t.slots) {
        const list = map.get(s.round) ?? [];
        list.push(s);
        map.set(s.round, list);
      }
      break; // nur das erste Turnier für die Rundenzahl
    }
    return [...map.keys()].sort((a, b) => a - b).length;
  }, [tournaments]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold">Turnier</h1>
          <p className="text-sm text-[var(--muted)]">K.-o.-System, 2 bis 8 Spieler. Sieger rücken automatisch weiter.</p>
        </div>
        <button className="btn btn-primary !py-2 text-sm" onClick={() => setOpen((v) => !v)}>
          <Trophy className="h-4 w-4" /> Neues Turnier
        </button>
      </div>

      {open && (
        <div className="card space-y-3 p-4">
          <input className="input" placeholder="Name (z. B. Kellerpokal)" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="grid gap-2 sm:grid-cols-2">
            {players.map((p) => {
              const on = selected.includes(p.id);
              return (
                <button
                  key={p.id}
                  className={`flex items-center justify-between rounded-xl border p-2 text-left text-sm ${
                    on ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)]'
                  }`}
                  onClick={() => setSelected((prev) => (on ? prev.filter((x) => x !== p.id) : [...prev, p.id]))}
                >
                  <span className="flex items-center gap-2">
                    <Avatar value={p.avatar} className="h-4 w-4" /> {p.name}
                  </span>
                  {on && <span className="text-[var(--accent)]">✓</span>}
                </button>
              );
            })}
          </div>
          <button className="btn btn-primary w-full" disabled={selected.length < 2} onClick={create}>
            Turnier starten ({selected.length} Spieler)
          </button>
        </div>
      )}

      {tournaments.map((t) => {
        const maxRound = Math.max(...t.slots.map((s) => s.round));
        const winner = t.slots.find((s) => s.playerId && s.playerId === t.winnerPlayerId && s.round === maxRound);
        return (
          <div key={t.id} className="card space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-bold">{t.name || 'Turnier'}</p>
                <p className="text-xs text-[var(--muted)]">
                  {new Date(t.createdAt).toLocaleDateString('de-DE')} · {t.status === 'finished' ? 'beendet' : 'läuft'}
                </p>
              </div>
              <button
                className="btn btn-danger !px-2 !py-1 text-xs"
                onClick={async () => {
                  if (window.confirm('Turnier löschen? Die Matches bleiben in der Historie.')) {
                    await api(`/tournaments/${t.id}`, { method: 'DELETE' });
                    await load();
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {winner && (
              <p className="flex items-center gap-2 text-sm font-bold text-[var(--accent)]">
                <Crown className="h-4 w-4" /> Sieger: {winner.name}
              </p>
            )}

            <div className="flex gap-3 overflow-x-auto scroll-x pb-1">
              {Array.from({ length: maxRound }, (_, i) => i + 1).map((round) => (
                <div key={round} className="min-w-[10rem] flex-1 space-y-2">
                  <p className="text-[10px] uppercase tracking-widest text-[var(--muted)]">Runde {round}</p>
                  {t.slots
                    .filter((s) => s.round === round)
                    .map((slot) => {
                      const label =
                        slot.nameA && slot.nameB
                          ? `${slot.nameA} vs ${slot.nameB}`
                          : slot.winnerPlayerId
                            ? slot.name ?? 'Sieger'
                            : slot.matchId
                              ? 'offen'
                              : '—';
                      const won = slot.winnerPlayerId && slot.winnerPlayerId === slot.playerId;
                      return (
                        <div
                          key={`${slot.round}-${slot.slot}`}
                          className={`rounded-lg border p-2 text-xs ${
                            won ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--line)] bg-[var(--surface-2)]'
                          }`}
                        >
                          <span className="flex items-center justify-between gap-1">
                            <span className="truncate">{label}</span>
                            {slot.matchId && (
                              <button
                                className="shrink-0 text-[var(--accent)]"
                                onClick={() => onOpenMatch(slot.matchId!)}
                                title="Match öffnen"
                              >
                                <ChevronRight className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </span>
                        </div>
                      );
                    })}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {tournaments.length === 0 && !open && (
        <div className="card p-6 text-center text-sm text-[var(--muted)]">
          Noch kein Turnier. „Neues Turnier" wählt Spieler und legt die Paarungen an.
        </div>
      )}
      {rounds > 0 && null}
    </div>
  );
}
