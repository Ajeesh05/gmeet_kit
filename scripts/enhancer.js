/**
 * @fileoverview Main script file for Gmeet plus
 * 
 * @author Ajeesh T
 * @date 2024-08-31
 */

(function (root) {


    // Everything that has to find something in Meet's UI goes through
    // MeetDom (scripts/meet-dom.js), which tries an icon ligature, then the
    // keyboard-shortcut hint, then a multi-language accessible name, then the
    // current jsname. Selectors used to be spelled out here one per control,
    // each depending on a single generated class name.
    const dom = () => root.MeetDom;

    // Object holds camera related methods
    const camera = {

        isDisableInitiated: false,
        disableIntervalId: null,

        /**
         * Get the camera element
         *
         * @returns {element} Camera element
         */
        get: function () {
            return dom().cameraButton();
        },


        /**
         * Get status of the camera
         *
         * @returns {string|undefined} "On", "Off" or undefined if element not detected.
         */
        getStatus: function () {
            const on = dom().cameraOn();
            return on === null ? undefined : (on ? 'On' : 'Off');
        },

        /**
         * Turns off camera
         */
        turnOff: function () {
            if (camera.getStatus() === 'On')
                camera.switch();
        },

        /**
         * Turns on camera
         */
        turnOn: function () {
            if (camera.getStatus() === 'Off')
                camera.switch();
        },

        /**
         * Toggle camera
         */
        switch: function () {
            camera.get().click();
        },

        /**
         * Enable camera
         */
        enable: function () {
            if (camera.get()) {
                camera.get().disabled = false;
                document.removeEventListener("keydown", camera.disableShortcut);
            }
        },

        /**
         * Disable camera
         */
        disable: function () {
            if (camera.get() && initSettings['disable-camera']) {
                document.addEventListener("keydown", camera.disableShortcut);
                camera.turnOff();
                camera.get().disabled = true;
            }
        },

        /**
         * Turns off camera with setTimeout
         */
        turnOffTimeout: function (attempt = 0) {
            camera.turnOff();
            if (camera.getStatus() === 'Off') return;          // done
            if (attempt >= common.MAX_ATTEMPTS) return;        // give up rather than spin
            setTimeout(() => camera.turnOffTimeout(attempt + 1), 1000);
        },

        /**
         * Disable camera with setInterval
         */
        disableTimout: function () {

            if (!camera.isDisableInitiated) {
                camera.isDisableInitiated = true;
                // Kept so switching the option off can stop it; it used to run
                // for the lifetime of the tab whatever the user chose.
                camera.disableIntervalId = setInterval(camera.disable, 2000);
            }
        },

        /**
         * Stop re-disabling and hand control back to the user
         */
        allow: function () {
            if (camera.disableIntervalId) {
                clearInterval(camera.disableIntervalId);
                camera.disableIntervalId = null;
            }
            camera.isDisableInitiated = false;
            camera.enable();
        },

        /**
         * Handles keydown event for disabling camera shortcuts
         *
         * @param {event}
         */
        disableShortcut: function (event) {
            if (event.ctrlKey && event.key === 'e') {
                camera.enable();
                camera.turnOff();
                camera.disable();
                setTimeout(camera.turnOff, 100);
            }
        }
    };

    // Object holds microphone related methods
    const mic = {

        isDisableInitiated: false,
        disableIntervalId: null,

        /**
         * Get the mic element
         * 
         * @returns {element} Mic element
         */
        get: function () {
            return dom().micButton();
        },

        /**
         * Get status of the mic
         * 
         * @returns {string|undefined} On, Off or undefined if element is not found
         */
        getStatus: function () {
            const on = dom().micOn();
            return on === null ? undefined : (on ? 'On' : 'Off');
        },

        /**
         * Turns off mic
         */
        turnOff: function () {
            if (mic.getStatus() === 'On')
                mic.switch();
        },

        /**
         * Turns on mic
         */
        turnOn: function () {
            if (mic.getStatus() === 'Off')
                mic.switch();
        },

        /**
         * Toggle mic
         */
        switch: function () {
            mic.get().click();
        },

        /**
         * Enable mic
         */
        enable: function () {
            if (mic.get()) {
                mic.get().disabled = false;
                document.removeEventListener("keydown", mic.disableShortcut);
            }
        },

        /**
         * Disable mic
         */
        disable: function () {
            if (mic.get() && initSettings['disable-mic']) {
                document.addEventListener("keydown", mic.disableShortcut);
                mic.turnOff();
                mic.get().disabled = true;
            }
        },

        /**
         * Turns off mic with setTimeout
         */
        turnOffTimeout: function (attempt = 0) {
            mic.turnOff();
            if (mic.getStatus() === 'Off') return;             // done
            if (attempt >= common.MAX_ATTEMPTS) return;        // give up rather than spin
            setTimeout(() => mic.turnOffTimeout(attempt + 1), 1000);
        },

        /**
         * Disable mic with setInterval
         */
        disableTimout: function () {

            if (!mic.isDisableInitiated) {
                mic.isDisableInitiated = true;
                // Kept so switching the option off can stop it; it used to run
                // for the lifetime of the tab whatever the user chose.
                mic.disableIntervalId = setInterval(mic.disable, 2000);
            }
        },

        /**
         * Stop re-disabling and hand control back to the user
         */
        allow: function () {
            if (mic.disableIntervalId) {
                clearInterval(mic.disableIntervalId);
                mic.disableIntervalId = null;
            }
            mic.isDisableInitiated = false;
            mic.enable();
        },

        /**
         * Handles keydown event for disabling mic shortcuts
         */
        disableShortcut: function (e) {
            if (e.ctrlKey && e.key === 'd') {
                mic.enable();
                mic.turnOff();
                mic.disable();
                setTimeout(mic.turnOff, 500);
            }
        }

    };

    // Object holds push to talk related methods
    const pushToTalk = {

        /**
         * True when the keystroke belongs to something the user is typing into.
         *
         * Meet's chat box, the "send a message" field and the rename dialogs are
         * all ordinary inputs, so without this a space typed in chat toggled the
         * microphone - twice per word - and everyone heard it.
         *
         * @param {EventTarget} target
         *
         * @returns {boolean}
         */
        isTyping: function (target) {
            if (!target || !target.tagName) return false;
            const tag = target.tagName.toLowerCase();
            return tag === 'input'
                || tag === 'textarea'
                || tag === 'select'
                || target.isContentEditable === true
                || (typeof target.closest === 'function' && !!target.closest('[contenteditable="true"]'));
        },

        /**
         * Handles keydown event for push to talk
         *
         * @param {event} - keydown event
         */
        keyDown: function (event) {
            if (event.code !== 'Space' || common.spacePressed) return;
            if (pushToTalk.isTyping(event.target)) return;
            if (!mic.get()) return;

            event.preventDefault();          // space would also activate a focused button
            common.spacePressed = true;
            mic.switch();
        },

        /**
         * Handles keyup event for push to talk
         *
         * @param {event} - keyup event
         */
        keyUp: function (event) {
            if (event.code !== 'Space') return;

            // Only release a hold this handler actually started, so a space
            // typed in chat can never leave the microphone flipped.
            if (!common.spacePressed) return;

            common.spacePressed = false;
            if (mic.get()) {
                event.preventDefault();
                mic.switch();
            }
        },

        /**
         * Enable push to talk
         */
        enable: function () {
            document.addEventListener('keydown', pushToTalk.keyDown);
            document.addEventListener('keyup', pushToTalk.keyUp);
        },

        /**
         * Disable push to talk
         */
        disable: function () {
            document.removeEventListener('keydown', pushToTalk.keyDown);
            document.removeEventListener('keyup', pushToTalk.keyUp);
        }
    };

    // Object holds join related methods
    const join = {

        /**
         * Get the join button element
         * 
         * @returns {element} join element
         */
        get: function () {
            return dom().joinButton();
        },

        /**
         * Checks if the meet is ready to join or not.
         *
         * Readiness is now derived from the join button itself being present
         * and enabled. It used to look for a "getting ready" spinner by class
         * name; that class no longer exists, so the check always returned true.
         *
         * @returns {boolean} Ready to join or not
         */
        ready: function () {
            return dom().readyToJoin();
        },

        /**
         * Joins the meeting
         */
        join: function () {
            if (join.get())
                join.get().click();
        },

        /**
         * to auto join meeting with setTimeout
         */
        autoJoin: function (attempt = 0) {
            if (join.ready()) {
                join.join();
                return;
            }
            if (attempt >= common.MAX_ATTEMPTS) return;
            setTimeout(() => join.autoJoin(attempt + 1), 1000);
        },

        /**
         * Check if joined the meeting or not
         * 
         * @returns {boolean} joined the meet or not
         */
        isJoined: function () {
            return dom().inCall();
        }
    };

    // Object holds the leave related methods
    const leave = {

        /**
         * Handles click event for confirmation for leaving the meeting
         * 
         * @param {event} - event
         */
        confirm: function (event) {
            if (confirm("Do you want to leave the call?")) {
                window.location.hash = "end";
                return;
            }

            // Meet binds its own handler to this same button, and
            // stopPropagation does nothing to listeners on the same element.
            // Cancelling used to leave the call anyway. Registering in the
            // capture phase puts this ahead of Meet's handler, and
            // stopImmediatePropagation is what actually holds it back.
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
        },

        /**
         * Get the leave call button
         * 
         * @returns {element} leave call button element
         */
        getButton: function () {
            return dom().leaveButton();
        },

        /**
         * Sets confirmation message for leaving the call
         */
        confirmation: function (attempt = 0) {
            const button = leave.getButton();
            if (button) {
                button.removeEventListener("click", leave.confirm, true);
                button.addEventListener("click", leave.confirm, true);   // capture
                return;
            }
            if (attempt >= common.MAX_ATTEMPTS) return;
            setTimeout(() => leave.confirmation(attempt + 1), 1000);
        },

        /**
         * Removes the confirmation message for leaving the call
         */
        confirmationOff: function () {
            if (leave.getButton())
                leave.getButton().removeEventListener("click", leave.confirm, true);
        },

        /**
         * Add hash while ending the meeting, so that the chrome.tab.onUpdated listener on 
         * background.js ends the meeting session and saves it to recent meetings
         */
        addHashListener: function () {

            // Remove hash if it starts with "end_"
            if (window.location.hash == "#end") {
                history.replaceState(null, '', window.location.pathname + window.location.search);
            }

            if (leave.getButton()) {
                leave.getButton().addEventListener("click", function () {
                    // Add a unique hash or query param to the URL
                    if (!initSettings['leave-confirmation'])
                        window.location.hash = "end";
                });
            } else if ((leave.hashAttempts = (leave.hashAttempts || 0) + 1) < common.MAX_ATTEMPTS) {
                setTimeout(leave.addHashListener, 1000);
            }

        }
    };

    const profile = {


        getMoreOptions: function () {
            return dom().selfTileMoreOptions();
        },


        minimize: function () {

            const moreOptionsButton = profile.getMoreOptions();

            if (!moreOptionsButton)
                return;

            moreOptionsButton.click();

            const minimizeLi = Array.from(document.querySelectorAll('li, [role="menuitem"]'))
                .find(item => /minimize|minimieren|minimizar|réduire|riduci|最小化|최소화/i
                    .test(item.getAttribute('aria-label') || item.textContent || ''));

            if (!minimizeLi) {
                // The menu is open and there is nothing here for us. Close it
                // again - leaving it up put a menu over the user's own video.
                document.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true
                }));
                moreOptionsButton.blur();
                return;
            }

            minimizeLi.click();
        },

        isMinimized: function () {
            return Array.from(document.querySelectorAll('button, [role="button"]'))
                .find(el => /expand|erweitern|expandir|agrandir|espandi|展开|확대/i
                    .test(el.getAttribute('aria-label') || '')) || null;
        },


        /**
         * Turns off mic with setTimeout
         */
        minimizeTimeout: function (attempt = 0) {
            if (profile.isMinimized()) return;
            if (attempt >= profile.MAX_MINIMIZE_ATTEMPTS) return;

            profile.minimize();

            if (!profile.isMinimized())
                setTimeout(() => profile.minimizeTimeout(attempt + 1), 1000);
        },

        // Deliberately small. Each attempt opens a menu over the user's own
        // video, so this must not keep trying for the length of the call.
        MAX_MINIMIZE_ATTEMPTS: 3

    };

    // Object holds the common methods
    const common = {

        // How many one-second retries any "wait for Meet's UI" loop may make.
        // Several of these used to recurse forever when the element they were
        // waiting for never appeared, leaving timers running for the whole call.
        MAX_ATTEMPTS: 30,

        // Space pressed or not for push to talk
        spacePressed: false,

        /**
         * Custom setInterval method with number of repetitions
         *
         * @param {Function} callback - callback function to be executed in timeout
         * @param {number} delay - Interval delay in milliseconds
         * @param {number} repetitions - Number of times the function need to be executed
         * 
         */
        setIntervalX: function (callback, delay, repetitions) {
            let x = 0;
            let intervalID = window.setInterval(function () {

                callback();

                if (++x === repetitions)
                    window.clearInterval(intervalID);

            }, delay);
        },

        /**
         * Handles event to stop further propagation
         *
         * @param {event} - event
         */
        stopPropagation: function (event) {
            event.stopPropagation();
        },

        /**
         * Checks if an object is empty or not
         *
         * @param {object} obj - Object need to checked
         * 
         * @returns {boolean} - True if empty, false if not
         */
        isEmpty: function (obj) {
            return Object.keys(obj).length === 0;
        },

        sleep: function (ms) {
            return new Promise((resolve) => setTimeout(resolve, ms));
        },

        getCurrentTime() {
            return (new Date()).toTimeString().split(' ')[0]; // "HH:MM:SS"
        },

        getUid() {
            return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        }
    };

    // Initial setting info decalaration
    let initSettings = {};

    // Listen for messages sent from popup.js
    window.addEventListener("message", (event) => {

        if (event.source === window) {

            // Setting status received from extension
            if (event.data.type === "initData") {
                if (common.isEmpty(initSettings)) {
                    // On a fresh install chrome.storage has no "settings" key,
                    // so data arrives undefined. Assigning it straight through
                    // made every later read throw and killed the whole script.
                    initSettings = event.data.data || {};
                    // Initiates the process
                    init();
                }
            }

            // Receive info when checkbox clicked in extension
            if (event.data.type === "checkbox")
                change(event.data.data.option, event.data.data.checked);

        }
    });

    /**
     * Make effects when changed options in extension
     *
     * @param {string} option - Option that is changed
     * @param {boolean} checked - checked or unchecked
     */
    function change(option, checked) {

        // Holds what method need to be called on every action
        const change = {

            "auto-mute": {
                "true": mic.turnOff,
                "false": false
            },
            "auto-video-off": {
                "true": camera.turnOff,
                "false": false
            },
            "disable-mic": {
                "true": mic.disableTimout,
                "false": mic.allow
            },
            "disable-camera": {
                "true": camera.disableTimout,
                "false": camera.allow
            },
            "push-to-talk": {
                "true": pushToTalk.enable,
                "false": pushToTalk.disable
            },
            "auto-join": {
                "true": join.join,
                "false": false
            },
            "leave-confirmation": {
                "true": leave.confirmation,
                "false": leave.confirmationOff
            }
        }

        initSettings[option] = checked;

        // calls the mathod dynamically
        const handler = change[option] && change[option][checked];
        if (typeof handler === 'function')
            handler();
    }


    function isInstantMeeting() {
        return window.location.pathname == '/new' || window.location.search.includes('adhoc')
    }

    /**
     * Main function that does all operations in meet
     */
    function main() {

        if (initSettings['auto-mute'])
            mic.turnOffTimeout();

        if (initSettings['auto-video-off'])
            camera.turnOffTimeout();

        if (initSettings['disable-mic'])
            mic.disableTimout();

        if (initSettings['disable-camera'])
            camera.disableTimout();

        if (initSettings['push-to-talk'])
            pushToTalk.enable();

        if (initSettings['auto-join'])
            join.autoJoin();

        if (initSettings['leave-confirmation'])
            leave.confirmation();

        leave.addHashListener();

        // chat.recordMessage();

        profile.minimizeTimeout();

    }

    // Tell ports.js the page is listening.
    //
    // Settings used to be relayed on a timer - immediately and again 500ms
    // later - and if this script had not finished loading by then, both copies
    // were lost and nothing ever asked again: the tab sat there with every
    // feature silently off. Announcing removes the guesswork.
    window.postMessage({ type: 'enhancerReady' }, window.location.origin);

    /**
     * Initializes the meet operations
     */
    async function init() {

        if (isInstantMeeting())
            await common.sleep(5000);

        if (document.readyState === 'loading')
            document.addEventListener('DOMContentLoaded', main);
        else
            main();
    }

})(typeof globalThis !== 'undefined' ? globalThis : window);