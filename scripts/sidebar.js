(function () {
    const content = document.getElementById('content');
    const historyListEl = document.getElementById('historyList');
    const menuButtons = document.querySelectorAll('.menu button');
    const searchInput = document.getElementById('search');
    const exportBtn = document.getElementById('export');
    const controls = document.getElementById('controls');
    const speakerFilter = document.getElementById('speakerFilter');

    const MASTER_INDEX_KEY = 'gmeet_transcript_master_index';
    const SETTINGS_KEY = 'transaction_settings';
    let activeTab = 'transcript';
    const selfUser = 'You';
    const liveMessages = {};
    let recorderActive = false;
    let activeTabSession = null;

    const fmtDate = ms => new Date(ms).toLocaleString();

    // Init
    async function init() {
        bindMenu();

        const settings = await getSettings();
        const tab = await getActiveTab();
        const meetingId = extractMeetingIdFromUrl(tab?.url || '');
        const index = await getMasterIndex();
        const now = Date.now();

        recorderActive = await checkRecorderInPage(tab.id);
        renderTopControls(settings?.autoRecord ?? true, recorderActive);

        const liveMatch = (index.list || []).find(i =>
            i.meetingId === meetingId &&
            Math.abs(now - (i.lastAccessed || 0)) < 60000
        );

        if (liveMatch) {
            // load transcript from storage, but DO NOT open history mode
            await preloadLiveSession(liveMatch.meetingId, liveMatch.sessionId);

            // show header with "Live"
            showMeetingHeader(liveMatch.meetingId, liveMatch.startedAt, true);

            // ensure live UI is active
            activeTabSession = null;
            renderLiveTranscript();
        } else {
            renderLiveTranscript();
        }


        if ((settings?.autoRecord ?? true) && !recorderActive) {
            const started = await startRecordingFlow();
            recorderActive = !!started;
            updateRecorderButton(recorderActive);
        }
        controls.classList.add('visible');

    }

    // storage & tab helpers
    function getActiveTab() {
        return new Promise(res => chrome.tabs.query({
            active: true, currentWindow: true
        }, tabs => res(tabs[0])));
    }

    function getMasterIndex() {
        return new Promise(res => chrome.storage.local.get(
            [MASTER_INDEX_KEY], r => res(r[MASTER_INDEX_KEY] || { list: [] }))
        );
    }

    function getSettings() {
        return new Promise(res => chrome.storage.sync.get(
            [SETTINGS_KEY], r => res(r[SETTINGS_KEY] || { autoRecord: true }))
        );
    }

    function setSettings(s) {
        return new Promise(res => chrome.storage.sync.set({
            [SETTINGS_KEY]: s
        }, () => res(true)));
    }

    function extractMeetingIdFromUrl(url) {
        try {
            const u = new URL(url);
            const p = u.pathname || '';
            const parts = p.split('/').filter(Boolean);
            return parts[0] ? parts[0] : null;
        } catch (e) {
            return null;
        }
    }

    function safeSendToTab(tabId, message) {
        return new Promise(resolve => {
            try {
                chrome.tabs.sendMessage(tabId, message, resp => {
                    if (chrome.runtime.lastError) {
                        console.warn("safeSendToTab: Tab message failed:", chrome.runtime.lastError.message);
                        return resolve(null);
                    }
                    resolve(resp);
                });
            } catch (e) {
                console.warn("safeSendToTab exception:", e);
                resolve(null);
            }
        });
    }


    async function checkRecorderInPage(tabId) {
        try {
            const resp = await safeSendToTab(tabId, { action: 'get_status' });
            if (resp && resp.recorderState)
                return !!resp.recorderState.active;
        } catch (e) {

        }

        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId }, func: () => !!(window && window.__GMEET_CAPTION_RECORDER)
            });
            return !!(results && results[0] && results[0].result);
        } catch (e) {
            return false;
        }
    }

    // start/stop flows (message-first)
    async function tryStartRecorderInPage(tabId) {
        try {
            await safeSendToTab(tabId, { action: 'start_recording' });
            const status = await safeSendToTab(tabId, { action: 'get_status' });
            return !!status?.recorderState?.active;
        } catch (e) {
            return false;
        }
    }

    async function tryStopRecorderInPage(tabId) {
        try {
            await safeSendToTab(tabId, { action: 'stop_recording' });
            const status = await safeSendToTab(tabId, { action: 'get_status' });
            return status?.recorderState ? !status.recorderState.active : false;
        } catch (e) {
            return false;
        }
    }

    async function startRecordingFlow() {
        const tab = await getActiveTab();
        if (!tab)
            return false;
        const ok = await tryStartRecorderInPage(tab.id);
        recorderActive = !!ok;
        updateRecorderButton(recorderActive);
        return ok;
    }

    async function stopRecordingFlow() {
        const tab = await getActiveTab();
        if (!tab)
            return false;
        const ok = await tryStopRecorderInPage(tab.id);
        recorderActive = ok ? false : recorderActive;
        updateRecorderButton(recorderActive);
        return ok;
    }

    // UI top controls
    // global delegated click handler for recorderToggle
    document.addEventListener('click', async (e) => {
        if (e.target && e.target.id === 'recorderToggle') {
            if (!recorderActive) {
                const started = await startRecordingFlow();
                recorderActive = !!started;
                updateRecorderButton(recorderActive);
            } else {
                const stopped = await stopRecordingFlow();
                recorderActive = stopped ? false : recorderActive;
                updateRecorderButton(recorderActive);
            }
        }
    });

    function renderTopControls(autoRecordChecked, isActive) {
        const existing = document.getElementById('topControls');
        if (existing)
            existing.remove();

        const wrapper = document.createElement('div');
        wrapper.id = 'topControls';
        wrapper.className = 'controls-top';
        const meetHeader = document.createElement('div');
        meetHeader.className = 'meeting-header';
        meetHeader.innerHTML = `
            <div>
                <div class='meeting-title' id='meetingTitle'></div>
                <div class='meeting-sub' id='meetingSub'></div>
            </div>
        `;

        const auto = document.createElement('label');
        auto.className = 'auto-record';
        auto.innerHTML = `
            <input id='autoRecordCheckbox' type='checkbox' ${autoRecordChecked ? 'checked' : ''} /> 
            <span>Auto-record</span>
        `;

        const btn = document.createElement('button');
        btn.id = 'recorderToggle';
        btn.className = `recorder-btn ${isActive ? 'active' : ''}`;
        btn.textContent = isActive ? 'Stop recording' : 'Start recording';
        btn.addEventListener('click', async () => {
            if (!recorderActive) {
                const started = await startRecordingFlow();
                recorderActive = !!started;
                updateRecorderButton(recorderActive);
            } else {
                const stopped = await stopRecordingFlow();
                recorderActive = stopped ? false : recorderActive;
                updateRecorderButton(recorderActive);
            }
        });

        auto.querySelector('#autoRecordCheckbox').addEventListener('change', e => setSettings({
            autoRecord: !!e.target.checked
        }));
        wrapper.appendChild(meetHeader);
        wrapper.appendChild(auto);
        wrapper.appendChild(btn);
        content.prepend(wrapper);
        document.getElementById('meetingTitle').textContent = '';
        document.getElementById('meetingSub').textContent = '';
    }

    function updateRecorderButton(isActive) {
        const btn = document.getElementById('recorderToggle');
        if (!btn) return;
        btn.classList.toggle('active', isActive);
        btn.textContent = isActive ? 'Stop recording' : 'Start recording';
    }

    function showMeetingHeader(meetingId, startedAt, isLive) {
        const title = document.getElementById('meetingTitle');
        const sub = document.getElementById('meetingSub');

        if (title)
            title.textContent = meetingId ? `Meeting: ${meetingId}` : '';

        if (sub)
            sub.textContent = startedAt ? `${fmtDate(startedAt)} ${isLive ? '• Live' : ''}` : (isLive ? '• Live' : '');
    }

    // History
    async function openHistorySession(meetingId, sessionId, item) {
        activeTab = 'history';
        activeTabSession = { meetingId, sessionId };

        // hide the history list
        historyListEl.style.display = 'none';

        // clear current view but keep top controls
        clearViewExceptTop();

        // remove old floating wrappers if any
        document.querySelector('.go-live-wrapper')?.remove();

        // ---- 1) Load transcript FIRST ----
        await loadSessionTranscript(meetingId, sessionId, { createControls: false });

        // ---- 2) NOW add inline Back button ----
        const backRow = document.createElement('div');
        backRow.className = 'history-back-row';
        backRow.style.display = 'flex';
        backRow.style.justifyContent = 'flex-start';
        backRow.style.margin = '10px 0';

        const back = document.createElement('button');
        back.textContent = '← Back';
        back.className = 'go-live';
        back.style.borderRadius = '8px';
        back.style.background = 'rgba(22,160,133,0.15)';
        back.style.color = 'var(--gk-green-light)';
        back.style.borderRadius = '6px';

        back.addEventListener('click', () => {
            activeTab = 'history';
            activeTabSession = null;

            // remove back row
            backRow.remove();

            // reset content (keep top controls)
            clearViewExceptTop();
            controls.classList.remove('visible');

            // show history list again
            historyListEl.style.display = 'flex';
            renderHistoryList();
        });

        backRow.appendChild(back);
        // place Back button at top of transcript area
        content.prepend(backRow);

        // Show search + export in history session
        controls.classList.add('visible');
    }

    // History
    async function renderHistoryList() {
        historyListEl.innerHTML = '';
        const idx = await getMasterIndex();
        const list = [...new Set(idx.list || [])]
            .slice(-50)
            .reverse();

        list.forEach(item => {
            const card = document.createElement('div');
            card.className = 'history-card';
            card.innerHTML = `
            <div class='history-meetid'>${item.meetingId}</div>
            <div class='history-meta'>
                ${fmtDate(item.startedAt)}
                ${Math.abs(Date.now() - (item.lastAccessed || 0)) < 60000 ? '• Live' : ''}
            </div>
            `;
            card.addEventListener('click', () => openHistorySession(item.meetingId, item.sessionId, item));
            historyListEl.appendChild(card);
        });
    }

    // menu & tabs
    function bindMenu() {
        menuButtons.forEach(btn => btn.addEventListener('click', () => setActiveTab(btn.dataset.tab)));
    }


    async function tryLoadRecentLiveSession() {
        const tab = await getActiveTab();
        if (!tab) return false;

        const meetingId = normalizeMeetingId(extractMeetingIdFromUrl(tab.url || ""));
        if (!meetingId) return false;

        const index = await getMasterIndex();
        const now = Date.now();

        const liveMatch = (index.list || []).find(i =>
            normalizeMeetingId(i.meetingId) === meetingId &&
            Math.abs(now - (i.lastAccessed || 0)) < 60000
        );

        if (!liveMatch) return false;

        // preload transcript into liveMessages (keeps activeTabSession null so live mode)
        await preloadLiveSession(liveMatch.meetingId, liveMatch.sessionId);

        // show header as live
        showMeetingHeader(liveMatch.meetingId, liveMatch.startedAt, true);

        // ensure live mode
        activeTabSession = null;

        return true;
    }



    function setActiveTab(tab) {
        const mainEl = document.querySelector('main');
        const topControls = document.getElementById('topControls');
        if (mainEl) mainEl.style.opacity = 0;

        setTimeout(() => {
            activeTab = tab;

            menuButtons.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
            controls.classList.toggle('visible', tab === 'transcript');
            historyListEl.style.display = tab === 'history' ? 'flex' : 'none';

            // Hide Start/Stop controls outside transcript tab
            if (topControls) topControls.style.display = (tab === 'transcript') ? 'flex' : 'none';

            const meetHeader = document.querySelector('.meeting-header');
            if (meetHeader) meetHeader.style.display = (tab === 'transcript') ? 'flex' : 'none';
            if (tab !== 'transcript') document.querySelector('.go-live-wrapper')?.remove();

            if (tab === 'history') {
                clearView();
                if (topControls) topControls.style.display = 'none';
                renderHistoryList();
                if (mainEl) mainEl.style.opacity = 1;
                return;
            }

            if (tab === 'settings') {
                clearView();
                if (topControls) topControls.style.display = 'none';
                renderSettings();
                if (mainEl) mainEl.style.opacity = 1;
                return;
            }

            if (tab === 'transcript') {
                // On every switch to Live, check for a recent stored session first.
                // Use the returned boolean to decide what to render.
                tryLoadRecentLiveSession().then((loaded) => {
                    // If a recent session was NOT loaded, we must force live mode:
                    if (!loaded) {
                        // Clear any history session state — we're switching to live with nothing preloaded
                        activeTabSession = null;

                        // Clear view (keep top controls) and remove any residual history back rows
                        clearViewExceptTop();
                        content.querySelector('.history-back-row')?.remove();

                        // Also clear liveMessages if you want to avoid accidentally showing previous history
                        // (optional — uncomment if you observe stale liveMessages)
                        // Object.keys(liveMessages).forEach(k => delete liveMessages[k]);

                        // Show an empty live placeholder via renderLiveTranscript
                        renderLiveTranscript();
                    } else {
                        // loaded === true -> preload has populated liveMessages and header; render them
                        if (!activeTabSession) renderLiveTranscript();
                    }

                    if (topControls) topControls.style.display = 'flex';
                    if (mainEl) mainEl.style.opacity = 1;
                }).catch((e) => {
                    console.error('tryLoadRecentLiveSession error', e);
                    // fallback: ensure we show live placeholder
                    activeTabSession = null;
                    clearViewExceptTop();
                    content.querySelector('.history-back-row')?.remove();
                    renderLiveTranscript();
                    if (topControls) topControls.style.display = 'flex';
                    if (mainEl) mainEl.style.opacity = 1;
                });

                return;
            }



        }, 120);
    }
    // ---- helper: clear view but keep top controls if present ----
    function clearViewExceptTop() {
        const top = document.getElementById('topControls');
        // clear everything and re-add topControls (if exists) so controls stay consistent
        content.innerHTML = '';
        if (top) content.appendChild(top);
    }

    // ---- render live transcript: uses `liveMessages` and only shows live view ----
    function renderLiveTranscript() {
        // Do nothing if a history session is open — live view should not override it
        if (activeTabSession) return;

        clearViewExceptTop();
        // remove any persisted go-live/back button
        document.querySelector('.go-live-wrapper')?.remove();

        // Optionally set header blank for live until we detect a match
        showMeetingHeader('', null, false);

        const uids = Object.keys(liveMessages);
        if (!uids.length) {
            const empty = document.createElement('div');
            empty.className = 'empty';
            empty.textContent = 'Waiting for live captions...';
            content.appendChild(empty);
            return;
        }

        // Append messages in the order of liveMessages insertion (uid order is approximate)
        uids.forEach(uid => {
            const record = liveMessages[uid];
            if (!record || !record.elem) return;
            content.appendChild(record.elem);
        });

        populateSpeakerFilter();

        // scroll to bottom to show most recent
        setTimeout(() => {
            content.scrollTop = content.scrollHeight;
        }, 30);
    }

    async function preloadLiveSession(meetingId, sessionId) {
        // DO NOT set activeTabSession — this must remain live mode
        const key = `gmeet_transcript_${meetingId}_sessions`;
        const stored = await new Promise(res =>
            chrome.storage.local.get([key], r => res(r[key] || []))
        );

        const sessionObj = (stored || []).find(s => s.sessionId === sessionId);
        if (!sessionObj) return;

        const transcript = sessionObj.transcript || {};
        const entries = transcript.entries || {};
        const order = transcript.order || Object.keys(entries);

        // rebuild liveMessages map exactly like realtime mode
        for (const uid of order) {
            const entry = entries[uid];
            if (!entry) continue;

            const lastMsg = entry.messages.length
                ? entry.messages[entry.messages.length - 1]
                : { text: entry.lastText || '', ts: '' };

            // build the element like realtime handler does
            const div = document.createElement('div');
            div.className = `message ${entry.user === selfUser ? 'self' : 'other'}`;
            div.dataset.uid = uid;

            div.innerHTML = `
            <div class="bubble">
                <div class="meta">${entry.user} • ${lastMsg.ts || ''}</div>
                <div class="text">${escapeHtml(lastMsg.text)}</div>
            </div>
        `;

            liveMessages[uid] = {
                elem: div,
                text: lastMsg.text,
                lastTs: lastMsg.t || Date.now()
            };
        }
    }


    // ---- load a stored session transcript and render it (history / preloaded session) ----
    async function loadSessionTranscript(meetingId, sessionId, opts = {}) {
        // opts.preloaded can be used by caller to behave slightly differently (currently unused)
        try {
            // clear live state so live messages don't appear over history view
            activeTabSession = { meetingId, sessionId };

            // Clear main content while preserving topControls
            clearViewExceptTop();

            // key pattern in your storage: gmeet_transcript_<meetingId>_sessions
            const key = `gmeet_transcript_${meetingId}_sessions`;
            const stored = await new Promise(res =>
                chrome.storage.local.get([key], (r) => res(r[key] || []))
            );

            // stored is expected to be an array of session objects
            const sessionObj = (stored || []).find(s => s.sessionId === sessionId);
            if (!sessionObj) {
                const notFound = document.createElement('div');
                notFound.className = 'empty';
                notFound.textContent = 'Session not found.';
                content.appendChild(notFound);
                return;
            }

            // show meeting header: meetingId + startedAt; mark not live
            showMeetingHeader(meetingId, sessionObj.startedAt || null, false);

            // render each entry in the transcript order
            const transcript = sessionObj.transcript || {};
            const entries = transcript.entries || {};
            const order = transcript.order || Object.keys(entries);

            // container for messages
            order.forEach(uid => {
                const entry = entries[uid];
                if (!entry) return;

                // pick last message (messages array may contain previous updates)
                const lastMsg = Array.isArray(entry.messages) && entry.messages.length
                    ? entry.messages[entry.messages.length - 1]
                    : { text: entry.lastText || '', ts: '' };

                const div = document.createElement('div');
                div.className = `message ${entry.user === selfUser ? 'self' : 'other'}`;

                div.innerHTML = `
                    <div class='bubble'>
                        <div class='meta'>${entry.user} • ${lastMsg.ts || ''}</div>
                        <div class='text'>${escapeHtml(lastMsg.text || entry.lastText || '')}</div>
                    </div>
                `;

                content.appendChild(div);
            });

            populateSpeakerFilter();

            // ensure scrolled to bottom
            setTimeout(() => {
                content.scrollTop = content.scrollHeight;
            }, 30);

        } catch (e) {
            console.error('loadSessionTranscript error', e);
            const err = document.createElement('div');
            err.className = 'empty';
            err.textContent = 'Failed to load session.';
            content.appendChild(err);
        }

        // small helper to safely escape text inserted as HTML
        function escapeHtml(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }
    }

    function clearView() {
        const top = document.getElementById('topControls');
        content.innerHTML = '';
        if (top)
            content.appendChild(top);
    }

    // settings UI
    function renderSettings() {
        clearView();
        const wrapper = document.createElement('div');
        wrapper.className = 'settings-option';
        wrapper.innerHTML = `
            <span>Auto-record captions</span>
            <div class='toggle' id='autoRecordToggle'></div>
        `;
        content.appendChild(wrapper);

        chrome.storage.sync.get([SETTINGS_KEY], data => {
            const current = data[SETTINGS_KEY]?.autoRecord ?? true;
            const toggle = document.getElementById('autoRecordToggle');
            if (current)
                toggle.classList.add('active');
            toggle.addEventListener('click', () => {
                toggle.classList.toggle('active');
                const state = toggle.classList.contains('active');
                setSettings({ autoRecord: state });
            });
        });
    }

    // search & export
    searchInput.addEventListener('input', () => {
        if (activeTab !== 'transcript') return;
        const q = searchInput.value.toLowerCase();
        content.querySelectorAll('.message').forEach(m => {
            m.style.display = m.textContent.toLowerCase().includes(q) ? 'flex' : 'none';
        });
    });

    exportBtn.addEventListener('click', () => {
        // Allow export for live transcript OR history session
        if (activeTab !== 'transcript' && !activeTabSession) return;

        // Determine meeting/session for naming
        let filename = `transcript_${Date.now()}.csv`;
        if (activeTabSession) {
            const { meetingId, sessionId } = activeTabSession;
            filename = `${meetingId}_${sessionId}.csv`;
        }

        // Build CSV
        const rows = [['User', 'Timestamp', 'Text']];
        content.querySelectorAll('.message').forEach(m => {
            const meta = m.querySelector('.meta').textContent.split('•');
            const user = meta[0].trim();
            const ts = meta[1]?.trim() || '';
            const text = m.querySelector('.text').textContent.trim();
            rows.push([user, ts, text]);
        });

        const csv = rows
            .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
            .join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
    });


    // ---------------------- Realtime message handler (live captions) ----------------------
    chrome.runtime.onMessage.addListener((msg, sender, sendResp) => {
        try {
            // only react to messages from the recorder
            if (!msg || msg.source !== 'gmeet_caption_recorder' || !msg.payload) return;
            const p = msg.payload;
            handleRealtimePayload(p);
            sendResp?.({ ok: true });
        } catch (e) {
            console.error('Realtime listener error', e);
        }
        return true;
    });

    function handleRealtimePayload(p) {
        // sanity checks
        if (!p || !p.uniqueId || !p.text) return;
        // Do not show live captions when viewing a stored session
        if (activeTabSession) return;
        // Allow search in live transcript OR history session
        if (activeTab !== 'transcript' && !activeTabSession) return;

        // Normalize user label for matching your UI expectation
        const userLabel = p.user || 'Unknown';

        // If this uid is not present, create a container for this speaker
        const existing = liveMessages[p.uniqueId];

        if (!existing) {
            // Create a message element for the new caption
            const div = document.createElement('div');
            div.className = `message ${userLabel === selfUser ? 'self' : 'other'}`;
            div.dataset.uid = p.uniqueId;
            div.innerHTML = `
                <div class='bubble'>
                    <div class='meta'>${escapeHtml(userLabel)} • ${escapeHtml(p.ts || '')}</div>
                    <div class='text'>${escapeHtml(p.text)}</div>
                </div>
            `;

            content.appendChild(div);

            liveMessages[p.uniqueId] = { elem: div, text: p.text, lastTs: p.t || Date.now() };

            // scroll to bottom to show new content
            setTimeout(() => { content.scrollTop = content.scrollHeight; }, 30);
            return;
        }

        // existing entry — decide update or append new message block
        if (p.type === 'caption_update' || p.replaced) {
            // update in-place
            const txtEl = existing.elem.querySelector('.text');
            if (txtEl) txtEl.textContent = p.text;
            const metaEl = existing.elem.querySelector('.meta');
            if (metaEl) metaEl.textContent = `${userLabel} • ${p.ts || ''}`;
            existing.text = p.text;
            existing.lastTs = p.t || Date.now();
            return;
        }

        // If we receive a caption_add while an entry exists but text differs, append a new bubble
        if (p.type === 'caption_add' && p.text !== existing.text) {
            const div = document.createElement('div');
            div.className = `message ${userLabel === selfUser ? 'self' : 'other'}`;
            div.dataset.uid = p.uniqueId;
            div.innerHTML = `
                <div class='bubble'>
                    <div class='meta'>${escapeHtml(userLabel)} • ${escapeHtml(p.ts || '')}</div>
                    <div class='text'>${escapeHtml(p.text)}</div>
                </div>
            `;
            content.appendChild(div);
            // update map to point to latest element & text
            liveMessages[p.uniqueId] = { elem: div, text: p.text, lastTs: p.t || Date.now() };
            setTimeout(() => { content.scrollTop = content.scrollHeight; }, 30);
            return;
        }

        // Fallback: update text if it's different
        if (existing.text !== p.text) {
            const txtEl = existing.elem.querySelector('.text');
            if (txtEl) txtEl.textContent = p.text;
            existing.text = p.text;
            existing.lastTs = p.t || Date.now();
        }
    }

    // utility: escape text before inserting into innerHTML
    function escapeHtml(s) {
        if (!s) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function populateSpeakerFilter() {
        const speakers = new Set();

        content.querySelectorAll('.message .meta').forEach(meta => {
            const name = meta.textContent.split('•')[0].trim();
            speakers.add(name);
        });

        speakerFilter.innerHTML = '<option value="">All Speakers</option>';
        speakers.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            speakerFilter.appendChild(opt);
        });
    }

    speakerFilter.addEventListener('change', () => {
        const sel = speakerFilter.value.toLowerCase();

        content.querySelectorAll('.message').forEach(m => {
            const meta = m.querySelector('.meta').textContent.toLowerCase();
            m.style.display = (!sel || meta.startsWith(sel)) ? 'flex' : 'none';
        });
    });

    document.getElementById('copyAll').addEventListener('click', () => {
        if (activeTab !== 'transcript' && !activeTabSession) return;

        let output = '';

        content.querySelectorAll('.message').forEach(m => {
            const meta = m.querySelector('.meta').textContent.replace('•', ' @ ');
            const text = m.querySelector('.text').textContent.trim();
            output += `${meta}: ${text}\n`;
        });

        navigator.clipboard.writeText(output)
            .then(() => console.log('Transcript copied.'));
    });

    // init
    init();
})();