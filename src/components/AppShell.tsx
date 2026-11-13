import { useState, type ReactNode } from 'react';

/**
 * Kopfzeile und Grundgerüst nach der Portfolio-Vorlage.
 * Siehe /opt/data/knowledge/design-system/layout.md
 *
 * Erwartet shell.css (Klassen .app-header, .app-nav-item, …) und theme.css (Tokens).
 * Die Theme-Umschaltung bleibt Sache der App: `theme` + `onToggleTheme` übergeben,
 * damit jede App ihre eigene Persistenz behalten kann.
 */

export type NavItem = { id: string; label: string };

export function AppShell({
  name,
  subtitle,
  mark,
  items,
  active,
  onNavigate,
  theme,
  onToggleTheme,
  actions,
  mobileExtra,
  footer,
  children,
}: {
  name: string;
  subtitle: string;
  mark?: ReactNode;
  items: NavItem[];
  active: string;
  onNavigate: (id: string) => void;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  actions?: ReactNode;
  mobileExtra?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-container app-header__inner">
          <button className="app-brand" onClick={() => onNavigate(items[0]?.id ?? '')}>
            {mark ? <span className="app-brand__mark">{mark}</span> : null}
            <span className="app-brand__text">
              {name}
              <span className="app-brand__sub">{subtitle}</span>
            </span>
          </button>

          <nav className="app-nav">
            {items.map((item) => (
              <button
                key={item.id}
                className={`app-nav-item${item.id === active ? ' is-active' : ''}`}
                onClick={() => onNavigate(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="app-actions">
            {actions}
            {onToggleTheme ? (
              <button
                className="app-iconbtn"
                onClick={onToggleTheme}
                aria-label={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}
              >
                {theme === 'dark' ? '☀' : '☾'}
              </button>
            ) : null}
            <button
              className="app-iconbtn app-mobile-toggle"
              onClick={() => setOpen((v) => !v)}
              aria-label="Menü"
            >
              {open ? '✕' : '☰'}
            </button>
          </div>
        </div>

        {open ? (
          <nav className="app-mobile-nav">
            {items.map((item) => (
              <button
                key={item.id}
                className={item.id === active ? 'is-active' : undefined}
                onClick={() => {
                  onNavigate(item.id);
                  setOpen(false);
                }}
              >
                {item.label}
              </button>
            ))}
            {mobileExtra ? (
              <>
                <div className="app-mobile-nav__sep" />
                {/* Klick auf einen Zusatzeintrag schließt das Menü */}
                <div className="app-mobile-nav__extra" onClick={() => setOpen(false)}>
                  {mobileExtra}
                </div>
              </>
            ) : null}
          </nav>
        ) : null}
      </header>

      <main>{children}</main>

      {footer ? <footer className="app-footer">{footer}</footer> : null}
    </div>
  );
}

/** Seitenkopf: Badge, Serif-Titel, ein Satz Einleitung. */
export function PageHead({
  label,
  title,
  intro,
  children,
}: {
  label: string;
  title: string;
  intro: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="app-container app-hero">
      <p className="app-badge">{label}</p>
      <h1 className="app-title">{title}</h1>
      <p className="app-lede">{intro}</p>
      {children}
    </header>
  );
}

/** Kennzahlen-Leiste: höchstens vier echte Werte. */
export function StatRow({ items }: { items: { value: string; label: string }[] }) {
  if (items.length === 0) return null;
  return (
    <dl className="stat-row">
      {items.map((item) => (
        <div className="stat" key={item.label}>
          <dt className="stat__value">{item.value}</dt>
          <dd className="stat__label">{item.label}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Abgesetzte Sektion auf dem zweiten Grauton. */
export function Band({
  title,
  note,
  children,
}: {
  title?: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="app-band app-section">
      <div className="app-container">
        {title ? (
          <div className="app-section__head">
            <h2 className="app-section__title">{title}</h2>
            {note ? <p className="app-section__note">{note}</p> : null}
          </div>
        ) : null}
        {children}
      </div>
    </section>
  );
}
