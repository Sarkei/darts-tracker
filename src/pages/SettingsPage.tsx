import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const AVATARS = ['🎯', '🎪', '🔥', '🦅', '🐺', '⚡', '🍀', '🎱', '🏆', '🧊'];

export function SettingsPage() {
  const { user, refresh } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [avatar, setAvatar] = useState(user?.avatar ?? '🎯');
  const [saved, setSaved] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwMessage, setPwMessage] = useState<string | null>(null);
  const [ai, setAi] = useState<{ enabled: boolean; provider: string; model: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setAi(await api('/ai/status'));
      } catch {
        /* egal */
      }
    })();
  }, []);

  const saveProfile = async () => {
    await api('/auth/me', { method: 'PATCH', body: { displayName, avatar } });
    await refresh();
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  const changePassword = async () => {
    setPwMessage(null);
    try {
      await api('/auth/password', { body: { currentPassword, newPassword } });
      setCurrentPassword('');
      setNewPassword('');
      setPwMessage('Passwort geändert.');
    } catch {
      setPwMessage('Aktuelles Passwort stimmt nicht oder das neue ist zu kurz.');
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Einstellungen</h1>

      <section className="card space-y-3 p-4">
        <p className="label">Profil</p>
        <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          {AVATARS.map((a) => (
            <button
              key={a}
              onClick={() => setAvatar(a)}
              className={`grid h-10 w-10 place-items-center rounded-xl border text-lg ${
                avatar === a ? 'border-[--color-accent] bg-[--color-accent-soft]' : 'border-[--color-line]'
              }`}
            >
              {a}
            </button>
          ))}
        </div>
        <button className="btn btn-primary" onClick={saveProfile}>
          {saved ? 'gespeichert ✓' : 'Speichern'}
        </button>
      </section>

      <section className="card space-y-3 p-4">
        <p className="label">Passwort ändern</p>
        <input
          className="input"
          type="password"
          placeholder="aktuelles Passwort"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
        <input
          className="input"
          type="password"
          placeholder="neues Passwort (mind. 8 Zeichen)"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <button className="btn" onClick={changePassword} disabled={!currentPassword || newPassword.length < 8}>
          Passwort ändern
        </button>
        {pwMessage && <p className="text-sm text-[--color-muted]">{pwMessage}</p>}
      </section>

      <section className="card p-4">
        <p className="label">KI</p>
        <p className="text-sm text-[--color-muted]">
          {ai?.enabled
            ? `DeepSeek aktiv (${ai.model}) — Spielanalyse und Trainingspläne laufen über deinen API-Key.`
            : 'Kein API-Key hinterlegt. Analysen sind deaktiviert.'}
        </p>
      </section>

      <section className="card p-4 text-sm text-[--color-muted]">
        <p className="label">Über</p>
        <p>Darts Tracker · manuelles Scoring, Checkout-Vorschläge, Statistik, Rangliste.</p>
        <p className="mt-1">Kamera-Tracking und Live-Dashboard folgen in der nächsten Ausbaustufe.</p>
      </section>
    </div>
  );
}
