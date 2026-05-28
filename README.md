# overview-enhanced-revealjs

A Quarto extension that enhances RevealJS overview mode with scroll navigation, FLIP zoom animations, and corrected thumbnail rendering.

Press **O** to enter overview mode, then:

- Scroll **horizontally** to move between slide columns
- Scroll **vertically** to move between rows within a column
- Swipe on touch devices using the same directional logic
- Click any slide to zoom in with animation
- Press **O** or **Escape** to zoom back to the selected slide

Each gesture commits to one axis (horizontal or vertical) and holds it for the duration of the scroll, preventing accidental diagonal navigation.

## Installation

```bash
quarto add AJBogo9/overview-enhanced-revealjs
```

## Usage

Add the plugin to your document's front matter:

```yaml
format: revealjs
revealjs-plugins:
  - overview-enhanced
```

Works alongside any other RevealJS theme or format extension, including [liquid-glass-revealjs](https://github.com/AJBogo9/liquid-glass-revealjs):

```yaml
format:
  liquid-glass-revealjs:
    slide-number: true
revealjs-plugins:
  - overview-enhanced
```

## Options

All options are optional. Pass them under `OverviewEnhanced` in your Reveal format config:

```yaml
format:
  revealjs:
    OverviewEnhanced:
      threshold: 60
      cooldown: 100
```

| Option          | Default | Description                                                               |
|-----------------|---------|---------------------------------------------------------------------------|
| `threshold`     | `60`    | Accumulated scroll (px) needed to navigate one slide                      |
| `velocityScale` | `0.3`   | How much scroll speed amplifies delta (set to `0` to disable)             |
| `maxBoost`      | `4`     | Cap on velocity boost (total multiplier maxes at 5×)                      |
| `decayMs`       | `250`   | ms of inactivity before the gesture resets                                |
| `cooldown`      | `150`   | ms between navigations per axis — keep this >= `transitionMs`             |
| `transitionMs`  | `140`   | Duration of the pan animation when navigating between slides              |
| `zoomMs`        | `500`   | Default duration for both zoom-in and zoom-out animations                 |
| `zoomInMs`      | `null`  | Duration override for the zoom-in animation (falls back to `zoomMs`)      |
| `zoomOutMs`     | `null`  | Duration override for the zoom-out animation (falls back to `zoomMs`)     |
