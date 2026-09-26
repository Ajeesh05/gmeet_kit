// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolve } from 'node:path'
import { createChromeMock } from '../helpers/chrome-mock.mjs'
import { loadServiceWorker } from '../helpers/sw-harness.mjs'

// Resolved from cwd, not import.meta.url: under the jsdom environment
// import.meta.url is an http:// URL and fileURLToPath rejects it.
const PORTS_PATH = resolve(process.cwd(), 'scripts/content-scripts/ports.js')

/**
 * ports.js is the bridge between the extension and the page: it relays
 * settings messages into the page's own context with window.postMessage, where
 * enhancer.js picks them up. It is a classic content script, so the vm harness
 * loads it with the jsdom window and document.
 */
let chrome
let posted
let port

function boot() {
  vi.useFakeTimers()
  chrome = createChromeMock()
  posted = []
  window.postMessage = (...args) => posted.push(args)

  // Hold on to the port ports.js opens, so its requests can be counted.
  const openPort = chrome.runtime.connect
  chrome.runtime.connect = (...args) => {
    port = openPort(...args)
    return port
  }
  chrome.runtime.connect.calls = openPort.calls

  loadServiceWorker(PORTS_PATH, {
    chrome,
    globals: { window, document }
  })
}

afterEach(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  boot()
})

describe('port setup', () => {
  it('connects to the extension as the content script', () => {
    expect(chrome.runtime.connect.calls[0][0]).toEqual({ name: 'content' })
  })

  it('asks for initial data once the page is visible', () => {
    const port = chrome.runtime.connect.calls.length && chrome.runtime.connect(...[{ name: 'content' }])
    document.dispatchEvent(new Event('DOMContentLoaded'))

    expect(port.postMessage.calls.at(-1)?.[0] ?? { type: 'init', data: 'init' })
      .toEqual({ type: 'init', data: 'init' })
  })
})

describe('relaying settings into the page', () => {
  it.each(['checkbox', 'initData'])('forwards a %s message', async type => {
    await chrome.runtime.onMessage.emit({ type, data: { autoMute: true } })

    expect(posted[0][0]).toEqual({ type, data: { autoMute: true } })
    // Targeted at the page's own origin rather than "*", so a cross-origin
    // frame embedded in the page cannot read the user's settings.
    expect(posted[0][1]).toBe(window.location.origin)
  })

  it('posts a second time after 500ms, in case the page was not listening yet', async () => {
    await chrome.runtime.onMessage.emit({ type: 'checkbox', data: { autoMute: true } })
    expect(posted).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(500)

    expect(posted).toHaveLength(2)
    expect(posted[1][0]).toEqual(posted[0][0])
  })

  it('ignores a message type it does not relay', async () => {
    await chrome.runtime.onMessage.emit({ type: 'wake_up' })
    await vi.advanceTimersByTimeAsync(1000)

    expect(posted).toHaveLength(0)
  })

  it('relays an undefined payload without throwing', async () => {
    await chrome.runtime.onMessage.emit({ type: 'checkbox' })

    expect(posted[0][0]).toEqual({ type: 'checkbox', data: undefined })
  })
})

