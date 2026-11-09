
import { readFileSync } from 'node:fs';
import { changeBlobs, findBoardCircle, sharpness, type GrayImage } from '../src/lib/vision/detect.js';
import { applyMatrix, homographyFrom4, reprojectionError } from '../src/lib/vision/homography.js';
import { BOARD_MM, pointToField } from '../src/lib/vision/geometry.js';

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, extra = '') => {
  if (cond) pass += 1; else { fail += 1; console.log('FAIL', label, extra); }
};

function readPPM(path: string): GrayImage {
  const buf = readFileSync(path);
  // Header: P6\n<w> <h>\n255\n
  let idx = 0;
  const token = () => {
    while (idx < buf.length && /\s/.test(String.fromCharCode(buf[idx]))) idx += 1;
    let s = '';
    while (idx < buf.length && !/\s/.test(String.fromCharCode(buf[idx]))) { s += String.fromCharCode(buf[idx]); idx += 1; }
    return s;
  };
  const magic = token();
  if (magic !== 'P6') throw new Error('kein P6: ' + magic);
  const width = Number(token());
  const height = Number(token());
  token();
  idx += 1;
  const data = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const r = buf[idx + i * 3], g = buf[idx + i * 3 + 1], b = buf[idx + i * 3 + 2];
    data[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return { data, width, height };
}

const base = '/opt/data/profiles/coding/cache/scratch';

// 1) Kreis-Erkennung frontal
const front = readPPM(`${base}/board_front.ppm`);
const hit = findBoardCircle(front);
console.log('Kreis frontal:', hit ? `cx=${hit.cx.toFixed(1)} cy=${hit.cy.toFixed(1)} r=${hit.r.toFixed(1)} score=${hit.score.toFixed(3)}` : 'nicht gefunden');
check('Kreis gefunden', Boolean(hit));
if (hit) {
  check('Mittelpunkt frontal (±6 px)', Math.hypot(hit.cx - 350, hit.cy - 350) < 6, `${hit.cx.toFixed(1)}/${hit.cy.toFixed(1)}`);
  check('Radius frontal (±8 px)', Math.abs(hit.r - 342) < 8, hit.r.toFixed(1));
}
check('Schärfe frontal > 100', sharpness(front) > 100, sharpness(front).toFixed(0));

// 2) Perspektivisches Bild
const persp = readPPM(`${base}/board_persp.ppm`);
const hit2 = findBoardCircle(persp);
console.log('Kreis perspektivisch:', hit2 ? `cx=${hit2.cx.toFixed(1)} cy=${hit2.cy.toFixed(1)} r=${hit2.r.toFixed(1)} score=${hit2.score.toFixed(3)}` : 'nicht gefunden');
check('Kreis perspektivisch gefunden', Boolean(hit2));

// 3) Kalibrierung: die vier bekannten Quellpunkte (dest im Bild) → Board-MM
const dest = [{ x: 410, y: 60 }, { x: 760, y: 300 }, { x: 440, y: 600 }, { x: 150, y: 290 }];
const W = 900, H = 640;
const norm = dest.map((p) => ({ x: p.x / W, y: p.y / H }));
const targets = [
  { x: 0, y: -BOARD_MM.doubleOuter },
  { x: BOARD_MM.doubleOuter, y: 0 },
  { x: 0, y: BOARD_MM.doubleOuter },
  { x: -BOARD_MM.doubleOuter, y: 0 },
];
const Himg = homographyFrom4(norm, targets);
const err = reprojectionError(norm, targets, Himg);
check('Kalibrierung exakt (Rückprojektion < 0,5 mm)', err < 0.5, err.toFixed(3));

// 4) Feldbestimmung an bekannten Bildpunkten (Dart im T20 sitzt bei dest-Mitte oben)
// Boardmitte im Zielbild (aus dem Generator): (423.0, 294.5)
const center = applyMatrix(Himg, { x: 423 / W, y: 294.5 / H });
console.log('Mittelpunkt in Board-MM:', center.x.toFixed(1), center.y.toFixed(1));
check('Mittelpunkt nahe 0/0 (±6 mm)', Math.hypot(center.x, center.y) < 6, `${center.x.toFixed(1)}/${center.y.toFixed(1)}`);

// 5) Differenzbild: leer vs. Dart → Blob → Feld
function detect(path: string) {
  const img = readPPM(path);
  const blobs = changeBlobs(persp, img, 20);
  const blob = blobs.sort((a, b) => b.area - a.area)[0];
  if (!blob) return null;
  const p = applyMatrix(Himg, { x: blob.wx / img.width, y: blob.wy / img.height });
  return { blob, mm: p, field: pointToField(p.x, p.y) };
}

const tip = detect(`${base}/board_persp_dart.ppm`);
check('Spitze erkannt', Boolean(tip));
if (tip) {
  console.log('Spitze:', tip.mm.x.toFixed(1), tip.mm.y.toFixed(1), 'r=', Math.hypot(tip.mm.x, tip.mm.y).toFixed(1),
    '→', tip.field ? `${tip.field.ring} ${tip.field.number}` : 'außerhalb');
  check('Spitze = Triple 20', tip.field?.ring === 'triple' && tip.field?.number === 20, JSON.stringify(tip.field));
  check('Blob-Größe plausibel', tip.blob.area >= 8 && tip.blob.area <= 900, tip.blob.area.toString());
}

const single = detect(`${base}/board_persp_single.ppm`);
check('Single-Band erkannt', Boolean(single));
if (single) {
  console.log('Single:', single.mm.x.toFixed(1), single.mm.y.toFixed(1), 'r=', Math.hypot(single.mm.x, single.mm.y).toFixed(1),
    '→', single.field ? `${single.field.ring} ${single.field.number}` : 'außerhalb');
  check('Single 20 erkannt', single.field?.ring === 'single' && single.field?.number === 20, JSON.stringify(single.field));
}

// Dart mit Schaft: Schwerpunkt verschiebt sich — das muss die Konfidenz senken, nicht crashen
const shaft = detect(`${base}/board_persp_shaft.ppm`);
if (shaft) {
  console.log('Mit Schaft:', shaft.mm.x.toFixed(1), shaft.mm.y.toFixed(1), '→', shaft.field ? `${shaft.field.ring} ${shaft.field.number}` : 'außerhalb');
  check('Schaft: Zahl 20 bleibt', shaft.field?.number === 20, JSON.stringify(shaft.field));
}

// 6) Geometrie-Stichproben
const probe = (ring: string, num: number, rMm: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  const f = pointToField(Math.sin(a) * rMm, -Math.cos(a) * rMm);
  check(`${ring}${num} @${deg}°`, f?.ring === ring && (num === 0 || f?.number === num), JSON.stringify(f));
};
probe('triple', 20, 103, 0);
probe('double', 6, 166, 90);
probe('triple', 3, 103, 180);
probe('single', 11, 130, 270);
probe('bull', 0, 10, 0);
probe('bullseye', 0, 3, 0);
probe('triple', 19, 103, 198);

console.log(`\n${pass} grün, ${fail} rot`);
process.exit(fail ? 1 : 0);
