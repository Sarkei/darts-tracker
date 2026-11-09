import { useEffect, useState } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import { api } from '../lib/api';
import type { Player } from '../lib/types';
import { Avatar } from '../components/Avatar';

export function PlayersPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const data = await api<{ players: Player[] }>('/players');
    setPlayers(data.players);
  };

  useEffect(() => {
    void load();
  }, []);

  const add = async () => {
    if (!name.trim()) return;
    setError(null);
    try {
      await api('/players', { body: { name: name.trim() } });
      setName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  };

  const remove = async (id: number) => {
    setError(null);
    try {
      await api(`/players/${id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Fehler';
      setError(msg === 'player-in-use' ? 'Dieser Spieler hat schon Matches — Profile bleiben erhalten.' : msg);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold">Spieler</h1>
        <p className="text-sm text-[var(--color-muted)]">Profile für Rangliste und Statistik. Gäste brauchen kein Konto.</p>
      </div>

      <div className="card space-y-3 p-4">
        <div className="flex gap-2">
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name des Spielers"
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button className="btn btn-primary" onClick={add}>
            <UserPlus className="h-4 w-4" />
          </button>
        </div>
        {error && <p className="text-sm text-[#ffb3ba]">{error}</p>}
      </div>

      <div className="space-y-2">
        {players.map((p) => (
          <div key={p.id} className="card flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="truncate font-bold">
                <Avatar value={p.avatar} /> {p.name}
              </p>
              <p className="text-xs text-[var(--color-muted)]">
                {p.is_guest ? 'Gast' : 'Konto'} · {p.matches ?? 0} Matches
              </p>
            </div>
            <button className="btn btn-danger !px-3 !py-2" onClick={() => remove(p.id)}>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
