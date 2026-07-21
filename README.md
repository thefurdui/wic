# wic (Wide-gamut Icon Compiler)

A CLI tool that generates modern wide-gamut (Display P3) web assets and legacy sRGB favicons from a single SVG source.

## Why?

Most standard image processors (like ImageMagick or `librsvg`) rely on underlying C libraries that don't understand modern CSS color spaces like `oklch()` or `display-p3`. If your master SVG uses wide-gamut colors, traditional asset pipelines will clip, mute, or fail to render your icons.

`wic` solves this by running a headless Chromium browser to parse your CSS exactly as a real browser would:

1. It renders Apple Touch and PWA icons using a `display-p3` color profile to preserve maximum color accuracy.
2. It safely converts your colors down to an `srgb` profile for legacy `.ico` fallbacks.
3. It can inject a pure-vector circular mask for desktop Chrome tabs without altering your original coordinate space.

## Usage

```bash
npx @thefurdui/wic -s <source.svg> -n "<App Name>" -o <output_dir> [-r <radius_percentage>] [--pwa]
```

_(Alternatively, use `pnpm dlx @thefurdui/wic` or `bunx @thefurdui/wic`)_

**Options:**

- `-s, --source` : Path to your master SVG. _Must be a sharp-cornered square._
- `-n, --name` : The application name (this is injected or updated in your `manifest.json`).
- `-o, --output` : Target directory for the generated assets (e.g., `public` or `dist`).
- `-r, --radius` : _(Optional)_ Border radius percentage applied natively to Android/PWA icons and `favicon.svg` (e.g., `15`). Note: The `apple-touch-icon.png` ignores this and stays sharp per Apple's guidelines.
- `--pwa` : _(Optional)_ Sets `manifest.json` `display` to `standalone` for installable PWAs. Without this flag, `display` defaults to `browser`.

**Example:**

```bash
npx @thefurdui/wic -s assets/master-logo.svg -n "Lode Beat" -o public -r 15
npx @thefurdui/wic -s assets/master-logo.svg -n "Lode Beat" -o public -r 15 --pwa
```

> **Note for `pnpm` users:** If you are using `pnpm`, make sure to allow the `puppeteer` postinstall script to ensure your headless Chromium instance downloads properly.
>
> **Note for Linux users:** If you are running this on a barebones Linux server (like a CI/CD pipeline) or WSL, Puppeteer may require standard Chromium system shared libraries (like `libnss3` or `libgbm1`) to be installed via your package manager to prevent crash errors.

## Generated Output

Running the command will generate the following assets in your target directory:

- `favicon.svg` (Display P3, masked if radius is provided; SVG sources only)
- `apple-touch-icon.png` (180x180, Display P3, sharp corners)
- `icon-48.png` / `icon-96.png` / `icon-144.png` (Google SERP + HiDPI favicons, Display P3)
- `icon-192.png` / `icon-512.png` (PWA icons, Display P3, rounded if radius provided)
- `favicon.ico` (Multi-layer 64/48/32/16, sRGB gamut-mapped)
- `manifest.json` (Bootstrapped or dynamically updated)

On success, `wic` prints a ready-to-paste `<head>` snippet with the correct `<link>` tags for Google Search and browsers.

## License

MIT
