#!/usr/bin/env node

import puppeteer from 'puppeteer'
import pngToIco from 'png-to-ico'
import { createRequire } from 'module'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { unlink } from 'fs/promises'
import { parseArgs } from 'util'
import { join, extname } from 'path'

const require = createRequire(import.meta.url)
const { version: PACKAGE_VERSION } = require('./package.json')

// --- 1. CLI Setup & Guardrails ---
const USAGE =
  'Usage: wic -s <source.svg|source.png> -n "<App Name>" -o <output_dir> [-r <radius_percentage>] [--pwa] [-v]'

const options = {
  source: { type: 'string', short: 's' },
  name: { type: 'string', short: 'n' },
  output: { type: 'string', short: 'o' },
  radius: { type: 'string', short: 'r', default: '0' },
  pwa: { type: 'boolean', default: false },
  version: { type: 'boolean', short: 'v' },
}

let args
try {
  args = parseArgs({ options, allowPositionals: true }).values
} catch (e) {
  console.error(`\x1b[31m[ERROR]\x1b[0m Invalid arguments.\n${USAGE}`)
  process.exit(1)
}

if (args.version) {
  console.log(PACKAGE_VERSION)
  process.exit(0)
}

if (!args.source || !args.name || !args.output) {
  console.error(`\x1b[31m[ERROR]\x1b[0m Missing required arguments.\n${USAGE}`)
  process.exit(1)
}

const OUTPUT_DIR = args.output
const SOURCE_PATH = args.source
const APP_NAME = args.name
const RADIUS_PCT = parseInt(args.radius, 10)
const IS_PWA = Boolean(args.pwa)
const MANIFEST_DISPLAY = IS_PWA ? 'standalone' : 'browser'

const SOURCE_EXT = extname(SOURCE_PATH).toLowerCase()
const SOURCE_KIND = SOURCE_EXT === '.svg' ? 'svg' : SOURCE_EXT === '.png' ? 'png' : null

if (!SOURCE_KIND) {
  console.error(
    `\x1b[31m[ERROR]\x1b[0m Unsupported source format: ${SOURCE_EXT || '(none)'}. Only .svg and .png are supported.`,
  )
  process.exit(1)
}

if (!existsSync(SOURCE_PATH)) {
  console.error(`\x1b[31m[ERROR]\x1b[0m Source file not found: ${SOURCE_PATH}`)
  process.exit(1)
}

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true })
}

console.log(`\x1b[1;34m[INFO]\x1b[0m Booting wic dual-engine for '${APP_NAME}'...`)

const svgContent = SOURCE_KIND === 'svg' ? readFileSync(SOURCE_PATH, 'utf8') : null
const pngDataUrl =
  SOURCE_KIND === 'png'
    ? `data:image/png;base64,${readFileSync(SOURCE_PATH).toString('base64')}`
    : null

function getSourceMarkup() {
  if (SOURCE_KIND === 'svg') return svgContent
  return `<img src="${pngDataUrl}" alt="" />`
}

