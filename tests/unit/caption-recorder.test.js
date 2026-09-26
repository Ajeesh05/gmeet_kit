// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createChromeMock } from '../helpers/chrome-mock.mjs'

const RECORDER_PATH = resolve(process.cwd(), 'scripts/content-scripts/caption-recorder.js')
const MEETDOM_PATH = resolve(process.cwd(), 'scripts/meet-dom.js')

/**
 * caption-recorder.js parses Meet's live captions into a stored transcript.
 *
 * The DOM built here mirrors what real Meet renders, captured from a live call:
 *
 *   <div class="nMcdL">
 *     <div class="adE6rb">
 *       <img src="…" data-iml="539902.82">
 *       <div class="KcIKyf"><span class="NWpY1d">Alpha</span></div>
 *     </div>
 *     <div class="ygicle VbkSUe">…text…</div>
 *   </div>
 *
 * Two details drive every test below, and both were sources of data loss:
 * a speaker change opens a NEW .nMcdL block, and data-iml is a per-element
 * render timestamp, so it differs between two blocks from the same person.
 */
let chrome

function boot(localStorage = {}) {
  // Each boot loads another copy of the recorder into the same jsdom document,
  // and listeners bound to `document` outlive `document.body.innerHTML = ...`.
  // Without this, the previous test's recorder is still intercepting keys.
  try { window.__GMEET_CAPTION_RECORDER?.stop() } catch (e) { /* none yet */ }

  vi.useFakeTimers()
  chrome = createChromeMock({
    syncStorage: { transaction_settings: { autoRecord: false } },
    localStorage
  })
  globalThis.chrome = chrome

  document.body.innerHTML = `
    <button jsname="RrG0hf" aria-label="Turn on captions"></button>
    <div jsname="dsyhDe" aria-label="Captions"></div>`

  // Meet toggles the label; the recorder reads it to know whether captions are on.
  document.querySelector('button[jsname="RrG0hf"]').addEventListener('click', function () {
    const on = /^turn off/i.test(this.getAttribute('aria-label'))
    this.setAttribute('aria-label', on ? 'Turn on captions' : 'Turn off captions')
  })

  // meet-dom.js first: it is what the recorder asks where things are.
  new Function(readFileSync(MEETDOM_PATH, 'utf8'))()
  new Function(readFileSync(RECORDER_PATH, 'utf8'))()
}

/** Opens a new caption block, as Meet does when a different person speaks. */
let imlCounter = 1000
function speak(name, text, { sameBlockAs = null, avatar = null } = {}) {
  const captions = document.querySelector('[aria-label="Captions"]')
  let block = sameBlockAs

  if (!block) {
    block = document.createElement('div')
    block.className = 'nMcdL'
    const head = document.createElement('div')
    head.className = 'adE6rb'
    const img = document.createElement('img')
    img.src = avatar || `https://lh3.googleusercontent.com/mm/${name}`
    img.dataset.iml = String(imlCounter += 137)      // fresh per block, as Meet does
    const who = document.createElement('div')
    who.className = 'KcIKyf'
    const span = document.createElement('span')
    span.className = 'NWpY1d'
    span.textContent = name
    who.appendChild(span)
    head.append(img, who)
    const body = document.createElement('div')
    body.className = 'ygicle VbkSUe'
    block.append(head, body)
    captions.appendChild(block)
  }

  block.querySelector('.ygicle').textContent = text
  return block
}

const startRecorder = async () => {
  await chrome.runtime.onMessage.emit({ action: 'start_recording' }, {}, () => {})
  await vi.advanceTimersByTimeAsync(1200)
}

/** MutationObserver callbacks are microtasks; let them drain. */
const settle = () => vi.advanceTimersByTimeAsync(50)

/**
 * Lets the debounced save fire.
 *
 * The recorder writes the transcript at most once every 2s rather than on
 * every caption mutation, so reading storage straight after speaking sees
 * nothing. Tests that assert on what was stored wait for that timer.
 */
const flush = () => vi.advanceTimersByTimeAsync(2100)

const storedTranscript = () => {
  const call = chrome.storage.local.set.calls
    .map(c => c[0])
    .reverse()
    .find(o => Object.keys(o).some(k => k.endsWith('_sessions')))
  if (!call) return null
  const key = Object.keys(call).find(k => k.endsWith('_sessions'))
  return call[key].at(-1).transcript
}

const linesOf = t => Object.values(t.entries)
  .flatMap(e => e.messages.map(m => ({ user: e.user, text: m.text, seq: m.seq, t: m.t })))
  .sort((a, b) => a.t - b.t || a.seq - b.seq)

