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

});

// Setting button and home button
const settingButton = document.getElementById('settings-button');
const homeButton = document.getElementById('home-button');

/**
 * Page configuration object
 * Define all pages and their properties in one place
 */
const PAGE_CONFIG = {
    savedMeetings: {
        container: 'saved-group',
        title: 'Gmeet kit',
        showHomeButton: false,
        display: 'block',
        headerButton: {
            icon: 'images/settings.svg',
            rotate: true,
            target: 'settingsPage'
        }
    },
    settingsPage: {
        container: 'settings',
        title: 'Settings',
        showHomeButton: true,
        display: 'flex',
        headerButton: {
            icon: 'images/back.svg',
            rotate: false,
            target: 'savedMeetings'
        }
    },
    meetForLaterPage: {
        container: 'meet-for-later',
        title: 'Choose your meeting url',
        showHomeButton: true,
        display: 'block',
        headerButton: {
            icon: 'images/refresh.svg',
            rotate: true,
            target: 'refreshMeetsForLater'
        },
        onEnter: () => {
            // Execute when navigating to this page
            fetchMeetsForLater(10);
        }
    },
    recentMeetingsPage: {
        container: 'recent-meetings',
        title: 'Last 10 meetings',
        showHomeButton: true,
        display: 'block',
        headerButton: {
            icon: 'images/back.svg',
            rotate: false,
            target: 'savedMeetings'
        },
        onEnter: () => {
            // Execute when navigating to this page
            openRecentMeetings(10);
        }
    }
};


/**
 * Page Navigation Manager
 * Centralized navigation system with configuration-driven approach
 */
const PageNavigator = {
    // Cache DOM elements
    elements: {
        popup: document.getElementById('popupContent'),
        title: document.getElementById('title'),
        headerIcon: document.getElementById('header-img'),
        homeButton: homeButton,
        settingButton: settingButton
    },

    // Track current page
    currentPage: 'savedMeetings',

    // Get all page containers
    containers: {},

    /**
     * Initialize the navigator
     */
    init() {
        // Cache all container elements
        Object.keys(PAGE_CONFIG).forEach(pageKey => {
            const config = PAGE_CONFIG[pageKey];
            this.containers[pageKey] = document.getElementById(config.container);
        });

        // Set up event listeners
        this.setupEventListeners();

        // Navigate to initial page
        this.navigateTo('savedMeetings');
    },

    /**
     * Set up navigation event listeners
     */
    setupEventListeners() {
        // Settings/Header button click
        this.elements.settingButton.addEventListener('click', () => {
            const targetPage = this.elements.settingButton.getAttribute('custom-target');

            // Check if it's a special action (not a page navigation)
            if (targetPage === 'refreshMeetsForLater') {
                this.refreshMeetsForLater();
            } else {
                this.navigateTo(targetPage);
            }
        });

        // Home button click
        this.elements.homeButton.addEventListener('click', () => {
            this.navigateTo('savedMeetings');
        });
    },

    /**
     * Navigate to a specific page
     * @param {string} pageName - Name of the page from PAGE_CONFIG
     */
    navigateTo(pageName) {
        const config = PAGE_CONFIG[pageName];

        if (!config) {
            console.error(`Page "${pageName}" not found in PAGE_CONFIG`);
            return;
        }

        // Hide all containers
        Object.values(this.containers).forEach(container => {
            if (container) container.style.display = 'none';
        });

        // Show target container
        if (this.containers[pageName]) {
            this.containers[pageName].style.display = config.display;
        }

        // Update title
        this.elements.title.textContent = config.title;

        // Update home button visibility
        this.elements.homeButton.style.display = config.showHomeButton ? 'inline-block' : 'none';

        // Update header button (settings/back/refresh)
        if (config.headerButton) {
            this.elements.headerIcon.src = config.headerButton.icon;
            this.elements.settingButton.setAttribute('custom-target', config.headerButton.target);

            // Handle rotation class
            if (config.headerButton.rotate) {
                this.elements.settingButton.classList.add('rotate');
            } else {
                this.elements.settingButton.classList.remove('rotate');
            }
        }

        // Execute onEnter callback if defined
        if (typeof config.onEnter === 'function') {
            config.onEnter();
        }

        // Update current page tracker
        this.currentPage = pageName;
    },

    /**
     * Special action: Refresh meeting URLs
     */
    refreshMeetsForLater() {
        fetchMeetsForLater(10);
    },

    /**
     * Get current page name
     * @returns {string} Current page name
     */
    getCurrentPage() {
        return this.currentPage;
    },

    /**
     * Check if a page exists
     * @param {string} pageName - Page name to check
     * @returns {boolean}
     */
    pageExists(pageName) {
        return PAGE_CONFIG.hasOwnProperty(pageName);
    }
};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', function () {
    PageNavigator.init();

});

// Expose PageNavigator globally for use in other scripts
window.PageNavigator = PageNavigator;

// Backward compatibility: Keep the old target object structure
// but redirect to PageNavigator
const target = {
    savedMeetings: () => PageNavigator.navigateTo('savedMeetings'),
    settingsPage: () => PageNavigator.navigateTo('settingsPage'),
    meetForLaterPage: () => PageNavigator.navigateTo('meetForLaterPage'),
    recentMeetingsPage: () => PageNavigator.navigateTo('recentMeetingsPage'),
    refreshMeetsForLater: () => PageNavigator.refreshMeetsForLater()
};