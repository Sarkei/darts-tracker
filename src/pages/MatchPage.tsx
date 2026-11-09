import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bot, Camera, Check, Copy, MonitorSmartphone, RotateCcw, Sparkles, Target, UserX, Volume2, VolumeX, X } from 'lucide-react';
import { api } from '../lib/api';
import { dartLabel, type MatchState, type Ring } from '../lib/types';
import { useMatchEvents } from '../lib/useMatchEvents';
import { useWakeLock } from '../lib/useWakeLock';
import { Avatar } from '../components/Avatar';

interface Props {
  matchId: number;
  onNavigate: (to: string) => void;
}

const RINGS: Array<{ key: Ring; label: string }> = [
  { key: 'single', label: 'Single' },
  { key: 'double', label: 'Doppel' },
  { key: 'triple', label: 'Triple' },
];

interface AiSummary {
  headline: string;
  summary: string;
  highlights: string[];
  tips: string[];
}

interface DeviceRow {
  deviceId: string;
  role: 'camera' | 'dashboard' | 'viewer';
  name: string;
  status: { quality?: 'good' | 'ok' | 'bad'; message?: string; calibrated?: boolean };
  lastSeen: string;
}

interface Candidate {
  id: number;
  ring: Ring;
  number: number;
  confidence: number;
  createdAt: string;
}

function myDeviceId() {
  let id = localStorage.getItem('darts.deviceId');
  if (!id) {
    id = 'dev-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    localStorage.setItem('darts.deviceId', id);
  }
  return id;
}

