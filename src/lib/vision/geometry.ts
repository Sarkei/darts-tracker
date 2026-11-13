import type { Ring } from '../types';

/** Reihenfolge der Zahlen ab „12 Uhr" im Uhrzeigersinn. */
export const BOARD_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

/** Radien in Millimetern vom Mittelpunkt aus (Turnierboard, Doppel-Außenkante = 170 mm). */
export const BOARD_MM = {
  doubleOuter: 170,
  doubleInner: 162,
  tripleOuter: 107,
  tripleInner: 99,
  bull: 15.9,
  bullseye: 6.35,
};

export interface Field {
  ring: Ring;
  number: number;
  score: number;
  /** Abstand zur Sektorgrenze in Grad — klein heißt unsicher. */
  angleMargin: number;
}

export function scoreOf(ring: Ring, number: number): number {
  if (ring === 'bull') return 25;
  if (ring === 'bullseye') return 50;
  if (ring === 'triple') return number * 3;
  if (ring === 'double') return number * 2;
  return number;
}

/**
 * Rechnet einen Punkt in Board-Millimetern (0/0 = Mitte, +y = unten, 20 oben)
 * in Feld und Ring um.
 */
export function pointToField(xMm: number, yMm: number): Field | null {
  const r = Math.hypot(xMm, yMm);
  if (r > BOARD_MM.doubleOuter + 6) return null;

  if (r <= BOARD_MM.bullseye) return { ring: 'bullseye', number: 0, score: 50, angleMargin: 9 };
  if (r <= BOARD_MM.bull) return { ring: 'bull', number: 0, score: 25, angleMargin: 9 };

  // Winkel 0° = oben, im Uhrzeigersinn
  let angle = (Math.atan2(xMm, -yMm) * 180) / Math.PI;
  angle = (angle + 360) % 360;

  const sectorFloat = (angle + 9) / 18;
  const index = Math.floor(sectorFloat) % 20;
  const centreOfSector = index * 18;
  let diff = Math.abs(angle - centreOfSector);
  if (diff > 180) diff = 360 - diff;
  const angleMargin = 9 - Math.min(9, diff);

  const number = BOARD_ORDER[index];
  let ring: Ring;
  if (r > BOARD_MM.doubleInner) ring = 'double';
  else if (r > BOARD_MM.tripleOuter) ring = 'single';
  else if (r > BOARD_MM.tripleInner) ring = 'triple';
  else ring = 'single';

  return { ring, number, score: scoreOf(ring, number), angleMargin };
}
