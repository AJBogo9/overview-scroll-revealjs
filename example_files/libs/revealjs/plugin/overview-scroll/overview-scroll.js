var OverviewScroll = (function () {
  var DEFAULTS = {
    threshold:     60,   // accumulated px to trigger one slide navigation
    velocityScale: 0.3,  // how much scroll speed amplifies delta
    maxBoost:      4,    // cap on velocity boost (multiplier maxes at 5x)
    decayMs:       250,  // ms of inactivity before gesture resets
    cooldown:      150,  // ms between navigations per axis (must be >= transitionMs)
    transitionMs:  140,  // overview pan animation duration
  };

  var AXIS_LOCK_MIN = 3; // min delta magnitude (px) before committing to an axis

  return {
    id: 'overview-scroll',

    init: function (deck) {
      var cfg = Object.assign({}, DEFAULTS, deck.getConfig().OverviewScroll || {});
      var TRANSITION = 'transform ' + cfg.transitionMs + 'ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';

      var accumX     = 0;
      var accumY     = 0;
      var lastTime   = 0; // 0 on first event so velocity boost is skipped (no prior reference point)
      var lastNavX   = 0; // independent cooldowns so horizontal and vertical don't block each other
      var lastNavY   = 0;
      var lockedAxis = null; // 'x' or 'y', held for the duration of a gesture
      var decayTimer = null;
      var slidesEl   = deck.getSlidesElement();

      // Enable smooth panning after the overview entry has settled.
      // Disable before exit so RevealJS's own exit transform is instant.
      deck.on('overviewshown', function () {
        setTimeout(function () { slidesEl.style.transition = TRANSITION; }, 50);
      });
      deck.on('overviewhidden', function () {
        slidesEl.style.transition = '';
      });

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
          if (accumX > 0) deck.navigateRight(); else deck.navigateLeft();
          lastNavX = Date.now();
          accumX -= (accumX > 0 ? 1 : -1) * cfg.threshold;
        }
        while (Math.abs(accumY) >= cfg.threshold) {
          if (Date.now() - lastNavY < cfg.cooldown) break;
          if (accumY > 0) deck.navigateDown(); else deck.navigateUp();
          lastNavY = Date.now();
          accumY -= (accumY > 0 ? 1 : -1) * cfg.threshold;
        }
      }

      // Mouse / trackpad
      document.addEventListener('wheel', function (e) {
        if (!deck.isOverview()) return;
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

      // Touch (mobile)
      var touchX = 0;
      var touchY = 0;

      document.addEventListener('touchstart', function (e) {
        if (!deck.isOverview()) return;
        touchX    = e.touches[0].clientX;
        touchY    = e.touches[0].clientY;
        lastTime  = 0;
        resetGesture();
      }, { passive: true });

      document.addEventListener('touchmove', function (e) {
        if (!deck.isOverview()) return;
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
