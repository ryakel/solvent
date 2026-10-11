// colourmemory.test.js — colours taught by the user for one cube (core/colourmemory.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createColourMemory, lookAlikeGroups, colourMix } from '../src/core/colourmemory.js';

// Ryan's knockoff 3x3, measured from his photo (SOLV-21): the lime "green" the
// standard classifier reads as yellow, and a coral red close to its orange.
const LIME = [115, 219, 0];
const YELLOW = [254, 243, 0];
const CORAL = [255, 101, 70];
const ORANGE = [255, 86, 0];
const dim = (rgb, k) => rgb.map((x) => Math.round(x * k));

test('a taught colour is recognised again on a darker or brighter face', () => {
  const m = createColourMemory();
  m.teach(LIME, 'G');
  for (const k of [0.6, 0.8, 1.0]) assert.equal(m.recall(dim(LIME, k)).colour, 'G', `x${k}`);
  // Brighter, clipped at 255 on the green channel: the mix shifts a little, still lime.
  assert.equal(m.recall([135, 255, 6]).colour, 'G');
});

test('brightness divides out: a colour and its dimmed self have the same mix', () => {
  const a = colourMix(CORAL);
  const b = colourMix(dim(CORAL, 0.7));
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(a[i] - b[i]) < 0.01);
});

test('nothing is claimed that does not clearly match', () => {
  const m = createColourMemory();
  assert.deepEqual(m.recall(LIME), { colour: null, nearest: null }, 'nothing taught yet');
  m.teach(YELLOW, 'Y');
  // Lime is far from the taught yellow: not claimed, though yellow is the nearest guess.
  assert.deepEqual(m.recall(LIME), { colour: null, nearest: 'Y' });
  m.teach(CORAL, 'R');
  m.teach(ORANGE, 'O');
  assert.equal(m.recall(CORAL).colour, 'R');
  assert.equal(m.recall(ORANGE).colour, 'O');
  // Halfway between the coral red and the orange: neither may claim it.
  const between = CORAL.map((x, i) => Math.round((x + ORANGE[i]) / 2));
  assert.equal(m.recall(between).colour, null);
});

test('once all six colours are taught, a sticker only needs to be clearly closest to one', () => {
  const m = createColourMemory();
  const six = { W: [239, 254, 242], Y: YELLOW, G: LIME, B: [30, 110, 230], R: CORAL, O: ORANGE };
  for (const [c, rgb] of Object.entries(six)) m.teach(rgb, c);
  // A lime under a warm lamp: too far from the taught lime to pass the "near"
  // test on its own, but far closer to it than to anything else.
  const warmLime = [138, 215, 5];
  assert.equal(m.recall(warmLime).colour, 'G');
  assert.deepEqual(m.taughtColours(), ['B', 'G', 'O', 'R', 'W', 'Y']);
});

test('an exact taught sample reports its answer; forget clears everything', () => {
  const m = createColourMemory();
  m.teach(LIME, 'G');
  assert.equal(m.answerFor(LIME), 'G');
  assert.equal(m.answerFor(YELLOW), null);
  m.forget();
  assert.equal(m.recall(LIME).colour, null);
  assert.equal(m.answerFor(LIME), null);
  assert.deepEqual(m.taughtColours(), []);
});

test('look-alike stickers are asked about together', () => {
  const rgbs = [LIME, YELLOW, dim(LIME, 0.85), CORAL, ORANGE, dim(CORAL, 0.9), YELLOW];
  const groups = lookAlikeGroups(rgbs, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(groups, [[0, 2], [1, 6], [3, 5], [4]]);
  // Only the indices asked about are grouped.
  assert.deepEqual(lookAlikeGroups(rgbs, [2, 3]), [[2], [3]]);
});