export function MatchPage({ matchId, onNavigate }: Props) {
  const [state, setState] = useState<MatchState | null>(null);
  const [ring, setRing] = useState<Ring>('single');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AiSummary | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [sound, setSound] = useState(() => localStorage.getItem('darts.sound') !== '0');
  const [copied, setCopied] = useState(false);
  const [hasRole, setHasRole] = useState(true);
  const me = useMemo(() => myDeviceId(), []);
  const spokenVisit = useRef<number | null>(null);
  useWakeLock(!state?.finished);

  const load = useCallback(async () => {
    try {
      const data = await api<MatchState>(`/matches/${matchId}`);
      setState(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Match konnte nicht geladen werden');
    }
  }, [matchId]);

  const loadSide = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([
        api<{ devices: DeviceRow[] }>(`/matches/${matchId}/devices`),
        api<{ candidates: Candidate[] }>(`/matches/${matchId}/candidates`),
      ]);
      setDevices(d.devices);
      setCandidates(c.candidates);
      // Rolle nicht mehr stillschweigend setzen — das Gerät fragt beim ersten Mal.
      setHasRole(Boolean(d.devices.find((x) => x.deviceId === me)));
    } catch {
      /* Geräte sind optional */
    }
  }, [matchId, me]);

  useEffect(() => {
    void load();
    void loadSide();
  }, [load, loadSide]);

  useMatchEvents(matchId, useCallback(() => {
    void load();
    void loadSide();
  }, [load, loadSide]));

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Aktion fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  const throwDart = (r: Ring, number: number) =>
    act(() => api(`/matches/${matchId}/darts`, { body: { ring: r, number } }));

  const active = useMemo(
    () => state?.players.find((p) => p.matchPlayerId === state.currentMatchPlayerId) ?? null,
    [state],
  );

  const recentVisits = useMemo(() => {
    if (!state) return [];
    return [...state.visits].reverse().slice(0, 12);
  }, [state]);

  const lastCompletedVisit = useMemo(() => {
    if (!state) return null;
    const done = state.visits.filter((v) => v.bust || v.checkout || v.darts.length === 3);
    return done.length ? done[done.length - 1] : null;
  }, [state]);

  const cameraDevice = devices.find((d) => d.role === 'camera') ?? null;

  // Ansage: 180er und Checkouts einmal pro Zug
  useEffect(() => {
    if (!sound || !state?.lastVisit) return;
    const visit = state.lastVisit;
    if (spokenVisit.current === visit.id) return;
    if (visit.darts.length < 3 && !visit.checkout) return;
    spokenVisit.current = visit.id;
    const text = visit.checkout
      ? 'Checkout'
      : visit.score === 180
        ? 'Einhundertachtzig'
        : visit.bust
          ? 'Bust'
          : null;
    if (text && 'speechSynthesis' in window) {
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'de-DE';
      utter.rate = 1.05;
      window.speechSynthesis.speak(utter);
    }
    if (navigator.vibrate && (visit.checkout || visit.score === 180)) navigator.vibrate(60);
  }, [state?.lastVisit, sound]);

  // Tastatur am PC: 1–9 Zahl, S/D/T Ring, Backspace Undo, Leertaste Zug beenden
  useEffect(() => {
    if (state?.finished) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toLowerCase();
      if (key === 's') setRing('single');
      else if (key === 'd') setRing('double');
      else if (key === 't') setRing('triple');
      else if (key === 'backspace') {
        e.preventDefault();
        void act(() => api(`/matches/${matchId}/darts/last`, { method: 'DELETE' }));
      } else if (key === ' ' || key === 'escape') {
        e.preventDefault();
        void act(() => api(`/matches/${matchId}/visits/end`, { method: 'POST' }));
      } else if (/^[1-9]$/.test(key)) {
        void throwDart(ring, Number(key));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [ring, state?.finished, matchId]);

  if (!state) {
    return <div className="py-16 text-center text-[var(--color-muted)]">lade Match …</div>;
  }

  const playerById = (matchPlayerId: number) => state.players.find((p) => p.matchPlayerId === matchPlayerId);
  const route = active?.checkoutSuggestion?.[0] ?? null;
  const alternatives = active?.checkoutSuggestion?.slice(1) ?? [];
  const dartsInVisit =
    state.lastVisit && state.lastVisit.matchPlayerId === active?.matchPlayerId ? state.lastVisit.darts.length : 0;

  const requestSummary = async () => {
    setSummaryBusy(true);
    setError(null);
    try {
      const data = await api<AiSummary>('/ai/match-summary', { body: { matchId } });
      setSummary(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'KI-Zusammenfassung fehlgeschlagen');
    } finally {
      setSummaryBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button className="btn !px-3 !py-2" onClick={() => onNavigate('/history')}>
          <ArrowLeft className="h-4 w-4" /> Historie
        </button>
        <div className="flex gap-1 overflow-x-auto scroll-x">
          {state.players.map((p) => (
            <span
              key={p.matchPlayerId}
              className={`chip ${p.matchPlayerId === state.currentMatchPlayerId ? 'chip-on' : ''}`}
            >
              <Avatar value={p.avatar} /> {p.name} · {p.legsWon}
            </span>
          ))}
        </div>
      </div>

      {!hasRole && (
        <div className="card border-[#3ee383] p-4">
          <p className="label">Wie soll dieses Gerät mitmachen?</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <button
              className="btn"
              onClick={() => onNavigate(`/match/${matchId}/camera`)}
            >
              <Camera className="h-4 w-4" /> Kamera (filmt das Board)
            </button>
            <button
              className="btn btn-primary"
              onClick={async () => {
                await api(`/matches/${matchId}/devices`, { body: { deviceId: me, role: 'dashboard', name: 'Dashboard' } });
                setHasRole(true);
                await loadSide();
              }}
            >
              <MonitorSmartphone className="h-4 w-4" /> Dashboard (Anzeige + Eingabe)
            </button>
            <button
              className="btn"
              onClick={async () => {
                await api(`/matches/${matchId}/devices`, { body: { deviceId: me, role: 'viewer', name: 'Zuschauer' } });
                setHasRole(true);
                await loadSide();
              }}
            >
              Nur zusehen
            </button>
          </div>
        </div>
      )}

      <div className="card flex flex-wrap items-center justify-between gap-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip">
            <MonitorSmartphone className="h-3.5 w-3.5" />
            {devices.find((d) => d.deviceId === me)?.role === 'camera' ? 'Dieses Gerät: Kamera' : 'Dieses Gerät: Dashboard'}
          </span>
          {cameraDevice ? (
            <span
              className={`chip ${
                cameraDevice.status?.quality === 'good'
                  ? 'chip-on'
                  : cameraDevice.status?.quality === 'bad'
                    ? '!border-[#ff7a86] !text-[#ff9aa3]'
                    : ''
              }`}
              title={cameraDevice.status?.message ?? ''}
            >
              <Camera className="h-3.5 w-3.5" />
              Kamera {cameraDevice.status?.quality === 'good' ? 'gut' : cameraDevice.status?.quality === 'ok' ? 'okay' : 'unklar'}
            </span>
          ) : (
            <span className="chip">Keine Kamera verbunden</span>
          )}
          {cameraDevice?.status?.message && (
            <span className="text-xs text-[#a9b9d4]">{cameraDevice.status.message}</span>
          )}
        </div>
        <div className="flex gap-2">
          <button className="btn !px-3 !py-2 text-xs" onClick={() => onNavigate(`/match/${matchId}/camera`)}>
            <Camera className="h-3.5 w-3.5" /> Kamera auf diesem Gerät
          </button>
          <button
            className="btn !px-3 !py-2 text-xs"
            onClick={async () => {
              await api(`/matches/${matchId}/devices`, { body: { deviceId: me, role: 'dashboard', name: 'Dashboard' } });
              await loadSide();
            }}
          >
            Als Dashboard
          </button>
        </div>
      </div>

      <div className="card flex flex-wrap items-center justify-between gap-2 p-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[#a9b9d4]">Zuschauer-Code</span>
          <span className="rounded-lg bg-[#1b2b45] px-2 py-1 font-mono text-sm font-bold tracking-widest">
            {state.match.shareCode ?? '—'}
          </span>
          <button
            className="btn !px-2 !py-1 text-xs"
            onClick={async () => {
              const url = `${window.location.origin}/#/watch/${state.match.shareCode}`;
              await navigator.clipboard?.writeText(url).catch(() => undefined);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
          >
            <Copy className="h-3.5 w-3.5" /> {copied ? 'kopiert' : 'Link kopieren'}
          </button>
          <button className="btn !px-2 !py-1 text-xs" onClick={() => onNavigate(`/match/${matchId}/remote`)}>
            Fernbedienung
          </button>
        </div>
        <button
          className="btn !px-2 !py-1 text-xs"
          onClick={() => {
            const next = !sound;
            setSound(next);
            localStorage.setItem('darts.sound', next ? '1' : '0');
          }}
        >
          {sound ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          {sound ? 'Ansage an' : 'Ansage aus'}
        </button>
      </div>

      {candidates.length > 0 && (
        <div className="card border-[#ffcf6b] p-4">
          <p className="label !mb-2">Kamera-Vorschläge ({candidates.length})</p>
          <div className="space-y-2">
            {candidates.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl bg-[#1b2b45] p-2">
                <span className="font-bold">{dartLabel(c.ring, c.number)}</span>
                <span className="text-xs text-[#a9b9d4]">{Math.round(c.confidence * 100)} % sicher</span>
                <div className="flex gap-1">
                  <button
                    className="btn btn-primary !px-2 !py-1 text-xs"
                    onClick={() => act(() => api(`/matches/${matchId}/candidates/${c.id}`, { body: { action: 'approve' } }))}
                  >
                    <Check className="h-3.5 w-3.5" /> übernehmen
                  </button>
                  <button
                    className="btn !px-2 !py-1 text-xs"
                    onClick={() => act(() => api(`/matches/${matchId}/candidates/${c.id}`, { body: { action: 'reject' } }))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {lastCompletedVisit && !state.finished && (
        <div className="card flex items-center justify-between gap-3 p-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[#a9b9d4]">Letzte Runde</p>
            <p className="text-sm font-bold">
              {playerById(lastCompletedVisit.matchPlayerId)?.name}
            </p>
          </div>
          <p className="font-mono text-xs text-[#a9b9d4]">
            {lastCompletedVisit.darts.map((d) => dartLabel(d.ring, d.number)).join(' ')}
          </p>
          <p className={`text-2xl font-extrabold tabular-nums ${lastCompletedVisit.bust ? 'text-[#ff7a86]' : ''}`}>
            {lastCompletedVisit.bust ? 'Bust' : lastCompletedVisit.score}
          </p>
        </div>
      )}

      {state.finished && (
        <div className="card border-[var(--color-accent)] p-4">
          <p className="text-xs uppercase tracking-widest text-[var(--color-muted)]">Match beendet</p>
          <p className="mt-1 text-2xl font-extrabold text-[var(--color-accent)]">
            {state.players.find((p) => p.matchPlayerId === state.match.winnerPlayerId)?.name} gewinnt
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => onNavigate('/new')}>
              Neues Match
            </button>
            <button className="btn" onClick={requestSummary} disabled={summaryBusy}>
              <Sparkles className="h-4 w-4" /> {summaryBusy ? 'analysiere …' : 'KI-Analyse'}
            </button>
          </div>
        </div>
      )}

      {summary && (
        <div className="card space-y-2 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-[var(--color-accent)]">
            <Bot className="h-4 w-4" /> {summary.headline}
          </p>
          <p className="text-sm text-[#cfdaf0]">{summary.summary}</p>
          {summary.highlights.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--color-muted)]">
              {summary.highlights.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          )}
          {summary.tips.length > 0 && (
            <div className="rounded-xl bg-[var(--color-accent-soft)] p-3 text-sm">
              <p className="mb-1 text-xs font-bold uppercase tracking-widest text-[var(--color-accent)]">Tipps</p>
              <ul className="list-disc space-y-1 pl-5">
                {summary.tips.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {active && !state.finished && (
        <div className="card p-5 text-center">
          <div className="flex items-center justify-center gap-2 text-sm text-[var(--color-muted)]">
            <span className="text-xl">{active.avatar}</span>
            <span className="font-bold uppercase tracking-widest">{active.name} ist dran</span>
          </div>
          <p className="mt-1 text-[clamp(3.5rem,18vw,7rem)] font-black leading-none tabular-nums">
            {active.remaining}
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs text-[var(--color-muted)]">
            <span className="chip">Leg {state.currentLegIndex}</span>
            <span className="chip">
              Darts in diesem Zug: {dartsInVisit}/3
            </span>
            {state.match.doubleIn && !active.entered && <span className="chip !text-[var(--color-warn)]">Double-In offen</span>}
            {state.match.doubleOut && <span className="chip">Double-Out</span>}
          </div>

          {route && (
            <div className="mt-4 rounded-2xl border border-[#2c8f56] bg-[#0d3521] p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-accent)]">Checkout</p>
              <p className="mt-1 text-2xl font-extrabold tracking-wide">{route.label}</p>
              {alternatives.length > 0 && (
                <p className="mt-1 text-xs text-[var(--color-muted)]">
                  Alternativen: {alternatives.map((a) => a.label).join(' · ')}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {!state.finished && active && (
        <div className="card p-4">
          <div className="mx-auto mb-3 grid max-w-md grid-cols-3 gap-2">
            {RINGS.map((r) => (
              <button
                key={r.key}
                className={`ring-btn ${ring === r.key ? 'active' : ''}`}
                onClick={() => setRing(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>

          <div className="mx-auto grid max-w-md grid-cols-5 gap-2">
            {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
              <button key={n} className="num-btn" disabled={busy} onClick={() => throwDart(ring, n)}>
                {ring === 'triple' ? `T${n}` : ring === 'double' ? `D${n}` : n}
              </button>
            ))}
          </div>

          <div className="mx-auto mt-2 grid max-w-md grid-cols-2 gap-2">
            <button className="num-btn !aspect-auto !py-3" disabled={busy} onClick={() => throwDart('bull', 0)}>
              25 · Bull
            </button>
            <button className="num-btn !aspect-auto !py-3" disabled={busy} onClick={() => throwDart('bullseye', 0)}>
              50 · Bullseye
            </button>
          </div>

          <div className="mx-auto mt-3 flex max-w-md flex-wrap gap-2">
            <button
              className="btn flex-1"
              disabled={busy}
              onClick={() => act(() => api(`/matches/${matchId}/darts/last`, { method: 'DELETE' }))}
            >
              <RotateCcw className="h-4 w-4" /> Undo
            </button>
            <button
              className="btn flex-1"
              disabled={busy || dartsInVisit === 0}
              onClick={() => act(() => api(`/matches/${matchId}/visits/end`, { method: 'POST' }))}
            >
              <UserX className="h-4 w-4" /> Zug beenden
            </button>
          </div>

          {error && <p className="mt-2 text-sm text-[#ffb3ba]">{error}</p>}
        </div>
      )}

      <div className="card p-4">
        <p className="label">Züge</p>
        <div className="space-y-1">
          {recentVisits.map((v) => {
            const p = playerById(v.matchPlayerId);
            return (
              <div key={v.id} className="flex items-center justify-between gap-2 rounded-lg px-1 py-1 text-sm odd:bg-white/[0.03]">
                <span className="flex min-w-0 items-center gap-2">
                  <span><Avatar value={p?.avatar} /></span>
                  <span className="truncate text-[var(--color-muted)]">{p?.name}</span>
                </span>
                <span className="flex items-center gap-1 font-mono text-xs text-[var(--color-muted)]">
                  {v.darts.map((d) => (
                    <span key={d.id} className="rounded bg-white/5 px-1.5 py-0.5">
                      {dartLabel(d.ring, d.number)}
                    </span>
                  ))}
                </span>
                <span
                  className={`w-16 text-right font-bold tabular-nums ${
                    v.checkout ? 'text-[var(--color-accent)]' : v.bust ? 'text-[var(--color-danger)]' : ''
                  }`}
                >
                  {v.bust ? 'Bust' : v.score}
                </span>
              </div>
            );
          })}
          {recentVisits.length === 0 && <p className="text-sm text-[var(--color-muted)]">Noch keine Würfe.</p>}
        </div>
      </div>

      <button
        className="btn w-full !border-transparent !bg-transparent text-xs text-[var(--color-muted)]"
        onClick={() => {
          if (window.confirm('Match wirklich abbrechen? Der Spielstand bleibt in der Historie.')) {
            void act(() => api(`/matches/${matchId}/abandon`, { method: 'POST' }));
          }
        }}
      >
        <Target className="h-3 w-3" /> Match abbrechen
      </button>
    </div>
  );
}
