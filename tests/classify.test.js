// classify.test.js — camera color classifier (HSV / hue-based).
//
// Locks in the color reads that a real camera can't be screenshotted for: the
// six scheme colors under normal, dim, and lightly warm/cool lighting; the two
// notoriously close pairs (white vs yellow, red vs orange); and that a neutral
// grey — genuinely ambiguous — comes back low-confidence so the UI flags it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyColor,
  classifyColorDetailed,
  CONFIDENCE_THRESHOLD,
} from '../src/sizes/size2x2.js';

// Representative sRGB samples. Each entry: [r,g,b] -> expected letter.
// Includes the on-brand reference, a dim (under-lit) variant, and a warm- or
// cool-tinted variant (simulating a shifted white balance).
const CASES = {
  W: [
    [244, 246, 248], // reference white
    [252, 250, 235], // warm-tinted white (tungsten)
    [230, 236, 245], // cool-tinted white (shade)
    [200, 200, 198], // dimmer white / bright grey card that still reads bright
  ],
  Y: [
    [245, 197, 24], // reference yellow
    [240, 225, 140], // pale / washed yellow
    [200, 160, 20], // dim yellow
    [250, 210, 70], // bright warm yellow
  ],
  O: [
    [242, 121, 43], // reference orange
    [230, 120, 40], // slightly cool orange
    [180, 90, 30], // dim orange
    [250, 140, 60], // warm/bright orange
  ],
  R: [
    [229, 72, 77], // reference red
    [200, 60, 60], // dim red
    [235, 60, 55], // saturated warm red
    [190, 55, 70], // cool red
  ],
  G: [
    [46, 194, 126], // reference green
    [30, 110, 70], // dim green
    [70, 150, 90], // warm-tinted green
    [40, 200, 140], // cool/bright green
  ],
  B: [
    [43, 127, 255], // reference blue
    [60, 120, 200], // dim blue
    [40, 110, 210], // cooler blue
    [80, 140, 240], // lighter blue
  ],
};

for (const [expected, samples] of Object.entries(CASES)) {
  for (const rgb of samples) {
    test(`classify ${rgb.join(',')} -> ${expected}`, () => {
      const { color, confidence } = classifyColorDetailed(rgb);
      assert.equal(color, expected, `got ${color} for ${rgb}`);
      assert.equal(classifyColor(rgb), expected);
      assert.ok(
        confidence > CONFIDENCE_THRESHOLD,
        `expected confident read for ${rgb}, got ${confidence.toFixed(3)}`
      );
    });
  }
}

test('white vs yellow separation', () => {
  // A warm white must NOT read as yellow, and a pale yellow must NOT read white.
  assert.equal(classifyColorDetailed([250, 248, 235]).color, 'W');
  assert.equal(classifyColorDetailed([240, 225, 140]).color, 'Y');
});

test('red vs orange separation', () => {
  assert.equal(classifyColorDetailed([229, 72, 77]).color, 'R');
  assert.equal(classifyColorDetailed([242, 121, 43]).color, 'O');
  // A red-orange in between still lands on one of them, not on yellow.
  assert.ok(['R', 'O'].includes(classifyColorDetailed([233, 95, 55]).color));
});

test('ambiguous grey is low confidence', () => {
  // A mid-value neutral grey is genuinely ambiguous — nearest White, but the
  // UI should flag it for a second look.
  const { color, confidence } = classifyColorDetailed([128, 128, 132]);
  assert.equal(color, 'W');
  assert.ok(
    confidence < CONFIDENCE_THRESHOLD,
    `expected low confidence for grey, got ${confidence.toFixed(3)}`
  );
});

test('a hue exactly between two bands is low confidence', () => {
  // ~35° sits between Orange (24°) and Yellow (47°): a coin-flip.
  const { confidence } = classifyColorDetailed([230, 150, 40]);
  assert.ok(
    confidence < CONFIDENCE_THRESHOLD + 0.05,
    `expected near-threshold confidence, got ${confidence.toFixed(3)}`
  );
});

test('confidence is a normalized 0..1 value', () => {
  for (const samples of Object.values(CASES)) {
    for (const rgb of samples) {
      const { confidence } = classifyColorDetailed(rgb);
      assert.ok(confidence >= 0 && confidence <= 1, `${rgb} -> ${confidence}`);
    }
  }
});
