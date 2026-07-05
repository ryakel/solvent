# Solvent Logo System — Design Specification

## Brand concept

Solvent is a precise, engineering-minded 2×2 cube solver. The logo system should communicate two meanings at once:

1. **Solve** — the app resolves a scrambled 2×2 cube into an ordered solution.
2. **Solvent** — the cube appears to dissolve, disperse, or deconstruct into smaller geometric fragments.

The visual language should feel like a technical instrument, not a toy. The marks should be crisp, geometric, confident, and usable in product surfaces such as app icons, README headers, GitHub previews, launch graphics, and small UI badges.

---

## Global visual rules

### Style

Use a clean, modern, vector-style aesthetic.

The logos should look like intentional brand marks, not illustrations. Use flat color, hard geometry, crisp edges, controlled negative space, and minimal decoration.

Avoid:

- 3×3 Rubik's cubes
- Cartoon styling
- Drop shadows
- Heavy bevels
- Generic AI glows
- Hands holding a cube
- Overly playful rainbow color usage
- Excessive gradients
- Photorealism
- Toy-like proportions

### Cube rule

Any cube shown must clearly read as a **2×2 cube**.

Each visible face should contain exactly four cubies, arranged as a 2×2 grid.

Do not draw nine stickers per face. Do not imply a 3×3 cube.

### Background

Primary presentation background:

- Dark slate: `#12151A`

Marks should be designed to work on this background first.

A transparent-background export should also be possible for production use, but concept previews should be shown on dark slate.

### Color palette

Use the cube palette as accents only. The design should feel restrained and premium.

Primary base:

- Dark slate: `#12151A`

Primary light:

- Off-white: `#F4F6F8`

Accent colors:

- Yellow: `#F5C518`
- Green: `#2EC27E`
- Blue: `#2B7FFF`
- Red: `#E5484D`
- Orange: `#F2792B`

Preferred usage:

- Use 2–3 accent colors for premium versions.
- Use all six colors only when the concept needs to explicitly communicate "cube solving."
- Avoid equal-weight rainbow distribution.
- Let white and slate carry most of the visual weight.

### Geometry

Use:

- Rounded-corner squares only when needed to soften the app icon.
- Mostly squared geometry with subtle chamfered corners.
- Thick dark separators between cubies.
- Pixel-square fragments for the dissolve effect.
- Isometric or shallow 3/4 perspective for cube marks.
- Strong silhouette for small-size legibility.

Avoid:

- Organic blobs
- Liquid splashes
- Circular swirls
- Irregular confetti shapes
- Complex internal detail

### Dissolve / resolve motif

The dissolve effect should be represented using small square fragments.

Fragments should:

- Be square or near-square.
- Use the same palette as the cube.
- Trail away from one corner or edge.
- Decrease in size and/or density as they move away.
- Feel orderly and digital, not chaotic confetti.

The dissolve should imply either:

- A scrambled cube resolving into order, or
- A solved cube dissolving into controlled geometric particles.

---

## Direction 1 — Icon-first mark

### Purpose

A square app-icon style mark with no text.

This direction is optimized for:

- Mobile app icon
- Favicon
- Product tile
- Internal tool launcher
- Slack app icon
- Small UI badge

### Composition

Use a single isometric 2×2 cube centered on a dark slate background.

The cube should be shown in slight 3/4 or isometric view with three visible faces:

- Top face
- Left face
- Right/front face

Each visible face must show a 2×2 structure.

### Current visual direction

The current generated concept uses:

- Top face: off-white
- Left face: blue
- Right/front face: orange
- Dark slate separators between cubies
- A dissolve trail moving diagonally up and right
- White, blue, and orange square fragments
- Larger fragments closer to the cube
- Smaller, dimmer fragments farther away

### Layout rules

The cube should occupy roughly 45–60% of the square canvas width.

The dissolve trail should extend toward the upper-right, but not so far that the icon feels unbalanced.

Maintain enough empty space around the mark so it works inside rounded app-icon masks.

Recommended icon composition:

- Canvas: square
- Cube center: slightly left of center
- Dissolve trail: upper-right quadrant
- Safe margin: at least 12–15% on all sides

### Shape behavior

The cube should look mostly solved and stable, with one corner or edge dissolving.

Preferred dissolve area:

- Upper-right edge of the top/right face intersection
- Right/front face breaking into orange fragments
- Top face breaking into white fragments
- Blue fragments used sparingly for depth

The dissolve should not destroy the cube's readability as a 2×2.

### Iteration prompts

Use this when regenerating Direction 1:

> "Create a clean vector-style app icon for Solvent, a precise 2×2 cube solver. Show a true 2×2 cube in isometric view, with exactly four cubies per visible face. Use a dark slate background. The cube should feel solved and technical, with one upper-right corner dissolving into small square fragments. Use only off-white, blue, and orange accents. Keep the geometry crisp, premium, and flat. No text, no 3×3 cube, no shadows, no bevels, no cartoon styling."

