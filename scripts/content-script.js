/**
 * @fileoverview Acts as a bridge between extension and DOM.
 *
 * @author Ajeesh T
 * @version 2.1
 * @date 2024-08-31
 */

(function () {

    const injectScript = (src) => {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL(src);
        script.onload = function () {
            this.remove();
        };
        (document.head || document.documentElement).appendChild(script);
    };

    injectScript('scripts/enhancer.js');

    // Passes the message from popup.js to enhancer.js
    chrome.runtime.onMessage.addListener((message) => {
        console.log(message);

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
        // Connects port and asks for initial settings data to the extension
        const port = chrome.runtime.connect({ name: "content" });
        port.postMessage({ type: 'init', data: 'init' });
    }


})();

