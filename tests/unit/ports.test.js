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

function boot() {
  vi.useFakeTimers()
  chrome = createChromeMock()
  posted = []
  window.postMessage = (...args) => posted.push(args)

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
    expect(posted[0][1]).toBe('*')
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
