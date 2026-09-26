import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadBackground, meetTab } from '../helpers/load.js'

/**
 * background.js is loaded unmodified through the vm harness.
 *
 * Fake timers are installed before loading, for two reasons: the module starts
 * a 1-second setInterval at top level, and the harness hands the vm its Date
 * and timers at load time, so faking afterwards would come too late.
 */
const NOW = '2026-05-01T10:00:00.000Z'
let chrome
let sw
let consts

function boot(mockOptions = {}, now = NOW) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(now))
  const loaded = loadBackground(mockOptions)
  chrome = loaded.chrome
  sw = loaded.sw
  consts = loaded.consts
  return loaded
}

/** storage.sync.set is called from inside a storage.sync.get callback. */
const settle = () => vi.advanceTimersByTimeAsync(0)

const savedMeetings = () => chrome.storage.sync.set.calls.at(-1)?.[0]?.recentMeetings

afterEach(() => {
  vi.useRealTimers()
})

describe('meetingIdFromUrl', () => {
  beforeEach(() => boot())

  it('reads the code from a plain meeting url', () => {
    expect(consts.meetingIdFromUrl('https://meet.google.com/abc-defg-hij')).toBe('abc-defg-hij')
  })

  it.each([
    ['?authuser=0', 'https://meet.google.com/abc-defg-hij?authuser=0'],
    ['?pli=1', 'https://meet.google.com/abc-defg-hij?pli=1'],
    ['a calendar link', 'https://meet.google.com/abc-defg-hij?hs=224&authuser=2'],
    ['a fragment', 'https://meet.google.com/abc-defg-hij#start'],
    ['a trailing slash', 'https://meet.google.com/abc-defg-hij/']
  ])('still reads the code with %s', (_label, url) => {
    // Meet appends these routinely - several accounts signed in, calendar
    // links, deep links. The old exact-match anchor meant none of those
    // meetings were ever recorded.
    expect(consts.meetingIdFromUrl(url)).toBe('abc-defg-hij')
  })

  it.each([
    'https://meet.google.com/',
    'https://meet.google.com/new',
    'https://meet.google.com/landing',
    'https://meet.google.com/ab-defg-hij',
    'https://meet.google.com/abc-defg-hijk',
    'https://meet.google.com/abcdefghij',
    'http://meet.google.com/abc-defg-hij',
    'https://meet.google.com/lookup/abc-defg-hij',
    'https://meet.google.com.evil.test/abc-defg-hij',
    'https://notmeet.google.com/abc-defg-hij',
    'chrome://extensions',
    ''
  ])('rejects %s', url => {
    expect(consts.meetingIdFromUrl(url)).toBeNull()
  })

  it('lower-cases nothing it should not - uppercase codes are not meetings', () => {
    expect(consts.meetingIdFromUrl('https://meet.google.com/ABC-DEFG-HIJ')).toBeNull()
  })
})

describe('session tracking with query strings', () => {
  it('records a meeting reached with ?authuser=0', async () => {
    boot()
    await chrome.tabs.onUpdated.emit(1,
      { url: 'https://meet.google.com/abc-defg-hij?authuser=0' },
      meetTab(1))

    expect(consts.meetingSessions[1]).toMatchObject({ id: 'abc-defg-hij' })
  })

  it('does not restart the clock when the query string changes mid-meeting', async () => {
    boot()
    await chrome.tabs.onUpdated.emit(1, { url: 'https://meet.google.com/abc-defg-hij' }, meetTab(1))
    const started = consts.meetingSessions[1].start

    vi.setSystemTime(new Date('2026-05-01T10:10:00.000Z'))
    await chrome.tabs.onUpdated.emit(1, { url: 'https://meet.google.com/abc-defg-hij?pli=1' }, meetTab(1))

    expect(consts.meetingSessions[1].start).toBe(started)
  })
})

