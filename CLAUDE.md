# overview-enhanced-revealjs

A Quarto RevealJS plugin that adds mouse-wheel and touch navigation to RevealJS overview mode, with FLIP zoom animations when entering and leaving the overview, and thumbnail centering that matches presentation mode.

## Repository layout

```
_extensions/overview-enhanced/
  _extension.yml                  # Quarto extension manifest
  OverviewEnhanced/
    overview-enhanced.js          # All plugin logic (single file, ~490 lines)
example.qmd                       # Live demo document (quarto render to rebuild)
example.html                      # Pre-rendered demo (also update example_files copy)
README.md                         # Public documentation
```

The entire plugin is `overview-enhanced.js`. There is no build step.

**Important**: `example.html` bundles a copy of the plugin at
`example_files/libs/revealjs/plugin/overview-enhanced/overview-enhanced.js`.
After editing the source in `_extensions/`, always copy it there too:
```
cp _extensions/overview-enhanced/OverviewEnhanced/overview-enhanced.js \
   example_files/libs/revealjs/plugin/overview-enhanced/overview-enhanced.js
```

## How the plugin works

### Overview navigation

RevealJS's built-in overview mode (`O` key) shows all slides as a scrollable grid. The plugin intercepts `wheel` and `touch` events on that grid and translates them into `deck.navigateRight/Left/Up/Down()` calls. Gesture processing lives in `processDeltas()`:

- **Axis locking**: once the magnitude exceeds `AXIS_LOCK_MIN` px, the gesture commits to horizontal or vertical for its duration. The lock resets after `decayMs` ms of inactivity.
- **Velocity boost**: each wheel event computes `mag/dt` and scales delta by up to `1 + maxBoost`. This lets fast flings skip multiple slides.
- **Per-axis cooldowns**: `lastNavX` and `lastNavY` are independent, so a horizontal scroll does not block a subsequent vertical one.

### Thumbnail centering (`savedTops` / `applyTopsAsPadding`)

**Problem**: RevealJS vertically centers slide content via `top: Npx` inline styles on each `<section>` (e.g. `top: 287px` for a sparse section title). When entering overview mode, RevealJS resets all these to `top: 0px !important` via a CSS rule that cannot be overridden by inline styles. Thumbnails then show all content at the top of the cell.

**Solution**: Capture each section's `top` value in presentation mode and re-apply it as `padding-top` in overview mode. `padding-top` is not overridden by the RevealJS overview CSS.

Key facts discovered through investigation:
- RevealJS computes and sets `top` for **all** non-stack sections at `ready` time, not just the current slide. E.g. Column title sections (level1) get `top: 287px` even when they are `future` slides.
- Level2 content slides that are `future` at ready time have an **empty** `top` inline style (not even `0px`). Their `top` is only computed when they become active (after `slidechanged`).
- The `savedTops` WeakMap stores only non-empty, non-`0px` values. Empty means "not yet computed" and falls through to the fallback.

**Fallback for unvisited slides**: `applyTopsAsPadding` estimates centering for level2 content slides whose `top` is not yet known by summing `child.offsetHeight + marginTop + marginBottom` for all children and computing `(slideH - contentH) / 2`. `offsetHeight` is unaffected by CSS transforms so this correctly reads full-size layout dimensions even in scaled overview mode.

**`saveTops` is called at**:
- `deck.on('ready')` — captures all section tops that RevealJS has computed at startup (level1 sections and the title slide)
- `deck.on('resize')` — recaptures in case RevealJS recomputes centering
- `deck.on('slidechanged')` — accumulates tops for level2 slides as the user navigates
- `keydown 'o'` (capture phase) — captures before RevealJS adds the `overview` class and resets tops

**`applyTopsAsPadding`** runs in `overviewshown` before `zoomOut()`. It sets `padding-top` on each non-stack section using `savedTops` if available, otherwise the fallback estimate.

**`clearPaddingTops`** runs in `doZoomIn`'s timer callback and the `overviewhidden` fallback timer, just before `toggleOverview(false)` or after the animation completes, so padding never leaks into presentation mode.

### FLIP zoom animations

When entering and leaving overview mode the plugin animates `.reveal` (the root RevealJS element) using the FLIP technique. `.reveal` has no transform in its resting state in either mode, so identity is always the animation target.

#### Zoom-out (entering overview)

Fired from `overviewshown`. The slide was just full-screen; now it is a thumbnail in the grid.

1. `captureThumb()` records `thumbRect` — the thumbnail's screen rect — while the overview layout is active.
2. A start transform is computed that makes `.reveal` look as if the thumbnail is still full-screen (presentation-area size, centered in viewport).
3. `applyFlip(startTransform)` sets the transform instantly (no transition), flushes, then animates to identity over `zoomOutMs`.

#### Zoom-in (leaving overview)

Fired by `doZoomIn()`, called from O/Escape keydown and click handlers.

The approach is **forward animation**, not a reverse FLIP. The overview grid must stay visible for the full duration so the grid is only replaced by the presentation view when the animation completes.

1. `.reveal` is reset to identity and flushed so `captureThumb()` reads accurate rects.
2. A `zoomEndTransform` is computed: the transform that maps the thumbnail's position to the presentation area (same math as the zoom-out start state).
3. `.reveal` is animated from identity to `zoomEndTransform` over `zoomInMs`.
4. At the end of the timer, `.reveal` is cleared and `deck.toggleOverview(false)` is called in the same task — no intermediate paint, seamless swap.

