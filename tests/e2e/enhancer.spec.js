import { test, expect } from './fixtures.js'

/**
 * enhancer.js runs in the Meet page's own JS context and drives the call
 * controls. These exercise it against the stub described in
 * tests/fixtures/meet-stub.html, through the real settings bridge:
 * storage -> service worker -> ports.js -> postMessage -> enhancer.
 */

const setSettings = (serviceWorker, settings) =>
  serviceWorker.evaluate(s => new Promise(r => chrome.storage.sync.set({ settings: s }, r)), settings)

const clearSettings = serviceWorker =>
  serviceWorker.evaluate(() => new Promise(r => chrome.storage.sync.remove('settings', r)))

async function openMeet(context, meet, code = 'abc-defg-hij', query = '') {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(meet.url(code) + query)
  await page.waitForFunction(() => window.__meet !== undefined)
  page.errors = errors
  return page
}

/**
 * Waits until the settings have actually reached the page.
 *
 * The stub records every message it receives, so this is the real signal
 * rather than a guess at how long the storage -> worker -> ports -> postMessage
 * trip takes on a loaded machine.
 */
const settingsArrived = page =>
  page.waitForFunction(
    () => (window.__received || []).some(m => m.type === 'initData'),
    null,
    { timeout: 15000 }
  )

/**
 * What the page knows, for when an assertion about it fails.
 *
 * These tests have failed on CI while passing locally and under artificial
 * load, which is exactly the case where a bare "expected true to be false" is
 * worth nothing. This distinguishes the possibilities: the settings never
 * reached the page, or enhancer.js never announced itself, or it did both and
 * still could not find the control.
 *
 * @param {import('@playwright/test').Page} page
 *
 * @returns {Promise<string>}
 */
const diagnose = page => page.evaluate(() => {
  const seen = (window.__received || []).map(m => m && m.type)
  const dom = window.MeetDom
  const mic = dom && dom.micButton ? dom.micButton() : null
  const name = mic
    ? (mic.getAttribute('aria-label') || mic.getAttribute('data-tooltip') || mic.textContent || '')
    : null
  return [
    `messages seen by the page: ${JSON.stringify(seen)}`,
    `enhancer announced itself: ${seen.includes('enhancerReady')}`,
    `settings reached the page: ${seen.includes('initData')}`,
    `MeetDom present in page world: ${!!dom}`,
    `mic button resolved: ${!!mic}${name === null ? '' : ` (name: ${JSON.stringify(name.trim())})`}`,
    `MeetDom health: ${dom && dom.health ? JSON.stringify(dom.health()) : 'n/a'}`,
    `stub log: ${JSON.stringify((window.__meet && window.__meet.log()) || [])}`
  ].join('\n')
}).catch(e => `diagnostics unavailable: ${e}`)

const join = async page => {
  await page.waitForSelector('#join:not([disabled])')
  await page.click('#join')
  await page.waitForSelector('[aria-label="Leave call"]')
}

test.describe('settings arriving in the page', () => {
  test('a profile with no saved settings does not break the page', async ({ context, meet, serviceWorker }) => {
    await clearSettings(serviceWorker)
    const page = await openMeet(context, meet)
    await page.waitForTimeout(2000)

    // initSettings used to be assigned undefined here, and every later read of
    // it threw - taking every feature down on a fresh install.
    expect(page.errors, `page errors:\n${page.errors.join('\n')}`).toEqual([])
  })

  test('auto-mute turns the microphone off', async ({ context, meet, serviceWorker }) => {
    await setSettings(serviceWorker, { 'auto-mute': true })
    const page = await openMeet(context, meet)

    // Wait for the settings to actually reach the page rather than for
    // expect.poll's 5s default: on a loaded machine the
    // storage -> worker -> ports -> postMessage trip can take longer, and the
    // rest of this file already waits on the real signal.
    await settingsArrived(page)
    await expect.poll(() => page.evaluate(() => window.__meet.micOn())).toBe(false)
    expect(await page.evaluate(() => window.__meet.camOn())).toBe(true)
  })

  test('auto-video-off turns the camera off', async ({ context, meet, serviceWorker }) => {
    await setSettings(serviceWorker, { 'auto-video-off': true })
    const page = await openMeet(context, meet)

    await settingsArrived(page)
    await expect.poll(() => page.evaluate(() => window.__meet.camOn())).toBe(false)
  })

  test('with everything off the extension leaves the call alone', async ({ context, meet, serviceWorker }) => {
    await setSettings(serviceWorker, {})
    const page = await openMeet(context, meet)
    await page.waitForTimeout(2500)

    expect(await page.evaluate(() => window.__meet.micOn())).toBe(true)
    expect(await page.evaluate(() => window.__meet.camOn())).toBe(true)
    expect(await page.evaluate(() => window.__meet.joined())).toBe(false)
  })
})