### Common fixes

If the model draws a 3×3:
> "Redo as a true 2×2 cube. Each visible face must contain exactly four cubies, not nine."

If the dissolve becomes too messy:
> "Make the fragments fewer, more square, and more orderly. The dissolve should feel engineered, not like confetti."

If it looks too playful:
> "Reduce the color count to white, blue, and orange. Make the cube more minimal and technical."

---

## Direction 2 — Wordmark + mark

### Purpose

A horizontal brand lockup for documentation, repo headers, launch pages, and README graphics.

This direction is optimized for:

- GitHub README header
- GitHub social preview
- Product landing page hero
- Internal docs
- Presentation title slide
- Wide logo placement

### Composition

Use a horizontal lockup:

1. Cube mark on the left
2. Wordmark "SOLVENT" or "Solvent" on the right
3. Optional tagline beneath the wordmark

The current generated concept uses:

- A 2×2 cube mark on the left
- Large all-caps technical wordmark: SOLVENT
- Tagline below: SCAN · VERIFY · SOLVE
- Colored tagline words:
    - SCAN in blue
    - VERIFY in green
    - SOLVE in orange
- White dot separators

### Canvas

Preferred preview ratio:

- 2:1

Recommended production sizes:

- GitHub social preview: 1280×640
- README header: 1600×800
- Wide transparent logo: export with flexible width
- SVG source: use vector reconstruction where possible

### Cube mark

The cube should be a true 2×2.

Current direction:

- Top face: blue
- Right face: green
- Left/front face: mixed colors, implying scrambled input
    - Yellow
    - White
    - Orange
    - Red
- Small square dissolve fragments to the left of the cube

This creates a visual story:

- Scrambled/disordered input on the left
- Ordered, solved faces on top/right
- Fragments dissolving away as the cube resolves

### Wordmark

Typography should feel:

- Technical
- Geometric
- Precise
- Nameplate-like
- Slightly monospaced or squared

Use uppercase for the strongest current direction:

`SOLVENT`

Recommended type characteristics:

- Wide tracking
- Squared terminals
- Chamfered or cut corners if available
- Clean sans or monospace sans
- No playful rounded type
- No script or display gimmicks

Approximate wordmark color:

- Off-white: `#F4F6F8`

### Tagline

Optional tagline:

`scan · verify · solve`

or uppercase:

`SCAN · VERIFY · SOLVE`

Preferred version for technical feel:
`SCAN · VERIFY · SOLVE`

Color treatment:

- SCAN — blue `#2B7FFF`
- VERIFY — green `#2EC27E`
- SOLVE — orange `#F2792B`
- Dot separators — off-white `#F4F6F8`

Tagline should be small, tracked out, and aligned beneath the wordmark.

### Layout rules

Recommended proportions:

- Cube mark: 22–28% of total lockup width
- Gap between mark and wordmark: 6–9% of total width
- Wordmark height: roughly 40–50% of cube height
- Tagline height: roughly 18–25% of wordmark height
- Tagline aligned to the left edge of the wordmark

The lockup should feel balanced, not like an icon pasted next to text.

### Iteration prompts

Use this when regenerating Direction 2:

> "Create a horizontal wordmark and mark for Solvent, a precise 2×2 cube solver. Use a dark slate background. On the left, show a true 2×2 cube in isometric view with exactly four cubies per visible face. The cube should show disorder resolving into order: one face mixed like a scanned scrambled cube, while the top and right faces are clean solved color faces. Add a few small square dissolve fragments near the cube. To the right, set SOLVENT in a clean technical geometric or monospace sans with wide tracking. Add a small tagline below: SCAN · VERIFY · SOLVE. Use off-white for the wordmark, with the tagline words in blue, green, and orange. Keep it flat, crisp, premium, and technical. No 3×3 cube, no shadows, no bevels, no cartoon styling."

### Common fixes

If the wordmark gets distorted:
> "Keep the wordmark simple and readable. Use clean geometric uppercase letters and do not stylize the letters beyond subtle technical cuts."

If the cube becomes too colorful:
> "Keep only one mixed face. Make the other visible faces solved and orderly. Do not make every cubie a different color."

If the logo feels too busy:
> "Reduce the number of dissolve fragments and remove unnecessary colors. Make the cube and wordmark feel more premium."

---

## Direction 3 — Minimal monogram

### Purpose

A compact "S" mark built from cube geometry.

This direction is optimized for:

- Favicon
- Small app badge
- CLI/tool icon
- Social avatar
- Embossed or monochrome brand use
- Minimal alternate mark

### Composition

Construct the letter S from modular square and rectangular cubie-like geometry.

The mark should hint at:

- 2×2 cube geometry
- A path from disorder to order
- Dissolving pixels
- Technical problem-solving

