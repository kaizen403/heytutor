# Handwriting Stroke Animation Plan

## Problem

Text on the whiteboard appears to "reveal" or "grow" from one side instead of being written stroke-by-stroke like a teacher. The cursor traces the glyph's outline boundary instead of following natural pen motion. Math notation (a squared, a cubed, a times b, area equals length times width) must be written out like a teacher handwriting on a board — not fading in.

## Root Cause

`opentype.js` `getPath()` returns **outline paths** (the filled-shape boundary of each letter), not **stroke paths** (the pen's writing motion). The function `textToStrokePaths` in `lib/handwriting.ts` is misnamed — it produces outline contours.

The current `writeText` pipeline:
1. `font.getPath(char)` -> outline path (closed boundary loop around glyph silhouette)
2. `Konva.Path` with `fillEnabled: false`, `stroke: ink`, `strokeWidth: 2.5`
3. Dash-offset animation: `dash([totalLength])`, `dashOffset(totalLength -> 0)`
4. Cursor follows `getPointAtLength(drawnLength)` — a point traveling along the boundary edge

For a letter like "O": the pen traces the outer circle, then jumps to the inner circle. For "t": the pen traces the entire shape boundary in one closed loop. This looks like the letter is being "filled in" or "materializing", not written.

**Contrast with shapes**: `shapePaths.ts` generates genuine stroke paths (pen motion). The same dash-offset technique on stroke paths looks correct. The rendering machinery is sound; only the path data source is wrong.

**Confirmed by opentype.js maintainers** (issue #71): fonts store outlines, not centerlines. There is no API to extract stroke data from a standard font.

---

## Solution: Tegaki

Tegaki skeletonizes font glyphs into pen-motion stroke polylines with natural stroke order, variable width, and timing data.

### Tegaki Package Details

| Property | Value |
|----------|-------|
| npm package | `tegaki` |
| License | MIT |
| Runtime dependencies | Zero |
| Built-in Caveat font | `tegaki/fonts/caveat` (pre-built stroke bundle) |
| Konva integration | Use `drawGlyph` from `tegaki/core` on Konva canvas context, or build `Konva.Path` from stroke polylines |
| Custom fonts | Any TTF/OTF via generator CLI or web UI |
| Framework adapters | React, Svelte, Vue, Solid, Astro, Web Components |

### Stroke Data Format (from Tegaki)

Each glyph in the bundle contains ordered strokes:

```typescript
interface TegakiGlyphData {
  w: number;  // advance width (font units)
  t: number;  // total animation duration (seconds)
  s: {
    p: [number, number, number][];  // [x, y, width] polyline points in font units
    d: number;  // delay before stroke starts (seconds)
    a: number;  // animation duration of stroke (seconds)
    r?: number; // priority (0 = body, -1 = dot)
  }[];
}
```

Example — character 't' from Caveat bundle:
- Stroke 1: 2 points, delay=0s, duration=0.007s (short tick)
- Stroke 2: 31 points, delay=0.157s, duration=0.403s (cross + stem)
- Total: 0.56s

The gap between stroke 1 finishing and stroke 2 starting (0.157s) is the pen-up/pen-down transition.

### Coordinate System

- All coordinates are in **font units** (not pixels)
- Scale by `fontSize / unitsPerEm` to get CSS pixels
- Y-axis is **font-up** (y increases upward, negative y = above baseline)
- Flip to canvas-down: `py = oy + (y + ascender) * scale`
- Width is **stroke diameter** in font units (not radius)

---

## Architecture

```
BUILD TIME (one-time)
┌──────────────────────────────────────────────────────────┐
│  tegaki/fonts/caveat (pre-built bundle, npm)             │
│  OR generate custom bundle via tegaki generator CLI      │
│                                                          │
│  Bundle contains per-glyph:                              │
│    - ordered stroke polylines [[x, y, width], ...]       │
│    - per-stroke delay + duration                         │
│    - stroke priority (body vs dot)                       │
└──────────────────────────────────────────────────────────┘
                        │
                        ▼
RUNTIME (Konva canvas)
┌──────────────────────────────────────────────────────────┐
│  writeText(text, x, y, duration)                         │
│                                                          │
│  For each character:                                     │
│    1. Look up TegakiGlyphData from bundle                │
│    2. Convert stroke polylines to SVG path data           │
│    3. For each stroke (ordered):                         │
│       a. flyCursorTo(stroke start)                       │
│       b. Create Konva.Path with stroke path data         │
│       c. Dash-offset animate (existing technique)         │
│       d. Cursor follows getPointAtLength                 │
│       e. Apply variable strokeWidth from bundle data     │
│    4. Brief pen-up pause between strokes (delay field)   │
│    5. Advance x by glyph advance width                   │
│    6. Move to next character                             │
│                                                          │
│  Fallback: Konva.Text opacity fade for missing glyphs    │
└──────────────────────────────────────────────────────────┘
```

### What Changes vs What Stays

**STAYS (rendering machinery is sound)**:
- `Whiteboard.writeText` dash-offset animation loop (Konva.Path + dash + dashOffset)
- `Whiteboard.flyCursorTo` bezier arc cursor flight
- `Whiteboard.drawShape` (already works for shapes)
- Cursor-follows-`getPointAtLength` logic
- Layer promotion pattern (animLayer -> drawLayer on completion)
- `executeCommand` in page.tsx (calls writeText)
- TTS sync coordination (onStart triggers drawing)
- `runSegment` per-segment barrier sync

**CHANGES**:
- `lib/handwriting.ts` — replace opentype.js with Tegaki bundle lookup. Return ordered stroke polylines per character instead of outline paths.
- `components/Whiteboard.tsx` `writeText` — handle multiple ordered strokes per character. Add pen-up cursor movement between strokes.
- `package.json` — add `tegaki` dependency, remove `opentype.js` (no longer needed at runtime)

**NO CHANGE NEEDED**:
- `app/page.tsx` — calls `wb.writeText` the same way
- `lib/incrementalParser.ts` — parsing unaffected
- `lib/drawingProtocol.ts` — command structure unaffected
- `lib/audioSync.ts` — duration calculations unaffected
- `lib/elevenLabsClient.ts` — TTS unaffected
- `lib/createTTSClient.ts` — unaffected
- `lib/sentenceChunker.ts` — unaffected (already not imported after sync fix)
- `lib/shapePaths.ts` — shapes already work correctly

---

## File-by-File Changes

### Step 1: Install Tegaki

```bash
pnpm add tegaki
```

This gives us:
- `tegaki/core` — `drawGlyph`, `computeTimeline`, `lookupGlyphData`, `createBundle`, types
- `tegaki/fonts/caveat` — pre-built Caveat stroke bundle (same font, now with stroke data)

No need to generate a custom bundle — Caveat is already a built-in font in Tegaki.

### Step 2: Rewrite `lib/handwriting.ts`

**Current** (broken — returns outline paths via opentype.js):

```typescript
import * as opentype from "opentype.js";

export interface CharacterPath {
  char: string;
  pathData: string;  // OUTLINE path (the problem)
  x: number;
  y: number;
  width: number;
}

export async function textToStrokePaths(text, x, y, fontSize): Promise<CharacterPath[]>
```

**New** (stroke polylines via Tegaki):

```typescript
import caveatBundle from "tegaki/fonts/caveat";
import type { TegakiBundle, TegakiGlyphData } from "tegaki/core";

export interface StrokePath {
  pathData: string;              // SVG path: "M x y L x y L x y..."
  startX: number;                // first point x (canvas coords)
  startY: number;                // first point y (canvas coords)
  width: number;                 // average stroke width (canvas units)
  delay: number;                 // seconds before this stroke starts
  duration: number;              // seconds to animate this stroke
  priority: number;              // 0 = body, -1 = dot
}

export interface CharacterPath {
  char: string;
  strokes: StrokePath[];         // ordered strokes (was: single pathData string)
  x: number;
  y: number;
  width: number;                 // advance width (canvas units)
}

let bundleCache: TegakiBundle | null = null;

function getBundle(): TegakiBundle {
  if (!bundleCache) {
    bundleCache = caveatBundle as unknown as TegakiBundle;
  }
  return bundleCache;
}

function polylineToSVGPath(
  points: [number, number, number][],
  scaleX: number,
  scaleY: number,
  offsetX: number,
  offsetY: number,
): string {
  return points
    .map(([px, py], i) => {
      const x = offsetX + px * scaleX;
      const y = offsetY + py * scaleY;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export async function textToStrokePaths(
  text: string,
  x: number,
  y: number,
  fontSize: number,
): Promise<CharacterPath[]> {
  const bundle = getBundle();
  const scale = fontSize / bundle.unitsPerEm;
  const ascender = bundle.ascender;

  const results: CharacterPath[] = [];
  let currentX = x;

  for (const char of text) {
    if (char === " ") {
      currentX += fontSize * 0.3;
      continue;
    }

    const glyph = bundle.glyphData[char];

    if (!glyph) {
      // Missing glyph — return marker for fallback
      results.push({
        char,
        strokes: [],
        x: currentX,
        y,
        width: fontSize * 0.5,
      });
      currentX += fontSize * 0.5;
      continue;
    }

    const advanceWidth = glyph.w * scale;
    const baselineY = y + ascender * scale;

    const strokes: StrokePath[] = glyph.s.map((s) => {
      const points = s.p as [number, number, number][];
      const widths = points.map((p) => p[2] * scale);
      const avgWidth = widths.reduce((a, b) => a + b, 0) / Math.max(widths.length, 1);

      const pathData = polylineToSVGPath(
        points,
        scale,
        -scale,  // flip Y (font-up to canvas-down)
        currentX,
        baselineY,
      );

      const firstPoint = points[0];
      const startX = currentX + firstPoint[0] * scale;
      const startY = baselineY - firstPoint[1] * scale;

      return {
        pathData,
        startX,
        startY,
        width: Math.max(avgWidth, 1.5),
        delay: s.d,
        duration: s.a,
        priority: s.r ?? 0,
      };
    });

    results.push({
      char,
      strokes,
      x: currentX,
      y,
      width: advanceWidth,
    });

    currentX += advanceWidth;
  }

  return results;
}

// Remove: loadHandwritingFont, animateHandwriting, opentype.js import
// Remove: HandwritingFont, HandwritingOptions interfaces
```

**Key changes**:
- Import `tegaki/fonts/caveat` instead of parsing Caveat.ttf with opentype.js
- Each `CharacterPath` now has `strokes: StrokePath[]` (multiple ordered strokes) instead of single `pathData: string`
- `StrokePath` includes `startX`/`startY` (for cursor flight), `width` (variable stroke width), `delay`/`duration` (timing from Tegaki), `priority` (body vs dot)
- Polyline-to-SVG-path conversion: `M x y L x y L x y...` (simple polyline, no curves)
- Y-axis flip: `y * -scale` (font-up to canvas-down) + `baselineY` offset using `ascender`
- Missing glyphs return empty strokes array (Whiteboard handles fallback per-character)

### Step 3: Modify `components/Whiteboard.tsx` `writeText`

**Current** (one path per char, no pen-up):

```typescript
async writeText(text, x, y, duration) {
  const charPaths = await textToStrokePaths(text, x, y, 32);
  for (const charPath of charPaths) {
    const pathData = charPath.pathData;  // single outline path
    const charPath = new Konva.Path({ data: pathData, ... });
    // dash-offset animate
    // cursor follows getPointAtLength
  }
}
```

**New** (multiple ordered strokes per char, pen-up between strokes):

```typescript
async writeText(text, x, y, duration) {
  const charPaths = await textToStrokePaths(text, x, y, 32);
  const totalStrokes = charPaths.reduce((sum, cp) => sum + cp.strokes.length, 0);
  const perStrokeDuration = duration / Math.max(totalStrokes, 1);

  for (const charPath of charPaths) {
    if (cancelRef.current) return;

    // Fallback: no stroke data for this glyph -> Konva.Text opacity fade
    if (charPath.strokes.length === 0) {
      const textNode = new Konva.Text({
        text: charPath.char,
        x: charPath.x,
        y: charPath.y,
        fontSize: 32,
        fontFamily: "Caveat, cursive",
        fill: INK_COLOR,
        opacity: 0,
      });
      animLayerRef.current.add(textNode);
      // animate opacity 0 -> 1 over perStrokeDuration
      // ... (existing fallback code)
      continue;
    }

    for (const stroke of charPath.strokes) {
      if (cancelRef.current) return;

      // Pen-up: fly cursor to start of this stroke
      await flyCursorTo(stroke.startX, stroke.startY, 150);
      if (cancelRef.current) return;

      // Create Konva.Path for this stroke
      const pathNode = new Konva.Path({
        data: stroke.pathData,
        stroke: INK_COLOR,
        strokeWidth: stroke.width,
        fillEnabled: false,
        lineCap: "round",
        lineJoin: "round",
      });
      animLayerRef.current.add(pathNode);

      const totalLength = pathNode.getLength();
      pathNode.dash([totalLength]);
      pathNode.dashOffset(totalLength);

      const strokeDuration = stroke.duration > 0
        ? stroke.duration * 1000  // use Tegaki's timing
        : perStrokeDuration;       // fallback to even distribution

      // Dash-offset animation (same technique as existing)
      await new Promise<void>((resolve) => {
        const startTime = performance.now();
        const animateFrame = () => {
          if (cancelRef.current) {
            pathNode.destroy();
            resolve();
            return;
          }
          const elapsed = performance.now() - startTime;
          const progress = Math.min(elapsed / strokeDuration, 1);
          const drawnLength = progress * totalLength;
          pathNode.dashOffset(totalLength - drawnLength);

          // Cursor follows the pen motion
          const point = pathNode.getPointAtLength(drawnLength);
          if (point) {
            updateCursor(point.x, point.y);
          }

          if (progress < 1) {
            requestAnimationFrame(animateFrame);
          } else {
            pathNode.dash([]);
            // Move completed stroke to permanent layer
            pathNode.moveTo(drawLayerRef.current);
            resolve();
          }
        };
        requestAnimationFrame(animateFrame);
      });

      // Pen-up pause between strokes (use Tegaki delay or default)
      if (stroke.delay > 0) {
        await new Promise((r) => setTimeout(r, stroke.delay * 1000));
      }
    }
  }
}
```

**Key changes**:
- Outer loop: iterate `charPaths` (same)
- New inner loop: iterate `charPath.strokes` (multiple per char)
- Before each stroke: `flyCursorTo(stroke.startX, stroke.startY, 150)` — pen-up cursor flight to stroke start
- Per stroke: `Konva.Path` with stroke polyline data (pen motion, not outline)
- `strokeWidth` set from Tegaki's per-stroke width data (variable width)
- `strokeDuration` from Tegaki's `duration` field (natural timing) or fallback to even distribution
- Between strokes: `setTimeout(stroke.delay)` — pen-up pause from Tegaki's delay field
- Fallback: `Konva.Text` opacity fade per-character (not per-word) when glyph missing from bundle
- Existing `flyCursorTo`, `updateCursor`, layer promotion, animation cleanup — all unchanged

### Step 4: Remove opentype.js dependency

```bash
pnpm remove opentype.js
```

Remove from `package.json`. The `public/fonts/Caveat.ttf` file can stay (used by CSS `@font-face` for any text rendering) but is no longer parsed at runtime.

### Step 5: Verify math notation coverage

Tegaki's built-in Caveat bundle covers Latin characters. Check coverage for:

| Character | Unicode | In Caveat bundle? | Action |
|-----------|---------|-------------------|--------|
| a-z, A-Z | U+0061-007A, U+0041-005A | Yes | Direct stroke data |
| 0-9 | U+0030-0039 | Yes | Direct stroke data |
| = | U+003D | Yes | Direct stroke data |
| + | U+002B | Yes | Direct stroke data |
| - | U+002D | Yes | Direct stroke data |
| ( ) | U+0028, U+0029 | Yes | Direct stroke data |
| x (multiply) | U+00D7 | Check bundle | Fallback to Konva.Text if missing |
| / (divide) | U+002F | Yes | Direct stroke data |
| ^ | U+005E | Check bundle | Fallback if missing |
| squared (²) | U+00B2 | Check bundle | Fallback if missing |
| cubed (³) | U+00B3 | Check bundle | Fallback if missing |
| square root (√) | U+221A | Unlikely | Fallback to Konva.Text |
| pi (π) | U+03C0 | Unlikely | Fallback to Konva.Text |

For missing glyphs, the per-character `Konva.Text` fallback in `writeText` handles it gracefully — the character fades in while others are stroke-animated.

If broader coverage is needed later, generate a custom bundle with the Tegaki generator CLI:
```bash
# Clone tegaki repo, run generator with custom character set
bunx tegaki generate "Caveat" --chars "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789=+-*/^()²³√π×÷" --output ./custom-caveat
```

Or use the web UI at `https://gkurt.com/tegaki/generator/`.

---

## Implementation Phases

### Phase 1: Core Stroke Rendering (MVP)

| Step | File | What | Effort |
|------|------|------|--------|
| 1 | `package.json` | `pnpm add tegaki` | 1 min |
| 2 | `lib/handwriting.ts` | Full rewrite — replace opentype.js with Tegaki bundle lookup. New `CharacterPath` interface with `strokes: StrokePath[]`. Polyline-to-SVG-path conversion. Y-axis flip. Missing glyph handling. | ~30 min |
| 3 | `components/Whiteboard.tsx` | Rewrite `writeText` — inner stroke loop, pen-up cursor flight, per-stroke Konva.Path, variable strokeWidth, Tegaki timing, per-character fallback. | ~45 min |
| 4 | `package.json` | `pnpm remove opentype.js` | 1 min |
| 5 | Verify | Test with math questions (cuboid, rectangle, circle). Check stroke animation looks like handwriting. Check cursor follows pen motion. Check fallback for missing glyphs. | ~15 min |

### Phase 2: Polish

| Area | File | What |
|------|------|------|
| Variable stroke width | `Whiteboard.tsx` | Use Tegaki's per-point width data to vary strokeWidth along the path (draw segments with different widths, or use Konva custom sceneFunc for smooth width gradient) |
| Pen-up speed | `Whiteboard.tsx` | Make flyCursorTo between strokes faster (100ms) than writing speed — teachers lift pen quickly |
| Dot deferral | `Whiteboard.tsx` | Strokes with `priority: -1` (i-dots, t-cross) should be deferred to after all body strokes in the word, per Tegaki's timeline scheduler |
| Stroke timing | `Whiteboard.tsx` | Use Tegaki's per-stroke `duration` and `delay` fields for natural pacing instead of even distribution |
| Smooth curves | `lib/handwriting.ts` | Convert polylines to smooth bezier paths using Catmull-Rom spline through the points (Tegaki has `subdivideStroke` with smoothing option) |

### Phase 3: Advanced

| Area | What |
|------|------|
| Custom bundle | Generate Caveat bundle with extended character set (math symbols, superscripts) via Tegaki generator CLI |
| Tegaki drawGlyph | Instead of building Konva.Path from polylines, use `drawGlyph` from `tegaki/core` directly on Konva's canvas context inside a `Konva.Shape` sceneFunc — gives Tegaki's full rendering (subdivision, effects, pressure width) |
| Effects | Use Tegaki's effects API (glow, wobble, pressureWidth, taper, gradient) for richer pen visual |
| Roughjs texture | Optionally render strokes with roughjs for a sketchy pen texture (revive dead `strokeAnimation.ts`) |

---

## Expected Visual Result

**Before** (current): Letters appear to "grow" or "fill in" from an arbitrary starting point on their outline. Cursor traces the glyph boundary edge. Looks like a shape being revealed, not written.

**After** (with Tegaki):
- Cursor flies to the start of the first stroke of a character
- Pen moves along the natural writing motion (down-stroke of "t", then cross-stroke)
- Variable stroke width (thicker on down-strokes, thinner on up-strokes)
- Brief pen-up lift between strokes (cursor flies to next stroke start)
- Dots on "i" and "j" deferred to after body strokes
- Moves to next character
- Looks like a teacher handwriting on a whiteboard
- Missing glyphs (rare math symbols) gracefully fade in via Konva.Text fallback

---

## Technical Details

### Tegaki API Reference (used in this plan)

```typescript
// Import the pre-built Caveat stroke bundle
import caveatBundle from "tegaki/fonts/caveat";

// Types from tegaki/core
import type { TegakiBundle, TegakiGlyphData } from "tegaki/core";

// Bundle structure
interface TegakiBundle {
  family: string;
  lineCap: "round" | "butt" | "square";
  fontUrl: string;
  unitsPerEm: number;      // e.g. 1000
  ascender: number;        // font units
  descender: number;       // font units (negative)
  glyphData: Record<string, TegakiGlyphData>;  // keyed by character
}

// Per-glyph stroke data
interface TegakiGlyphData {
  w: number;  // advance width (font units)
  t: number;  // total animation duration (seconds)
  s: {
    p: [number, number, number][];  // [x, y, width] in font units
    d: number;  // delay before stroke (seconds)
    a: number;  // animation duration (seconds)
    r?: number; // priority (0=body, -1=dot)
  }[];
}

// Coordinate conversion
const scale = fontSize / bundle.unitsPerEm;
const canvasX = offsetX + fontX * scale;
const canvasY = offsetY + (fontY + bundle.ascender) * scale;  // flip Y

// Polyline to SVG path
function toPathData(points: [number, number, number][]): string {
  return points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`)
    .join(" ");
}
```

### Alternative: `drawGlyph` on Konva canvas context

For Phase 3, instead of building `Konva.Path` from polylines, use Tegaki's built-in renderer:

```typescript
import { drawGlyph, computeTimeline } from "tegaki/core";

