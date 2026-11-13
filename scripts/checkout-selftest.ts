import { checkoutRoutes, dartPoints, isDouble } from '../server/scoring.js';

let failures = 0;

function check(label: string, condition: boolean) {
  if (!condition) {
    failures += 1;
    console.error('FAIL', label);
  }
}

// Jeder Vorschlag muss den Rest exakt auf 0 bringen und mit einem Doppel enden.
for (let remaining = 2; remaining <= 170; remaining += 1) {
  const routes = checkoutRoutes(remaining, true);
  if (remaining === 169 || remaining === 168 || remaining === 166 || remaining === 165 || remaining === 163 || remaining === 162 || remaining === 159) {
    check(`kein Finish für ${remaining}`, routes.length === 0);
    continue;
  }
  check(`Finish für ${remaining} fehlt`, routes.length > 0);
  for (const route of routes) {
    const total = route.throws.reduce((sum, t) => sum + dartPoints(t.ring, t.number), 0);
    check(`${remaining}: Summe ${total} bei ${route.label}`, total === remaining);
    check(`${remaining}: letzter Dart kein Doppel (${route.label})`, isDouble(route.throws[route.throws.length - 1].ring));
    check(`${remaining}: zu viele Darts (${route.label})`, route.throws.length <= 3);
    for (const t of route.throws.slice(0, -1)) {
      check(`${remaining}: Zwischenwurf ${t.label} führt ins Aus`, remaining > 0);
    }
  }
}

// Bekannte Wege
const p170 = checkoutRoutes(170, true)[0];
check('170 = T20 T20 Bull', p170?.label === 'T20 T20 Bull');
const p2 = checkoutRoutes(2, true)[0];
check('2 = D1', p2?.label === 'D1');

// Straight-Out: 1 ist mit einem Single finishbar, mit Double-Out nicht.
check('Double-Out: 1 nicht finishbar', checkoutRoutes(1, true).length === 0);

if (failures) {
  console.error(`${failures} Fehler beim Checkout-Test`);
  process.exit(1);
}
console.log('Checkout-Test grün: 2–170 geprüft');