test.describe('auto-join', () => {
  test('presses Join once the lobby is ready, and nothing before', async ({ context, meet, serviceWorker }) => {
    await setSettings(serviceWorker, { 'auto-join': true })
    const page = await openMeet(context, meet, 'abc-defg-hij', '?ready=2000')

    // Must not fire while the button is still disabled.
    await page.waitForTimeout(800)
    expect(await page.evaluate(() => window.__meet.joined())).toBe(false)

    await expect.poll(() => page.evaluate(() => window.__meet.joined()), { timeout: 15000 }).toBe(true)
  })

  test('does not press some other button instead', async ({ context, meet, serviceWorker }) => {
    // The old selector was Material's ripple class, which every button carries,
    // so querySelector returned whichever came first in the DOM.
    await setSettings(serviceWorker, { 'auto-join': true })
    const page = await openMeet(context, meet)
    await expect.poll(() => page.evaluate(() => window.__meet.joined()), { timeout: 15000 }).toBe(true)

    const log = await page.evaluate(() => window.__meet.log())
    expect(log.filter(e => e.what === 'captions')).toHaveLength(0)
    expect(log.filter(e => e.what === 'leave-default-ran')).toHaveLength(0)
  })
})

test.describe('push to talk', () => {
  test('does not key the microphone while the user types', async ({ context, meet, serviceWorker }) => {
    await setSettings(serviceWorker, { 'push-to-talk': true })
    const page = await openMeet(context, meet)
    await settingsArrived(page)
    await join(page)
    await page.waitForTimeout(1200)

    await page.click('#chatbox')
    const before = await page.evaluate(() => window.__meet.toggles('mic'))
    await page.type('#chatbox', 'hello there friend')
    await page.waitForTimeout(300)
    const after = await page.evaluate(() => window.__meet.toggles('mic'))

    expect(after - before, 'typing three words must not key the microphone').toBe(0)
  })

  test('unmutes while space is held and mutes again on release', async ({ context, meet, serviceWorker }) => {
    await setSettings(serviceWorker, { 'auto-mute': true, 'push-to-talk': true })
    const page = await openMeet(context, meet)
    await join(page)
    await expect.poll(() => page.evaluate(() => window.__meet.micOn())).toBe(false)

    await page.locator('body').click()
    await page.keyboard.down('Space')
    await page.waitForTimeout(200)
    const held = await page.evaluate(() => window.__meet.micOn())
    await page.keyboard.up('Space')
    await page.waitForTimeout(200)
    const released = await page.evaluate(() => window.__meet.micOn())

    expect(held, 'holding space should unmute').toBe(true)
    expect(released, 'releasing space should mute again').toBe(false)
  })
})