describe('session tracking', () => {
  it('starts a session when a tab navigates to a meeting', async () => {
    boot()

    await chrome.tabs.onUpdated.emit(1, { url: 'https://meet.google.com/abc-defg-hij' }, meetTab(1))

    expect(consts.meetingSessions[1]).toMatchObject({ id: 'abc-defg-hij' })
  })

  it('records the meeting when the tab navigates away', async () => {
    boot()
    await chrome.tabs.onUpdated.emit(1, { url: 'https://meet.google.com/abc-defg-hij' }, meetTab(1))

    vi.setSystemTime(new Date('2026-05-01T10:30:00.000Z'))
    await chrome.tabs.onUpdated.emit(1, { url: 'https://example.com/' }, { id: 1, url: 'https://example.com/' })
    await settle()

    expect(savedMeetings()['abc-defg-hij']).toMatchObject({ count: 1, totalDurationMinutes: 30 })
    expect(consts.meetingSessions[1]).toBeUndefined()
  })

  it('records the meeting when the tab is closed', async () => {
    boot()
    await chrome.tabs.onUpdated.emit(1, { url: 'https://meet.google.com/abc-defg-hij' }, meetTab(1))

    vi.setSystemTime(new Date('2026-05-01T10:05:00.000Z'))
    await chrome.tabs.onRemoved.emit(1)
    await settle()

    expect(savedMeetings()['abc-defg-hij'].totalDurationMinutes).toBe(5)
  })

  it('treats the #end marker as the end of the meeting', async () => {
    boot()
    await chrome.tabs.onUpdated.emit(1, { url: 'https://meet.google.com/abc-defg-hij' }, meetTab(1))

    vi.setSystemTime(new Date('2026-05-01T10:10:00.000Z'))
    await chrome.tabs.onUpdated.emit(1, { url: 'https://meet.google.com/abc-defg-hij#end' }, meetTab(1))
    await settle()

    expect(savedMeetings()['abc-defg-hij'].totalDurationMinutes).toBe(10)
    expect(consts.meetingSessions[1]).toBeUndefined()
  })

  it('ignores an update that carries no url change', async () => {
    boot()

    await chrome.tabs.onUpdated.emit(1, { status: 'loading' }, meetTab(1))

    expect(consts.meetingSessions[1]).toBeUndefined()
  })

  it('does nothing when a tab with no session is closed', async () => {
    boot()

    await chrome.tabs.onRemoved.emit(99)
    await settle()

    expect(chrome.storage.sync.set.calls).toHaveLength(0)
  })

  it('tracks several meeting tabs independently', async () => {
    boot()

    await chrome.tabs.onUpdated.emit(1, { url: 'https://meet.google.com/aaa-bbbb-ccc' }, meetTab(1))
    await chrome.tabs.onUpdated.emit(2, { url: 'https://meet.google.com/ddd-eeee-fff' }, meetTab(2))

    expect(consts.meetingSessions[1].id).toBe('aaa-bbbb-ccc')
    expect(consts.meetingSessions[2].id).toBe('ddd-eeee-fff')
  })
})

describe('completeSession', () => {
  it('rounds a sub-minute meeting up to one minute', async () => {
    boot()
    await chrome.tabs.onUpdated.emit(1, { url: 'https://meet.google.com/abc-defg-hij' }, meetTab(1))

    vi.setSystemTime(new Date('2026-05-01T10:00:10.000Z'))
    await chrome.tabs.onRemoved.emit(1)
    await settle()

    expect(savedMeetings()['abc-defg-hij'].totalDurationMinutes).toBe(1)
  })

  it('accumulates repeat visits to the same meeting', async () => {
    boot({
      syncStorage: {
        recentMeetings: {
          'abc-defg-hij': {
            count: 2,
            totalDurationMinutes: 45,
            history: [{ startTime: '2026-04-30 09:00:00', endTime: '2026-04-30 09:20:00', duration: 20 }]
          }
        }
      }
    })
    await chrome.tabs.onUpdated.emit(1, { url: 'https://meet.google.com/abc-defg-hij' }, meetTab(1))

    vi.setSystemTime(new Date('2026-05-01T10:15:00.000Z'))
    await chrome.tabs.onRemoved.emit(1)
    await settle()

    expect(savedMeetings()['abc-defg-hij']).toMatchObject({ count: 3, totalDurationMinutes: 60 })
  })

  it('puts the newest visit at the front of the history', async () => {
    boot({
      syncStorage: {
        recentMeetings: {
          'abc-defg-hij': {
            count: 1,
            totalDurationMinutes: 20,
            history: [{ startTime: '2026-04-30 09:00:00', endTime: '2026-04-30 09:20:00', duration: 20 }]
          }
        }
      }
    })
    await chrome.tabs.onUpdated.emit(1, { url: 'https://meet.google.com/abc-defg-hij' }, meetTab(1))
    vi.setSystemTime(new Date('2026-05-01T10:15:00.000Z'))
    await chrome.tabs.onRemoved.emit(1)
    await settle()

    expect(savedMeetings()['abc-defg-hij'].history[0].duration).toBe(15)
  })

  it('keeps at most 10 history entries per meeting', async () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      startTime: `2026-04-${String(i + 1).padStart(2, '0')} 09:00:00`,
      endTime: `2026-04-${String(i + 1).padStart(2, '0')} 09:10:00`,
      duration: 10
    }))
    boot({ syncStorage: { recentMeetings: { 'abc-defg-hij': { count: 10, totalDurationMinutes: 100, history } } } })

    await chrome.tabs.onUpdated.emit(1, { url: 'https://meet.google.com/abc-defg-hij' }, meetTab(1))
    vi.setSystemTime(new Date('2026-05-01T10:05:00.000Z'))
    await chrome.tabs.onRemoved.emit(1)
    await settle()

    expect(savedMeetings()['abc-defg-hij'].history).toHaveLength(10)
    expect(savedMeetings()['abc-defg-hij'].history[0].duration).toBe(5)
  })

  it('keeps at most 10 meetings, dropping the least recent', async () => {
    const recentMeetings = {}
    for (let i = 0; i < 10; i += 1) {
      recentMeetings[`old-meet-${i}`] = {
        count: 1,
        totalDurationMinutes: 10,
        history: [{ startTime: `2026-04-0${(i % 9) + 1} 09:00:00`, endTime: '2026-04-01 09:10:00', duration: 10 }]
      }
    }
    boot({ syncStorage: { recentMeetings } })

    await chrome.tabs.onUpdated.emit(1, { url: 'https://meet.google.com/abc-defg-hij' }, meetTab(1))
    vi.setSystemTime(new Date('2026-05-01T10:05:00.000Z'))
    await chrome.tabs.onRemoved.emit(1)
    await settle()

    const saved = savedMeetings()
    expect(Object.keys(saved)).toHaveLength(10)
    expect(saved['abc-defg-hij']).toBeDefined()
  })
})

