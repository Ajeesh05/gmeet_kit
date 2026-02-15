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

    /**
     * Saves the state of the checkboxes to chrome storage
     *
     * @param {string} id - Key
     * @param {boolean} state - Value
     * 
     * @returns {void}
     */
    function saveState(id, state) {
        let stateObj = {};
        stateObj[id] = state;
        chrome.storage.sync.set(stateObj);
    }

    /**
     * Restore the saved state to checkboxes while opening extension popup
     */
    function restoreState() {
        chrome.storage.sync.get(checkboxIds, function (result) {
            checkboxIds.forEach(id => {
                if (result[id] !== undefined) {
                    document.getElementById(id).checked = result[id];
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

});


