// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createChromeMock } from '../helpers/chrome-mock.mjs'

const SIDEBAR_PATH = resolve(process.cwd(), 'scripts/sidebar.js')
const HTML_PATH = resolve(process.cwd(), 'sidebar.html')

const MEETING = 'abc-defg-hij'
const SESSION_KEY = `gmeet_transcript_${MEETING}_sessions`
const MASTER_KEY = 'gmeet_transcript_master_index'
const SETTINGS_KEY = 'transaction_settings'

/** A stored session, shaped the way caption-recorder.js writes one. */
function session(overrides = {}) {
  return {
    meetingId: MEETING,
    sessionId: 's1',
    startedAt: 1_700_000_000_000,
    lastAccessed: 1_700_000_600_000,
    transcript: {
      meetingId: MEETING,
      sessionId: 's1',
      startedAt: 1_700_000_000_000,
      order: ['spk_alpha', 'spk_bravo'],
      entries: {
        spk_alpha: {
          user: 'Alpha',
          messages: [
            { seq: 1, text: 'the numbers look good', ts: '10:00:00', t: 1_700_000_001_000 },
            { seq: 2, text: 'shipping on friday', ts: '10:05:00', t: 1_700_000_300_000 }
          ]
        },
        spk_bravo: {
          user: 'Bravo',
          messages: [
            { seq: 1, text: 'agreed on the numbers', ts: '10:02:00', t: 1_700_000_120_000 }
          ]
        }
      }
    },
    ...overrides
  }
}

function masterEntry(overrides = {}) {
  return {
    meetingId: MEETING,
    sessionId: 's1',
    startedAt: 1_700_000_000_000,
    lastAccessed: 1_700_000_600_000,
    active: false,
    ...overrides
  }
}

let chrome

/**
 * A fresh seed for every test.
 *
 * The storage mock shallow-copies what it is given, so a nested object reused
 * between tests is the same object - and one test's edit is visible in the
 * next.
 */
const seeded = () => ({
  settings: { consented: true, autoRecord: false },
  local: { [SESSION_KEY]: [session()], [MASTER_KEY]: { list: [masterEntry()] } }
})

/**
 * Loads sidebar.html's body and runs sidebar.js against it.
 *
 * The script is an IIFE that reads its elements at load and calls init(), so
 * the document has to be in place first.
 */
async function boot({ settings = {}, local = {}, tabUrl = `https://meet.google.com/${MEETING}` } = {}) {
  const html = readFileSync(HTML_PATH, 'utf8')
  document.documentElement.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))

  chrome = createChromeMock({
    syncStorage: Object.keys(settings).length ? { [SETTINGS_KEY]: settings } : {},
    localStorage: local,
    tabs: [{ id: 7, active: true, url: tabUrl, title: 'Meet' }]
  })
  globalThis.chrome = chrome

  new Function(readFileSync(SIDEBAR_PATH, 'utf8'))()
  await settle()
}

const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
  await new Promise(r => setTimeout(r, 0))
  for (let i = 0; i < 12; i++) await Promise.resolve()
}

/** Delivers a message the way caption-recorder.js sends one. */
const fromRecorder = payload =>
  chrome.runtime.onMessage.emit({ source: 'gmeet_caption_recorder', payload }, {}, () => {})

const shown = () => [...document.querySelectorAll('.message')]
  .filter(m => m.style.display !== 'none')
  .map(m => m.querySelector('.text').textContent)

const click = sel => document.querySelector(sel).dispatchEvent(
  new window.MouseEvent('click', { bubbles: true, cancelable: true }))

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  delete globalThis.chrome
})

describe('before consent', () => {
  it('shows the consent card and records nothing', async () => {
    await boot()

    // autoRecord used to default to true, so the first time the panel happened
    // to open it started recording a meeting - a decision the user never made,
    // and the opposite of what the privacy policy tells them to do.
    expect(document.querySelector('.consent-card')).not.toBeNull()
    expect(chrome.tabs.sendMessage.calls.filter(c => c[1]?.action === 'start_recording'))
      .toHaveLength(0)
  })

  it('"Not now" turns auto-record off and keeps it off', async () => {
    await boot()
    click('#consentDecline')
    await settle()

    expect(document.querySelector('.consent-card')).toBeNull()
    const saved = chrome.storage.sync._dump()[SETTINGS_KEY]
    expect(saved.consented).toBe(true)
    expect(saved.autoRecord).toBe(false)
  })

  it('"I understand" only enables auto-record when that box is ticked', async () => {
    await boot()
    document.getElementById('consentAutoRecord').checked = true
    click('#consentAccept')
    await settle()

    expect(chrome.storage.sync._dump()[SETTINGS_KEY].autoRecord).toBe(true)
  })

  it('keeps auto-record on for someone upgrading who already had it', async () => {
    // A 2.3.0 user with auto-record on meets this card for the first time on
    // upgrade. An unticked box would turn their own setting off the moment
    // they accepted it.
    await boot({ settings: { autoRecord: true } })

    expect(document.getElementById('consentAutoRecord').checked).toBe(true)
    click('#consentAccept')
    await settle()

    expect(chrome.storage.sync._dump()[SETTINGS_KEY].autoRecord).toBe(true)
  })

  it('is not shown again once answered', async () => {
    await boot({ settings: { consented: true, autoRecord: false } })
    expect(document.querySelector('.consent-card')).toBeNull()
  })
})

