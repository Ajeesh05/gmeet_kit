/**
 * @fileoverview Backgroud service worker for Gmeet kit
 * 
 * Always run in the background that connects all the tabs and the chrome extensions
 * 
 * @author Ajeesh T
 * @date 2024-08-31
 */


chrome.runtime.onConnect.addListener((port) => {
    // Identify the port's sender (popup or content script)
    port.onMessage.addListener((message) => {
        if (port.name === "popup") {
            // Replay message from panel to content script
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs.length) return;
                chrome.tabs.sendMessage(tabs[0].id, message, () => {
                    // The tab may have no content script (not a Meet page).
                    void chrome.runtime.lastError;
                });
            });
        } else if (port.name === "content") {

            if (message.type == 'init')
                findTabsBySubdomain("meet.google.com");

            // sendMessageOnActivated("meet.google.com");
        }
    });
});

/**
 * Sends extension data to the tab
 *
 * @param {number} tabId
 * 
 * @returns {void}
 */
function sendInitData(tabId) {
    chrome.storage.sync.get('settings', function (result) {
        const message = {
            type: "initData",
            data: { ...DEFAULT_SETTINGS, ...(result.settings || {}) }
        };
        chrome.tabs.sendMessage(tabId, message, function (response) {
            if (chrome.runtime.lastError) {
                console.log(chrome.runtime.lastError.message);
            } else {
                console.log('Message sent to tab:', tabId);
            }
        });
    });
}

/**
 * Sends message to the active tab with retries
 *
 * @param {string} message - Message that has to be sent
 * @param {string} retries - Number of retries
 * 
 * @returns {void}
 */
function sendMessageToActiveTab(message, retries = 5) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs.length > 0) {
            chrome.tabs.sendMessage(tabs[0].id, message, function () {
                if (chrome.runtime.lastError) {
                    console.log(chrome.runtime.lastError.message);
                } else {
                    console.log('Message sent to tab:', tabs[0].id);
                }
            });
        } else if (retries > 0) {
            console.warn('No active tab found. Retrying...');
            setTimeout(function () {
                sendMessageToActiveTab(message, retries - 1);
            }, 500);  // Retry after 500ms
        } else {
            console.log('Failed to find an active tab after multiple attempts.');
        }
    });
}

/**
 * Sends message to all tabs with specific subdomain
 *
 * @param {string} subdomain - subdomain url
 * 
 * @returns {void}
 */
function findTabsBySubdomain(subdomain) {
    // Query all open tabs
    chrome.tabs.query({}, function (tabs) {
        const matchingTabs = tabs.filter(tab => {
            try {
                // Extract the hostname (subdomain + domain) from the tab's URL
                const url = new URL(tab.url);
                return url.hostname === subdomain; // Exact match for the subdomain
            } catch (e) {
                return false; // Skip tabs with invalid URLs (e.g., chrome://)
            }
        });

        if (matchingTabs.length > 0) {
            console.log(`Found ${matchingTabs.length} tab(s) with subdomain "${subdomain}":`, matchingTabs);

            // Send a message to each matching tab
            matchingTabs.forEach(tab => {
                sendInitData(tab.id);
            });
        } else {
            console.log(`No tabs found with subdomain "${subdomain}".`);
        }
    });
}

/**
 * Sends message to the tab with specific subdomain on activated
 *
 * @param {string} subdomain - subdomain url
 * 
 * @returns {void}
 */
function sendMessageOnActivated(subdomain) {
    chrome.tabs.onActivated.addListener(function (activeInfo) {
        const tabId = activeInfo.tabId;

        // Get the tab information
        chrome.tabs.get(tabId, function (tab) {
            const url = new URL(tab.url);

            // Check if the tab's URL matches the specified subdomain
            if (url.hostname === subdomain) {
                sendInitData(tabId);
            }
        });
    });
}


const MEETING_REGEX = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
const meetingSessions = {}; // Stores temporary active meetings (tabId -> { id, startTime })

