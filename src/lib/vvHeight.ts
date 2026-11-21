/**
 * Haelt `--vv-height` aktuell: die Hoehe des sichtbaren Bereichs.
 *
 * Auf dem Handy deckt die Tastatur den unteren Teil des Bildschirms ab. `100vh` und
 * `100dvh` kennen sie nicht — Dialoge und Vollbild-Ansichten werden dann unten
 * abgeschnitten, Eingabefelder verschwinden hinter der Tastatur.
 *
 * `visualViewport.height` ist genau die Flaeche, die wirklich sichtbar ist, und
 * schrumpft mit der Tastatur. Der Wert landet als CSS-Variable auf `<html>`, damit
 * jede Regel `var(--vv-height, 100dvh)` nutzen kann.
 */
export function starteSichtbareHoehe(): () => void {
  if (typeof window === 'undefined') return () => {};

  const root = document.documentElement;
  const vv = window.visualViewport;

  const setzen = () => {
    const hoehe = vv ? Math.round(vv.height) : window.innerHeight;
    root.style.setProperty('--vv-height', `${hoehe}px`);
  };

  setzen();

  if (!vv) {
    window.addEventListener('resize', setzen);
    window.addEventListener('orientationchange', setzen);
    return () => {
      window.removeEventListener('resize', setzen);
      window.removeEventListener('orientationchange', setzen);
      root.style.removeProperty('--vv-height');
    };
  }

  vv.addEventListener('resize', setzen);
  vv.addEventListener('scroll', setzen);
  window.addEventListener('orientationchange', setzen);

  return () => {
    vv.removeEventListener('resize', setzen);
    vv.removeEventListener('scroll', setzen);
    window.removeEventListener('orientationchange', setzen);
    root.style.removeProperty('--vv-height');
  };
}