describe('what the panel says the recorder is doing', () => {
  const consented = { consented: true, autoRecord: false }

  it('reports a failed start instead of claiming to record', async () => {
    await boot({ settings: consented })
    await fromRecorder({ type: 'recording_started', meetingId: MEETING, startedAt: Date.now() })
    await settle()
    expect(document.getElementById('recorderToggle').textContent).toBe('Stop recording')

    // The recorder emits recorder_failed when the caption container never turns
    // up. Nothing here listened, so the button stayed on "Stop recording" for
    // the rest of the call and the panel claimed a transcript that was never
    // being written.
    await fromRecorder({ type: 'recorder_failed', reason: 'container_missing' })
    await settle()

    expect(document.getElementById('recorderToggle').textContent).toBe('Start recording')
    expect(document.getElementById('recorderStatus').dataset.state).toBe('failed')
    // The header should not still be advertising a live recording either.
    expect(document.getElementById('meetingSub').textContent).not.toContain('Live')
  })

  it('follows a stop that came from the page, not the button', async () => {
    await boot({ settings: consented })
    await fromRecorder({ type: 'recording_started', meetingId: MEETING, startedAt: Date.now() })
    await settle()

    // The user can also stop recording through the recorder's own modal.
    await fromRecorder({ type: 'recording_stopped', reason: 'manual_caption_disabled' })
    await settle()

    expect(document.getElementById('recorderToggle').textContent).toBe('Start recording')
    expect(document.getElementById('recorderStatus').dataset.state).toBe('stopped')
  })

  it('says so when storage is full', async () => {
    await boot({ settings: consented })
    await fromRecorder({ type: 'storage_error', reason: 'QUOTA_BYTES quota exceeded' })
    await settle()

    expect(document.getElementById('recorderStatus').dataset.state).toBe('storage-full')
  })
})

describe('search and the speaker filter together', () => {
  const openStored = async () => {
    click('button[data-tab="history"]')
    await settle()
    click('.history-card')
    await settle()
  }

  it('applies both at once', async () => {
    await boot(seeded())
    await openStored()
    expect(shown()).toHaveLength(3)

    const search = document.getElementById('search')
    search.value = 'numbers'
    search.dispatchEvent(new window.Event('input'))
    await settle()
    expect(shown()).toEqual(['the numbers look good', 'agreed on the numbers'])

    // Both used to write element.style.display directly, so picking a speaker
    // silently threw the search away.
    const filter = document.getElementById('speakerFilter')
    filter.value = 'Alpha'
    filter.dispatchEvent(new window.Event('change'))
    await settle()

    expect(shown()).toEqual(['the numbers look good'])
  })

  it('keeps the chosen speaker when the search changes', async () => {
    await boot(seeded())
    await openStored()

    const filter = document.getElementById('speakerFilter')
    filter.value = 'Alpha'
    filter.dispatchEvent(new window.Event('change'))
    await settle()

    const search = document.getElementById('search')
    search.value = 'friday'
    search.dispatchEvent(new window.Event('input'))
    await settle()

    expect(document.getElementById('speakerFilter').value).toBe('Alpha')
    expect(shown()).toEqual(['shipping on friday'])
  })
})

describe('the speaker filter during a live call', () => {
  it('lists a speaker first heard mid-call', async () => {
    await boot({ settings: { consented: true, autoRecord: false } })

    // populateSpeakerFilter only ran on a full re-render, so during a live call
    // the dropdown stayed empty and the filter did nothing at all.
    await fromRecorder({
      type: 'caption_add', uniqueId: 'spk_a', seq: 1,
      user: 'Alpha', text: 'first line', ts: '10:00:00', t: 1
    })
    await fromRecorder({
      type: 'caption_add', uniqueId: 'spk_b', seq: 1,
      user: 'Bravo', text: 'second line', ts: '10:00:05', t: 2
    })
    await settle()

    expect([...document.querySelectorAll('#speakerFilter option')].map(o => o.textContent))
      .toEqual(['All Speakers', 'Alpha', 'Bravo'])
  })

  it('renders a live caption as text, never as markup', async () => {
    await boot({ settings: { consented: true, autoRecord: false } })
    await fromRecorder({
      type: 'caption_add', uniqueId: 'spk_a', seq: 1,
      user: '<img src=x onerror="window.__xss=1">',
      text: '<script>window.__xss=1<\/script>', ts: '10:00:00', t: 1
    })
    await settle()

    expect(window.__xss).toBeUndefined()
    expect(document.querySelector('.message img')).toBeNull()
    expect(document.querySelector('.message .text').textContent)
      .toBe('<script>window.__xss=1<\/script>')
  })
})