// --- 2. The Dynamic Vector SVG Forge ---
function applyVectorMaskToSvg(originalSvg) {
  // If the user wants sharp corners, don't clutter the XML with a mask.
  if (RADIUS_PCT <= 0) return originalSvg

  // Clamp the percentage to 50% max so the vector math doesn't break
  const clampedPct = Math.min(RADIUS_PCT, 50)

  const viewBoxMatch = originalSvg.match(/viewBox=["']\s*([\d\.-]+)\s+([\d\.-]+)\s+([\d\.-]+)\s+([\d\.-]+)\s*["']/i)

  // Fallbacks in case the SVG lacks a viewBox
  let minX = 0,
    minY = 0,
    width = 512,
    height = 512

  if (viewBoxMatch) {
    minX = parseFloat(viewBoxMatch[1])
    minY = parseFloat(viewBoxMatch[2])
    width = parseFloat(viewBoxMatch[3])
    height = parseFloat(viewBoxMatch[4])
  }

  // Calculate the absolute vector border radius
  const rx = Math.min(width, height) * (clampedPct / 100)

  const openTagMatch = originalSvg.match(/(<svg[^>]*>)/i)
  if (!openTagMatch) return originalSvg

  const openTag = openTagMatch[0]
  const closeTag = '</svg>'

  const innerContent = originalSvg.slice(openTagMatch.index + openTag.length, originalSvg.lastIndexOf(closeTag))

  return `${openTag}
  <defs>
    <clipPath id="wic-tab-mask">
      <rect x="${minX}" y="${minY}" width="${width}" height="${height}" rx="${rx}" ry="${rx}" />
    </clipPath>
  </defs>
  <g clip-path="url(#wic-tab-mask)">
    ${innerContent}
  </g>
${closeTag}`
}

// --- 3. Headless Render Engine Factory ---
async function createRenderEngine(profile) {
  const browser = await puppeteer.launch({
    headless: true,
    args: [`--force-color-profile=${profile}`, '--disable-web-security'],
  })

  const page = await browser.newPage()

  return {
    browser,
    renderPng: async (size, filename, applyRounding) => {
      const radiusPx = applyRounding && RADIUS_PCT > 0 ? Math.round(size * (RADIUS_PCT / 100)) : 0

      await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 })

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              body { margin: 0; background: transparent; overflow: hidden; }
              .mask {
                width: ${size}px; height: ${size}px;
                border-radius: ${radiusPx}px;
                overflow: hidden;
                display: flex; align-items: center; justify-content: center;
              }
              svg, img { width: 100%; height: 100%; display: block; }
              img { object-fit: contain; }
            </style>
          </head>
          <body>
            <div class="mask">${getSourceMarkup()}</div>
          </body>
        </html>
      `

      await page.setContent(html, { waitUntil: 'domcontentloaded' })

      const outPath = join(OUTPUT_DIR, filename)
      await page.screenshot({
        path: outPath,
        type: 'png',
        omitBackground: true,
        clip: { x: 0, y: 0, width: size, height: size },
      })

      console.log(`  -> Rendered [${profile}]: ${filename} (${size}x${size}, radius: ${radiusPx}px)`)
      return outPath
    },
  }
}

// --- 4. The Execution Pipeline ---
async function buildAssets() {
  try {
    // A. Forge the Tab SVG (SVG sources only)
    if (SOURCE_KIND === 'svg') {
      const maskedSvg = applyVectorMaskToSvg(svgContent)
      writeFileSync(join(OUTPUT_DIR, 'favicon.svg'), maskedSvg)
      console.log(`  -> Forged: favicon.svg (Vector Mask: ${RADIUS_PCT > 0 ? RADIUS_PCT + '%' : 'Sharp'})`)
    }

    // B. Engine 1: Display P3 (Modern Web, Google SERP & Apple)
    // Google recommends >48px square favicons; 48/96/144 cover SERP + HiDPI.
    console.log(`\x1b[1;34m[INFO]\x1b[0m Spooling Display P3 Engine...`)
    const p3Engine = await createRenderEngine('display-p3-d65')
    await p3Engine.renderPng(180, 'apple-touch-icon.png', false)

    const pwaSizes = [48, 96, 144, 192, 512]
    for (const s of pwaSizes) {
      await p3Engine.renderPng(s, `icon-${s}.png`, true)
    }
    await p3Engine.browser.close()

    // C. Engine 2: sRGB (Legacy Fallbacks & ICO)
    console.log(`\x1b[1;34m[INFO]\x1b[0m Spooling sRGB Gamut-Mapping Engine...`)
    const srgbEngine = await createRenderEngine('srgb')

    const icoSizes = [64, 48, 32, 16]
    const tempFiles = []

    for (const s of icoSizes) {
      const tempPath = await srgbEngine.renderPng(s, `favicon-${s}.png`, true)
      tempFiles.push(tempPath)
    }
    await srgbEngine.browser.close()

    // Pack the sRGB layers into the .ico wrapper
    const icoBuffer = await pngToIco(tempFiles)
    writeFileSync(join(OUTPUT_DIR, 'favicon.ico'), icoBuffer)
    console.log(`  -> Packed: favicon.ico (Multi-layer: 64, 48, 32, 16)`)

    // Burn the temporary sRGB PNGs
    for (const file of tempFiles) {
      await unlink(file)
    }

    return true
  } catch (err) {
    console.error(`\x1b[31m[ERROR]\x1b[0m Pipeline failure: ${err.message}`)
    return false
  }
}

// --- 5. Manifest Generator & Updater ---
function updateManifest() {
  const manifestPath = join(OUTPUT_DIR, 'manifest.json')

  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      manifest.name = APP_NAME
      manifest.short_name = APP_NAME
      manifest.display = MANIFEST_DISPLAY
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
      console.log(
        `\x1b[1;34m[INFO]\x1b[0m Updated existing manifest.json (display: ${MANIFEST_DISPLAY})`,
      )
    } catch (err) {
      console.error(`\x1b[31m[ERROR]\x1b[0m Could not parse manifest.json. Ensure it is valid JSON.`)
    }
  } else {
    const baseManifest = {
      name: APP_NAME,
      short_name: APP_NAME,
      icons: [
        { src: '/icon-48.png', sizes: '48x48', type: 'image/png' },
        { src: '/icon-96.png', sizes: '96x96', type: 'image/png' },
        { src: '/icon-144.png', sizes: '144x144', type: 'image/png' },
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
      theme_color: '#ffffff',
      background_color: '#ffffff',
      display: MANIFEST_DISPLAY,
      start_url: '/',
      scope: '/',
    }
    writeFileSync(manifestPath, JSON.stringify(baseManifest, null, 2))
    console.log(
      `\x1b[1;34m[INFO]\x1b[0m Generated new manifest.json from scratch (display: ${MANIFEST_DISPLAY})`,
    )
  }
}

// --- 6. Head snippet for Google SERP + browsers ---
function printHeadLinks() {
  const lines = []

  if (SOURCE_KIND === 'svg') {
    lines.push(`    <link rel="icon" href="/favicon.svg" type="image/svg+xml" sizes="any" />`)
  }

  for (const s of [48, 96, 144, 192, 512]) {
    lines.push(`    <link rel="icon" type="image/png" sizes="${s}x${s}" href="/icon-${s}.png" />`)
  }

  lines.push(`    <link rel="icon" href="/favicon.ico" sizes="32x32" />`)
  lines.push(`    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />`)
  lines.push(`    <link rel="manifest" href="/manifest.json" />`)

  console.log(`\n\x1b[1;32m[SUCCESS]\x1b[0m wic execution complete. Assets ready.`)
  console.log(`\x1b[1;33m[COPY]\x1b[0m Paste these into your <head>:`)
  console.log('')
  console.log(lines.join('\n'))
  console.log('')
}

// --- Run ---
const ok = await buildAssets()
if (!ok) process.exit(1)
updateManifest()
printHeadLinks()
