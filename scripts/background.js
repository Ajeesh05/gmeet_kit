/**
 * @fileoverview Backgroud service worker for Gmeet plus
 * 
 * Always run in the background that connects all the tabs and the chrome extensions
 * 
 * @author Ajeesh T
 * @version 1.0
 * @date 2024-08-31
 */

chrome.runtime.onConnect.addListener((port) => {
    // Identify the port's sender (popup or content script)
    port.onMessage.addListener((message) => {
        if (port.name === "popup") {
            // Relay message from panel to content script
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                chrome.tabs.sendMessage(tabs[0].id, message);
            });
        } else if (port.name === "content") {
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
            data: result.settings
        };
        console.log(message);
        chrome.tabs.sendMessage(tabId, message, function (response) {
            if (chrome.runtime.lastError) {
                console.log(chrome.runtime.lastError.message);
            } else {
                console.log('Message sent to tab:', tabId);
            }
        });
        console.log(message);
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
        debugger;
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