describe('deleting a transcript', () => {
  it('takes two clicks, then removes the session and its index entry', async () => {
    await boot(seeded())
    click('button[data-tab="history"]')
    await settle()

    const del = document.querySelector('.history-card .icon-btn.danger')
    del.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await settle()

    // Armed, not fired: a transcript should not go to a stray tap.
    expect(del.textContent).toBe('Sure?')
    expect(chrome.storage.local._dump()[SESSION_KEY]).toHaveLength(1)

    del.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await settle()

    const stored = chrome.storage.local._dump()
    expect(stored[SESSION_KEY]).toBeUndefined()
    expect(stored[MASTER_KEY].list).toEqual([])
    expect(document.querySelector('.history-card')).toBeNull()
  })

  it('deletes everything from Settings, on a second click', async () => {
    await boot(seeded())
    click('button[data-tab="settings"]')
    await settle()

    const all = document.getElementById('deleteAll')
    all.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await settle()
    expect(chrome.storage.local._dump()[SESSION_KEY]).toHaveLength(1)

    all.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await settle()

    const stored = chrome.storage.local._dump()
    expect(stored[SESSION_KEY]).toBeUndefined()
    expect(stored[MASTER_KEY].list).toEqual([])
  })
})

describe('the history list', () => {
  it('describes each session rather than just naming the meeting', async () => {
    await boot(seeded())
    click('button[data-tab="history"]')
    await settle()

    // Every card used to show the meeting code and a date, so three sessions of
    // the same standup were indistinguishable.
    const stats = document.querySelector('.history-stats').textContent
    expect(stats).toContain('3 lines')
    expect(stats).toContain('10m')
    expect(stats).toContain('Alpha')
    expect(stats).toContain('Bravo')
  })

  it('shows one card per session, not one per index entry', async () => {
    // [...new Set(list)] over objects deduplicates nothing, which is what the
    // old code relied on.
    const dupe = masterEntry()
    await boot({
      settings: { consented: true, autoRecord: false },
      local: { [SESSION_KEY]: [session()], [MASTER_KEY]: { list: [dupe, { ...dupe }, { ...dupe }] } }
    })
    click('button[data-tab="history"]')
    await settle()

    expect(document.querySelectorAll('.history-card')).toHaveLength(1)
  })

  it('says so when there is nothing recorded', async () => {
    await boot({ settings: { consented: true, autoRecord: false } })
    click('button[data-tab="history"]')
    await settle()

    expect(document.querySelector('.history-list .empty').textContent)
      .toBe('No recorded meetings yet.')
  })
})

describe('settings', () => {
  it('writes one field without erasing the others', async () => {
    await boot({ settings: { consented: true, autoRecord: false, mergeWindowSecs: 60, keepMeetings: 15 } })
    click('button[data-tab="settings"]')
    await settle()

    const keep = document.getElementById('keepMeetings')
    keep.value = '5'
    keep.dispatchEvent(new window.Event('change'))
    await settle()

    // setSettings used to replace the whole object, so saving one control threw
    // away every other setting - including the record of consent.
    const saved = chrome.storage.sync._dump()[SETTINGS_KEY]
    expect(saved).toMatchObject({ consented: true, autoRecord: false, mergeWindowSecs: 60, keepMeetings: 5 })
  })

  it('clamps a number typed outside its range', async () => {
    await boot({ settings: { consented: true, autoRecord: false } })
    click('button[data-tab="settings"]')
    await settle()

    const keep = document.getElementById('keepMeetings')
    keep.value = '9999'
    keep.dispatchEvent(new window.Event('change'))
    await settle()

    expect(chrome.storage.sync._dump()[SETTINGS_KEY].keepMeetings).toBe(100)
  })

  it('offers the toggle as a real switch', async () => {
    await boot({ settings: { consented: true, autoRecord: false } })
    click('button[data-tab="settings"]')
    await settle()

    // It was a bare <div>: not focusable, not operable by keyboard, invisible
    // to a screen reader.
    const toggle = document.getElementById('autoRecordToggle')
    expect(toggle.tagName).toBe('BUTTON')
    expect(toggle.getAttribute('role')).toBe('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('false')

    toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    await settle()

    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(chrome.storage.sync._dump()[SETTINGS_KEY].autoRecord).toBe(true)
  })

  it('reports how much room the transcripts take', async () => {
    await boot(seeded())
    click('button[data-tab="settings"]')
    await settle()

    expect(document.getElementById('storageUsage').textContent)
      .toMatch(/^1 transcript stored, using \d+(\.\d+)? (B|KB|MB)\.$/)
  })
})
