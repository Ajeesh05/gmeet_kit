/**
 * @fileoverview Acts as a bridge between extension and DOM.
 *
 * @author Ajeesh T
 * @version 2.1
 * @date 2024-08-31
 */

(function () {

    // To enable lock mechanism for chrome storage
    let isUpdatingTranscript = false;

    const injectScript = (src) => {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL(src);
        script.onload = function () {
            this.remove();
        };
        (document.head || document.documentElement).appendChild(script);
    };

    injectScript('scripts/enhancer.js');

    // Connects port and asks for initial settings data to the extension
    const port = chrome.runtime.connect({ name: "content" });

    // Passes the message from popup.js to enhancer.js
    chrome.runtime.onMessage.addListener((message) => {

        if (['checkbox', 'initData'].includes(message.type)) {
            data = message.data;
            window.postMessage({ type: message.type, data }, "*");
            setTimeout(function () {
                window.postMessage({ type: message.type, data }, "*");
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

    // Your function to run after the page is visible
    function runAfterVisible() {
        port.postMessage({ type: 'init', data: 'init' });
    }

    // Postmessage listener
    window.addEventListener("message", (event) => {
        // Ensure the message is from the same page and has the correct type
        if (event.source === window) {

            if(event.data.type == "transcript")
                storeTranscript(event.data.data);
            else if (event.data.type == "download_transcript")
                downloadTranscriptAsCSV(event.data.data);

        }
    });


    async function storeTranscript(transcript) {

        // If another instance is running, wait for it to complete
        if (isUpdatingTranscript) {
            setTimeout(() => storeTranscript(transcript), 100);
            return;
        }
        // Lock to prevent concurrent execution
        isUpdatingTranscript = true;

        // To handle exception raised, if promise is rejected
        try {
            await asyncStoreTranscript(transcript);
        } catch (error) {
            console.error('failed to save', error)
        }

        // Release the lockstoreTranscript
        isUpdatingTranscript = false;
    }

    async function asyncStoreTranscript(transcript) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get('recentMeetings', function (result) {

                transcript = JSON.parse(transcript);
                meetingId = transcript.meetingId;

                recentMeetings = result.recentMeetings || {};
                recentMeetings[meetingId] = recentMeetings[meetingId] || {};

                recentMeetings[meetingId][transcript.time] = {
                    user: transcript.user,
                    text: transcript.text
                };

                result.recentMeetings = recentMeetings;
                // Store the result in chrome storage
                chrome.storage.local.set(result, () => {
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


    function downloadTranscriptAsCSV(meetingId) {

        chrome.storage.local.get('recentMeetings', (recentMeetings) => {

            transcript = recentMeetings['recentMeetings'][meetingId];

            let csvContent = "Timestamp,User,Text\n"; // CSV Header

            for (const [timestamp, entry] of Object.entries(transcript)) {
                const user = entry.user;
                const text = entry.text.join(" "); // Join text array into a single string

                // Escape quotes and new lines
                const escapedText = `"${text.replace(/"/g, '""')}"`;

                csvContent += `${timestamp},${user},${escapedText}\n`;
            }

            // Create a Blob and trigger the download
            const blob = new Blob([csvContent], { type: "text/csv" });
            const url = URL.createObjectURL(blob);

            const a = document.createElement("a");
            a.href = url;
            a.download = "meet_transcript.csv";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
        });
    }


})();

