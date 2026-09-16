import { test as base, chromium } from '@playwright/test'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:https'
import { execFileSync } from 'node:child_process'
import { packDir } from '../helpers/pack.mjs'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const STUB = readFileSync(join(REPO_ROOT, 'tests/fixtures/meet-stub.html'), 'utf8')

/**
 * The content scripts only match https://meet.google.com/*, so a test page has
 * to be served from exactly that origin. The browser is pointed at a local
 * https server with --host-resolver-rules, and the self-signed certificate is
 * trusted by its public-key hash rather than by disabling certificate checks -
 * meet.google.com is HSTS-preloaded, and HSTS refuses the blanket bypass.
 *
 * The mapping exists only inside this throwaway browser profile.
 */
function makeCert(dir) {
  const key = join(dir, 'key.pem')
  const cert = join(dir, 'cert.pem')
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '1',
    '-subj', '/CN=meet.google.com',
    '-addext', 'subjectAltName=DNS:meet.google.com'
  ], { stdio: 'ignore' })

  const spki = execFileSync('bash', ['-c',
    `openssl x509 -in '${cert}' -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl enc -base64`
  ], { encoding: 'utf8' }).trim()

  return { key: readFileSync(key), cert: readFileSync(cert), spki }
}

export const test = base.extend({
  meet: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'gmeet-cert-'))
    const { key, cert, spki } = makeCert(dir)

    const server = createServer({ key, cert }, (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(STUB)
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()

    await use({ port, spki, url: code => `https://meet.google.com/${code}` })

    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  },

  context: async ({ meet }, use) => {
    const workDir = mkdtempSync(join(tmpdir(), 'gmeet-e2e-'))
    const extensionDir = join(workDir, 'extension')
    packDir(REPO_ROOT, extensionDir)
    // packDir excludes docs/ and *.md, but the stub lives under tests/ which is
    // excluded too - it is served over http, not loaded from the extension.
    writeFileSync(join(extensionDir, '.packed'), '')

    const context = await chromium.launchPersistentContext(join(workDir, 'profile'), {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        `--host-resolver-rules=MAP meet.google.com 127.0.0.1:${meet.port}`,
        `--ignore-certificate-errors-spki-list=${meet.spki}`
      ]
    })

    await use(context)

    await context.close()
    rmSync(workDir, { recursive: true, force: true })
  },

  serviceWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers()
    if (!worker) worker = await context.waitForEvent('serviceworker')

    // Warm the worker before any test navigates.
    //
    // An MV3 service worker that has not been driven yet can miss the first
    // tabs.onUpdated it should have received, which made meeting-tracking
    // assertions fail perhaps one run in three. This makes the setup
    // deterministic; the underlying fragility - that meetingSessions lives only
    // in worker memory, which MV3 discards at will - is a product issue, not a
    // test issue, and is filed separately.
    await worker.evaluate(() => true)

    await use(worker)
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host)
  }
})

export const expect = test.expect