/**
 * Extracts the meeting code from a Meet url.
 *
 * Meet routinely appends a query string - ?authuser= when several accounts are
 * signed in, ?pli=, ?hs= from calendar links - so the code is read from the
 * path rather than by matching the whole url. The hostname is still compared
 * exactly, which is what keeps meet.google.com.evil.test out.
 *
 * @param {string} url
 *
 * @returns {string|null} the meeting code, or null if this is not a meeting
 */
function meetingIdFromUrl(url) {
    try {
        const u = new URL(url);
        if (u.protocol !== 'https:' || u.hostname !== 'meet.google.com') return null;
        const first = u.pathname.split('/').filter(Boolean)[0];
        return first && MEETING_REGEX.test(first) ? first : null;
    } catch (e) {
        return null; // chrome://, about:blank and friends
    }
}

/**
 * Writes the in-flight sessions to disk so a service-worker restart can pick
 * them back up. MV3 evicts the worker whenever it likes, which used to lose
 * the meeting entirely.
 */
function persistSessions() {
    chrome.storage.local.set({ activeMeetingSessions: meetingSessions });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
        let url;
        try {
            url = new URL(changeInfo.url);
        } catch (e) {
            return;
        }

        // Detect our special end marker
        if (url.hash === "#end") {
            if (meetingSessions[tabId]) {
                completeSession(tabId);
            }
            return;
        }

        const id = meetingIdFromUrl(changeInfo.url);

        if (id) {
            // Navigating within the same meeting must not restart the clock.
            if (meetingSessions[tabId] && meetingSessions[tabId].id === id) return;
            if (meetingSessions[tabId]) completeSession(tabId);

            const start = new Date().toISOString();
            meetingSessions[tabId] = { id, start };
            persistSessions();
        } else if (meetingSessions[tabId]) {
            // User navigated away from meeting
            completeSession(tabId);
        }
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    if (meetingSessions[tabId]) {
        completeSession(tabId);
    }
});

/**
 * Store the meeting info, when the meeting ends
 *
 * @param {int} tabId - subdomain url
 * 
 * @returns {void}
 */
function completeSession(tabId, session = null, endTime = null) {
    if (!session) session = meetingSessions[tabId];
    if (!session) return;

    // Use endTime if provided, otherwise use current time
    const end = endTime ? new Date(endTime) : new Date();
    const start = new Date(session.start);
    const durationMinutes = Math.max(1, Math.round((end - start) / 60000)); // minimum 1 minute

    const startTime = formatTime(start);
    const formattedEndTime = formatTime(end);
    const id = session.id;

    chrome.storage.sync.get({ recentMeetings: {} }, (data) => {
        const meetings = data.recentMeetings;

        if (!meetings[id]) {
            meetings[id] = {
                count: 0,
                totalDurationMinutes: 0,
                history: []
            };
        }

        meetings[id].count += 1;
        meetings[id].totalDurationMinutes += durationMinutes;
        meetings[id].history.unshift({ startTime, endTime: formattedEndTime, duration: durationMinutes });

        // Limit history per meeting to 10 entries
        if (meetings[id].history.length > 10) {
            meetings[id].history = meetings[id].history.slice(0, 10);
        }

        // Limit total meeting IDs to 10 by most recent history[0].startTime
        const sortedEntries = Object.entries(meetings).sort((a, b) => {
            const timeA = new Date(a[1].history[0]?.startTime || 0).getTime();
            const timeB = new Date(b[1].history[0]?.startTime || 0).getTime();
            return timeB - timeA; // most recent first
        });

        const limited = Object.fromEntries(sortedEntries.slice(0, 10)); // keep only top 10 meetings

        chrome.storage.sync.set({ recentMeetings: limited });
    });

    if (tabId) delete meetingSessions[tabId];
    persistSessions();
}


/**
 * Formats the time
 *
 * @param {string} date
 * 
 * @returns {string}
 */
