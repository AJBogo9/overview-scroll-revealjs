var OverviewScroll = (function () {
  var DEFAULTS = {
    threshold:     60,   // accumulated px to trigger one slide navigation
    velocityScale: 0.3,  // how much scroll speed amplifies delta
    maxBoost:      4,    // cap on velocity boost (multiplier maxes at 5x)
    decayMs:       250,  // ms of inactivity before gesture resets
    cooldown:      150,  // ms between navigations per axis (must be >= transitionMs)
    transitionMs:  140,  // pan animation duration when navigating between slides
    zoomMs:        500,  // FLIP zoom duration fallback (used when zoomInMs/zoomOutMs are not set)
    zoomInMs:      null, // zoom-in duration override (defaults to zoomMs)
    zoomOutMs:     null, // zoom-out duration override (defaults to zoomMs)
  };

  var AXIS_LOCK_MIN = 3; // min delta magnitude (px) before committing to an axis

  return {
    id: 'overview-scroll',

    init: function (deck) {
      var cfg = Object.assign({}, DEFAULTS, deck.getConfig().OverviewScroll || {});
      var zoomInMs  = cfg.zoomInMs  != null ? cfg.zoomInMs  : cfg.zoomMs;
      var zoomOutMs = cfg.zoomOutMs != null ? cfg.zoomOutMs : cfg.zoomMs;
      var NAV_TRANSITION   = 'transform ' + cfg.transitionMs + 'ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      var ZOOM_IN_TRANS    = 'transform ' + zoomInMs  + 'ms cubic-bezier(0.16, 1, 0.3, 1)';
      var ZOOM_OUT_TRANS   = 'transform ' + zoomOutMs + 'ms cubic-bezier(0.16, 1, 0.3, 1)';

      var accumX     = 0;
      var accumY     = 0;
      var lastTime   = 0; // 0 on first event so velocity boost is skipped (no prior reference point)
      var lastNavX   = 0; // independent cooldowns so horizontal and vertical don't block each other
      var lastNavY   = 0;
      var lockedAxis = null; // 'x' or 'y', held for the duration of a gesture
      var decayTimer = null;
      var flipTimer       = null;
      var flipInProgress  = false; // true while applyFlip() is animating .reveal
      var clickTimer = null; // pending non-current-slide click timeout
      var thumbRect  = null; // last known screen rect of the current slide thumbnail
      var exitingOverview = false; // true while doZoomIn() controls the transition

      var slidesEl = deck.getSlidesElement();
      var revealEl = deck.getRevealElement();

      // ── Overview thumbnail centering ──────────────────────────────────────
      // RevealJS resets every section's vertical-centering offset to `top:0px
      // !important` when entering overview (a CSS rule that inline styles cannot
      // override). We re-apply the same centering as `padding-top` instead —
      // that property is not clobbered by the rule.
      //
      // Strategy: snapshot each section's inline `top` style while still in
      // presentation mode (where RevealJS has set it to the exact centering px).
      // In overviewshown, use those saved values directly so our padding-top
      // matches RevealJS's own number and there is no positional jump when
      // overview switches back to presentation mode. Fall back to an offsetHeight
      // estimate for sections whose top was not yet snapshotted.
      var savedTops = new WeakMap();

      function saveTops() {
        var sections = slidesEl.querySelectorAll('section');
        for (var i = 0; i < sections.length; i++) {
          var t = sections[i].style.top;
          if (t && t !== '0px') savedTops.set(sections[i], t);
        }
      }

      // Capture before RevealJS adds the `overview` class (keydown fires first
      // in capture phase, before any overview layout resets happen).
      document.addEventListener('keydown', function (e) {
        if (!deck.isOverview() && (e.key === 'o' || e.key === 'O')) saveTops();
      }, true);

      deck.on('ready',  saveTops);
      deck.on('resize', saveTops);

      function applyTopsAsPadding() {
        var slideH = deck.getConfig().height || 700;
        var sections = slidesEl.querySelectorAll('section');
        for (var i = 0; i < sections.length; i++) {
          var s = sections[i];
          if (s.classList.contains('stack')) continue;
          var saved = savedTops.get(s);
          if (saved) {
            s.style.paddingTop = saved;
          } else {
            // Fallback: derive centering from children's layout heights.
            var contentH = 0;
            for (var j = 0; j < s.children.length; j++) {
              var child = s.children[j];
              var cs = window.getComputedStyle(child);
              contentH += child.offsetHeight +
                parseFloat(cs.marginTop  || 0) +
                parseFloat(cs.marginBottom || 0);
            }
            var pad = Math.max(0, Math.round((slideH - contentH) / 2));
            if (pad > 0) s.style.paddingTop = pad + 'px';
          }
        }
      }

      function clearPaddingTops() {
        var sections = slidesEl.querySelectorAll('section');
        for (var i = 0; i < sections.length; i++) {
          sections[i].style.paddingTop = '';
        }
      }

      // ── FLIP helpers ─────────────────────────────────────────────────────

      // Record the screen rect of the current slide thumbnail (must be called
      // while in overview mode so the thumbnail is rendered at its grid position).
      function captureThumb() {
        var section = deck.getCurrentSlide();
        if (section) thumbRect = section.getBoundingClientRect();
      }

      // Apply a FLIP animation to .reveal: set startTransform instantly,
      // then animate to identity. .reveal has no transform in its resting state
      // in either presentation or overview mode, so identity is always the target.
      function applyFlip(startTransform, onDone) {
        clearTimeout(flipTimer);
        flipInProgress = true;

        // Cancel any in-progress FLIP so captureThumb() reads accurate rects.
        revealEl.style.transition      = 'none';
        revealEl.style.transform       = '';
        revealEl.style.transformOrigin = '0 0';
        revealEl.offsetHeight; // flush styles

        revealEl.style.transform = startTransform;
        revealEl.offsetHeight;  // flush again so browser registers the start state

        revealEl.style.transition = ZOOM_OUT_TRANS;
        revealEl.style.transform  = '';

        flipTimer = setTimeout(function () {
          revealEl.style.transition      = '';
          revealEl.style.transform       = '';
          revealEl.style.transformOrigin = '';
          flipInProgress = false;
          if (onDone) onDone();
        }, zoomOutMs);
      }

      // Zoom out: current slide was full screen, now appears as a thumbnail.
      // FLIP: start the .reveal transform so the thumbnail looks full-screen,
      // animate to identity so the overview zooms out into view.
      function zoomOut() {
        captureThumb();
        if (!thumbRect || thumbRect.width <= 0 || thumbRect.height <= 0) return;

        var vw        = window.innerWidth;
        var vh        = window.innerHeight;
        var revealCfg = deck.getConfig();
        var slideW    = revealCfg.width  || 1050;
        var slideH    = revealCfg.height || 700;
        var margin    = revealCfg.margin != null ? revealCfg.margin : 0.1;
        var rScale    = Math.min(vw / (slideW * (1 + 2 * margin)), vh / (slideH * (1 + 2 * margin)));
        var presentW  = slideW * rScale;
        var presentH  = slideH * rScale;
        var presentX  = (vw - presentW) / 2;
        var presentY  = (vh - presentH) / 2;

        // With transform-origin 0 0, translate(tx,ty) scale(sx,sy) maps the
        // thumbnail to the presentation area, matching doZoomIn()'s end state.
        var sx = presentW / thumbRect.width;
        var sy = presentH / thumbRect.height;
        var tx = presentX - thumbRect.left * sx;
        var ty = presentY - thumbRect.top  * sy;

        applyFlip(
          'translate(' + tx + 'px,' + ty + 'px) scale(' + sx + ',' + sy + ')',
          function () {
            // Enable the nav transition now that the zoom has settled.
            if (deck.isOverview()) slidesEl.style.transition = NAV_TRANSITION;
          }
        );
      }

      // Zoom in: overview grid zooms into the selected slide, then snaps to
      // presentation mode. The overview stays visible for the full duration of
      // the animation so the grid is only removed when the slide fills the screen.
      function doZoomIn() {
        if (!deck.isOverview()) return;

        exitingOverview = true;

        // Cancel any in-progress animation and reset .reveal to identity so that
        // captureThumb() reads accurate section rects (unaffected by any transform).
        clearTimeout(flipTimer);
        flipInProgress = false;
        revealEl.style.transition      = 'none';
        revealEl.style.transform       = '';
        revealEl.style.transformOrigin = '0 0';
        revealEl.offsetHeight;

        captureThumb();
        if (!thumbRect || thumbRect.width <= 0 || thumbRect.height <= 0) {
          thumbRect = null; // suppress overviewhidden fallback animation
          revealEl.style.transformOrigin = '';
          exitingOverview = false;
          deck.toggleOverview(false);
          return;
        }

        var vw = window.innerWidth;
        var vh = window.innerHeight;

        // Map the thumbnail to the presentation area (not the full viewport).
        // RevealJS letterboxes the slide, so the presentation area is smaller than
        // the viewport. Using vw/vh overscales the end frame and causes a visible
        // correction when snapping to presentation mode.
        var revealCfg    = deck.getConfig();
        var slideW       = revealCfg.width  || 1050;
        var slideH       = revealCfg.height || 700;
        var margin       = revealCfg.margin != null ? revealCfg.margin : 0.1;
        var revealScale  = Math.min(vw / (slideW * (1 + 2 * margin)), vh / (slideH * (1 + 2 * margin)));
        var presentW     = slideW * revealScale;
        var presentH     = slideH * revealScale;
        var presentX     = (vw - presentW) / 2;
        var presentY     = (vh - presentH) / 2;

        var sx = presentW / thumbRect.width;
        var sy = presentH / thumbRect.height;
        // With transform-origin 0 0, translate(tx,ty) scale(sx,sy) maps
        // thumbnail top-left to presentX/presentY and fills the presentation area.
        var tx = presentX - thumbRect.left * sx;
        var ty = presentY - thumbRect.top  * sy;
        var zoomEndTransform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + sx + ',' + sy + ')';

        // Animate forward: identity → thumbnail-fills-viewport.
        // The overview grid zooms in toward the selected slide throughout.
        revealEl.style.transition = ZOOM_IN_TRANS;
        revealEl.style.transform  = zoomEndTransform;

        flipTimer = setTimeout(function () {
          // The selected slide now fills the viewport. Snap to presentation mode:
          // clear .reveal and toggle overview in the same task so there is no
          // intermediate paint — the switch is seamless.
          clearPaddingTops();
          revealEl.style.transition      = 'none';
          revealEl.style.transform       = '';
          revealEl.style.transformOrigin = '';
          slidesEl.style.transition      = '';
          deck.toggleOverview(false); // overviewhidden fires; exitingOverview suppresses it
          exitingOverview = false;
        }, zoomInMs);
      }

      // ── Overview events ───────────────────────────────────────────────────

      deck.on('overviewshown', function () {
        slidesEl.style.transition = ''; // no nav transition during zoom
        // Cancel any pending click zoom-in from a previous session.
        clearTimeout(clickTimer);
        // Reset gesture state so stale accumulators from before the overview
        // was opened do not trigger immediate navigation.
        resetGesture();
        lastTime = 0;
        applyTopsAsPadding();
        zoomOut();
      });

      deck.on('overviewhidden', function () {
        if (exitingOverview) return; // doZoomIn() already owns this transition
        // Fallback for programmatic toggleOverview(false) calls not via doZoomIn.
        // Overview is already hidden here, so use a reverse FLIP from the thumbnail.
        slidesEl.style.transition = '';
        if (!thumbRect) return;
        var vw        = window.innerWidth;
        var vh        = window.innerHeight;
        var revealCfg = deck.getConfig();
        var slideW    = revealCfg.width  || 1050;
        var slideH    = revealCfg.height || 700;
        var margin    = revealCfg.margin != null ? revealCfg.margin : 0.1;
        var rScale    = Math.min(vw / (slideW * (1 + 2 * margin)), vh / (slideH * (1 + 2 * margin)));
        var presentW  = slideW * rScale;
        var presentH  = slideH * rScale;
        var presentX  = (vw - presentW) / 2;
        var presentY  = (vh - presentH) / 2;
        // Use the same translate+scale math as doZoomIn so the fallback animation
        // is the exact reverse: start at the thumbnail position, zoom to full slide.
        var sx           = presentW / thumbRect.width;
        var sy           = presentH / thumbRect.height;
        var tx           = presentX - thumbRect.left * sx;
        var ty           = presentY - thumbRect.top  * sy;
        var startTransform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + sx + ',' + sy + ')';
        clearTimeout(flipTimer);
        flipInProgress = false;
        revealEl.style.transition      = 'none';
        revealEl.style.transform       = '';
        revealEl.style.transformOrigin = '0 0';
        revealEl.offsetHeight;
        revealEl.style.transform = startTransform;
        revealEl.offsetHeight;
        revealEl.style.transition = ZOOM_IN_TRANS;
        revealEl.style.transform  = '';
        flipTimer = setTimeout(function () {
          clearPaddingTops();
          revealEl.style.transition      = '';
          revealEl.style.transform       = '';
          revealEl.style.transformOrigin = '';
        }, zoomInMs);
      });

      deck.on('slidechanged', function () {
        if (deck.isOverview()) {
          // Skip capture while .reveal has an active transform — the rects would be
          // distorted. doZoomIn() always re-captures with a clean transform anyway.
          if (!flipInProgress) captureThumb();
          // Re-arm the nav transition in case it was cleared.
          slidesEl.style.transition = NAV_TRANSITION;
        }
      });

      // ── Keyboard interception ─────────────────────────────────────────────
      // Intercept O and Escape in capture phase so doZoomIn() can start its
      // animation while the overview is still rendering (before RevealJS hides it).

      document.addEventListener('keydown', function (e) {
        if (!deck.isOverview()) return;
        if (e.key === 'o' || e.key === 'O' || e.key === 'Escape') {
          e.stopPropagation(); // prevent RevealJS from also calling toggleOverview
          clearTimeout(clickTimer);
          doZoomIn();
        }
      }, true);

      // ── Click interception ────────────────────────────────────────────────
      // For non-current slides: pan to the slide first, then zoom in.
      // For the current slide: zoom in directly.

      document.addEventListener('click', function (e) {
        if (!deck.isOverview()) return;

        var el = e.target.closest('[data-index-h], [data-index-v]');
        if (!el) return;

        e.preventDefault();
        e.stopPropagation();

        var h, v;
        if (el.hasAttribute('data-index-v')) {
          if (!el.parentElement) return;
          h = parseInt(el.parentElement.getAttribute('data-index-h') || 0, 10);
          v = parseInt(el.getAttribute('data-index-v'), 10);
        } else {
          h = parseInt(el.getAttribute('data-index-h'), 10);
          v = 0;
        }

        var cur = deck.getIndices();
        if (h === cur.h && v === cur.v) {
          // Current slide — zoom in immediately.
          clearTimeout(clickTimer);
          doZoomIn();
          return;
        }

        // Pan to the clicked slide with animation, then zoom in.
        // Cancel any previous pending click so only the latest target is used.
        clearTimeout(clickTimer);
        slidesEl.style.transition = NAV_TRANSITION;
        deck.slide(h, v);

        // After the pan settles, zoom in. captureThumb() is called inside
        // doZoomIn() after .reveal is reset, so the rect is always accurate.
        clickTimer = setTimeout(doZoomIn, cfg.transitionMs + 50);
      }, true);

      // ── Gesture state ─────────────────────────────────────────────────────

      function resetGesture() {
        accumX     = 0;
        accumY     = 0;
        lockedAxis = null;
      }

      function processDeltas(deltaX, deltaY, multiplier) {
        var absX = Math.abs(deltaX);
        var absY = Math.abs(deltaY);
        var mag  = Math.sqrt(absX * absX + absY * absY);

        // Only commit to an axis once the gesture is intentional.
        if (lockedAxis === null) {
          if (mag < AXIS_LOCK_MIN) return;
          lockedAxis = absX >= absY ? 'x' : 'y';
        }

        if (lockedAxis === 'x') accumX += deltaX * multiplier;
        else                    accumY += deltaY * multiplier;

        clearTimeout(decayTimer);
        decayTimer = setTimeout(resetGesture, cfg.decayMs);

        while (Math.abs(accumX) >= cfg.threshold) {
          if (Date.now() - lastNavX < cfg.cooldown) break;
          slidesEl.style.transition = NAV_TRANSITION;
          if (accumX > 0) deck.navigateRight(); else deck.navigateLeft();
          lastNavX = Date.now();
          accumX -= (accumX > 0 ? 1 : -1) * cfg.threshold;
        }
        while (Math.abs(accumY) >= cfg.threshold) {
          if (Date.now() - lastNavY < cfg.cooldown) break;
          slidesEl.style.transition = NAV_TRANSITION;
          if (accumY > 0) deck.navigateDown(); else deck.navigateUp();
          lastNavY = Date.now();
          accumY -= (accumY > 0 ? 1 : -1) * cfg.threshold;
        }
      }

      // ── Mouse / trackpad ──────────────────────────────────────────────────

      document.addEventListener('wheel', function (e) {
        if (!deck.isOverview() || exitingOverview) return;
        e.preventDefault();

        var now = Date.now();
        var dt  = lastTime === 0 ? Infinity : Math.max(now - lastTime, 8);
        lastTime = now;

        var absX = Math.abs(e.deltaX);
        var absY = Math.abs(e.deltaY);
        var mag  = Math.sqrt(absX * absX + absY * absY);
        var boost      = Math.min((mag / dt) * cfg.velocityScale, cfg.maxBoost);
        var multiplier = 1 + boost;

        processDeltas(e.deltaX, e.deltaY, multiplier);
      }, { passive: false });

      // ── Touch ─────────────────────────────────────────────────────────────

      var touchX = 0;
      var touchY = 0;

      document.addEventListener('touchstart', function (e) {
        if (!deck.isOverview() || exitingOverview) return;
        touchX   = e.touches[0].clientX;
        touchY   = e.touches[0].clientY;
        lastTime = 0;
        resetGesture();
      }, { passive: true });

      document.addEventListener('touchmove', function (e) {
        if (!deck.isOverview() || exitingOverview) return;
        e.preventDefault();
        var x = e.touches[0].clientX;
        var y = e.touches[0].clientY;
        // Inverted: swiping left moves to the next slide (right).
        processDeltas(touchX - x, touchY - y, 1);
        touchX = x;
        touchY = y;
      }, { passive: false });

      document.addEventListener('touchend', function () {
        if (!deck.isOverview()) return;
        clearTimeout(decayTimer);
        resetGesture();
      }, { passive: true });
    }
  };
})();