beforeEach(() => {
  delete window.location
  window.location = new URL('https://meet.google.com/abc-defg-hij')
  imlCounter = 1000
})

afterEach(() => {
  vi.useRealTimers()
  delete globalThis.chrome
})

describe('finding the captions button', () => {
  it('finds it by aria-label even when the jsname has changed', async () => {
    boot()
    document.querySelector('button[jsname="RrG0hf"]').setAttribute('jsname', 'somethingElse')

    await startRecorder()

    expect(document.querySelector('button[aria-label]').getAttribute('aria-label'))
      .toBe('Turn off captions')
  })

  it('does not mistake "Jump to most recent captions" for the toggle', async () => {
    boot()
    const decoy = document.createElement('button')
    decoy.setAttribute('aria-label', 'Jump to most recent captions')
    document.body.prepend(decoy)

    await startRecorder()

    // The real toggle flipped; the decoy was left alone.
    expect(decoy.getAttribute('aria-label')).toBe('Jump to most recent captions')
    expect(document.querySelector('button[jsname="RrG0hf"]').getAttribute('aria-label'))
      .toBe('Turn off captions')
  })
})

describe('one speaker, several utterances', () => {
  it('keeps every utterance instead of overwriting the last', async () => {
    boot()
    await startRecorder()

    speak('Alpha', 'first thing'); await settle()
    speak('Alpha', 'second thing'); await settle()
    speak('Alpha', 'third thing'); await settle()

    await flush()
    expect(linesOf(storedTranscript()).map(l => l.text))
      .toEqual(['first thing', 'second thing', 'third thing'])
  })

  it('corrects a caption that is still growing rather than duplicating it', async () => {
    boot()
    await startRecorder()

    const block = speak('Alpha', 'the'); await settle()
    speak('Alpha', 'the quick', { sameBlockAs: block }); await settle()
    speak('Alpha', 'the quick brown fox', { sameBlockAs: block }); await settle()

    await flush()
    expect(linesOf(storedTranscript()).map(l => l.text)).toEqual(['the quick brown fox'])
  })
})

describe('two speakers', () => {
  it('keeps them apart and keeps the conversation in order', async () => {
    boot()
    await startRecorder()

    speak('Alpha', 'alpha one'); await settle()
    speak('Bravo', 'bravo one'); await settle()
    speak('Alpha', 'alpha two'); await settle()

    await flush()
    const lines = linesOf(storedTranscript())
    expect(lines.map(l => `${l.user}: ${l.text}`)).toEqual([
      'Alpha: alpha one',
      'Bravo: bravo one',
      'Alpha: alpha two'
    ])
  })

  it('does not split one person into several speakers', async () => {
    // Real Meet gives each caption block a fresh data-iml, which is what used
    // to mint a new identity per utterance: two speakers, five entries.
    boot()
    await startRecorder()

    speak('Alpha', 'alpha one'); await settle()
    speak('Bravo', 'bravo one'); await settle()
    speak('Alpha', 'alpha two'); await settle()

    await flush()
    const transcript = storedTranscript()
    expect(Object.keys(transcript.entries)).toHaveLength(2)
    expect(Object.values(transcript.entries).map(e => e.user).sort()).toEqual(['Alpha', 'Bravo'])
  })

  it('tells apart two people who share a display name', async () => {
    boot()
    await startRecorder()

    speak('Sam', 'first sam', { avatar: 'https://lh3.googleusercontent.com/mm/one' })
    await settle()
    speak('Sam', 'second sam', { avatar: 'https://lh3.googleusercontent.com/mm/two' })
    await settle()

    await flush()
    expect(Object.keys(storedTranscript().entries)).toHaveLength(2)
  })
})

