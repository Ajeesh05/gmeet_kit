(() => {
    let addedElements = new Map();
    let observerController = null;

    const policy = globalThis.trustedTypes?.createPolicy("default", {
        createHTML: (input) => input // ⚠️ sanitize in production
    }) ?? { createHTML: (input) => input };

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

    const createButton = (parentWrapper) => {
        const button = document.createElement("div");

        button.innerHTML = policy.createHTML(`
            <i class="google-material-icons fit-screen-icon" aria-hidden="true">fit_screen</i>
        `);

        button.className = "gmeetkit-fullscreen-btn";
        button.title = "Fit Screen by Gmeet kit";

        parentWrapper.append(button);
        return button;
    };

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

        document.addEventListener("dblclick", (e) => {
            e.preventDefault();
            if (document.fullscreenElement)
                document.exitFullscreen();
        });

        const update = () => {
            clearAddedElements();

            const visibleVideos = Array.from(document.querySelectorAll("video"))
                .filter(v => !v.style.display.includes("none"));

            visibleVideos.forEach(video => {

                const parentWrapper = video.closest("[data-participant-id]");

                if (!parentWrapper) return;

                if(parentWrapper.getAttribute("jsname") == 'aTv5jf') return;
                
                const button = createButton(parentWrapper);
                attachEvents(button, video, signal);

                addedElements.set(parentWrapper, button);
            });
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
