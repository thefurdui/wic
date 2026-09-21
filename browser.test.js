import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ensureBrowser } from './browser.js'

function fixture(configuration = {}) {
  return {
    executablePath: async () => '/cache/chrome/browser',
    browserVersion: async () => '148.0.7778.97',
    configuration: async () => ({ defaultBrowser: 'chrome', cacheDirectory: '/custom cache', ...configuration }),
  }
}

test('cached browser requires no installation, even with downloads disabled', async () => {
  await ensureBrowser(fixture({ skipDownload: true }), {
    exists: () => true,
    install: () => assert.fail('unexpected download'),
  })
})

test('missing browser installs the bundled version into the configured cache once', async () => {
  let installed = false
  let calls = 0
  const dependencies = {
    exists: () => installed,
    log: () => {},
    install: async (executable, args, options) => {
      calls++
      assert.equal(executable, process.execPath)
      assert.match(args[0], /puppeteer.*cli\.js$/)
      assert.deepEqual(args.slice(1), ['browsers', 'install', 'chrome@148.0.7778.97'])
      assert.equal(options.env.PUPPETEER_CACHE_DIR, '/custom cache')
      installed = true
    },
  }
  await ensureBrowser(fixture(), dependencies)
  await ensureBrowser(fixture(), dependencies)
  assert.equal(calls, 1)
})

test('invalid explicit executable does not trigger a download', async () => {
  await assert.rejects(ensureBrowser(fixture({ executablePath: '/missing' }), {
    exists: () => false,
    install: () => assert.fail('unexpected download'),
  }), /PUPPETEER_EXECUTABLE_PATH/)
})

for (const configuration of [{ skipDownload: true }, { chrome: { skipDownload: true } }]) {
  test(`disabled downloads produce a pinned recovery command: ${JSON.stringify(configuration)}`, async () => {
    await assert.rejects(ensureBrowser(fixture(configuration), {
      exists: () => false,
      install: () => assert.fail('unexpected download'),
    }), /downloads are disabled.*browsers install chrome@148\.0\.7778\.97/)
  })
}

test('download failure preserves the cause and gives a recovery command', async () => {
  await assert.rejects(ensureBrowser(fixture(), {
    exists: () => false,
    log: () => {},
    install: async () => { throw new Error('network unavailable') },
  }), /network unavailable\nRetry with:.*browsers install chrome@148\.0\.7778\.97/)
})

test('installer success without an executable is reported as failure', async () => {
  await assert.rejects(ensureBrowser(fixture(), {
    exists: () => false,
    log: () => {},
    install: async () => {},
  }), /Browser executable is still missing/)
})
