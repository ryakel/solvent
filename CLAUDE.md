# CLAUDE.md

Solvent — browser-based Rubik's cube solver (2×2 shipping, 3×3 slots in via `src/sizes/` modules). Pure static site: no backend, no build step, no framework; deployed to GitHub Pages by `.github/workflows/pages.yml`. `README.md` covers the product flow (Scan → Verify → Solve) and architecture.

## Gotchas

- `DESIGN.md` is the **logo/brand specification**, not an app-architecture doc — don't look there for product or code design.
- `vendor/three.module.js` is vendored Three.js — don't refactor, lint, or "upgrade" it in passing; replacing it is a deliberate decision.
- The solver is deterministic and verified against thousands of random scrambles with zero tolerance for failures — any solver change must keep `npm test` green, and an impossible cube must never reach the solver (the Verify-step validation is a product guarantee).
- No build step means everything must run as plain ES modules straight off the file system / Pages — don't introduce a bundler or transpiled syntax.

## Commands

- `npm test` — full suite (unit + e2e); `npm run serve` — local server on :8080.
