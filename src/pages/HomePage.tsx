import { useEffect, useState } from 'react';
import {
  BarChart3,
  ChevronRight,
  History,
  ListOrdered,
  Play,
  Target,
  Trophy,
  Users,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { MatchSummary, PlayerStats } from '../lib/types';
import { Band, PageHead, StatRow } from '../components/AppShell';

const AREAS = [
  {
    to: '/history',
    icon: History,
    title: 'Historie',
    text: 'Alle Matches der Gruppe, mit Legs, Aufnahme und Ergebnis.',
  },
  {
    to: '/stats',
    icon: BarChart3,
    title: 'Statistik',
    text: 'Average, Doppelquote, 180er und Trefferbild je Spieler.',
  },
  {
    to: '/training',
    icon: Target,
    title: 'Training',
    text: 'Übungen und Trainingsspiele für Doppel und Checkouts.',
  },
  {
    to: '/tournament',
    icon: Trophy,
    title: 'Turnier',
    text: 'Turnierbaum anlegen, Ergebnisse eintragen, Sieger ermitteln.',
  },
  {
    to: '/ranking',
    icon: ListOrdered,
    title: 'Rangliste',
    text: 'Elo-Wert, Siege und Average im direkten Vergleich.',
  },
  {
    to: '/players',
    icon: Users,
    title: 'Spieler',
    text: 'Spieler anlegen und verwalten, Gäste ohne Konto zulassen.',
  },
];

function legsLabel(value: string | number): string {
  const n = Number(value);
  return `${n} ${n === 1 ? 'Leg' : 'Legs'}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function HomePage({ onNavigate }: { onNavigate: (to: string) => void }) {
  const { user } = useAuth();
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [m, s] = await Promise.all([
          api<{ matches: MatchSummary[] }>('/matches?limit=8'),
          api<{ players: PlayerStats[] }>('/stats'),
        ]);
        setMatches(m.matches);
        setStats(s.players[0] ?? null);
      } catch {
        /* still leer */
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const active = matches.filter((m) => m.status === 'active');
  const recent = matches.filter((m) => m.status !== 'active').slice(0, 4);
  const firstName = user?.displayName?.split(' ')[0] ?? 'Spieler';

  const values = [
    { value: stats ? String(stats.matches) : '0', label: 'Matches' },
    { value: stats ? String(stats.legs) : '0', label: 'Legs' },
    { value: stats ? stats.average.toFixed(1).replace('.', ',') : '0,0', label: 'Average' },
    { value: stats ? `${Math.round(stats.doubleQuote)}%` : '0%', label: 'Doppelquote' },
  ];

  return (
    <>
      <PageHead
        label="Übersicht · Darts Tracker"
        title={`Willkommen zurück, ${firstName}`}
        intro="Matches erfassen, Würfe auswerten und Training planen – alle Zahlen deiner Gruppe an einem Ort."
      >
        <StatRow items={values} />
      </PageHead>

      <section className="app-section app-container">
        <div className="app-section__head">
          <h2 className="app-section__title">Bereiche</h2>
          <p className="app-section__note">Sechs Ansichten, eine Datenbasis</p>
        </div>
        <div className="app-grid app-grid--three">
          {AREAS.map((area) => {
            const Icon = area.icon;
            return (
              <button
                key={area.to}
                className="app-card app-card--link"
                onClick={() => onNavigate(area.to)}
              >
                <span className="app-card__head">
                  <Icon className="h-5 w-5" strokeWidth={1.8} />
                  <ChevronRight className="app-card__arrow h-5 w-5" />
                </span>
                <span className="app-card__title block">{area.title}</span>
                <span className="app-card__text block">{area.text}</span>
              </button>
            );
          })}
        </div>
      </section>

      <Band
        title="Zuletzt passiert"
        note={loaded ? `${active.length} laufend · ${recent.length} beendet` : undefined}
      >
        <div className="app-stack">
          {active.map((m) => (
            <button key={m.id} className="app-row" onClick={() => onNavigate(`/match/${m.id}`)}>
              <span className="min-w-0">
                <span className="app-row__title block truncate">
                  {m.players.map((p) => p.name).join(' vs ')}
                </span>
                <span className="app-row__meta block">
                  läuft · {m.start_score} · Best of {m.best_of} · {legsLabel(m.legs_played)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-[var(--accent)]">
                fortsetzen <Play className="h-4 w-4" />
              </span>
            </button>
          ))}

          {recent.map((m) => (
            <button key={m.id} className="app-row" onClick={() => onNavigate(`/match/${m.id}`)}>
              <span className="min-w-0">
                <span className="app-row__title block truncate">
                  {m.players.map((p) => p.name).join(' vs ')}
                </span>
                <span className="app-row__meta block">
                  beendet · {formatDate(m.finished_at)} · {legsLabel(m.legs_played)}
                </span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-[var(--muted)]" />
            </button>
          ))}

          {loaded && active.length === 0 && recent.length === 0 && (
            <div className="app-empty">
              Noch kein Match gespielt. Leg das erste an – zwei Spieler, 501, Double-Out.
              <div className="mt-4">
                <button className="ui-btn ui-btn-primary" onClick={() => onNavigate('/new')}>
                  Neues Match
                </button>
              </div>
            </div>
          )}
        </div>
      </Band>
    </>
  );
}
