# overview-scroll-revealjs

A Quarto extension that adds mouse-wheel navigation to RevealJS overview mode, inspired by GNOME's workspace switcher.

Press **O** to enter overview mode, then:

- Scroll **horizontally** to move between slide columns
- Scroll **vertically** to move between rows within a column

## Installation

```bash
quarto add AJBogo9/overview-scroll-revealjs
```

## Usage

Add the plugin to your document's front matter:

```yaml
format: revealjs
revealjs-plugins:
  - OverviewScroll
```

Works alongside any other RevealJS theme or format extension, including [liquid-glass-revealjs](https://github.com/AJBogo9/liquid-glass-revealjs):

```yaml
format:
  liquid-glass-revealjs:
    slide-number: true
revealjs-plugins:
  - OverviewScroll
```

## Options

The extension ships with sensible defaults. To tweak behaviour, fork the plugin and adjust the constants at the top of `overview-scroll.js`:

| Constant    | Default | Description                                      |
|-------------|---------|--------------------------------------------------|
| `THRESHOLD` | `20`    | Minimum scroll delta (px) before navigating      |
| `COOLDOWN`  | `350`   | Minimum time (ms) between consecutive navigations |