It should not become a literal full cube.

### Current visual direction

The current concept uses:

- A vertical blocky S
- Mostly off-white geometric segments
- Accent cubies in yellow, blue, green, and red
- Small square fragments dissolving from the top-left and bottom-right
- Dark negative-space gaps between block sections
- Chamfered cuts on some white segments

### Shape rules

The monogram should have:

- Strong silhouette
- Clear S readability at small sizes
- Modular cubie-like construction
- Controlled negative space
- A few accent squares embedded into the form
- Pixel fragments at one or both ends

The S should feel engineered, not handwritten.

### Color rules

Primary:

- Off-white structure: `#F4F6F8`

Accent options:

- Yellow near upper segment
- Blue near upper/mid-left segment
- Green near lower/mid-right segment
- Red near lower-left or dissolve fragment

For a more premium version, reduce to:

- Off-white
- Blue
- Green

or:

- Off-white
- Blue
- Orange

### Layout rules

The monogram should occupy roughly 45–60% of the square canvas height.

Keep generous negative space around it.

The dissolve fragments should not obscure the S.

Preferred fragment placement:

- A few small squares near the top-left entrance of the S
- A few small squares near the bottom-right exit of the S

### Iteration prompts

Use this when regenerating Direction 3:

> "Create a minimal monogram logo for Solvent. Build the letter S from crisp modular square and rectangular cube-like geometry, inspired by a 2×2 cube solver. Use a dark slate background. The S should be mostly off-white with a few restrained cube-color accent blocks. Add a subtle dissolve effect using small square fragments at the top-left and bottom-right ends. The mark should feel technical, premium, geometric, and highly legible at small sizes. Use strong negative space and flat vector shapes. No full 3×3 cube, no cartoon style, no shadows, no bevels, no glow."

### Common fixes

If the S is hard to read:
> "Make the S silhouette clearer and reduce the number of accent blocks. Prioritize letter readability over cube detail."

If it looks too much like random blocks:
> "Use stronger continuous white segments so the S reads as one constructed letter."

If it feels too colorful:
> "Limit the palette to off-white plus two accents."

---

## Export requirements

### Concept previews

Generate previews on dark slate background.

Recommended:

- Direction 1: 1024×1024 or 512×512
- Direction 2: 1280×640
- Direction 3: 1024×1024 or 512×512

### Production exports

For selected marks, produce:

- SVG
- PNG with transparent background
- PNG on dark slate background
- Square app icon
- Wide lockup
- Monochrome version
- Small-size favicon version

### Transparent export guidance

When exporting transparent PNGs:

- Remove the dark slate background.
- Preserve internal dark separators only if they are part of the mark.
- Make sure dark cubie gaps do not disappear on dark UI backgrounds.
- Consider a light-background variant where separators use dark slate.

### SVG reconstruction guidance

Because generated raster logos may not be true vector art, recreate the chosen direction in Figma, Illustrator, or code as SVG.

Use:

- Rectangles
- Polygon faces
- Simple square fragments
- Consistent spacing
- Exact palette values
- No raster effects

---

## Design QA checklist

Before accepting an iteration, verify:

- The cube is a true 2×2, not a 3×3.
- Each visible cube face has exactly four cubies.
- The dissolve effect uses square fragments, not random particles.
- The logo still works at small sizes.
- The color usage is restrained.
- The mark feels technical and precise.
- The wordmark is readable.
- The dark background is `#12151A`.
- No drop shadows, bevels, generic glow, or cartoon treatment are present.
- The design communicates solving/resolution, not just a generic cube.

---

## Recommended next iteration path

Start with Direction 2 as the primary brand lockup because it currently has the clearest complete identity system: cube mark, wordmark, and tagline.

Then create derivative versions:

1. Extract the cube mark from Direction 2 as a square icon.
2. Simplify the Direction 1 icon using the Direction 2 cube proportions.
3. Refine Direction 3 into a compact monogram/favicon.
4. Build a final SVG system with:
    - Primary horizontal lockup
    - Icon-only mark
    - Monogram mark
    - Single-color variant
    - Dark-background and transparent-background versions

---

## Asset inventory (current)

The following raster concepts are checked into [`assets/`](./assets/) and used by the app:

| File | Direction | Used for |
| --- | --- | --- |
| `assets/solvent-wordmark.png` | Direction 2 — wordmark + mark | README header, app header, social preview |
| `assets/solvent-icon.png` | Direction 1 — icon-first mark | App tile, apple-touch-icon, OG image |
| `assets/solvent-monogram.png` | Direction 3 — minimal monogram | Favicon, small badge |

The palette above is mirrored exactly in the app's CSS custom properties (`--c-white`, `--c-yellow`, `--c-green`, `--c-blue`, `--c-red`, `--c-orange`, and `--slate`) so the product surface and the brand marks stay in lockstep.
