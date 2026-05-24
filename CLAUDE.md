# overview-scroll-revealjs

A Quarto RevealJS plugin that adds mouse-wheel and touch navigation to RevealJS overview mode, with FLIP zoom animations when entering and leaving the overview.

## Repository layout

```
_extensions/overview-scroll/
  _extension.yml               # Quarto extension manifest
  OverviewScroll/
    overview-scroll.js         # All plugin logic (single file, ~395 lines)
example.qmd                    # Live demo document
README.md                      # Public documentation
```

The entire plugin is `overview-scroll.js`. There is no build step.

## How the plugin works

### Overview navigation

RevealJS's built-in overview mode (`O` key) shows all slides as a scrollable grid. The plugin intercepts `wheel` and `touch` events on that grid and translates them into `deck.navigateRight/Left/Up/Down()` calls. Gesture processing lives in `processDeltas()`:

- **Axis locking**: once the magnitude exceeds `AXIS_LOCK_MIN` px, the gesture commits to horizontal or vertical for its duration. The lock resets after `decayMs` ms of inactivity.
- **Velocity boost**: each wheel event computes `mag/dt` and scales delta by up to `1 + maxBoost`. This lets fast flings skip multiple slides.
- **Per-axis cooldowns**: `lastNavX` and `lastNavY` are independent, so a horizontal scroll does not block a subsequent vertical one.

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
2. A `zoomEndTransform` is computed: the transform that maps the thumbnail's position to the presentation area (same math as the zoom-out start state — see below).
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

## Event listener design

All listeners are on `document` and never removed (single-page lifecycle). Keyboard and click listeners use the **capture phase** (`true` as third argument) so they intercept events before RevealJS's own handlers and can call `e.stopPropagation()` to prevent double-handling.

The wheel listener calls `e.preventDefault()` (requires `passive: false`) to suppress native page scroll while in overview.