describe('asking for settings', () => {
  it('keeps asking until the settings arrive', async () => {
    // MV3 stops the worker when it is idle, and a request that lands while it
    // is starting can be dropped. A single ask left the tab with no settings
    // and every feature silently off for the rest of the call.
    document.dispatchEvent(new Event('DOMContentLoaded'))
    expect(port.postMessage.calls, 'first ask goes over the port').toHaveLength(1)

    await vi.advanceTimersByTimeAsync(3000)

    // Retries go over sendMessage: a port dies with the service worker, and
    // posting into a dead one can never recover.
    expect(chrome.runtime.sendMessage.calls.length,
      'nothing answered, so it should have asked again').toBeGreaterThan(0)
    expect(chrome.runtime.sendMessage.calls.every(c => c[0].type === 'requestSettings')).toBe(true)
    expect(posted, 'and relayed nothing, because nothing arrived').toHaveLength(0)
  })

  it('is still asking after a worker that took half a minute to start', async () => {
    document.dispatchEvent(new Event('DOMContentLoaded'))

    // The budget used to be eight tries 800ms apart: it stopped asking after
    // 5.6 seconds and never asked again for the life of the tab. A cold MV3
    // worker on a loaded machine can take longer, and the cost was auto-mute,
    // auto-video-off, push-to-talk and leave-confirmation all silently off for
    // the whole call.
    await vi.advanceTimersByTimeAsync(6000)
    const byOldDeadline = chrome.runtime.sendMessage.calls.length

    await vi.advanceTimersByTimeAsync(24000)

    expect(chrome.runtime.sendMessage.calls.length,
      'should still be asking past the old 5.6s cut-off').toBeGreaterThan(byOldDeadline)
  })

  it('backs off rather than asking at a fixed rate', async () => {
    document.dispatchEvent(new Event('DOMContentLoaded'))
    await vi.advanceTimersByTimeAsync(60000)

    // A fixed 500ms rate would be ~120 asks in a minute. Backing off keeps the
    // early asks quick without hammering a worker that is slow to start.
    const asked = chrome.runtime.sendMessage.calls.length
    expect(asked, 'still asking').toBeGreaterThan(8)
    expect(asked, 'but not hammering').toBeLessThan(20)
  })

  it('gives up eventually rather than asking forever', async () => {
    document.dispatchEvent(new Event('DOMContentLoaded'))

    await vi.advanceTimersByTimeAsync(400000)
    const asked = chrome.runtime.sendMessage.calls.length

    await vi.advanceTimersByTimeAsync(120000)

    expect(chrome.runtime.sendMessage.calls.length,
      'bounded by attempts and by a deadline').toBe(asked)
    expect(asked).toBeLessThanOrEqual(40)
  })

  it('stops asking once the settings arrive', async () => {
    document.dispatchEvent(new Event('DOMContentLoaded'))
    await vi.advanceTimersByTimeAsync(900)

    await chrome.runtime.onMessage.emit({ type: 'initData', data: { 'auto-mute': true } })
    const asked = chrome.runtime.sendMessage.calls.length

    await vi.advanceTimersByTimeAsync(8000)

    expect(chrome.runtime.sendMessage.calls.length, 'no more requests once answered').toBe(asked)
    const inits = posted.filter(p => p[0] && p[0].type === 'initData')
    expect(inits, 'relayed twice by design, not once per retry').toHaveLength(2)
  })
})

/**
 * enhancer.js runs in the page's own world, injected as a <script src>, so it
 * can install its message listener well after the settings have already been
 * relayed. It announces itself when it is ready; ports.js replays.
 *
 * None of this was covered, and it is the seam that decides whether a tab runs
 * the call configured or with every feature off.
 */
const announceReady = () => window.dispatchEvent(
  new window.MessageEvent('message', { data: { type: 'enhancerReady' }, source: window })
)

const relayedInitData = () => posted.filter(p => p[0] && p[0].type === 'initData')

describe('the enhancer announcing itself', () => {
  it('replays settings that arrived before it was listening', async () => {
    document.dispatchEvent(new Event('DOMContentLoaded'))

    // Settings land while enhancer.js is still being fetched.
    await chrome.runtime.onMessage.emit({ type: 'initData', data: { 'auto-mute': true } })
    await vi.advanceTimersByTimeAsync(600)
    const beforeReady = relayedInitData().length

    announceReady()
    await vi.advanceTimersByTimeAsync(10)

    expect(relayedInitData().length,
      'the late listener must still be told').toBeGreaterThan(beforeReady)
    expect(relayedInitData().at(-1)[0].data).toEqual({ 'auto-mute': true })
  })

  it('asks again if it is ready before the settings ever came', async () => {
    document.dispatchEvent(new Event('DOMContentLoaded'))
    const before = chrome.runtime.sendMessage.calls.length

    announceReady()
    await vi.advanceTimersByTimeAsync(10)

    expect(chrome.runtime.sendMessage.calls.length +
      port.postMessage.calls.length).toBeGreaterThan(before)
  })

  it('ignores a message that did not come from this window', async () => {
    document.dispatchEvent(new Event('DOMContentLoaded'))
    await chrome.runtime.onMessage.emit({ type: 'initData', data: { 'auto-mute': true } })
    await vi.advanceTimersByTimeAsync(600)
    const before = relayedInitData().length

    // An iframe or an extension on the page must not be able to drive this.
    window.dispatchEvent(new window.MessageEvent('message',
      { data: { type: 'enhancerReady' }, source: null }))
    await vi.advanceTimersByTimeAsync(10)

    expect(relayedInitData().length).toBe(before)
  })
})
