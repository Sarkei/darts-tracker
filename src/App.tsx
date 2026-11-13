import { useEffect, useState } from 'react';
import {
  BarChart3,
  History,
  Home,
  LogOut,
  Plus,
  Settings,
  Target,
  Trophy,
  Users,
} from 'lucide-react';
import { AppShell } from './components/AppShell';
import { useAuth } from './lib/auth';
import { AuthPage } from './pages/AuthPage';
import { HomePage } from './pages/HomePage';
import { NewMatchPage } from './pages/NewMatchPage';
import { MatchPage } from './pages/MatchPage';
import { CameraPage } from './pages/CameraPage';
import { HistoryPage } from './pages/HistoryPage';
import { StatsPage } from './pages/StatsPage';
import { RankingPage } from './pages/RankingPage';
import { PlayersPage } from './pages/PlayersPage';
import { SettingsPage } from './pages/SettingsPage';
import { ResetPage } from './pages/ResetPage';
import { WatchPage } from './pages/WatchPage';
import { RemotePage } from './pages/RemotePage';
import { TrainingPage } from './pages/TrainingPage';
import { TournamentPage } from './pages/TournamentPage';

function currentRoute() {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  return hash;
}

type ThemeName = 'light' | 'dark';

const NAV = [
  { id: '/', label: 'Start', icon: Home },
  { id: '/history', label: 'Historie', icon: History },
  { id: '/stats', label: 'Statistik', icon: BarChart3 },
  { id: '/training', label: 'Training', icon: Target },
  { id: '/tournament', label: 'Turnier', icon: Trophy },
  { id: '/ranking', label: 'Rangliste', icon: Trophy },
  { id: '/players', label: 'Spieler', icon: Users },
];

const SECTIONS: Record<string, string> = {
  '/': 'Startseite',
  '/history': 'Historie',
  '/stats': 'Statistik',
  '/training': 'Training',
  '/tournament': 'Turnier',
  '/ranking': 'Rangliste',
  '/players': 'Spieler',
  '/settings': 'Einstellungen',
  '/new': 'Neues Match',
};

export default function App() {
  const { user, loading, logout } = useAuth();
  const [route, setRoute] = useState(currentRoute());
  const [theme, setTheme] = useState<ThemeName>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  );

  useEffect(() => {
    const onHash = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Theme-Umschaltung: Attribut auf <html>, Wahl in localStorage
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('darts-theme', theme);
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  }, [theme]);

  const navigate = (to: string) => {
    window.location.hash = to;
  };

  // Öffentliche Wege ohne Anmeldung
  if (route.startsWith('/watch/')) {
    return <WatchPage code={route.split('/')[2] ?? ''} />;
  }
  if (route.startsWith('/reset')) {
    return <ResetPage onNavigate={(to) => { window.location.hash = to; }} />;
  }

  if (loading) {
    return (
      <div className="app">
        <div className="app-container app-page flex min-h-[60vh] items-center justify-center gap-2 text-[var(--muted)]">
          <Target className="h-5 w-5 animate-pulse text-[var(--accent)]" /> lade …
        </div>
      </div>
    );
  }

  if (!user) return <AuthPage />;

  const matchDetail = route.match(/^\/match\/(\d+)$/);
  const cameraDetail = route.match(/^\/match\/(\d+)\/camera$/);
  const remoteDetail = route.match(/^\/match\/(\d+)\/remote$/);
  const isMatch = Boolean(matchDetail);
  const inMatchArea = Boolean(matchDetail || cameraDetail || remoteDetail);

  const activeNav = inMatchArea ? '/history' : route;
  const sectionLabel = inMatchArea ? 'Match' : SECTIONS[route] ?? 'Übersicht';

  const page = (
    <>
      {route === '/' && <HomePage onNavigate={navigate} />}
      {route === '/new' && <NewMatchPage onCreated={(id) => navigate(`/match/${id}`)} />}
      {isMatch && <MatchPage matchId={Number(matchDetail![1])} onNavigate={navigate} />}
      {cameraDetail && <CameraPage matchId={Number(cameraDetail[1])} onNavigate={navigate} />}
      {remoteDetail && <RemotePage matchId={Number(remoteDetail[1])} onNavigate={navigate} />}
      {route === '/history' && <HistoryPage onOpen={(id) => navigate(`/match/${id}`)} />}
      {route === '/stats' && <StatsPage />}
      {route === '/training' && <TrainingPage />}
      {route === '/tournament' && <TournamentPage onOpenMatch={(id) => navigate(`/match/${id}`)} />}
      {route === '/ranking' && <RankingPage />}
      {route === '/players' && <PlayersPage />}
      {route === '/settings' && <SettingsPage />}
    </>
  );

  return (
    <AppShell
      name="Darts Tracker"
      subtitle={sectionLabel}
      mark={<Target className="h-[22px] w-[22px]" strokeWidth={2.2} />}
      items={NAV.map(({ id, label }) => ({ id, label }))}
      active={activeNav}
      onNavigate={navigate}
      theme={theme}
      onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      actions={
        <>
          <button className="app-cta" onClick={() => navigate('/new')} title="Neues Match">
            <Plus className="h-4 w-4" />
            <span>Neues Match</span>
          </button>
          <button
            className="app-iconbtn app-iconbtn--wide"
            onClick={() => navigate('/settings')}
            aria-label="Einstellungen"
            title="Einstellungen"
          >
            <Settings className="h-4 w-4" />
          </button>
          <button
            className="app-iconbtn app-iconbtn--wide"
            onClick={logout}
            aria-label="Abmelden"
            title="Abmelden"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </>
      }
      mobileExtra={
        <>
          <button onClick={() => navigate('/settings')}>Einstellungen</button>
          <button onClick={() => navigate('/new')}>Neues Match</button>
          <button onClick={logout}>Abmelden</button>
        </>
      }
      footer={
        <div className="app-container flex flex-wrap items-center justify-between gap-2">
          <span>Darts Tracker · Matches, Legs und Checkouts für deine Gruppe</span>
          <span>501 · Double-Out · Statistik</span>
        </div>
      }
    >
      {route === '/' ? page : <div className="app-container app-page">{page}</div>}
    </AppShell>
  );
}
