import { test, expect } from './fixtures.js'

/**
 * Runs against a local https server standing in for meet.google.com, so the
 * manifest's content-script matches apply for real. See fixtures.js.
 */

/**
 * Meeting ids currently being tracked, from both the in-memory map and the
 * copy background.js mirrors into storage.local.
 *
 * Reading both is not belt-and-braces: meetingSessions lives only in the
 * service worker's memory, and MV3 recycles that worker freely, so an
 * assertion against the in-memory map alone is a race - and, more to the
 * point, so is the feature. See the ReferenceError/lifecycle findings.
 */
const trackedMeetingIds = serviceWorker =>
  serviceWorker.evaluate(async () => {
    const live = Object.values(meetingSessions).map(s => s.id)
    const stored = Object.values(
      (await chrome.storage.local.get('activeMeetingSessions')).activeMeetingSessions ?? {}
    ).map(s => s.id)
    return [...new Set([...live, ...stored])]
  })

test.describe('on a Meet call page', () => {
  test('exposes enhancer.js to the Meet page as a web-accessible resource', async ({ context, meet, extensionId }) => {
    // inject-scripts.js appends enhancer.js as a <script> and the tag removes
    // itself on load, so the tag is not there to assert on. What must hold for
    // that injection to work at all is the manifest's web_accessible_resources
    // entry - which this checks directly, and deterministically.
    const page = await context.newPage()
    await page.goto(meet.url('abc-defg-hij'))

    const status = await page.evaluate(
      url => fetch(url).then(r => r.status, () => 0),
      `chrome-extension://${extensionId}/scripts/enhancer.js`
    )

    expect(status).toBe(200)
  })

  test('does not expose the content scripts to the page', async ({ context, meet, extensionId }) => {
    // Only enhancer.js is web-accessible; the content scripts must not be.
    const page = await context.newPage()
    await page.goto(meet.url('abc-defg-hij'))

    const status = await page.evaluate(
      url => fetch(url).then(r => r.status, () => 0),
      `chrome-extension://${extensionId}/scripts/content-scripts/ports.js`
    )

    expect(status).toBe(0)
  })

  test('starts tracking the meeting', async ({ context, meet, serviceWorker }) => {
    const page = await context.newPage()
    await page.goto(meet.url('abc-defg-hij'))

    await expect
      .poll(() => trackedMeetingIds(serviceWorker), { timeout: 15_000 })
      .toContain('abc-defg-hij')
  })

  test('relays settings from the extension into the page', async ({ context, meet, serviceWorker }) => {
    const page = await context.newPage()
    await page.goto(meet.url('abc-defg-hij'))
    // The path a popup toggle takes: service worker -> content script (ports.js)
    // -> window.postMessage -> enhancer.js in the page's own context.
    //
    // The send is inside the poll because the content script may not have
    // registered its listener yet, and because a recycled service worker can
    // drop the first attempt.
    await expect
      .poll(
        async () => {
          await serviceWorker
            .evaluate(async () => {
              const [tab] = await chrome.tabs.query({ url: 'https://meet.google.com/*' })
              if (!tab) return
              await chrome.tabs.sendMessage(tab.id, {
                type: 'checkbox',
                data: { option: 'auto-mute', checked: true }
              })
            })
            .catch(() => {})
          return page.evaluate(() => window.__received ?? [])
        },
        { timeout: 15_000 }
      )
      .toContainEqual({ type: 'checkbox', data: { option: 'auto-mute', checked: true } })
  })

  test('records the meeting once the user leaves', async ({ context, meet, serviceWorker }) => {
    const page = await context.newPage()
    await page.goto(meet.url('abc-defg-hij'))
    await expect.poll(() => trackedMeetingIds(serviceWorker), { timeout: 15_000 }).toContain('abc-defg-hij')

    await page.goto('https://meet.google.com/')

    await expect
      .poll(() =>
        serviceWorker.evaluate(async () =>
          Object.keys((await chrome.storage.sync.get('recentMeetings')).recentMeetings ?? {})
        )
      )
      .toContain('abc-defg-hij')
  })

  test('does not track the Meet landing page as a meeting', async ({ context, serviceWorker }) => {
    const page = await context.newPage()
    await page.goto('https://meet.google.com/')
    await page.waitForTimeout(1500)

    expect(await trackedMeetingIds(serviceWorker)).toHaveLength(0)
  })
})
