import { useEffect, useState } from 'react';
import { BarChart3, History, Home, LogOut, Plus, Trophy, Users, Settings, Target } from 'lucide-react';
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

function currentRoute() {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  return hash;
}

export default function App() {
  const { user, loading, logout } = useAuth();
  const [route, setRoute] = useState(currentRoute());

  useEffect(() => {
    const onHash = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--color-muted)]">
        <Target className="mr-2 h-5 w-5 animate-pulse" /> lade …
      </div>
    );
  }

  if (!user) return <AuthPage />;

  const navigate = (to: string) => {
    window.location.hash = to;
  };

  const matchDetail = route.match(/^\/match\/(\d+)$/);
  const cameraDetail = route.match(/^\/match\/(\d+)\/camera$/);
  const isMatch = Boolean(matchDetail);

  const nav = [
    { to: '/', label: 'Start', icon: Home },
    { to: '/history', label: 'Historie', icon: History },
    { to: '/stats', label: 'Statistik', icon: BarChart3 },
    { to: '/ranking', label: 'Rangliste', icon: Trophy },
    { to: '/players', label: 'Spieler', icon: Users },
  ];

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-24 pt-4 md:pb-8">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button className="flex shrink-0 items-center gap-2" onClick={() => navigate('/')}>
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--color-accent)] text-[#04160c]">
            <Target className="h-5 w-5" />
          </span>
          <span className="text-lg font-extrabold tracking-tight">Darts</span>
        </button>

        <nav className="hidden min-w-0 items-center gap-1 lg:flex">
          {nav.map((item) => {
            const active = route === item.to || (item.to === '/history' && isMatch);
            const Icon = item.icon;
            return (
              <button
                key={item.to}
                onClick={() => navigate(item.to)}
                className={`btn !border-transparent !bg-transparent !px-3 !py-2 text-sm ${
                  active ? '!text-[var(--color-accent)]' : '!text-[var(--color-muted)]'
                }`}
              >
                <Icon className="h-4 w-4" /> {item.label}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button className="btn btn-primary !px-3 !py-2 text-sm" onClick={() => navigate('/new')}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Neues Match</span>
          </button>
          <button className="btn !px-3 !py-2" onClick={() => navigate('/settings')} title="Einstellungen">
            <Settings className="h-4 w-4" />
          </button>
          <button className="btn !px-3 !py-2" onClick={logout} title="Abmelden">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="flex-1">
        {route === '/' && <HomePage onNavigate={navigate} />}
        {route === '/new' && <NewMatchPage onCreated={(id) => navigate(`/match/${id}`)} />}
        {isMatch && <MatchPage matchId={Number(matchDetail![1])} onNavigate={navigate} />}
        {cameraDetail && <CameraPage matchId={Number(cameraDetail[1])} onNavigate={navigate} />}
        {route === '/history' && <HistoryPage onOpen={(id) => navigate(`/match/${id}`)} />}
        {route === '/stats' && <StatsPage />}
        {route === '/ranking' && <RankingPage />}
        {route === '/players' && <PlayersPage />}
        {route === '/settings' && <SettingsPage />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-[var(--color-line)] bg-[#080f1c]/95 px-2 py-2 backdrop-blur md:hidden">
        {nav.map((item) => {
          const Icon = item.icon;
          const active = route === item.to;
          return (
            <button
              key={item.to}
              onClick={() => navigate(item.to)}
              className={`flex flex-col items-center gap-1 px-3 py-1 text-[11px] font-semibold ${
                active ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]'
              }`}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
