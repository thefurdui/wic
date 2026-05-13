#!/usr/bin/env node

import puppeteer from 'puppeteer'
import pngToIco from 'png-to-ico'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { unlink } from 'fs/promises'
import { parseArgs } from 'util'
import { join } from 'path'

// --- 1. CLI Setup & Guardrails ---
const options = {
  source: { type: 'string', short: 's' },
  name: { type: 'string', short: 'n' },
  radius: { type: 'string', short: 'r', default: '0' },
}

let args
try {
  args = parseArgs({ options, allowPositionals: true }).values
} catch (e) {
  console.error(
    `\x1b[31m[ERROR]\x1b[0m Invalid arguments.\nUsage: wic -s <source.svg> -n "<App Name>" [-r <radius_percentage>]`,
  )
  process.exit(1)
}

if (!args.source || !args.name) {
  console.error(
    `\x1b[31m[ERROR]\x1b[0m Missing required arguments.\nUsage: wic -s <source.svg> -n "<App Name>" [-r <radius_percentage>]`,
  )
  process.exit(1)
}

const OUTPUT_DIR = 'output'
const SOURCE_SVG = args.source
const APP_NAME = args.name
const RADIUS_PCT = parseInt(args.radius, 10)

if (!existsSync(SOURCE_SVG)) {
  console.error(`\x1b[31m[ERROR]\x1b[0m Source SVG not found: ${SOURCE_SVG}`)
  process.exit(1)
}

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true })
}

console.log(`\x1b[1;34m[INFO]\x1b[0m Booting wic dual-engine for '${APP_NAME}'...`)

const svgContent = readFileSync(SOURCE_SVG, 'utf8')

// --- 2. Headless Render Engine Factory ---
async function createRenderEngine(profile) {
  const browser = await puppeteer.launch({
    headless: 'new',
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
              svg { width: 100%; height: 100%; display: block; }
            </style>
          </head>
          <body>
            <div class="mask">${svgContent}</div>
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

// --- 3. The Execution Pipeline ---
async function buildAssets() {
  try {
    // A. Copy raw SVG (Sharp corners, let the browser mask it)
    writeFileSync(join(OUTPUT_DIR, 'favicon.svg'), svgContent)
    console.log(`  -> Copied: favicon.svg (Raw XML)`)

    // B. Engine 1: Display P3 (Modern Web & Apple)
    console.log(`\x1b[1;34m[INFO]\x1b[0m Spooling Display P3 Engine...`)
    const p3Engine = await createRenderEngine('display-p3-d65')
    await p3Engine.renderPng(180, 'apple-touch-icon.png', false)
    await p3Engine.renderPng(192, 'icon-192.png', true)
    await p3Engine.renderPng(512, 'icon-512.png', true)
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
  } catch (err) {
    console.error(`\x1b[31m[ERROR]\x1b[0m Pipeline failure: ${err.message}`)
  }
}

// --- 4. Manifest Generator & Updater ---
function updateManifest() {
  const manifestPath = join(OUTPUT_DIR, 'manifest.json')

  if (existsSync(manifestPath)) {
    // Update existing
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      manifest.name = APP_NAME
      manifest.short_name = APP_NAME
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
      console.log(`\x1b[1;34m[INFO]\x1b[0m Updated existing manifest.json`)
    } catch (err) {
      console.error(`\x1b[31m[ERROR]\x1b[0m Could not parse manifest.json. Ensure it is valid JSON.`)
    }
  } else {
    // Generate new from scratch
    const baseManifest = {
      name: APP_NAME,
      short_name: APP_NAME,
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
      theme_color: '#ffffff',
      background_color: '#ffffff',
      display: 'standalone',
    }
    writeFileSync(manifestPath, JSON.stringify(baseManifest, null, 2))
    console.log(`\x1b[1;34m[INFO]\x1b[0m Generated new manifest.json from scratch`)
  }
}

// --- Run ---
await buildAssets()
updateManifest()
console.log(`\x1b[1;32m[SUCCESS]\x1b[0m wic execution complete. Assets ready.`)
