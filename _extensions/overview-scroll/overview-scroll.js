var OverviewScroll = (function () {
  var THRESHOLD = 20;  // minimum px delta before triggering navigation
  var COOLDOWN  = 350; // ms between slide navigations

  return {
    id: 'overview-scroll',

    init: function (deck) {
      var lastNav = 0;

      document.addEventListener('wheel', function (e) {
        if (!deck.isOverview()) return;

        var absX = Math.abs(e.deltaX);
        var absY = Math.abs(e.deltaY);

        if (absX < THRESHOLD && absY < THRESHOLD) return;

        var now = Date.now();
        if (now - lastNav < COOLDOWN) return;

        e.preventDefault();
        lastNav = now;

        // Horizontal scroll navigates between slide columns.
        // Vertical scroll navigates between rows within a column.
        if (absX >= absY) {
          if (e.deltaX > 0) deck.navigateRight();
          else              deck.navigateLeft();
        } else {
          if (e.deltaY > 0) deck.navigateDown();
          else              deck.navigateUp();
        }
      }, { passive: false });
    }
  };
})();