describe('formatTime', () => {
  beforeEach(() => boot())

  it('zero-pads every component', () => {
    expect(sw.formatTime(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02 03:04:05')
  })

  it('leaves two-digit components alone', () => {
    expect(sw.formatTime(new Date(2026, 10, 25, 13, 45, 59))).toBe('2026-11-25 13:45:59')
  })
})

describe('findTabsBySubdomain', () => {
  it('matches the hostname exactly, not as a suffix', async () => {
    boot({
      tabs: [
        { id: 1, url: 'https://meet.google.com/abc-defg-hij' },
        { id: 2, url: 'https://notmeet.google.com/x' },
        { id: 3, url: 'https://meet.google.com.evil.test/x' },
        { id: 4, url: 'https://calendar.google.com/' }
      ]
    })

    sw.findTabsBySubdomain('meet.google.com')
    await settle()

    expect(chrome.tabs.sendMessage.calls.map(c => c[0])).toEqual([1])
  })

  it('skips tabs whose url cannot be parsed', async () => {
    boot({ tabs: [{ id: 1, url: 'chrome://extensions' }, { id: 2 }, { id: 3, url: 'https://meet.google.com/a' }] })

    sw.findTabsBySubdomain('meet.google.com')
    await settle()

    expect(chrome.tabs.sendMessage.calls.map(c => c[0])).toEqual([3])
  })

  it('sends the stored settings to each matching tab', async () => {
    boot({
      tabs: [{ id: 1, url: 'https://meet.google.com/a' }, { id: 2, url: 'https://meet.google.com/b' }],
      syncStorage: { settings: { 'auto-mute': true } }
    })

    sw.findTabsBySubdomain('meet.google.com')
    await settle()

    expect(chrome.tabs.sendMessage.calls).toHaveLength(2)
    expect(chrome.tabs.sendMessage.calls[0][1]).toEqual({
      type: 'initData',
      data: { ...consts.DEFAULT_SETTINGS, 'auto-mute': true }
    })
  })

  it('sends a complete settings object even on a fresh profile', async () => {
    // The page reads initSettings['auto-mute'] directly. Handing it undefined
    // threw and took every feature down with it.
    boot({ tabs: [{ id: 1, url: 'https://meet.google.com/a' }], syncStorage: {} })

    sw.findTabsBySubdomain('meet.google.com')
    await settle()

    const sent = chrome.tabs.sendMessage.calls[0][1]
    expect(sent.data).toEqual(consts.DEFAULT_SETTINGS)
    expect(Object.keys(sent.data)).toContain('auto-mute')
  })

  it('sends nothing when no tab matches', async () => {
    boot({ tabs: [{ id: 1, url: 'https://example.com/' }] })

    sw.findTabsBySubdomain('meet.google.com')
    await settle()

    expect(chrome.tabs.sendMessage.calls).toHaveLength(0)
  })
})

describe('side panel availability', () => {
  it('enables the side panel on a Meet tab', async () => {
    boot()

    await sw.handleTabChange({ id: 5, url: 'https://meet.google.com/abc-defg-hij' })

    expect(chrome.sidePanel.setOptions.calls[0][0]).toEqual({ tabId: 5, path: 'sidebar.html', enabled: true })
  })

  it('disables the side panel away from Meet', async () => {
    boot()

    await sw.handleTabChange({ id: 5, url: 'https://example.com/' })

    expect(chrome.sidePanel.setOptions.calls[0][0]).toEqual({ tabId: 5, enabled: false })
  })

  it('ignores a tab with no url', async () => {
    boot()

    await sw.handleTabChange({ id: 5 })

    expect(chrome.sidePanel.setOptions.calls).toHaveLength(0)
  })

  it('enables the side panel for the Meet landing page too', async () => {
    boot()

    await sw.handleTabChange({ id: 5, url: 'https://meet.google.com/' })

    expect(chrome.sidePanel.setOptions.calls[0][0].enabled).toBe(true)
  })
})

describe('crash recovery', () => {
  it('closes out sessions left unfinished by a browser restart', async () => {
    boot({
      localStorage: {
        activeMeetingSessions: {
          7: { id: 'abc-defg-hij', start: '2026-05-01T09:00:00.000Z', lastSeen: '2026-05-01T09:25:00.000Z' }
        }
      }
    })

    await chrome.runtime.onStartup.emit()
    await settle()

    expect(savedMeetings()['abc-defg-hij']).toMatchObject({ count: 1, totalDurationMinutes: 25 })
  })

  it('resumes a session whose tab is still open instead of ending it', async () => {
    // The worker is discarded routinely mid-call. The meeting must survive it.
    boot({
      tabs: [meetTab(7)],
      localStorage: {
        activeMeetingSessions: {
          7: { id: 'abc-defg-hij', start: '2026-05-01T09:00:00.000Z', lastSeen: '2026-05-01T09:59:00.000Z' }
        }
      }
    })
    await settle()

    expect(consts.meetingSessions[7]).toMatchObject({ id: 'abc-defg-hij' })
    expect(savedMeetings()).toBeUndefined()      // not closed out - still running
  })

  it('closes out a restored session whose tab has gone', async () => {
    boot({
      tabs: [],
      localStorage: {
        activeMeetingSessions: {
          7: { id: 'abc-defg-hij', start: '2026-05-01T09:00:00.000Z', lastSeen: '2026-05-01T09:25:00.000Z' }
        }
      }
    })
    await settle()

    expect(savedMeetings()['abc-defg-hij']).toMatchObject({ count: 1, totalDurationMinutes: 25 })
  })

  it('does nothing when there is no unfinished session', async () => {
    boot()

    await chrome.runtime.onStartup.emit()
    await settle()

    expect(chrome.storage.sync.set.calls).toHaveLength(0)
  })
})

describe('side panel request from a content script', () => {
  it('enables the panel and acknowledges', async () => {
    boot()
    const respond = vi.fn()

    await chrome.runtime.onMessage.emit({ action: 'requestEnableSidePanel' }, { tab: { id: 3 } }, respond)
    await settle()

    expect(chrome.sidePanel.setOptions.calls[0][0]).toMatchObject({ tabId: 3, enabled: true })
    expect(respond).toHaveBeenCalledWith({ ok: true })
  })

  it('refuses when the sender has no tab', async () => {
    boot()
    const respond = vi.fn()

    await chrome.runtime.onMessage.emit({ action: 'requestEnableSidePanel' }, {}, respond)

    expect(respond).toHaveBeenCalledWith({ ok: false, error: 'no_tab' })
  })

  it('answers a wake_up ping', async () => {
    boot()
    const respond = vi.fn()

    await chrome.runtime.onMessage.emit({ type: 'wake_up' }, {}, respond)

    expect(respond).toHaveBeenCalledWith({ ok: true })
  })
})

describe('sendMessageToActiveTab', () => {
  it('sends to the active tab when there is one', async () => {
    boot({ tabs: [{ id: 4, active: true, url: 'https://meet.google.com/a' }] })

    sw.sendMessageToActiveTab({ type: 'checkbox' })
    await settle()

    expect(chrome.tabs.sendMessage.calls[0][0]).toBe(4)
    expect(chrome.tabs.sendMessage.calls[0][1]).toEqual({ type: 'checkbox' })
  })

  it.todo('retries with the original message - currently the retry passes the retry count as the message, losing it')
})
