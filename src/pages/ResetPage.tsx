import { useState } from 'react';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { api } from '../lib/api';

export function ResetPage({ onNavigate }: { onNavigate: (to: string) => void }) {
  const token = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('token') ?? '';
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setMessage(null);
    if (password.length < 8) {
      setError('Mindestens 8 Zeichen.');
      return;
    }
    if (password !== repeat) {
      setError('Die Passwörter stimmen nicht überein.');
      return;
    }
    setBusy(true);
    try {
      await api('/auth/reset-password', { body: { token, password } });
      setMessage('Passwort geändert — bitte neu anmelden.');
      window.setTimeout(() => onNavigate('/'), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Der Link ist abgelaufen oder schon benutzt.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm space-y-3 p-6">
        <div className="flex items-center gap-2">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--accent)] text-[var(--on-accent)]">
            <KeyRound className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-lg font-extrabold">Neues Passwort</h1>
            <p className="text-xs text-[var(--muted)]">Der Link ist eine Stunde gültig und nur einmal nutzbar.</p>
          </div>
        </div>

        {!token && <p className="text-sm text-[var(--danger)]">Kein gültiger Link — bitte neu anfordern.</p>}

        <input
          className="input"
          type="password"
          placeholder="neues Passwort (mind. 8 Zeichen)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <input
          className="input"
          type="password"
          placeholder="Passwort wiederholen"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        {message && <p className="text-sm text-[var(--accent)]">{message}</p>}
        <button className="btn btn-primary w-full" disabled={busy || !token} onClick={submit}>
          {busy ? 'speichere …' : 'Passwort speichern'}
        </button>
        <button className="btn w-full !bg-transparent !border-transparent text-xs text-[var(--muted)]" onClick={() => onNavigate('/')}>
          <ArrowLeft className="h-3.5 w-3.5" /> zurück zur Anmeldung
        </button>
      </div>
    </div>
  );
}
