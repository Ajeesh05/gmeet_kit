(() => {
    let addedElements = new Map();
    let observerController = null;

    const launchVideoInFullscreen = async (video) => {
        try {
            await video.requestFullscreen();
        } catch {
            video.classList.toggle("fullscreen");
        }
    };

    const attachEvents = (button, video, signal) => {
        button.addEventListener("click", () => {
            launchVideoInFullscreen(video);
        }, { signal, passive: true });

    };

    /**
     * Builds the button without innerHTML.
     *
     * This used to install a Trusted Types policy named "default" that returned
     * its input unchanged - which is the page-wide policy, and the only reason
     * it was needed was this one static string.
     */
    const createButton = (parentWrapper) => {
        const button = document.createElement("div");

        const icon = document.createElement("i");
        icon.className = "google-material-icons fit-screen-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = "fit_screen";

        button.append(icon);
        button.className = "gmeetkit-fullscreen-btn";
        button.title = "Fit Screen by Gmeet kit";

        parentWrapper.append(button);
        return button;
    };

    // Which tile belongs to the user is MeetDom's business, not this file's.
    // The previous test was [jsname="aTv5jf"], a generated value that has since
    // moved, so the button was being added to the user's own video.
    const isSelfTile = (tile) => globalThis.MeetDom.isSelfTile(tile);

    const clearAddedElements = () => {
        for (const button of addedElements.values()) {
            button.remove();
        }
        addedElements.clear();
    };

    const start = () => {
        stop(); // prevent duplicates

        observerController = new AbortController();
        const { signal } = observerController;

        // Bound to the same signal as everything else, so stop() removes it.
        // Without that, each start() left another listener on the document.
        document.addEventListener("dblclick", () => {
            if (document.fullscreenElement)
                document.exitFullscreen();
        }, { signal });

        /**
         * Reconcile buttons against the tiles currently on screen.
         *
         * This used to remove every button and build them all again on each
         * tick - four times a second during a call, which threw away hover and
         * focus state and churned the DOM for no reason.
         */
        const update = () => {
            const wanted = new Map();

            for (const video of document.querySelectorAll("video")) {
                // Actually rendered, rather than "has no inline display:none".
                // The old check inspected only the element's own style
                // attribute, so a tile hidden by a class, by an ancestor or by
                // the hidden attribute still collected a button.
                if (video.getClientRects().length === 0) continue;

                const tile = video.closest("[data-participant-id]");
                if (!tile || isSelfTile(tile)) continue;

                wanted.set(tile, video);
            }

            // Drop buttons whose tile has gone.
            for (const [tile, button] of addedElements) {
                if (!wanted.has(tile) || !tile.isConnected) {
                    button.remove();
                    addedElements.delete(tile);
                }
            }

            // Add buttons for tiles that do not have one yet.
            for (const [tile, video] of wanted) {
                if (addedElements.has(tile)) continue;
                const button = createButton(tile);
                attachEvents(button, video, signal);
                addedElements.set(tile, button);
            }
        };

        update();
        const intervalId = setInterval(update, 1500);
        signal.addEventListener("abort", () => clearInterval(intervalId), { once: true });
    };

    const stop = () => {
        observerController?.abort();
        observerController = null;
        clearAddedElements();
    };

    // Shared stylesheet
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
        .fit-screen-icon {
            font-size: clamp(25px, 4vw, 40px);
        }
        .gmeetkit-fullscreen-btn {
            position: absolute;
            bottom: 0;
            right: 0;
            color: white;
            opacity: 0.3;
            cursor: pointer;
            transition: opacity 0.2s;
        }
        .gmeetkit-fullscreen-btn:hover {
            opacity: 0.8;
        }
    `);

    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

    // Auto-start
    start();

    // Optional debug hooks
    // window.__gmeetkit = { start, stop };
})();
