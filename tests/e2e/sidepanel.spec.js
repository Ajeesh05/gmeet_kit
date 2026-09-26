import { test, expect } from './fixtures.js'

/**
 * Chrome's side panel frame cannot be driven by Playwright, so sidebar.html is
 * opened as an ordinary tab. It is the same document running the same script;
 * only the frame around it differs.
 */
const SESSION = {
  meetingId: 'abc-defg-hij',
  sessionId: 's1',
  startedAt: 1_700_000_000_000,
  lastAccessed: 1_700_000_000_000,
  transcript: {
    meetingId: 'abc-defg-hij',
    sessionId: 's1',
    startedAt: 1_700_000_000_000,
    order: ['spk_alpha', 'spk_bravo'],
    entries: {
      spk_alpha: {
        user: 'Alpha',
        avatar: null,
        lastText: 'alpha two',
        messages: [
          { seq: 1, text: 'alpha one', ts: '10:00:00', t: 1_700_000_001_000, replaced: false },
          { seq: 2, text: 'alpha two', ts: '10:00:30', t: 1_700_000_030_000, replaced: false }
        ]
      },
      spk_bravo: {
        user: 'Bravo',
        avatar: null,
        lastText: 'bravo one',
        messages: [
          { seq: 1, text: 'bravo one', ts: '10:00:15', t: 1_700_000_015_000, replaced: false }
        ]
      }
    }
  }
}

const seed = serviceWorker => serviceWorker.evaluate(session => new Promise(r =>
  chrome.storage.local.set({
    [`gmeet_transcript_${session.meetingId}_sessions`]: [session],
    gmeet_transcript_master_index: {
      list: [{
        meetingId: session.meetingId,
        sessionId: session.sessionId,
        startedAt: session.startedAt,
        lastAccessed: 0,
        active: false
      }]
    }
  }, r)), SESSION)

/** Answers the consent card, which now gates the panel on a fresh profile. */
const consent = (serviceWorker, extra = {}) => serviceWorker.evaluate(v => new Promise(r =>
  chrome.storage.sync.set({ transaction_settings: v }, r)),
{ consented: true, autoRecord: false, ...extra })

async function openPanel(context, extensionId) {
  const page = await context.newPage()
  await page.setViewportSize({ width: 400, height: 720 })
  const errors = []
  page.on('pageerror', e => errors.push('pageerror: ' + e))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  await page.goto(`chrome-extension://${extensionId}/sidebar.html`)
  await page.waitForTimeout(800)
  page.errors = errors
  return page
}

