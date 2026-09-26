/**
 * @fileoverview Acts as a bridge between extension and DOM.
 *
 * @author Ajeesh T
 * @date 2024-08-31
 */

(function () {

    const injectScript = (src) => {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL(src);

        // Dynamically inserted scripts are async by default, which would let
        // enhancer.js run before the helper it depends on. async = false makes
        // the browser keep them in insertion order.
        script.async = false;

        script.onload = function () {
            this.remove();
        };
        (document.head || document.documentElement).appendChild(script);
    };

    // Order matters: enhancer.js reads MeetDom from the page's global scope.
    injectScript('scripts/meet-dom.js');
    injectScript('scripts/enhancer.js');

})();