#### Fallback (`overviewhidden`)

If `toggleOverview(false)` is called externally (not via `doZoomIn`), the `overviewhidden` event fires. The plugin runs the same animation as zoom-in but in reverse: it sets `.reveal` to `zoomEndTransform` as the start state and animates to identity. This uses the same translate+scale math so the trajectory is geometrically identical.

### Presentation area math

RevealJS letterboxes slides: the actual rendered slide is smaller than the viewport by `margin` on each side. All transform math must target the **presentation area**, not the full viewport, or the animation overshoots.

```js
var margin      = revealCfg.margin != null ? revealCfg.margin : 0.1; // Quarto default
var revealScale = Math.min(vw / (slideW * (1 + 2 * margin)),
                           vh / (slideH * (1 + 2 * margin)));
var presentW    = slideW * revealScale;
var presentH    = slideH * revealScale;
var presentX    = (vw - presentW) / 2;
var presentY    = (vh - presentH) / 2;
```

The transform that maps a thumbnail at `thumbRect` to the presentation area (with `transform-origin: 0 0`):

```js
var sx = presentW / thumbRect.width;
var sy = presentH / thumbRect.height;
var tx = presentX - thumbRect.left * sx;
var ty = presentY - thumbRect.top  * sy;
// 'translate(tx px, ty px) scale(sx, sy)'
```

This same formula appears in `zoomOut`, `doZoomIn`, and the `overviewhidden` fallback. They must stay in sync.

## Key state variables and their invariants

| Variable | Type | Invariant |
|---|---|---|
| `savedTops` | `WeakMap<section, string>` | Maps section elements to their presentation-mode `top` value. Only stores non-empty, non-`0px` values. Guard: `saveTops` early-returns when `deck.isOverview()` is true. |
| `thumbRect` | `DOMRect\|null` | Valid thumbnail rect captured while `.reveal` was at identity in overview mode. Nulled out in `doZoomIn()` error path to suppress the fallback animation. |
| `exitingOverview` | `bool` | `true` only while `doZoomIn()`'s `flipTimer` is pending. Suppresses the `overviewhidden` fallback. Must be cleared before any early return in `doZoomIn()`. |
| `flipInProgress` | `bool` | `true` while `applyFlip()`'s timer is pending. Guards `captureThumb()` in `slidechanged` — thumb rects are distorted while `.reveal` has an active transform. Must be reset whenever `flipTimer` is cancelled externally. |
| `flipTimer` | `timeout\|null` | Single shared timer for all `.reveal` animations. Always `clearTimeout` before setting. `doZoomIn()` and the `overviewhidden` fallback both clear `flipInProgress` when they cancel it. |
| `clickTimer` | `timeout\|null` | Pending `doZoomIn()` call after a non-current-slide click. Cancelled in `overviewshown`, keydown, and on all click paths. |

## Critical correctness rules

- **`captureThumb()` requires `.reveal` at identity.** Always clear `revealEl.style.transform = ''` and flush (`revealEl.offsetHeight`) before calling it. Never call it in `slidechanged` when `flipInProgress` is true.
- **`doZoomIn()` must reset `flipInProgress = false`** when it cancels `flipTimer` at the top. If it doesn't, the flag stays `true` permanently and `slidechanged` stops updating `thumbRect`.
- **The `overviewhidden` fallback must also reset `flipInProgress = false`** when it cancels `flipTimer`, for the same reason.
- **The error path in `doZoomIn()`** (bad rect) must: null `thumbRect`, clear `transformOrigin`, reset `exitingOverview`, then call `toggleOverview(false)`. Nulling `thumbRect` suppresses the fallback; clearing `transformOrigin` prevents it leaking into presentation mode.
- **`e.preventDefault()` and `e.stopPropagation()`** in the click handler must be called before any early returns, otherwise RevealJS's own click handler processes the event and exits overview without our animation.
- **`margin` must be included** in all `revealScale` calculations. Omitting it makes `presentW/presentH` ~20% too large, causing a visible overshoot at the end of zoom-in.
- **`clearPaddingTops()` must be called** before exiting overview (both in `doZoomIn` timer and `overviewhidden` fallback timer). If padding leaks into presentation mode, RevealJS's layout is disrupted.
- **`saveTops` must guard `deck.isOverview()`**. In overview mode all tops are `0px` (CSS rule), so saving them would wipe out the real values from presentation mode. The `slidechanged` event fires in overview too (when scrolling through slides), so the guard is essential.

## Event listener design

All listeners are on `document` and never removed (single-page lifecycle). Keyboard and click listeners use the **capture phase** (`true` as third argument) so they intercept events before RevealJS's own handlers and can call `e.stopPropagation()` to prevent double-handling.

The wheel listener calls `e.preventDefault()` (requires `passive: false`) to suppress native page scroll while in overview.

## Testing with the example

```bash
# Serve locally (run from repo root)
python3 -m http.server 8765
# Then navigate to http://localhost:8765/example.html
```

The example.html has the script URL versioned (`?v=N`) to bust browser cache during development. Increment `N` in the `<script>` tag after any plugin change, or use a new query string on the page URL.