describe('the captions hotkey', () => {
  /** Meet's own shortcut for captions is a bare "c". */
  const pressC = target => {
    const ev = new window.KeyboardEvent('keydown', { key: 'c', bubbles: true, cancelable: true })
    target.dispatchEvent(ev)
    return ev
  }

  it('does not fire while the user is typing', async () => {
    boot()
    await startRecorder()
    speak('Alpha', 'hello'); await settle()

    // Meet's chat box, the rename field, the participant search - all of them.
    const chat = document.createElement('textarea')
    document.body.appendChild(chat)
    const ev = pressC(chat)
    await settle()

    // The recorder listens in the capture phase, so with no guard it swallowed
    // every "c" typed anywhere in Meet and popped the modal instead.
    expect(ev.defaultPrevented).toBe(false)
    expect(document.getElementById('gcr-modal')).toBeNull()
  })

  it('does not fire inside a contenteditable', async () => {
    boot()
    await startRecorder()

    const rich = document.createElement('div')
    rich.setAttribute('contenteditable', 'true')
    document.body.appendChild(rich)
    const inner = document.createElement('span')
    rich.appendChild(inner)

    const ev = pressC(inner)
    await settle()

    expect(ev.defaultPrevented).toBe(false)
    expect(document.getElementById('gcr-modal')).toBeNull()
  })

  it('still intercepts the shortcut outside a text field', async () => {
    boot()
    await startRecorder()
    speak('Alpha', 'hello'); await settle()

    const ev = pressC(document.body)
    await settle()

    expect(ev.defaultPrevented).toBe(true)
    expect(document.getElementById('gcr-modal')).not.toBeNull()
  })

  it('ignores the shortcut when a modifier is held', async () => {
    boot()
    await startRecorder()

    const ev = new window.KeyboardEvent('keydown',
      { key: 'c', ctrlKey: true, bubbles: true, cancelable: true })
    document.body.dispatchEvent(ev)
    await settle()

    expect(ev.defaultPrevented).toBe(false)
  })
})

describe('how often the transcript is written', () => {
  const writes = () => chrome.storage.local.set.calls
    .filter(c => Object.keys(c[0]).some(k => k.endsWith('_sessions'))).length

  it('writes once for a sentence that arrives word by word', async () => {
    boot()
    await startRecorder()
    const before = writes()

    // Meet streams a caption a word at a time. Saving on every mutation cost
    // one full rewrite of the transcript per word - 24 writes for this line,
    // and because each write grows with the transcript, quadratically more as
    // the meeting goes on.
    const words = 'so what I wanted to say about the numbers is this'.split(' ')
    let block = null
    for (let i = 0; i < words.length; i++) {
      block = speak('Alpha', words.slice(0, i + 1).join(' '), { sameBlockAs: block })
      await settle()
    }
    await flush()

    expect(writes() - before).toBe(1)
    expect(linesOf(storedTranscript()).map(l => l.text))
      .toEqual(['so what I wanted to say about the numbers is this'])
  })

  it('does not lose the last words when the recorder stops', async () => {
    boot()
    await startRecorder()

    speak('Alpha', 'the very last thing said')
    await settle()
    // No flush: the save is still pending when the recorder stops.
    await chrome.runtime.onMessage.emit({ action: 'stop_recording' }, {}, () => {})
    await settle()

    expect(linesOf(storedTranscript()).map(l => l.text)).toEqual(['the very last thing said'])
  })
})

describe('starting and stopping repeatedly', () => {
  it('stops intercepting Meet\'s own shortcut once recording stops', async () => {
    boot()
    await startRecorder()
    speak('Alpha', 'hello'); await settle()

    await chrome.runtime.onMessage.emit({ action: 'stop_recording' }, {}, () => {})
    await settle()

    // The recorder intercepts "c" only to ask before captions go off with a
    // recording running. With no recording it must give the key back to Meet -
    // the listeners were added on every start and removed on no stop.
    const ev = new window.KeyboardEvent('keydown', { key: 'c', bubbles: true, cancelable: true })
    document.body.dispatchEvent(ev)
    await settle()

    expect(ev.defaultPrevented).toBe(false)
  })

  it('does not stack a second interception on the next start', async () => {
    boot()
    await startRecorder()
    await chrome.runtime.onMessage.emit({ action: 'stop_recording' }, {}, () => {})
    await startRecorder()
    speak('Alpha', 'hello'); await settle()

    // Counting modals would not show a duplicate - showDisableModal reuses one
    // element by id - so count what a single keypress sets off instead.
    let intercepts = 0
    const realGet = chrome.storage.sync.get
    chrome.storage.sync.get = (...args) => { intercepts++; return realGet(...args) }

    document.body.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'c', bubbles: true, cancelable: true }))
    await settle()
    chrome.storage.sync.get = realGet

    expect(intercepts).toBe(1)
  })
})

describe('auto-start', () => {
  it('stays off until the user has opted in', async () => {
    vi.useFakeTimers()
    chrome = createChromeMock({ syncStorage: {}, localStorage: {} })
    globalThis.chrome = chrome
    document.body.innerHTML = `
      <button jsname="RrG0hf" aria-label="Turn on captions"></button>
      <div jsname="dsyhDe" aria-label="Captions"></div>`
    new Function(readFileSync(MEETDOM_PATH, 'utf8'))()
    new Function(readFileSync(RECORDER_PATH, 'utf8'))()
    await vi.advanceTimersByTimeAsync(2000)

    // An unset setting is not consent.
    expect(document.querySelector('button[jsname="RrG0hf"]').getAttribute('aria-label'))
      .toBe('Turn on captions')
  })
})
