/**
 * @fileoverview Main script for popup extension
 * 
 * @author Ajeesh T
 * @date 2024-08-31
 */

let meetingId = '';

// Starts at DOM content fully loaded
document.addEventListener('DOMContentLoaded', function () {

    // Open port for sending message to background service worker
    const port = chrome.runtime.connect({ name: "popup" });

    // Selects all the checkboxa
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');

    // Map the NodeList to an array of IDs
    const checkboxIds = Array.from(checkboxes).map(checkbox => checkbox.id);

    // Save changes and sending a message to the content script via background.js
    checkboxes.forEach((checkbox) => {
        checkbox.addEventListener('change', function () {
            // Saving the current state of the settings to chrome storage
            saveState(this.id, this.checked);
            const message = {
                type: "checkbox",
                data: { option: this.id, checked: this.checked }
            };
            // Sends message to service worker
            port.postMessage(message);
        });
    });

    // To enable lock mechanism for chrome storage
    let isUpdatingStorage = false;

    /**
     * Saves the state of the checkboxes to chrome storage one by one with lock mechanism
     *
     * @async
     * @param {string} id - Key
     * @param {boolean} state - Value
     * 
     * @returns {Promise<void>} Resolves when the data is stored in chrome storage
     */
    async function saveState(id, state) {
        // If another instance is running, wait for it to complete
        if (isUpdatingStorage) {
            setTimeout(() => saveState(id, state), 100);
            return;
        }

        // Lock to prevent concurrent execution
        isUpdatingStorage = true;

        // To handle exception raised, if promise is rejected
        try {
            await asyncSave(id, state);
        } catch (error) {
            console.error('failed to save', error)
        }

        // Release the lock
        isUpdatingStorage = false;
    }

    /**
     * Saves the state of the checkboxes to chrome storage
     *
     * @async
     * @param {string} id - Key
     * @param {boolean} state - Value
     * 
     * @returns {Promise<any>} Resolves when the data is sored in chrome storage
     */
    async function asyncSave(id, state) {
        return new Promise((resolve, reject) => {
            chrome.storage.sync.get('settings', function (result) {
                result.settings = result.settings || {};
                result.settings[id] = state;
                // Store the result in chrome storage
                chrome.storage.sync.set(result, () => {
                    if (chrome.runtime.lastError) {
                        // Reject the promise, if storing failes
                        reject(chrome.runtime.lastError);
                    } else {
                        // Resolve the promise, if stored successfully
                        resolve();
                    }
                });
            });
        });
    }

    /**
     * Restore the saved state to checkboxes while opening extension popup
     */
    function restoreState() {
        chrome.storage.sync.get('settings', function (result) {
            const settings = result.settings || {};
            checkboxIds.forEach(id => {
                if (settings[id] !== undefined) {
                    document.getElementById(id).checked = settings[id];
                }
            });
        });
    }

    // Restore saved state to checkboxes
    restoreState();

    /**
     * Clears all the synced data from chrome storage
     */
    function clearStorage() {
        chrome.storage.sync.clear(function () {
            if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError);
            } else {
                console.log('All synced data cleared.');
            }
        });
    }
    // clearStorage();

    // Toggle between pages
    settingButtom.addEventListener("click", function () {
        target[this.getAttribute('custom-target')]();
    });

    // Return to home
    homeButtom.addEventListener("click", function () {
        target.savedMeetings();
    });

});

// Setting button and home button
const settingButtom = document.getElementById('settings-button');
const homeButtom = document.getElementById('home-button');

const target = {

    popup: document.getElementById('popupContent'),
    settings: document.getElementById('settings'),
    savedMeets: document.getElementById('saved-group'),
    title: document.getElementById('title'),
    headerIcon: document.getElementById('header-img'),
    meetForLater: document.getElementById('meet-for-later'),
    recentMettings: document.getElementById('recent-meetings'),

    /**
     * Navigate to saved meetings page
     * 
     * @returns {void}
     */
    savedMeetings: function () {

        // Show saved meetings div
        target.savedMeets.style.display = 'block';
        // Hide settings div
        target.settings.style.display = 'none';
        target.meetForLater.style.display = 'none';
        homeButtom.style.display = 'none';
        // Change title to saved meetings
        target.title.textContent = 'Gmeet kit';
        target.showSettingsIcon();
        settingButtom.setAttribute('custom-target', 'settingsPage');
        target.recentMettings.style.display = 'none';
    },

    /**
     * Navigate to configurations page
     * 
     * @returns {void}
     */
    settingsPage: function () {
        // Hide saved meeting div
        target.savedMeets.style.display = 'none';
        // Show settings div
        target.settings.style.display = 'flex';
        homeButtom.style.display = 'inline-block';
        // Change title to settings
        target.title.textContent = 'Settings';
        target.meetForLater.style.display = 'none';
        target.showBackIcon();
        settingButtom.setAttribute('custom-target', 'savedMeetings');
        target.recentMettings.style.display = 'none';
    },

    /**
     * Navigate to choose your meeting url page
     * 
     * @returns {void}
     */
    meetForLaterPage: function () {
        target.savedMeets.style.display = 'none';
        target.meetForLater.style.display = 'block';
        homeButtom.style.display = 'inline-block';
        target.title.textContent = 'Choose your meeting url';
        target.showRefreshIcon();
        settingButtom.setAttribute('custom-target', 'refreshMeetsForLater');
    },

    recentMeetingsPage: function () {
        target.recentMettings.style.display = 'block';
        target.savedMeets.style.display = 'none';
        target.meetForLater.style.display = 'none';
        homeButtom.style.display = 'inline-block';
        target.title.textContent = 'Last 10 meetings';
    },

    /**
     * Show setting icon
     * 
     * @returns {void}
     */
    showSettingsIcon: function () {
        // Show settings icon
        target.headerIcon.src = 'images/settings.svg';
        settingButtom.classList.add('rotate');
    },

    /**
     * Show back icon
     * 
     * @returns {void}
     */
    showBackIcon: function () {
        target.headerIcon.src = 'images/back.svg';
        settingButtom.classList.remove('rotate');
    },

    /**
     * Show refresh icon
     * 
     * @returns {void}
     */
    showRefreshIcon: function () {
        target.headerIcon.src = 'images/refresh.svg';
        settingButtom.classList.add('rotate');
    },

    /**
     * Refresh meeting urls
     * 
     * @returns {void}
     */
    refreshMeetsForLater: function () {
        fetchMeetsForLater(10);
    }

}

// Listener for message from content-script.js
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "transcript")
        storeTranscript(message.data);
    else if (message.type === "download_transcript")
        downloadTranscriptAsCSV();
});


