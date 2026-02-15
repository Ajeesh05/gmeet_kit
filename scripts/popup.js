/**
 * @fileoverview Main script for popup extension
 * 
 * @author Ajeesh T
 * @version 1.0
 * @date 2024-08-31
 */

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
     * @returns {Promise<void>} Resolves when the data is sored in chrome storage
     */
    async function saveState(id, state) {
        console.log(isUpdatingStorage);
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

    // Toggle between settings and saved meetings
    document.getElementById('settings-button').addEventListener("click", function () {

        const settings = document.getElementById('settings');
        const savedMeets = document.getElementById('saved-group');
        const title = document.getElementById('title');
        const settingIcon = document.getElementById('setting');
        const previousIcon = document.getElementById('previous');

        if (window.getComputedStyle(settings).display == 'none') {
            // Hide saved meeting div
            savedMeets.style.display = 'none';
            // Show settings div
            settings.style.display = 'flex';
            // Hide setting icon
            settingIcon.style.display = 'none';
            // Show previous icon
            previousIcon.style.display = 'block';
            // Change title to settings
            title.textContent = 'Settings';
        } else {
            // Show saved meetings div
            savedMeets.style.display = 'block';
            // Hide settings div
            settings.style.display = 'none';
            // Show settings icon
            settingIcon.style.display = 'block';
            // Hide previous icon
            previousIcon.style.display = 'none';
            // Change title to saved meetings
            title.textContent = 'Saved meetings';
        }

    });

});


