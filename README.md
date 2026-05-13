# wic

**Wide-gamut Icon Compiler**

A dual-engine build tool for generating wide-gamut (Display P3) web assets and legacy sRGB favicons from a single SVG source.

## The Architecture

Standard CLI image processors (like ImageMagick and `librsvg`) rely on underlying C libraries that cannot parse modern CSS color spaces like `oklch()`. If your master SVG uses wide-gamut colors, standard asset pipelines will clip, mute, or fail to render your icons entirely.

`wic` bypasses traditional rasterizers by using a headless Chromium engine to parse your CSS exactly as a modern browser would:

1. It forces a `display-p3-d65` color profile to render Apple Touch and PWA icons with maximum mathematical vibrance.
2. It reboots into an `srgb` context to natively gamut-map your colors down for legacy `.ico` fallbacks before packing them.
3. It dynamically injects a pure-vector circular clip-path for desktop Chrome tabs without altering your coordinate space.

## Installation

Clone the repository, install dependencies, and link the binary to your environment:

### npm

```bash
npm install
npm link
```

### pnpm

```bash
pnpm i
pnpm link --global
```

## Usage

```bash
wic -s <source.svg> -n "<App Name>" -o <output_dir> [-r <radius_percentage>]
```

**Options:**

- `-s, --source` : Path to your master SVG. _Must be a full-bleed, sharp-cornered square._
- `-n, --name` : The application name (injected or updated in `manifest.json`).
- `-o, --output` : Target directory for generated assets (e.g., `app/public` or `.`).
- `-r, --radius` : (Optional) Border radius percentage applied natively to Android/PWA icons and `favicon.svg` (e.g., `15`). `apple-touch-icon.png` file strictly ignores this parameter.

**Example:**

```bash
wic -s assets/master-logo.svg -n "Lode Beat" -o app/public -r 15
```

## Artifacts Generated

Executing the pipeline outputs the following tightly controlled assets:

- `favicon.svg` (Display P3, Rounded via flag)
- `apple-touch-icon.png` (180x180, Display P3, Sharp Corners)
- `icon-192.png` (192x192, Display P3, Rounded via flag)
- `icon-512.png` (512x512, Display P3, Rounded via flag)
- `favicon.ico` (Multi-layer 64/48/32/16, sRGB Gamut-Mapped)
- `manifest.json` (Bootstrapped or dynamically updated)

## License

MIT
