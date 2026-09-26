import { test, expect } from './fixtures.js'

const TOGGLES = [
  'auto-mute',
  'auto-video-off',
  'disable-mic',
  'disable-camera',
  'auto-join',
  'leave-confirmation',
  'push-to-talk'
]

/**
 * The popup opens on the saved-meetings view; the toggles live in a settings
 * panel behind the gear button, so every toggle test navigates there first,
 * the same way a user would.
 */
const openPopup = async (context, extensionId) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/popup.html`)
  await page.locator('#settings-button').click()
  await page.locator('label[for="auto-mute"]').waitFor({ state: 'visible' })
  return page
}

/** The view the popup opens on, where saved meetings are listed. */
const openSavedMeetings = async (context, extensionId) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/popup.html`)
  await page.locator('#linksContainer .link-item').first().waitFor({ state: 'visible' })
  return page
}

/**
 * The toggles are visually hidden inputs driven by a styled <label for=...>,
 * so the label is both what a user clicks and the only visible target.
 */
const toggle = (page, id) => page.locator(`label[for="${id}"]`)

const storedSettings = serviceWorker =>
  serviceWorker.evaluate(async () => (await chrome.storage.sync.get('settings')).settings ?? {})

test.describe('popup', () => {
  test('renders every toggle in the settings panel', async ({ context, extensionId }) => {
    const popup = await openPopup(context, extensionId)

    for (const id of TOGGLES) {
      await expect(toggle(popup, id)).toBeVisible()
    }
  })

  test('opens on the saved-meetings view, not on settings', async ({ context, extensionId }) => {
    const popup = await context.newPage()
    await popup.goto(`chrome-extension://${extensionId}/popup.html`)

    await expect(popup.locator('label[for="auto-mute"]')).toBeHidden()
    await expect(popup.locator('#saved-group')).toBeVisible()
  })

  test('persists a toggle to sync storage', async ({ context, extensionId, serviceWorker }) => {
    const popup = await openPopup(context, extensionId)

    await toggle(popup, 'auto-mute').click()

    await expect.poll(() => storedSettings(serviceWorker).then(s => s['auto-mute'])).toBe(true)
  })

  test('persists turning a toggle back off', async ({ context, extensionId, serviceWorker }) => {
    const popup = await openPopup(context, extensionId)
    await toggle(popup, 'auto-mute').click()
    await expect.poll(() => storedSettings(serviceWorker).then(s => s['auto-mute'])).toBe(true)

    await toggle(popup, 'auto-mute').click()

    await expect.poll(() => storedSettings(serviceWorker).then(s => s['auto-mute'])).toBe(false)
  })

  test('restores saved state when reopened', async ({ context, extensionId, serviceWorker }) => {
    const first = await openPopup(context, extensionId)
    await toggle(first, 'auto-video-off').click()
    await expect.poll(() => storedSettings(serviceWorker).then(s => s['auto-video-off'])).toBe(true)
    await first.close()

    const second = await openPopup(context, extensionId)

    await expect(second.locator('#auto-video-off')).toBeChecked()
  })

  test('keeps each toggle independent', async ({ context, extensionId, serviceWorker }) => {
    const popup = await openPopup(context, extensionId)

    await toggle(popup, 'auto-mute').click()
    await toggle(popup, 'push-to-talk').click()

    await expect.poll(() => storedSettings(serviceWorker)).toMatchObject({
      'auto-mute': true,
      'push-to-talk': true
    })
    // Untouched options are present and false rather than absent: the page
    // reads them directly, and a missing key used to make it throw.
    expect((await storedSettings(serviceWorker))['auto-join']).toBe(false)
  })

  test('a switch flipped with the keyboard is saved like one flipped with the mouse', async ({ context, extensionId, serviceWorker }) => {
    const popup = await openPopup(context, extensionId)

    const wrapper = popup.locator('.checkbox-wrapper-7').filter({ has: popup.locator('#auto-video-off') })
    await wrapper.focus()
    await wrapper.press(' ')

    // Setting .checked directly does not fire a change event, so this used to
    // move the switch on screen and save nothing.
    await expect.poll(() => storedSettings(serviceWorker))
      .toMatchObject({ 'auto-video-off': true })
    await expect(popup.locator('#auto-video-off')).toBeChecked()
  })

  test('renders without logging an error', async ({ context, extensionId }) => {
    const errors = []
    const popup = await context.newPage()
    popup.on('pageerror', err => errors.push(String(err)))
    popup.on('console', msg => msg.type() === 'error' && errors.push(msg.text()))

    await popup.goto(`chrome-extension://${extensionId}/popup.html`)
    await popup.locator('#settings-button').click()
    await expect(toggle(popup, 'auto-mute')).toBeVisible()

    expect(errors).toEqual([])
  })

  test('a saved meeting name is shown as text, not run as markup', async ({ context, extensionId, serviceWorker }) => {
    // Saved links round-trip through storage.sync, so a name entered once
    // arrives on every device. It used to be interpolated into innerHTML.
    await serviceWorker.evaluate(() => new Promise(r => chrome.storage.sync.set({
      links: [{
        name: 'standup"><button id="injected">x</button><a href="',
        url: 'https://meet.google.com/abc-defg-hij',
        editing: false
      }]
    }, r)))

    const popup = await openSavedMeetings(context, extensionId)

    expect(await popup.locator('#injected').count()).toBe(0)
    // The whole name, angle brackets and all, must appear as literal text.
    const names = await popup.evaluate(() =>
      [...document.querySelectorAll('#linksContainer a.link-name')].map(a => a.textContent))
    expect(names).toContain('standup"><button id="injected">x</button><a href="')
  })

  test('a javascript: url cannot survive into a clickable link', async ({ context, extensionId, serviceWorker }) => {
    await serviceWorker.evaluate(() => new Promise(r => chrome.storage.sync.set({
      links: [{ name: 'trap', url: 'javascript:window.__js=1', editing: false }]
    }, r)))

    const popup = await openSavedMeetings(context, extensionId)

    const hrefs = await popup.evaluate(() =>
      [...document.querySelectorAll('#linksContainer a')].map(a => a.getAttribute('href')))
    expect(hrefs.some(h => h && h.startsWith('javascript:'))).toBe(false)
  })
})
