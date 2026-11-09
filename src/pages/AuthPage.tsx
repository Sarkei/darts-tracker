import { useState } from 'react';
import { Target } from 'lucide-react';
import { useAuth } from '../lib/auth';

export function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register(email.trim(), password, displayName.trim());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      setError(
        message === 'invalid-credentials'
          ? 'E-Mail oder Passwort stimmt nicht.'
          : message === 'email-taken'
            ? 'Diese E-Mail ist schon registriert.'
            : message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[--color-accent] text-xl text-[#04160c]">🎯</span>
          <div>
            <h1 className="text-xl font-extrabold">Darts Tracker</h1>
            <p className="text-xs text-[--color-muted]">Matches, Statistiken, Checkouts</p>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl border border-[--color-line] p-1">
          <button
            className={`rounded-lg py-2 text-sm font-bold ${mode === 'login' ? 'bg-[--color-accent] text-[#04160c]' : 'text-[--color-muted]'}`}
            onClick={() => setMode('login')}
          >
            Anmelden
          </button>
          <button
            className={`rounded-lg py-2 text-sm font-bold ${mode === 'register' ? 'bg-[--color-accent] text-[#04160c]' : 'text-[--color-muted]'}`}
            onClick={() => setMode('register')}
          >
            Registrieren
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === 'register' && (
            <div>
              <label className="label">Spielername</label>
              <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Wie heißt du?" required />
            </div>
          )}
          <div>
            <label className="label">E-Mail</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="du@example.com" required />
          </div>
          <div>
            <label className="label">Passwort</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'mindestens 8 Zeichen' : '••••••••'}
              required
            />
          </div>
          {error && <p className="rounded-lg bg-[rgba(255,93,108,0.12)] px-3 py-2 text-sm text-[#ffb3ba]">{error}</p>}
          <button className="btn btn-primary w-full" disabled={busy}>
            <Target className="h-4 w-4" />
            {busy ? 'einen Moment …' : mode === 'login' ? 'Anmelden' : 'Konto erstellen'}
          </button>
        </form>
      </div>
    </div>
  );
}
