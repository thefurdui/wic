import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'

const require = createRequire(import.meta.url)
const run = promisify(execFile)

export async function ensureBrowser(puppeteer, { exists = existsSync, install = run, log = console.log } = {}) {
  const executablePath = await puppeteer.executablePath()
  if (exists(executablePath)) return

  const configuration = await puppeteer.configuration()
  if (configuration.executablePath) {
    throw new Error(`Browser not found at configured executable path: ${executablePath}. Check PUPPETEER_EXECUTABLE_PATH or your Puppeteer configuration.`)
  }

  const browser = configuration.defaultBrowser
  const version = await puppeteer.browserVersion()
  const target = `${browser}@${version}`
  const cli = require.resolve('puppeteer/internal/node/cli.js')
  const command = `"${process.execPath}" "${cli}" browsers install ${target}`

  if (configuration.skipDownload || configuration[browser]?.skipDownload) {
    throw new Error(`Browser ${target} is missing and browser downloads are disabled. Install it with: ${command}`)
  }

  log(`[INFO] Downloading ${target} for wic (cached for future runs)...`)
  try {
    // Use wic's own Puppeteer CLI, not a separately installed/latest version.
    await install(process.execPath, [cli, 'browsers', 'install', target], {
      env: { ...process.env, PUPPETEER_CACHE_DIR: configuration.cacheDirectory },
    })
    if (!exists(executablePath)) throw new Error(`Browser executable is still missing: ${executablePath}`)
  } catch (error) {
    throw new Error(`Could not install ${target}: ${error.message}\nRetry with: ${command}`, { cause: error })
  }
}
