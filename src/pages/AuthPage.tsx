import { useEffect, useState } from 'react';
import { KeyRound, MailCheck, Target } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { isDemoMode } from '../lib/demo';

export function AuthPage() {
  const { login, register } = useAuth();
  const isDemo = isDemoMode();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [inviteRequired, setInviteRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [forgotPath, setForgotPath] = useState<string | null>(null);

  useEffect(() => {
    void api<{ inviteRequired: boolean }>('/auth/config')
      .then((c) => setInviteRequired(c.inviteRequired))
      .catch(() => undefined);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register(email.trim(), password, displayName.trim(), inviteCode.trim());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      setError(
        message === 'invalid-credentials'
        ? 'E-Mail oder Passwort stimmt nicht.'
        : message === 'email-taken'
        ? 'Diese E-Mail ist schon registriert.'
        : message === 'invite-required'
          ? 'Einladungscode fehlt oder ist falsch.'
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
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--color-accent)] text-[var(--on-accent)]">
            <Target className="h-6 w-6" strokeWidth={2.4} />
          </span>
          <div>
            <h1 className="text-xl font-extrabold">Darts Tracker</h1>
            <p className="text-xs text-[var(--color-muted)]">Matches, Statistiken, Checkouts</p>
          </div>
        </div>

        <div className={`mb-4 grid gap-1 rounded-xl border border-[var(--color-line)] p-1 ${isDemo ? 'grid-cols-1' : 'grid-cols-2'}`}>
          <button
            className={`rounded-lg py-2 text-sm font-bold ${mode === 'login' ? 'bg-[var(--color-accent)] text-[var(--on-accent)]' : 'text-[var(--color-muted)]'}`}
            onClick={() => setMode('login')}
          >
            Anmelden
          </button>
          {!isDemo && (
            <button
              className={`rounded-lg py-2 text-sm font-bold ${mode === 'register' ? 'bg-[var(--color-accent)] text-[var(--on-accent)]' : 'text-[var(--color-muted)]'}`}
              onClick={() => setMode('register')}
            >
              Registrieren
            </button>
          )}
        </div>

        <form onSubmit={submit} className="space-y-3">
          {!isDemo && mode === 'register' && (
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
          {mode === 'register' && inviteRequired && (
            <div>
              <label className="label">Einladungscode</label>
              <input
                className="input"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="Code vom Besitzer der App"
                required
              />
            </div>
          )}
          {error && <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>}
          <button className="btn btn-primary w-full" disabled={busy}>
            <Target className="h-4 w-4" />
            {busy ? 'einen Moment …' : mode === 'login' ? 'Anmelden' : 'Konto erstellen'}
          </button>
        </form>

        {mode === 'login' && !isDemo && (
          <div className="mt-4 text-center">
            <button
              className="text-xs font-semibold text-[var(--muted)] underline-offset-2 hover:underline"
              onClick={() => {
                setForgot((v) => !v);
                setForgotPath(null);
                setError(null);
              }}
            >
              <KeyRound className="mr-1 inline h-3 w-3" />
              Passwort vergessen?
            </button>
          </div>
        )}

        {forgot && (
          <div className="mt-3 space-y-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <p className="text-xs text-[var(--muted)]">
              Wir schicken dir einen Link zum Zurücksetzen. Ohne Mailserver zeigt die App ihn direkt an.
            </p>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="deine E-Mail"
            />
            <button
              className="btn w-full !py-2 text-sm"
              disabled={!email.includes('@')}
              onClick={async () => {
                try {
                  const res = await api<{ ok: boolean; resetPath: string | null }>('/auth/forgot-password', {
                    body: { email: email.trim() },
                  });
                  setForgotPath(res.resetPath ?? 'gesendet');
                } catch {
                  setForgotPath('gesendet');
                }
              }}
            >
              <MailCheck className="h-4 w-4" /> Link anfordern
            </button>
            {forgotPath === 'gesendet' && (
              <p className="text-xs text-[var(--muted)]">Falls es das Konto gibt, ist der Link unterwegs bzw. per Mail versendet.</p>
            )}
            {forgotPath && forgotPath !== 'gesendet' && (
              <a className="block break-all text-xs text-[var(--accent)] underline" href={forgotPath}>
                {window.location.origin}
                {forgotPath} — jetzt Passwort setzen
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
