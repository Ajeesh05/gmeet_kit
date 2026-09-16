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
    expect((await storedSettings(serviceWorker))['auto-join']).toBeUndefined()
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
})