test.describe('side panel', () => {
  test('loads without errors', async ({ context, extensionId }) => {
    const panel = await openPanel(context, extensionId)
    expect(panel.errors, panel.errors.join('\n')).toEqual([])
  })

  test('switching between tabs does not throw', async ({ context, extensionId }) => {
    const panel = await openPanel(context, extensionId)
    panel.errors.length = 0

    await panel.click('button[data-tab="history"]')
    await panel.waitForTimeout(400)
    await panel.click('button[data-tab="transcript"]')
    await panel.waitForTimeout(800)
    await panel.click('button[data-tab="settings"]')
    await panel.waitForTimeout(400)

    // tryLoadRecentLiveSession called normalizeMeetingId, which was defined
    // nowhere - so every switch to Live Transcript threw a ReferenceError and
    // discarded whatever had been preloaded.
    expect(panel.errors, panel.errors.join('\n')).toEqual([])
  })

  test('a stored session shows every line, oldest first', async ({ context, extensionId, serviceWorker }) => {
    await consent(serviceWorker)
    await seed(serviceWorker)
    const panel = await openPanel(context, extensionId)

    await panel.click('button[data-tab="history"]')
    await panel.waitForSelector('.history-card')
    await panel.click('.history-card')
    await panel.waitForSelector('.message')

    const lines = await panel.evaluate(() =>
      [...document.querySelectorAll('.message')].map(m => ({
        meta: m.querySelector('.meta').textContent.trim(),
        text: m.querySelector('.text').textContent.trim()
      })))

    // Both renderers used to take only the LAST message of each speaker, and
    // walked the order speakers were first heard rather than the clock.
    expect(lines.map(l => l.text)).toEqual(['alpha one', 'bravo one', 'alpha two'])
    expect(lines.map(l => l.meta.split(' • ')[0])).toEqual(['Alpha', 'Bravo', 'Alpha'])
  })

  test('the speaker filter lists each speaker once', async ({ context, extensionId, serviceWorker }) => {
    await consent(serviceWorker)
    await seed(serviceWorker)
    const panel = await openPanel(context, extensionId)

    await panel.click('button[data-tab="history"]')
    await panel.waitForSelector('.history-card')
    await panel.click('.history-card')
    await panel.waitForSelector('.message')

    const options = await panel.evaluate(() =>
      [...document.querySelectorAll('#speakerFilter option')].map(o => o.textContent))
    expect(options).toEqual(['All Speakers', 'Alpha', 'Bravo'])
  })

  test('a meeting id is rendered as text, not markup', async ({ context, extensionId, serviceWorker }) => {
    await serviceWorker.evaluate(() => new Promise(r => chrome.storage.local.set({
      gmeet_transcript_master_index: {
        list: [{
          meetingId: '<img src=x onerror="window.__xss=1">',
          sessionId: 's9', startedAt: 1_700_000_000_000, lastAccessed: 0
        }]
      }
    }, r)))

    const panel = await openPanel(context, extensionId)
    await panel.click('button[data-tab="history"]')
    await panel.waitForTimeout(600)

    expect(await panel.evaluate(() => !!window.__xss)).toBe(false)
    expect(await panel.evaluate(() =>
      !!document.querySelector('.history-meetid img'))).toBe(false)
  })

  test('asks before it records anything', async ({ context, extensionId }) => {
    const panel = await openPanel(context, extensionId)

    // autoRecord defaulted to true, so opening the panel on a fresh install
    // started recording a meeting without ever asking.
    await panel.waitForSelector('.consent-card')
    expect(await panel.evaluate(() => new Promise(r =>
      chrome.storage.sync.get(['transaction_settings'], d =>
        r(d.transaction_settings?.autoRecord ?? null))))).toBeNull()
  })

  test('"Not now" leaves auto-record off', async ({ context, extensionId }) => {
    const panel = await openPanel(context, extensionId)
    await panel.click('#consentDecline')
    await panel.waitForTimeout(500)

    expect(await panel.evaluate(() => new Promise(r =>
      chrome.storage.sync.get(['transaction_settings'], d => r(d.transaction_settings)))))
      .toMatchObject({ consented: true, autoRecord: false })
  })

  test('tells the truth when the recorder could not start',
    async ({ context, extensionId, serviceWorker }) => {
      await consent(serviceWorker)
      const panel = await openPanel(context, extensionId)

      await serviceWorker.evaluate(async () => {
        const send = p => new Promise(r => chrome.runtime.sendMessage(
          { source: 'gmeet_caption_recorder', payload: p },
          () => { void chrome.runtime.lastError; r() }))
        await send({ type: 'recording_started', meetingId: 'abc-defg-hij', startedAt: Date.now() })
        await send({ type: 'recorder_failed', reason: 'container_missing' })
      })
      await panel.waitForTimeout(400)

      // The panel used to hear none of the recorder's lifecycle messages, so a
      // recorder that never started left the button reading "Stop recording".
      expect(await panel.textContent('#recorderToggle')).toBe('Start recording')
      expect(await panel.getAttribute('#recorderStatus', 'data-state')).toBe('failed')
    })

  test('every control in the bottom bar fits the panel',
    async ({ context, extensionId, serviceWorker }) => {
      await consent(serviceWorker)
      await seed(serviceWorker)
      const panel = await openPanel(context, extensionId)
      await panel.waitForSelector('#controls.visible')

      // Search, the speaker dropdown and two buttons on one row did not fit a
      // 400px panel: Copy was clipped and Export was off-screen entirely.
      const overflow = await panel.evaluate(() => {
        const panelWidth = document.documentElement.clientWidth
        return ['#search', '#speakerFilter', '#copyAll', '#export']
          .map(sel => ({ sel, right: document.querySelector(sel).getBoundingClientRect().right }))
          .filter(x => x.right > panelWidth + 0.5)
          .map(x => x.sel)
      })

      expect(overflow).toEqual([])
    })

  test('a transcript can be deleted', async ({ context, extensionId, serviceWorker }) => {
    await consent(serviceWorker)
    await seed(serviceWorker)
    const panel = await openPanel(context, extensionId)

    await panel.click('button[data-tab="history"]')
    await panel.waitForSelector('.history-card')

    // There was no delete anywhere in the UI: recorded meetings were kept
    // permanently with no way to remove one.
    await panel.click('.history-card .icon-btn.danger')
    await panel.click('.history-card .icon-btn.danger')
    await panel.waitForTimeout(500)

    expect(await panel.evaluate(() => new Promise(r =>
      chrome.storage.local.get(['gmeet_transcript_master_index'], d =>
        r(d.gmeet_transcript_master_index.list))))).toEqual([])
  })
})
