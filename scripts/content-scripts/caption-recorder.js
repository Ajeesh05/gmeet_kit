// caption-recorder.js — Clean validated rewrite
(() => {

    /********************************************************************
     * URL CHANGE DETECTION (Google Meet is a SPA)
     ********************************************************************/
    let lastUrl = location.href;

    const urlObserver = new MutationObserver(() => {
        if (location.href !== lastUrl) {
            const oldUrl = lastUrl;
            lastUrl = location.href;
            onUrlChanged(oldUrl, lastUrl);
        }
    });

    urlObserver.observe(document, { subtree: true, childList: true });


    /********************************************************************
     * CONFIG
     ********************************************************************/
    const DEBUG = true;
    const STORAGE_PREFIX = "gmeet_transcript_";
    const MASTER_KEY = STORAGE_PREFIX + "master_index";
    const SETTINGS_KEY = "transaction_settings";
    const MAX_POLL_ATTEMPTS = 60;
    const POLL_INTERVAL_MS = 1000;
    const MAX_MEETINGS_TO_KEEP = 15;

    const log = (...a) => { if (DEBUG) console.log("[GmeetCaptionRecorder]", ...a); };
    const errorLog = (...a) => console.error("[GmeetCaptionRecorder]", ...a);


    /********************************************************************
     * SAFE WRAPPERS — handles "Extension context invalidated" recovery
     ********************************************************************/
    function safeSendMessage(payload, callback) {
        try {
            chrome.runtime.sendMessage(payload, callback);
        } catch (e) {
            console.warn("[GmeetCaptionRecorder] sendMessage failed — retrying", e);
            reviveExtension(() => chrome.runtime.sendMessage(payload, callback));
        }
    }

    function safeStorageGet(keys, callback) {
        try {
            chrome.storage.local.get(keys, callback);
        } catch (e) {
            console.warn("[GmeetCaptionRecorder] storage.get failed — retrying", e);
            reviveExtension(() => chrome.storage.local.get(keys, callback));
        }
    }

    function safeStorageSet(obj, callback) {
        try {
            chrome.storage.local.set(obj, callback);
        } catch (e) {
            console.warn("[GmeetCaptionRecorder] storage.set failed — retrying", e);
            reviveExtension(() => chrome.storage.local.set(obj, callback));
        }
    }

    /********************************************************************
     * FORCE EXTENSION WAKE-UP
     ********************************************************************/
    function reviveExtension(afterWake) {
        chrome.runtime.sendMessage({ type: "wake_up" }, () => {
            setTimeout(afterWake, 200);
        });
    }


    /********************************************************************
     * RECORDER STATE
     ********************************************************************/
    let recorderState = {
        active: false,
        meetingId: null,
        sessionId: null,
        startedAt: null,
        stopRecorderFn: null
    };

    function onUrlChanged(oldUrl, newUrl) {
        const meetingId = getMeetingId();

        if (!meetingId) {
            log("URL changed but still not a valid meeting page:", newUrl);
            return;
        }

        log("Valid meeting detected after URL change:", meetingId);

        // Reinitialize session for the new meeting
        initializeGlobalSession(meetingId);

        // Auto-record logic
        chrome.storage.sync.get([SETTINGS_KEY], (res) => {
            const settings = res[SETTINGS_KEY] || {};
            if (settings.autoRecord) {
                enableCaptions();
                waitAndStartInternal();
            }
        });
    }


    /********************************************************************
     * UTILS
     ********************************************************************/
    const simpleHash = (s) => {
        let h = 2166136261 >>> 0;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        return h.toString(36);
    };

    const uniqueIdFromImg = (img) => {
        if (!img) return null;
        if (img.dataset && img.dataset.iml) return "iml_" + img.dataset.iml;
        if (img.src) return "src_" + simpleHash(img.src);
        return "img_" + Math.random().toString(36).slice(2, 9);
    };

    function getMeetingId() {
        const path = window.location.pathname || "";

        // Match real Meet IDs: xxx-xxxx-xxx
        const match = path.match(/\/([a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3})/i);

        if (match) {
            return match[1].toLowerCase();
        }

        // No valid meeting → return null
        return null;
    }


    const getSessionId = () =>
        `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;


    /********************************************************************
     * CAPTION BUTTON HELPERS
     ********************************************************************/
    function getCaptionButton() {
        return document.querySelector('button[jsname="r8qRAd"]');
    }
    function isCaptionEnabled() {
        const b = getCaptionButton();
        if (!b) return false;
        return b.getAttribute("aria-label")?.includes("off");
    }
    function enableCaptions() {
        const b = getCaptionButton();
        if (!b) { setTimeout(enableCaptions, 1000); return false; }
        if (!isCaptionEnabled()) b.click();
        return true;
    }
    function disableCaptions() {
        const b = getCaptionButton();
        if (!b) return false;
        if (isCaptionEnabled()) b.click();
        return true;
    }


    /********************************************************************
     * MESSAGING
     ********************************************************************/
    function sendRealtimeMessage(payload) {
        try {
            safeSendMessage({
                source: "gmeet_caption_recorder",
                payload
            });
        } catch (e) { errorLog(e); }
    }


    /********************************************************************
     * GLOBAL SESSION STATE (in-memory only until first transcript)
     ********************************************************************/
    let globalSession = { meetingId: null, sessionId: null, stored: false };



    /********************************************************************
     * SESSION INITIALIZER (used both on load and URL change)
     ********************************************************************/
    function initializeGlobalSession(meetingId) {

        chrome.storage.sync.get([SETTINGS_KEY], (cfg) => {
            try {
                const mergeWindowSecs = cfg[SETTINGS_KEY]?.mergeWindowSecs ?? 60;
                const mergeWindowMs = mergeWindowSecs * 1000;
                const key = STORAGE_PREFIX + meetingId + "_sessions";

                safeStorageGet([key], (res) => {
                    const sessions = res[key] || [];
                    const last = sessions[sessions.length - 1];
                    const now = Date.now();

                    if (
                        last &&
                        last.meetingId === meetingId &&
                        (now - (last.lastAccessed || last.startedAt || 0)) < mergeWindowMs
                    ) {
                        globalSession = {
                            meetingId,
                            sessionId: last.sessionId,
                            startedAt: last.startedAt || now,
                            lastAccessed: last.lastAccessed || now,
                            stored: true
                        };
                    } else {
                        globalSession = {
                            meetingId,
                            sessionId: getSessionId(),
                            startedAt: now,
                            lastAccessed: now,
                            stored: false
                        };
                    }

                    log("globalSession initialized (bootstrap or URL-change)", globalSession);
                });

            } catch (e) { errorLog("initializeGlobalSession", e); }
        });

    }

    /********************************************************************
     * INITIALIZE GLOBAL SESSION ON PAGE LOAD (only if valid meeting)
     ********************************************************************/
    chrome.storage.sync.get([SETTINGS_KEY], (cfg) => {
        const meetingId = getMeetingId();

        if (!meetingId) {
            log("Not a meeting page — skipping session initialization.");
            return;
        }

        initializeGlobalSession(meetingId);
    });


    /********************************************************************
     * HEARTBEAT (lastAccessed every second)
     ********************************************************************/
    setInterval(() => {
        try {
            // update in-memory lastAccessed always while in meeting
            globalSession.lastAccessed = Date.now();

            // only touch chrome.storage if we already persisted sessions for this meeting
            if (!globalSession.stored) return;

            const meetingId = globalSession.meetingId || getMeetingId();

            if (!meetingId) {
                log("Not a valid meeting page — recorder disabled.");
                return;
            }

            const key = STORAGE_PREFIX + meetingId + "_sessions";

            safeStorageGet([key], (res) => {
                const sessions = res[key] || [];
                if (!sessions.length) return;

                const last = sessions[sessions.length - 1];
                if (!last || last.sessionId !== globalSession.sessionId) return;

                last.lastAccessed = globalSession.lastAccessed;

                const toSet = {}; toSet[key] = sessions; safeStorageSet(toSet);

                // update master index lastAccessed too
                safeStorageGet([MASTER_KEY], (m) => {
                    const master = m[MASTER_KEY] || { list: [] };
                    const i = master.list.findIndex(x => x.sessionId === last.sessionId);
                    if (i !== -1) { master.list[i].lastAccessed = last.lastAccessed; const s = {}; s[MASTER_KEY] = master; safeStorageSet(s); }
                });
            });
        } catch (e) { }
    }, 1000);


    /********************************************************************
     * SAVE SESSION (raw JSON, no compression)
     ********************************************************************/
    function saveToStorage(meetingId, transcriptObj, sessionId) {
        try {
            const key = STORAGE_PREFIX + meetingId + "_sessions";

            safeStorageGet([key], (res) => {
                let sessions = res[key] || [];

                // Remove completely empty sessions
                sessions = sessions.filter(
                    s => s.transcript &&
                        Object.keys(s.transcript.entries || {}).length > 0
                );

                const idx = sessions.findIndex(s => s.sessionId === sessionId);

                if (idx !== -1) {
                    sessions[idx].transcript = transcriptObj;
                    sessions[idx].lastAccessed = Date.now();
                } else {
                    sessions.push({
                        meetingId,
                        sessionId,
                        startedAt: transcriptObj.startedAt,
                        lastAccessed: Date.now(),
                        transcript: transcriptObj
                    });
                }

                const out = {};
                out[key] = sessions;

                safeStorageSet(out, () => {
                    try {
                        updateMasterIndex(meetingId, sessionId, transcriptObj.startedAt);
                    } catch (e) { errorLog("updateMasterIndex on save", e); }
                });

                if (globalSession.sessionId === sessionId)
                    globalSession.stored = true;
            });
        } catch (e) { errorLog("saveToStorage", e); }
    }


    /********************************************************************
     * MASTER INDEX (LRU = keep last N meetings)
     ********************************************************************/
    function updateMasterIndex(meetingId, sessionId, startedAt) {
        try {
            safeStorageGet([MASTER_KEY], (res) => {
                let master = res[MASTER_KEY] || { list: [] };

                // Remove duplicates
                master.list = master.list.filter(
                    x => !(x.meetingId === meetingId && x.sessionId === sessionId)
                );

                master.list.push({
                    meetingId,
                    sessionId,
                    startedAt,
                    lastAccessed: Date.now(),
                    active: true
                });

                // Mark only newest as active
                master.list.forEach(e => e.active = (e.sessionId === sessionId));

                // Prune old meetings
                if (master.list.length > MAX_MEETINGS_TO_KEEP) {
                    master.list.sort(
                        (a, b) =>
                            (a.lastAccessed || a.startedAt) -
                            (b.lastAccessed || b.startedAt)
                    );

                    const toRemove = master.list.slice(
                        0,
                        master.list.length - MAX_MEETINGS_TO_KEEP
                    );

                    // Remove actual sessions
                    toRemove.forEach(old => {
                        const oldKey = STORAGE_PREFIX + old.meetingId + "_sessions";

                        safeStorageGet([oldKey], (r) => {
                            let sessions = r[oldKey] || [];
                            sessions = sessions.filter(
                                s => s.sessionId !== old.sessionId
                            );

                            const out = {};
                            out[oldKey] = sessions;
                            safeStorageSet(out);
                        });
                    });

                    master.list = master.list.slice(
                        master.list.length - MAX_MEETINGS_TO_KEEP
                    );
                }

                const out = {};
                out[MASTER_KEY] = master;
                safeStorageSet(out);
            });
        } catch (e) { errorLog("updateMasterIndex", e); }
    }


    /********************************************************************
     * START / STOP RECORDING
     ********************************************************************/
    function startRecordingFlow() {
        if (recorderState.active) return;
        enableCaptions();
        waitAndStartInternal();
    }

    function stopRecordingFlow(reason = "user_stop") {
        if (!recorderState.active) return;

        try {
            recorderState.stopRecorderFn &&
                recorderState.stopRecorderFn();
        } catch (e) { errorLog("stopRecorderFn error", e); }

        sendRealtimeMessage({
            type: "recording_stopped",
            meetingId: recorderState.meetingId,
            sessionId: recorderState.sessionId,
            reason
        });

        recorderState = {
            active: false,
            meetingId: null,
            sessionId: null,
            startedAt: null,
            stopRecorderFn: null
        };
    }


    /********************************************************************
     * FIND CAPTION CONTAINER
     ********************************************************************/
    function findCaptionsContainer() {
        let el = document.querySelector('[jsname="dsyhDe"]');
        if (el) return el;

        el = document.querySelector('[aria-label="Captions"]');
        if (el) return el;

        const regions = Array.from(
            document.querySelectorAll('div[role="region"]')
        );

        return (
            regions.find(r =>
                /caption|captions/i.test(r.getAttribute("aria-label") || "")
            ) || null
        );
    }


    /********************************************************************
     * WAIT FOR CAPTION CONTAINER THEN START RECORDER
     ********************************************************************/
    async function waitAndStartInternal() {
        try {
            let attempts = 0;
            let container = findCaptionsContainer();

            while (!container && attempts < MAX_POLL_ATTEMPTS) {
                await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
                attempts++;
                container = findCaptionsContainer();
            }

            if (!container) {
                errorLog("No caption container found");
                sendRealtimeMessage({ type: "recorder_failed", reason: "container_missing" });
                return;
            }

            const stopFn = startRecorderWithStop(container);
            if (typeof stopFn === "function")
                recorderState.stopRecorderFn = stopFn;

        } catch (e) { errorLog("waitAndStartInternal", e); }
    }


    /********************************************************************
     * START RECORDER (WITH STOP FUNCTION)
     ********************************************************************/
    function startRecorderWithStop(captionsContainer) {
        if (!captionsContainer) return null;

        const meetingId = getMeetingId();
        if (!meetingId) {
            log("Not a valid meeting page — recorder disabled.");
            return;
        }

        const sessionId = globalSession.sessionId;
        const startedAt = globalSession.startedAt || Date.now();
        if (!globalSession.startedAt) globalSession.startedAt = startedAt;

        const transcript = {
            meetingId,
            sessionId,
            startedAt,
            entries: {},
            order: []
        };


        /****************************************************************
         * PROCESS ONE CAPTION NODE
         ****************************************************************/
        function processCaptionNode(node) {
            try {
                if (!(node instanceof HTMLElement)) return;

                let block = node;
                while (block && !block.querySelector) block = block.parentElement;
                if (!block) return;

                let userBlock =
                    block.closest(".nMcdL") ||
                    (block.querySelector && (block.querySelector(".nMcdL") || block));

                if (!userBlock || !userBlock.querySelector) {
                    if (block.querySelector("img"))
                        userBlock = block;
                }

                const nameEl =
                    userBlock?.querySelector(".KcIKyf, .NWpY1d, span.NWpY1d");

                const textEl =
                    userBlock?.querySelector(".ygicle, .VbkSUe");

                const imgEl = userBlock?.querySelector("img");

                if (!nameEl || !textEl) return;

                const user = (nameEl.textContent || "").trim();
                const avatar = imgEl?.src || null;
                const unique =
                    uniqueIdFromImg(imgEl) ||
                    "u_" + simpleHash(user + (avatar || ""));

                const rawText = (textEl.textContent || "").trim();
                if (!rawText) return;

                const now = Date.now();
                const ts = new Date(now).toLocaleTimeString();
                const offset = ((now - startedAt) / 1000).toFixed(1) + "s";

                if (!transcript.entries[unique]) {
                    transcript.entries[unique] = {
                        user,
                        avatar,
                        messages: [],
                        lastText: null
                    };
                    transcript.order.push(unique);
                }

                const entry = transcript.entries[unique];
                const lastMsg =
                    entry.messages.length ?
                        entry.messages[entry.messages.length - 1] :
                        null;

                const lastText = entry.lastText;
                if (lastText === rawText) return;

                if (lastMsg) {
                    // correction
                    lastMsg.text = rawText;
                    lastMsg.ts = ts;
                    lastMsg.t = now;
                    lastMsg.offset = offset;
                    lastMsg.replaced = true;

                    entry.lastText = rawText;

                    sendRealtimeMessage({
                        type: "caption_update",
                        meetingId,
                        sessionId,
                        uniqueId: unique,
                        user,
                        avatar,
                        text: rawText,
                        ts,
                        offset,
                        replaced: true
                    });
                } else {
                    // new message
                    const seq =
                        entry.messages.length ?
                            entry.messages[entry.messages.length - 1].seq + 1 :
                            1;

                    const msg = {
                        seq,
                        text: rawText,
                        ts,
                        t: now,
                        offset,
                        replaced: false
                    };

                    entry.messages.push(msg);
                    entry.lastText = rawText;

                    sendRealtimeMessage({
                        type: "caption_add",
                        meetingId,
                        sessionId,
                        uniqueId: unique,
                        user,
                        avatar,
                        text: rawText,
                        ts,
                        offset,
                        seq
                    });
                }

                saveToStorage(meetingId, transcript, sessionId);

            } catch (e) { errorLog("processCaptionNode", e); }
        }


        /****************************************************************
         * MUTATION OBSERVER
         ****************************************************************/
        const mo = new MutationObserver((muts) => {
            try {
                for (const m of muts) {
                    if (m.addedNodes?.length)
                        m.addedNodes.forEach(n => processCaptionNode(n));

                    if (m.type === "characterData" && m.target)
                        processCaptionNode(m.target.parentElement);
                }
            } catch (e) { errorLog("mo", e); }
        });

        mo.observe(captionsContainer, {
            childList: true,
            subtree: true,
            characterData: true
        });


        /****************************************************************
         * CONFIRMATION MODAL (STYLED)
         ****************************************************************/
        function showDisableModal(onProceed) {
            const id = "gcr-modal";
            let modal = document.getElementById(id);

            if (!modal) {
                modal = document.createElement("div");
                modal.id = id;

                Object.assign(modal.style, {
                    position: "fixed",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    background: "#202124",
                    color: "white",
                    padding: "18px 22px",
                    borderRadius: "12px",
                    zIndex: 999999,
                    boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
                    fontFamily: "Roboto, sans-serif",
                    width: "340px"
                });

                modal.innerHTML = `
                    <div style="font-size:16px;font-weight:500;margin-bottom:10px;">
                        Disable captions?
                    </div>
                    <div style="font-size:14px;margin-bottom:16px;opacity:0.85;">
                        Turning off captions will stop the transcript recording.
                    </div>

                    <label style="display:flex;align-items:center;margin-bottom:16px;font-size:13px;opacity:0.9;">
                        <input type="checkbox" id="gcr-dontshow" style="margin-right:8px;">
                        Don't show again
                    </label>

                    <div style="display:flex;justify-content:flex-end;gap:10px;">
                        <button id="gcr-cancel" style="background:#3c4043;color:white;padding:6px 14px;border:none;border-radius:8px;font-size:14px;cursor:pointer;">
                            Cancel
                        </button>
                        <button id="gcr-yes" style="background:#8ab4f8;color:black;padding:6px 14px;border:none;border-radius:8px;font-size:14px;cursor:pointer;font-weight:500;">
                            Turn off
                        </button>
                    </div>
                `;

                document.body.appendChild(modal);
            }

            modal.style.display = "block";

            const dont = modal.querySelector("#gcr-dontshow");

            modal.querySelector("#gcr-cancel").onclick = () => {
                modal.style.display = "none";
                enableCaptions();
            };

            modal.querySelector("#gcr-yes").onclick = () => {
                modal.style.display = "none";

                if (dont.checked) {
                    chrome.storage.sync.get([SETTINGS_KEY], (r) => {
                        const s = r[SETTINGS_KEY] || {};
                        s.dontShowDisableAlert = true;

                        chrome.storage.sync.set({ [SETTINGS_KEY]: s });
                    });
                }

                onProceed();
            };
        }


        /****************************************************************
         * INTERCEPT CAPTION DISABLE (button or hotkey)
         ****************************************************************/
        function interceptDisable(e) {
            if (!recorderState.active) return;
            if (!isCaptionEnabled()) return;

            e.preventDefault();
            e.stopPropagation();

            chrome.storage.sync.get([SETTINGS_KEY], (res) => {
                const settings = res[SETTINGS_KEY] || {};

                if (settings.dontShowDisableAlert) {
                    stopRecordingFlow("manual_caption_disabled");
                    disableCaptions();
                    return;
                }

                showDisableModal(() => {
                    stopRecordingFlow("manual_caption_disabled");
                    disableCaptions();
                });
            });
        }

        // Button click
        document.addEventListener(
            "click",
            (e) => {
                const btn = getCaptionButton();
                if (btn && btn.contains(e.target)) {
                    interceptDisable(e);
                }
            },
            true
        );

        // "C" hotkey
        document.addEventListener(
            "keydown",
            (e) => {
                if (
                    e.key?.toLowerCase() === "c" &&
                    !e.ctrlKey &&
                    !e.metaKey
                ) {
                    interceptDisable(e);
                }
            },
            true
        );


        /****************************************************************
         * SET RECORDER STATE AND RETURN STOP FUNCTION
         ****************************************************************/
        recorderState.active = true;
        recorderState.meetingId = meetingId;
        recorderState.sessionId = sessionId;
        recorderState.startedAt = startedAt;

        sendRealtimeMessage({
            type: "recording_started",
            meetingId,
            sessionId,
            startedAt
        });

        return () => {
            try {
                mo.disconnect();
                recorderState.active = false;
                log("Recorder stopped");
            } catch (e) { errorLog("stopFn", e); }
        };
    }


    /********************************************************************
     * MESSAGE LISTENER (external API)
     ********************************************************************/
    chrome.runtime.onMessage.addListener((msg, sender, sendResp) => {
        try {
            if (!msg || !msg.action) return;

            switch (msg.action) {
                case "start_recording":
                    startRecordingFlow();
                    break;

                case "stop_recording":
                    stopRecordingFlow("remote_stop");
                    break;

                case "enable_captions":
                    sendResp?.({ status: enableCaptions() });
                    return;

                case "disable_captions":
                    sendResp?.({ status: disableCaptions() });
                    return;

                case "get_status":
                    sendResp?.({
                        status: "ok",
                        recorderState
                    });
                    return;
            }

            sendResp?.({ status: "ok" });
        } catch (e) { errorLog("onMessage", e); }

        return true;
    });


    /********************************************************************
     * AUTO-START IF ENABLED
     ********************************************************************/
    chrome.storage.sync.get([SETTINGS_KEY], (res) => {
        try {
            const settings = res[SETTINGS_KEY] || {};
            if (settings.autoRecord) {
                enableCaptions();
                waitAndStartInternal();
            }
        } catch (e) { errorLog("auto-start", e); }
    });


    /********************************************************************
     * EXPOSE DEBUG HELPERS
     ********************************************************************/
    window.__GMEET_CAPTION_RECORDER = {
        start: () => startRecordingFlow(),
        stop: (reason) => stopRecordingFlow(reason || "user_stop"),
        isActive: () => recorderState.active,
        getState: () => recorderState
    };

    log("Caption recorder loaded (clean rewrite)");

})();
