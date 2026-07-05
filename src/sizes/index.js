// sizes/index.js — the SizeModule registry.
//
// The UI is size-agnostic: it asks the registry for the active module and drives
// whatever it gets back. Ship 2x2 today; a 3x3 slots in here with no UI changes.

import size2x2 from './size2x2.js';

// 3x3: implement SizeModule here.
//   Create ./size3x3.js exporting a module with the same shape as size2x2
//   (id, name, gridN:3, cubiesPerEdge:3, faceOrder, colors, colorHex, colorNames,
//    solvedFaces, emptyFaces, validate, classifyColor, moveToTurn, solve, ...),
//   then add it to the array below. The scanner samples a gridN x gridN grid, the
//   renderer builds a cubiesPerEdge^3 cube, and the flow (scan -> correct ->
//   validate -> solve -> animate) works unchanged.
//
//   import size3x3 from './size3x3.js';

const MODULES = [size2x2 /* , size3x3 */];

export const SIZE_MODULES = MODULES;

export function getSizeModule(id) {
  const m = MODULES.find((x) => x.id === id);
  if (!m) throw new Error('unknown cube size: ' + id);
  return m;
}

export function defaultSizeModule() {
  return MODULES[0];
}
