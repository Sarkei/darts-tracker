/**
 * AppShell — das gemeinsame Gerüst für alle Apps.
 *
 * **Warum eine Komponente und nicht Copy-Paste:** Tims Vorgabe war, dass eine Änderung
 * am Aufbau (z. B. Kopfzeile zu Sidebar) in **allen** Apps gleichzeitig wirkt. Deshalb
 * liegt der Aufbau hier zentral; die Apps liefern nur Inhalte und Navigationspunkte.
 *
 * **Was hier drin steht:** Kopfzeile mit Marke, Navigation als Pillen, Theme-Umschalter,
 * Abmelden, Fußleiste. **Was hier NICHT drin steht:** Farben. Die kommen aus
 * `design/farben.css`, das der Generator aus `kit/paletten.json` baut.
 *
 * Verwendung in einer App:
 *
 *   import { AppShell } from './design/AppShell';
 *
 *   <AppShell
 *     name="Fitness"
 *     unterzeile="Training · Ernährung"
 *     icon="/icon-192.png"
 *     punkte={[{ id: 'heute', label: 'Heute' }, { id: 'plan', label: 'Plan' }]}
 *     aktiv={tab}
 *     onNavigate={setTab}
 *     rechts={<span>Tim</span>}
 *     fuss={<span>VRTX</span>}
 *   >
 *     … Seiteninhalt …
 *   </AppShell>
 */

import { useEffect, useState, type ReactNode } from 'react';

export type Punkt = { id: string; label: string; icon?: ReactNode };

export type AppShellProps = {
  /** Name in der Marke (z. B. „Fitness") */
  name: string;
  /** Kleine gesperrte Unterzeile (z. B. „Training · Ernährung") */
  unterzeile?: string;
  /** Pfad zum App-Icon; ohne Angabe wird ein Buchstabe gezeigt */
  icon?: string;
  /** Alternativ: eigenes Zeichen in der Marke */
  marke?: ReactNode;
  punkte: Punkt[];
  aktiv: string;
  onNavigate: (id: string) => void;
  /** Rechts in der Kopfzeile vor den Symbolen (z. B. Kontoname) */
  rechts?: ReactNode;
  /** Zusätzliche Aktionen vor Theme/Abmelden */
  aktionen?: ReactNode;
  onAbmelden?: () => void;
  /** Inhalt der Fußleiste rechts */
  fussRechts?: ReactNode;
  /** Fußleiste ganz ausblenden */
  ohneFuss?: boolean;
  children: ReactNode;
};

/**
 * Theme-Umschalter mit Speicherung.
 *
 * Der gespeicherte Wert wird zusätzlich in `index.html` vor dem ersten Bild gesetzt —
 * sonst blitzt beim Laden kurz das helle Design auf (Tim hat genau das zurückgemeldet).
 */
export function useTheme(schluessel = 'design.theme') {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    const gespeichert = localStorage.getItem(schluessel);
    const start = gespeichert === 'light' ? 'light' : 'dark';
    setTheme(start);
    document.documentElement.setAttribute('data-theme', start);
  }, [schluessel]);

  function wechseln() {
    const neu = theme === 'dark' ? 'light' : 'dark';
    setTheme(neu);
    localStorage.setItem(schluessel, neu);
    document.documentElement.setAttribute('data-theme', neu);
  }

  return { theme, wechseln };
}

export function AppShell({
  name,
  unterzeile,
  icon,
  marke,
  punkte,
  aktiv,
  onNavigate,
  rechts,
  aktionen,
  onAbmelden,
  fussRechts,
  ohneFuss,
  children,
}: AppShellProps) {
  const { theme, wechseln } = useTheme();

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-container app-header__inner">
          <a
            className="app-brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onNavigate(punkte[0]?.id ?? '');
            }}
          >
            <span className="app-brand__mark">
              {icon ? <img src={icon} alt="" /> : <span style={{ fontWeight: 700 }}>{name.charAt(0)}</span>}
            </span>
            <span className="app-brand__text">
              {name}
              {unterzeile && <span className="app-brand__sub">{unterzeile}</span>}
            </span>
          </a>

          {/* Desktop-Navigation */}
          <nav className="app-nav desktop-only" aria-label={name}>
            {punkte.map((p) => (
              <button
                key={p.id}
                className={`app-nav-item${p.id === aktiv ? ' is-active' : ''}`}
                onClick={() => onNavigate(p.id)}
                aria-current={p.id === aktiv ? 'page' : undefined}
              >
                {p.icon}
                {p.label}
              </button>
            ))}
          </nav>

          <div className="app-actions">
            {rechts}
            {aktionen}
            <button
              className="app-iconbtn"
              onClick={wechseln}
              title={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
            {onAbmelden && (
              <button className="app-iconbtn" onClick={onAbmelden} title="Abmelden">
                ⏻
              </button>
            )}
          </div>
        </div>

        {/* Mobil: gleiche Punkte unter der Kopfzeile */}
        <nav className="app-container app-mobile-nav" aria-label={`${name} Bereiche`}>
          {punkte.map((p) => (
            <button
              key={p.id}
              className={`app-nav-item${p.id === aktiv ? ' is-active' : ''}`}
              onClick={() => onNavigate(p.id)}
            >
              {p.icon}
              {p.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="app-container">{children}</main>

      {!ohneFuss && (
        <footer className="app-footer">
          <div className="app-container app-footer__inner">
            <span>{name}</span>
            <span>{fussRechts}</span>
          </div>
        </footer>
      )}
    </div>
  );
}

/**
 * Seitenkopf — gleiche Anordnung in jeder App: Badge, Titel, ein Satz.
 */
export function Seitenkopf({
  badge,
  titel,
  satz,
}: {
  badge?: string;
  titel: string;
  satz?: string;
}) {
  return (
    <section className="app-hero">
      {badge && <span className="app-eyebrow">{badge}</span>}
      <h1 className="app-title">{titel}</h1>
      {satz && <p className="app-lede">{satz}</p>}
    </section>
  );
}

/** Kennzahlenzeile — Label, Zahl, Einheit. Keine Erklärsätze darunter. */
export function Kennzahlen({
  werte,
}: {
  werte: { wert: string; label: string; akzent?: boolean }[];
}) {
  return (
    <div className="stat-row" style={{ ['--stats' as string]: werte.length }}>
      {werte.map((w) => (
        <div className="stat" key={w.label}>
          <div className={`stat__wert${w.akzent ? ' stat__wert--akzent' : ''}`}>{w.wert}</div>
          <div className="stat__label">{w.label}</div>
        </div>
      ))}
    </div>
  );
}
