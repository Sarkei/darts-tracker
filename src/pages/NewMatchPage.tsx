import { useEffect, useState } from 'react';
import { Check, Plus, Play, UserPlus } from 'lucide-react';
import { api } from '../lib/api';
import type { MatchState, Player } from '../lib/types';
import { Avatar } from '../components/Avatar';

export function NewMatchPage({ onCreated }: { onCreated: (id: number) => void }) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [name, setName] = useState('');
  const [startScore, setStartScore] = useState(501);
  const [customScore, setCustomScore] = useState('');
  const [doubleIn, setDoubleIn] = useState(false);
  const [doubleOut, setDoubleOut] = useState(true);
  const [bestOf, setBestOf] = useState(3);
  const [mode, setMode] = useState<'manual' | 'auto'>('manual');
  const [format, setFormat] = useState<'legs' | 'sets'>('legs');
  const [bestOfSets, setBestOfSets] = useState(3);
  const [throwOrder, setThrowOrder] = useState<'winner' | 'alternate'>('winner');
  const [guest, setGuest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const data = await api<{ players: Player[] }>('/players');
    setPlayers(data.players);
    return data.players;
  };

  useEffect(() => {
    void load();
  }, []);

  const toggle = (id: number) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const addGuest = async () => {
    if (!guest.trim()) return;
    const created = await api<{ player: Player }>('/players', { body: { name: guest.trim() } });
    await load();
    setSelected((prev) => [...prev, created.player.id]);
    setGuest('');
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api<MatchState>('/matches', {
        body: { name, playerIds: selected, startScore, doubleIn, doubleOut, bestOf, mode, format, bestOfSets, throwOrder },
      });
      onCreated(data.match.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Match konnte nicht erstellt werden');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Neues Match</h1>

      <section className="card space-y-2 p-4">
        <p className="label">Vorlage</p>
        <div className="flex flex-wrap gap-2">
          {[
            { label: '501 Double-Out', s: 501, di: false, dout: true, legs: 3, fmt: 'legs' as const },
            { label: '301 Double-In/Out', s: 301, di: true, dout: true, legs: 3, fmt: 'legs' as const },
            { label: '701 Double-Out', s: 701, di: false, dout: true, legs: 5, fmt: 'legs' as const },
            { label: 'Sätze: First to 3 Legs', s: 501, di: false, dout: true, legs: 3, fmt: 'sets' as const },
            { label: 'Kurz: First to 1 Leg', s: 301, di: false, dout: true, legs: 1, fmt: 'legs' as const },
          ].map((tpl) => (
            <button
              key={tpl.label}
              className="btn !px-3 !py-2 text-xs"
              onClick={() => {
                setStartScore(tpl.s);
                setDoubleIn(tpl.di);
                setDoubleOut(tpl.dout);
                setBestOf(tpl.legs);
                setFormat(tpl.fmt);
                setCustomScore('');
              }}
            >
              {tpl.label}
            </button>
          ))}
        </div>
      </section>

      <section className="card space-y-3 p-4">
        <div>
          <label className="label">Name (optional)</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Freitagsrunde" />
        </div>

        <div>
          <label className="label">Spieler ({selected.length} gewählt)</label>
          <div className="grid gap-2 sm:grid-cols-2">
            {players.map((p) => {
              const on = selected.includes(p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  className={`flex items-center justify-between gap-2 rounded-xl border p-3 text-left ${
                    on ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]' : 'border-[var(--color-line)] bg-[var(--surface-2)]'
                  }`}
                >
                  <span className="truncate">
                    <span className="mr-2"><Avatar value={p.avatar} /></span>
                    {p.name}
                  </span>
                  {on && <Check className="h-4 w-4 text-[var(--color-accent)]" />}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              className="input"
              value={guest}
              onChange={(e) => setGuest(e.target.value)}
              placeholder="Gast hinzufügen …"
              onKeyDown={(e) => e.key === 'Enter' && addGuest()}
            />
            <button className="btn" onClick={addGuest}>
              <UserPlus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div>
          <label className="label">Startpunkte</label>
          <div className="flex flex-wrap gap-2">
            {[301, 401, 501].map((s) => (
              <button
                key={s}
                className={`btn ${startScore === s ? 'btn-primary' : ''}`}
                onClick={() => {
                  setStartScore(s);
                  setCustomScore('');
                }}
              >
                {s}
              </button>
            ))}
            <input
              className="input !w-28"
              placeholder="Custom"
              inputMode="numeric"
              value={customScore}
              onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, '');
                setCustomScore(raw);
                if (raw) setStartScore(Number(raw));
              }}
            />
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            className={`btn ${doubleIn ? 'btn-primary' : ''}`}
            onClick={() => setDoubleIn((v) => !v)}
          >
            Double-In {doubleIn ? 'an' : 'aus'}
          </button>
          <button
            className={`btn ${doubleOut ? 'btn-primary' : ''}`}
            onClick={() => setDoubleOut((v) => !v)}
          >
            Double-Out {doubleOut ? 'an' : 'aus'}
          </button>
        </div>

        <div>
          <label className="label">Spielformat</label>
          <div className="grid grid-cols-2 gap-2">
            <button className={`btn ${format === 'legs' ? 'btn-primary' : ''}`} onClick={() => setFormat('legs')}>
              Nur Legs
            </button>
            <button className={`btn ${format === 'sets' ? 'btn-primary' : ''}`} onClick={() => setFormat('sets')}>
              Sätze
            </button>
          </div>
        </div>

        <div>
          <label className="label">{format === 'sets' ? 'Legs pro Satz (First to)' : 'Legs (First to)'}</label>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5, 7].map((b) => (
              <button key={b} className={`btn ${bestOf === b ? 'btn-primary' : ''}`} onClick={() => setBestOf(b)}>
                {b}
              </button>
            ))}
          </div>
        </div>

        {format === 'sets' && (
          <div>
            <label className="label">Sätze (Best of)</label>
            <div className="flex flex-wrap gap-2">
              {[1, 3, 5, 7].map((b) => (
                <button key={b} className={`btn ${bestOfSets === b ? 'btn-primary' : ''}`} onClick={() => setBestOfSets(b)}>
                  {b}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="label">Anwurf</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              className={`btn ${throwOrder === 'winner' ? 'btn-primary' : ''}`}
              onClick={() => setThrowOrder('winner')}
            >
              Sieger wirft an
            </button>
            <button
              className={`btn ${throwOrder === 'alternate' ? 'btn-primary' : ''}`}
              onClick={() => setThrowOrder('alternate')}
            >
              Abwechselnd
            </button>
          </div>
        </div>

        <div>
          <label className="label">Tracking</label>
          <div className="grid grid-cols-2 gap-2">
            <button className={`btn ${mode === 'manual' ? 'btn-primary' : ''}`} onClick={() => setMode('manual')}>
              Manuell
            </button>
            <button className={`btn ${mode === 'auto' ? 'btn-primary' : ''}`} onClick={() => setMode('auto')}>
              Automatisch
            </button>
          </div>
          {mode === 'auto' && (
            <p className="mt-2 rounded-lg bg-[var(--surface-2)] p-3 text-xs text-[var(--color-muted)]">
              Kamera-Tracking ist vorbereitet: Nach dem Start wählst du pro Gerät die Rolle „Kamera" oder „Dashboard".
              Bis die Erkennung aktiv ist, kannst du jederzeit manuell eintragen — beides landet im selben Spiel.
            </p>
          )}
        </div>

        {error && <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>}

        <button className="btn btn-primary w-full" disabled={busy || selected.length < 2} onClick={start}>
          {busy ? 'starte …' : <><Play className="h-4 w-4" /> Match starten</>}
        </button>
        {selected.length < 2 && <p className="text-center text-xs text-[var(--color-muted)]">Mindestens zwei Spieler wählen.</p>}
      </section>

      <button
        className="btn w-full"
        onClick={async () => {
          const created = await api<{ player: Player }>('/players', { body: { name: `Gast ${players.length + 1}` } });
          await load();
          setSelected((prev) => [...prev, created.player.id]);
        }}
      >
        <Plus className="h-4 w-4" /> Schnell einen Gast anlegen
      </button>
    </div>
  );
}
