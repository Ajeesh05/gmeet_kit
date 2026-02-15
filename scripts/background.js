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
                chrome.tabs.sendMessage(tabs[0].id, message);
            });
        } else if (port.name === "content") {

            if (message.type == 'init')
                findTabsBySubdomain("meet.google.com");
            else if (["transcript"].includes(message.type))
                storeTranscript(message.data);
            else if (message.type == 'download_transcript')
                downloadTranscriptAsCSV(message.data)

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
            data: result.settings
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
                sendMessageToActiveTab(retries - 1);
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


const MEETING_REGEX = /^https:\/\/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})$/;
const meetingSessions = {}; // Stores temporary active meetings (tabId -> { id, startTime })

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
        const url = new URL(changeInfo.url);
        const match = url.href.match(MEETING_REGEX);

        // Detect our special end marker
        if (url.hash === "#end") {
            if (meetingSessions[tabId]) {
                completeSession(tabId);
            }
            return;
        }

        if (match) {
            const id = match[1];
            const start = new Date().toISOString();
            meetingSessions[tabId] = { id, start };
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

// Add a lastSeen property to each session every second
setInterval(() => {
    const now = new Date().toISOString();
    for (const tabId in meetingSessions) {
        meetingSessions[tabId].lastSeen = now;
    }
    chrome.storage.local.set({ activeMeetingSessions: meetingSessions });
}, 1000); // every second

// On extension startup, complete unfinished sessions using lastSeen as end time
chrome.runtime.onStartup.addListener(() => {
    chrome.storage.local.get('activeMeetingSessions', (data) => {
        const sessions = data.activeMeetingSessions || {};
        for (const tabId in sessions) {
            const session = sessions[tabId];
            if (session && session.lastSeen) {
                completeSession("", session, session.lastSeen);
            }
        }
        chrome.storage.local.remove('activeMeetingSessions');
    });
});


// chrome.storage.sync.remove("recentMeetings", function() {
//     console.log("Greeting removed!");
// });