// Inside a Konva.Shape sceneFunc:
const ctx = layer.getCanvas().getContext();
const timeline = computeTimeline(text, bundle);

for (const entry of timeline.entries) {
  const glyph = bundle.glyphData[entry.char];
  if (!glyph) continue;
  const localTime = currentTime - entry.offset;
  drawGlyph(
    ctx,
    glyph,
    {
      x: entry.x * fontSize,
      y: entry.y * fontSize,
      fontSize,
      unitsPerEm: bundle.unitsPerEm,
      ascender: bundle.ascender,
      descender: bundle.descender,
    },
    localTime,
    bundle.lineCap,
    INK_COLOR,
    [],  // effects
  );
}
```

This gives Tegaki's full rendering quality (subdivision, variable width, effects) but requires managing the animation loop differently (a single `Konva.Shape` that redraws every frame via `sceneFunc`, instead of individual `Konva.Path` nodes per stroke).

---

## Research Sources

- Tegaki repo: https://github.com/KurtGokhan/tegaki (commit 68ee58f)
  - MIT license, zero runtime dependencies
  - Pre-built Caveat bundle: `tegaki/fonts/caveat`
  - `drawGlyph` function: `packages/renderer/src/lib/drawGlyph.ts`
  - Stroke data types: `packages/renderer/src/types.ts`
  - Generator pipeline: flatten -> rasterize -> skeletonize -> trace -> width -> order
- opentype.js issue #71: https://github.com/opentypejs/opentype.js/issues/71
  - Confirmed: fonts store outlines, not centerlines
- Tegaki npm: https://www.npmjs.com/package/tegaki
  - Package: `tegaki` with subpath exports (`tegaki/core`, `tegaki/react`, `tegaki/fonts/caveat`)
