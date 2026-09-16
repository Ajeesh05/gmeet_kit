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
        script.onload = function () {
            this.remove();
        };
        (document.head || document.documentElement).appendChild(script);
    };

    injectScript('scripts/enhancer.js');

})();

