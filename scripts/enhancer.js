/**
 * @fileoverview Main script file for Gmeet plus
 * 
 * @author Ajeesh T
 * @version 2.1
 * @date 2024-08-31
 */
const meetingId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

(function () {


    // To select camera element from DOM
    const cameraIndicator = {
        attribute: "aria-label",
        whenOn: "Turn off camera",
        whenOff: "Turn on camera"
    };

    // To select mic element from DOM
    const micIndicator = {
        attribute: "aria-label",
        whenOn: "Turn off microphone",
        whenOff: "Turn on microphone"
    };

    // To select join button element from DOM
    const joinIndicator = {
        attribute: "class",
        value: "UywwFc-RLmnJb"
    };

    // To select getting ready element from DOM
    const gettingReadyIndicator = {
        attribute: "class",
        value: "OMfBQ"
    };

    // To select leave button element from DOM
    const leaveIndicator = {
        attribute: "aria-label",
        value: "Leave call"
    };

    // Object holds camera related methods
    const camera = {

        isDisableInitiated: false,

        /**
         * Get the camera element
         *
         * @returns {element} Camera element
         */
        get: function () {
            return document.querySelector(`
                [${cameraIndicator.attribute}*="${cameraIndicator.whenOn}"], 
                [${cameraIndicator.attribute}*="${cameraIndicator.whenOff}"]
            `);
        },


        /**
         * Get status of the camera
         *
         * @returns {string|undefined} "On", "Off" or undefined if element not detected.
         */
        getStatus: function () {
            if (document.querySelector(`[${cameraIndicator.attribute}*="${cameraIndicator.whenOn}"]`))
                return 'On';
            else if (document.querySelector(`[${cameraIndicator.attribute}*="${cameraIndicator.whenOff}"]`))
                return 'Off';
            else
                return undefined;
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
        turnOffTimeout: function () {
            camera.turnOff();
            if (!join.ready() || !camera.get() || camera.getStatus() === 'On')
                setTimeout(camera.turnOffTimeout, 1000);
        },

        /**
         * Disable camera with setInterval
         */
        disableTimout: function () {

            if (!camera.isDisableInitiated) {
                camera.isDisableInitiated = true;
                setInterval(camera.disable, 2000);
            }
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
        /**
         * Get the mic element
         * 
         * @returns {element} Mic element
         */
        get: function () {
            return document.querySelector(`
                [${micIndicator.attribute}*="${micIndicator.whenOn}"], 
                [${micIndicator.attribute}*="${micIndicator.whenOff}"]
            `);
        },

        /**
         * Get status of the mic
         * 
         * @returns {string|undefined} On, Off or undefined if element is not found
         */
        getStatus: function () {
            if (document.querySelector(`[${micIndicator.attribute}*="${micIndicator.whenOn}"]`))
                return 'On';
            else if (document.querySelector(`[${micIndicator.attribute}*="${micIndicator.whenOff}"]`))
                return 'Off';
            else
                return undefined;
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
        turnOffTimeout: function () {
            mic.turnOff();
            if (!join.ready() || !mic.get() || mic.getStatus() === 'On')
                setTimeout(mic.turnOffTimeout, 1000);
        },

        /**
         * Disable mic with setInterval
         */
        disableTimout: function () {

            if (!mic.isDisableInitiated) {
                mic.isDisableInitiated = true;
                setInterval(mic.disable, 2000);
            }
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
         * Handles keydown event for push to talk
         *
         * @param {event} - keydown event
         */
        keyDown: function (event) {
            if (event.code === 'Space' && !common.spacePressed) {
                if (mic.get()) {
                    common.spacePressed = true;
                    mic.switch();
                }
            }

        },

        /**
         * Handles keyup event for push to talk
         *
         * @param {event} - keyup event
         */
        keyUp: function (event) {
            if (event.code === 'Space') {
                common.spacePressed = false;
                if (mic.get()) {
                    mic.switch();
                }
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
            return document.querySelector(`[${joinIndicator.attribute}="${joinIndicator.value}"]`);
        },

        /**
         * Get the getting ready element to check if the meet is ready to join
         * 
         * @returns {element} Getting ready element
         */
        gettingReady: function () {
            return document.querySelector(`[${gettingReadyIndicator.attribute}="${gettingReadyIndicator.value}"]`)
        },

        /**
         * Checks if the meet is ready to join or not.
         * 
         * @returns {boolean} Ready to join or not
         */
        ready: function () {
            if (join.gettingReady() === null)
                return true;
            else
                return false;
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
        autoJoin: function () {
            if (join.ready() && join.get())
                join.join()
            else
                setTimeout(join.autoJoin, 1000);
        },

        /**
         * Check if joined the meeting or not
         * 
         * @returns {boolean} joined the meet or not
         */
        isJoined: function () {
            if (leave.getButton())
                return true;
            else
                return false;
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
            if (!confirm("Do you want to leave the call?"))
                event.stopPropagation();
        },

        /**
         * Get the leave call button
         * 
         * @returns {element} leave call button element
         */
        getButton: function () {
            return document.querySelector(`[${leaveIndicator.attribute}="${leaveIndicator.value}"]`)
        },

        /**
         * Sets confirmation message for leaving the call
         */
        confirmation: function () {
            if (leave.getButton())
                leave.getButton().addEventListener("click", leave.confirm);
            else
                setTimeout(leave.confirmation, 1000);
        },

        /**
         * Removes the confirmation message for leaving the call
         */
        confirmationOff: function () {
            if (leave.getButton())
                leave.getButton().removeEventListener("click", leave.confirm);
        }
    };


    const transcript = {

        transcript: {},

        getCaptions: function () {
            
            let result = {};

            const captionDiv = document.querySelector(`[jsname="dsyhDe"]`);

            const childDivArray = Array.from(captionDiv.children).filter(child => child.tagName === 'DIV');

            childDivArray && childDivArray.forEach(user => {
                // Get the username (inside the `KcIKyf` class)
                const username = user.getElementsByClassName('KcIKyf')[0]?.textContent?.trim();

                const uniqueTag = user.querySelector(`img`).dataset.iml;

                // Get all messages (inside the `bh44bd` class)
                const messages = Array.from(user.querySelectorAll('.bh44bd span')).map(span =>
                    span.textContent.trim()
                );

                // Add the username and their messages to the result object
                if (username)
                    result[uniqueTag] = { user: username, text: messages };

            });

            return result;
        },

        recordTranscript: function () {

            let captions = {};
            let lastKey = {};
            let lastRecordedTime = {};

            setInterval(() => {

                captions = transcript.getCaptions();

                for (let key in captions) {

                    user = captions[key]['user'];

                    if (lastKey[user] != key) {

                        lastRecordedTime[user] = common.getCurrentTime();

                        lastKey[user] = key;
                    }

                    transcript.transcript[lastRecordedTime[user]] = {
                        user: user,
                        text: captions[key]['text']
                    };

                    
                    data = JSON.stringify({ 
                        meetingId: meetingId,
                        user: user, 
                        text: captions[key]['text'], 
                        time: lastRecordedTime[user] 
                    });

                    window.postMessage({ type: "transcript", data }, "*");
                }

                // console.log(transcript.transcript);

            }, 500);
        }

    };

    // Object holds the common methods
    const common = {

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
            return timeString = (new Date()).toTimeString().split(' ')[0]; // "HH:MM:SS"
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
                    initSettings = event.data.data;
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
                "true": mic.disable,
                "false": mic.enable
            },
            "disable-camera": {
                "true": camera.disable,
                "false": camera.enable
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
        if (change[option][checked])
            change[option][checked]();
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

        transcript.recordTranscript();

    }

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

})();

function downloadTranscript()
{
    window.postMessage({ type: "download_transcript", data: meetingId}, "*");
}