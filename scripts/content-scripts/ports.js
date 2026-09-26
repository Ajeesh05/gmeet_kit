    // Connects port and asks for initial settings data to the extension
    let port = chrome.runtime.connect({ name: "content" });

    // Set once the settings have actually arrived, so the request below can
    // stop retrying.
    let gotSettings = false;

    // The last settings seen, kept so they can be replayed to enhancer.js
    // whenever it announces itself - which may be after they arrived.
    let lastSettings = null;

    /**
     * Hands a message to enhancer.js, which lives in the page's own world.
     *
     * @param {string} type
     * @param {*} data
     */
    function relay(type, data) {
        window.postMessage({ type, data }, window.location.origin);
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (!event.data || event.data.type !== 'enhancerReady') return;

        // The page is listening now. If the settings already came and went,
        // send them again rather than leaving the tab unconfigured.
        if (lastSettings !== null) relay('initData', lastSettings);
        else requestSettings();
    });

    // Passes the message from popup.js to enhancer.js
    chrome.runtime.onMessage.addListener((message) => {

        if (message && message.type === 'initData') gotSettings = true;

        if (['checkbox', 'initData'].includes(message.type)) {
            const data = message.data;
            if (message.type === 'initData') lastSettings = data;

            // Sent twice: enhancer.js may not have installed its listener yet
            // when the first settings message arrives. It also announces itself
            // when it loads, which is what actually closes that race.
            relay(message.type, data);
            setTimeout(function () {
                relay(message.type, data);
            }, 500);
        }
    });

    document.addEventListener('DOMContentLoaded', function () {

        // Check if the page is prerendered or hidden
        if (document.visibilityState === 'hidden') {

            // Add listener to detect when the page becomes visible
            document.addEventListener('visibilitychange', function () {
                if (document.visibilityState === 'visible') {
                    runAfterVisible();
                }
            });
        } else {
            // Page is already visible
            runAfterVisible();
        }
    });

    // Ask the service worker for the settings, and keep asking until they turn
    // up.
    //
    // A single request was a race the page could lose: MV3 stops the worker
    // when it is idle, and a request that arrives while it is starting up can
    // be dropped, after which nothing ever asked again and every feature stayed
    // silently off for that tab.
    // Eight tries 800ms apart gave up after 5.6 seconds and never asked again,
    // which is far too short a budget for a cold MV3 worker on a loaded
    // machine: past that point the tab ran the whole call with auto-mute,
    // auto-video-off, push-to-talk and leave-confirmation all silently off.
    //
    // Backing off keeps the early asks quick, stops hammering a worker that is
    // slow to start, and keeps trying for as long as joining a call plausibly
    // takes. It is still bounded - by attempts and by a deadline, whichever
    // comes first.
    const INIT_RETRY_MS = 500;
    const INIT_RETRY_MAX_MS = 10000;
    const INIT_RETRY_FACTOR = 1.5;
    const INIT_MAX_ATTEMPTS = 40;
    const INIT_DEADLINE_MS = 300000;

    const initStartedAt = Date.now();

    /**
     * How long to wait before attempt n, in ms.
     *
     * @param {number} attempt
     *
     * @returns {number}
     */
    function initBackoff(attempt) {
        return Math.min(INIT_RETRY_MAX_MS, INIT_RETRY_MS * Math.pow(INIT_RETRY_FACTOR, attempt));
    }

    function requestSettings(attempt = 0) {
        if (gotSettings) return;

        if (attempt === 0) {
            try {
                port.postMessage({ type: 'init', data: 'init' });
            } catch (e) {
                port = null;
            }
        } else {
            // Retries go over sendMessage rather than the port. A port dies
            // with the service worker and posting into a dead one does nothing
            // at all, so retrying on it could never recover; sendMessage starts
            // the worker if it is not running.
            try {
                chrome.runtime.sendMessage({ type: 'requestSettings' }, () => {
                    void chrome.runtime.lastError;
                });
            } catch (e) {
                // Extension reloading or gone; the next attempt will find out.
            }
        }

        if (attempt + 1 >= INIT_MAX_ATTEMPTS) return;
        if (Date.now() - initStartedAt >= INIT_DEADLINE_MS) return;
        setTimeout(() => requestSettings(attempt + 1), initBackoff(attempt));
    }

    // Your function to run after the page is visible
    function runAfterVisible() {
        requestSettings();
    }