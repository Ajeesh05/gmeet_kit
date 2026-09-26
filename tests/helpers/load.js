import { fileURLToPath } from 'node:url'
import { createChromeMock } from './chrome-mock.mjs'
import { loadServiceWorker } from './sw-harness.mjs'

export const BACKGROUND_PATH = fileURLToPath(new URL('../../scripts/background.js', import.meta.url))

/**
 * Fresh service worker + chrome mock per test.
 *
 * background.js starts a heartbeat setInterval at module scope, so the caller
 * must install fake timers BEFORE calling this or the interval runs for real
 * and the suite never settles.
 */
export function loadBackground(mockOptions = {}) {
  const chrome = createChromeMock(mockOptions)
  const sw = loadServiceWorker(BACKGROUND_PATH, {
    chrome,
    expose: ['MEETING_REGEX', 'meetingIdFromUrl', 'meetingSessions', 'DEFAULT_SETTINGS']
  })
  return { chrome, sw, consts: sw.__exposed }
}

export const meetTab = (id, code = 'abc-defg-hij', extra = {}) => ({
  id,
  url: `https://meet.google.com/${code}`,
  active: true,
  windowId: 1,
  ...extra
})