test.describe('leave confirmation', () => {
  test('cancelling keeps you in the call', async ({ context, meet, serviceWorker }) => {
    await setSettings(serviceWorker, { 'leave-confirmation': true })
    const page = await openMeet(context, meet)
    await settingsArrived(page)
    await join(page)
    await page.waitForTimeout(1500)

    let asked = false
    page.on('dialog', d => { asked = true; d.dismiss() })
    await page.click('[aria-label="Leave call"]')
    await page.waitForTimeout(600)

    const log = await page.evaluate(() => window.__meet.log())
    expect(asked, 'the confirmation should be shown').toBe(true)
    // stopPropagation cannot stop a listener on the same element; Meet's own
    // handler used to run anyway and the call ended despite cancelling.
    expect(log.filter(e => e.what === 'leave-default-ran'),
      'cancelling must not let Meet leave the call').toHaveLength(0)
  })

  test('confirming lets the call end', async ({ context, meet, serviceWorker }) => {
    await setSettings(serviceWorker, { 'leave-confirmation': true })
    const page = await openMeet(context, meet)
    await settingsArrived(page)
    await join(page)
    await page.waitForTimeout(1500)

    page.on('dialog', d => d.accept())
    await page.click('[aria-label="Leave call"]')
    await page.waitForTimeout(600)

    const log = await page.evaluate(() => window.__meet.log())
    expect(log.filter(e => e.what === 'leave-default-ran')).toHaveLength(1)
  })
})

test.describe('fit-screen buttons', () => {
  test('one per remote participant, and not on your own tile', async ({ context, meet, serviceWorker }) => {
    await setSettings(serviceWorker, {})
    const page = await openMeet(context, meet)
    await join(page)
    await page.waitForTimeout(3000)

    // Stable across ticks: the button used to be destroyed and rebuilt every
    // 1.5 seconds, and the self tile was no longer being excluded.
    const counts = []
    for (let i = 0; i < 3; i++) {
      counts.push(await page.evaluate(() => window.__meet.fitButtons()))
      await page.waitForTimeout(400)
    }
    expect(counts, `counts were ${counts}`).toEqual([1, 1, 1])

    const onSelf = await page.evaluate(() =>
      !!document.querySelector('[data-self-name] .gmeetkit-fullscreen-btn'))
    expect(onSelf, 'your own tile should not get a fit-screen button').toBe(false)
  })
})

/**
 * Meet rebuilds do not announce themselves. These strip the signals the
 * extension might have leaned on and check the features still work, which is
 * the only way to find out whether the fallbacks are real.
 */
test.describe('surviving a Meet rebuild', () => {
  const stillMutes = (label, query) =>
    test(label, async ({ context, meet, serviceWorker }) => {
      await setSettings(serviceWorker, { 'auto-mute': true, 'auto-video-off': true })
      const page = await openMeet(context, meet, 'abc-defg-hij', query)
      await settingsArrived(page)

      try {
        await expect.poll(() => page.evaluate(() => window.__meet.micOn()), { timeout: 15000 }).toBe(false)
        await expect.poll(() => page.evaluate(() => window.__meet.camOn())).toBe(false)
      } catch (e) {
        throw new Error(`${e.message}\n\n--- page state ---\n${await diagnose(page)}`)
      }
      expect(page.errors, page.errors.join('\n')).toEqual([])
    })

  stillMutes('every jsname renamed', '?strip=jsname')
  stillMutes('every accessible name removed', '?strip=jsname,labels')
  stillMutes('icons gone, falling through to the shortcut hint', '?strip=jsname,icons')
  stillMutes('icons and shortcuts gone, down to the label', '?strip=jsname,icons,shortcuts')
  stillMutes('a German UI with no icons or shortcuts', '?strip=jsname,icons,shortcuts&lang=de')
  stillMutes('a Japanese UI with no icons or shortcuts', '?strip=jsname,icons,shortcuts&lang=ja')

  test('leaving works with no jsname and no labels', async ({ context, meet, serviceWorker }) => {
    await setSettings(serviceWorker, { 'leave-confirmation': true })
    const page = await openMeet(context, meet, 'abc-defg-hij', '?strip=jsname,labels')
    await settingsArrived(page)
    await page.waitForSelector('#join:not([disabled])')
    await page.click('#join')
    await page.waitForSelector('#leave')
    await page.waitForTimeout(1500)

    let asked = false
    page.on('dialog', d => { asked = true; d.dismiss() })
    await page.click('#leave')
    await page.waitForTimeout(600)

    expect(asked, 'the leave button was still found by its call_end icon').toBe(true)
  })
})