function formatTime(date) {
    const pad = (n) => (n < 10 ? '0' + n : n);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
        + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Heartbeat: refresh lastSeen so an interrupted session can still be closed out
 * with a sensible end time.
 *
 * Durations are rounded to whole minutes, so a 30-second beat is as precise as
 * the output can be. It used to run every second, which wrote the whole session
 * map to disk 86,400 times a day whether or not anything had changed.
 */
const HEARTBEAT_MS = 30000;

setInterval(() => {
    if (Object.keys(meetingSessions).length === 0) return;
    const now = new Date().toISOString();
    for (const tabId in meetingSessions) {
        meetingSessions[tabId].lastSeen = now;
    }
    persistSessions();
}, HEARTBEAT_MS);

/**
 * Recover sessions left behind by a previous worker.
 *
 * This runs every time the worker starts, not only at browser startup. MV3
 * discards the worker after about thirty seconds of inactivity - routinely, in
 * the middle of a call - and meetingSessions lives only in worker memory, so a
 * meeting in progress used to vanish without ever being recorded.
 *
 * A tab that is still open keeps its original start time and carries on being
 * timed. A tab that has gone is closed out at its last heartbeat.
 */
function restoreSessions() {
    chrome.storage.local.get('activeMeetingSessions', (data) => {
        const saved = data.activeMeetingSessions || {};
        if (Object.keys(saved).length === 0) return;

        chrome.tabs.query({}, (tabs) => {
            const open = new Set((tabs || []).map(t => String(t.id)));

            for (const tabId of Object.keys(saved)) {
                const session = saved[tabId];
                if (!session || !session.id) continue;

                if (open.has(String(tabId))) {
                    // Still in the meeting - resume timing it.
                    if (!meetingSessions[tabId]) meetingSessions[tabId] = session;
                } else {
                    completeSession(null, session, session.lastSeen || session.start);
                }
            }

            persistSessions();
        });
    });
}

restoreSessions();
chrome.runtime.onStartup.addListener(restoreSessions);


// chrome.storage.sync.remove("recentMeetings", function() {
//     console.log("Greeting removed!");
// });

/**
 * Settings every option starts at, written once on install.
 *
 * Without this there is no "settings" key at all on a fresh profile, so the
 * page received `undefined` and every feature read from it threw.
 */
const DEFAULT_SETTINGS = {
    'auto-mute': false,
    'auto-video-off': false,
    'disable-mic': false,
    'disable-camera': false,
    'push-to-talk': false,
    'auto-join': false,
    'leave-confirmation': false
};

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.sync.get('settings', (result) => {
        // Merge rather than overwrite: an update must not reset the user's choices.
        chrome.storage.sync.set({ settings: { ...DEFAULT_SETTINGS, ...(result.settings || {}) } });
    });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResp) => {
    if (msg?.action === 'requestEnableSidePanel') {
        const tabId = sender?.tab?.id;
        if (!tabId) { sendResp({ ok: false, error: 'no_tab' }); return; }
        chrome.sidePanel.setOptions({ tabId, path: 'sidebar.html', enabled: true }, () => {
            if (chrome.runtime.lastError) return sendResp({ ok: false, error: chrome.runtime.lastError.message });
            sendResp({ ok: true });
        });
        return true; // keep async
    }
});


chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        handleTabChange(tab);
    } catch (e) {
        console.error('Error in onActivated:', e);
    }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
        handleTabChange(tab);
    }
});

async function handleTabChange(tab) {
    if (!tab || !tab.url) return;

    try {
        if (tab.url.startsWith('https://meet.google.com/')) {
            // Enable side panel when user is on Google Meet
            await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'sidebar.html', enabled: true });
            console.log('Gmeet Kit side panel enabled for Meet tab');
        } else {
            // Disable (auto-close) side panel when switching away
            await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false });
            console.log('Gmeet Kit side panel disabled for non-Meet tab');
        }
    } catch (err) {
        console.error('Error toggling side panel:', err);
    }
}


chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "wake_up") {
        sendResponse({ ok: true });
        return;
    }

    // A content script asking for its settings again.
    //
    // The original request travels over a long-lived port, which dies with the
    // service worker - and MV3 stops the worker whenever it feels like it. A
    // request sent this way starts the worker if it is not running, so the tab
    // cannot end up waiting forever with every feature silently off.
    if (msg.type === "requestSettings") {
        const tabId = sender?.tab?.id;
        if (tabId) sendInitData(tabId);
        sendResponse({ ok: !!tabId });
    }
});

