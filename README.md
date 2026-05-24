# overview-scroll-revealjs

A Quarto extension that adds mouse-wheel and touch navigation to RevealJS overview mode, inspired by GNOME's workspace switcher.

Press **O** to enter overview mode, then:

- Scroll **horizontally** to move between slide columns (only from the first row)
- Scroll **vertically** to move between rows within a column
- Swipe on touch devices using the same directional logic

Each gesture commits to one axis (horizontal or vertical) and holds it for the duration of the scroll, preventing accidental diagonal navigation.

## Installation

```bash
quarto add AJBogo9/overview-scroll-revealjs
```

## Usage

Add the plugin to your document's front matter:

```yaml
format: revealjs
revealjs-plugins:
  - overview-scroll
```

Works alongside any other RevealJS theme or format extension, including [liquid-glass-revealjs](https://github.com/AJBogo9/liquid-glass-revealjs):

```yaml
format:
  liquid-glass-revealjs:
    slide-number: true
revealjs-plugins:
  - overview-scroll
```

## Options

All options are optional. Pass them under `OverviewScroll` in your Reveal format config:

```yaml
format:
  revealjs:
    OverviewScroll:
      threshold: 60
      cooldown: 100
```

| Option          | Default | Description                                                    |
|-----------------|---------|----------------------------------------------------------------|
| `threshold`     | `60`    | Accumulated scroll (px) needed to navigate one slide           |
| `velocityScale` | `0.3`   | How much scroll speed amplifies delta (set to `0` to disable)  |
| `maxBoost`      | `4`     | Cap on velocity boost (total multiplier maxes at 5×)           |
| `decayMs`       | `250`   | ms of inactivity before the gesture resets                     |
| `cooldown`      | `100`   | ms between individual slide navigations                        |
| `transitionMs`  | `140`   | Duration of the overview pan animation (ms)                    |
