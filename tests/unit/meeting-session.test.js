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

describe('MEETING_REGEX', () => {
  beforeEach(() => boot())

  it('matches a real meeting code', () => {
    expect('https://meet.google.com/abc-defg-hij'.match(consts.MEETING_REGEX)?.[1]).toBe('abc-defg-hij')
  })

  it('rejects the Meet landing page', () => {
    expect(consts.MEETING_REGEX.test('https://meet.google.com/')).toBe(false)
  })

  it('rejects a meeting url carrying a query string', () => {
    // Worth pinning: Meet appends ?authuser=0 when several accounts are signed
    // in, and the exact-match anchor means those visits are not tracked.
    expect(consts.MEETING_REGEX.test('https://meet.google.com/abc-defg-hij?authuser=0')).toBe(false)
  })

  it.each([
    'https://meet.google.com/ABC-DEFG-HIJ',
    'https://meet.google.com/ab-defg-hij',
    'https://meet.google.com/abc-defg-hijk',
    'https://meet.google.com/abcdefghij',
    'http://meet.google.com/abc-defg-hij',
    'https://meet.google.com/lookup/abc-defg-hij'
  ])('rejects %s', url => {
    expect(consts.MEETING_REGEX.test(url)).toBe(false)
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
      syncStorage: { settings: { autoMute: true } }
    })

    sw.findTabsBySubdomain('meet.google.com')
    await settle()

    expect(chrome.tabs.sendMessage.calls).toHaveLength(2)
    expect(chrome.tabs.sendMessage.calls[0][1]).toEqual({ type: 'initData', data: { autoMute: true } })
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
    expect(chrome.storage.local.remove.calls[0][0]).toBe('activeMeetingSessions')
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
