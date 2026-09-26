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
    const STORAGE_PREFIX = 'gmeet_transcript_';
    const DEFAULT_SETTINGS = {
        // Recording is opt-in. The privacy policy tells the user to inform the
        // other participants "before enabling this feature", so the feature
        // cannot be the one that is already on when they first look.
        autoRecord: false,
        consented: false,
        mergeWindowSecs: 60,
        keepMeetings: 15
    };
    let activeTab = 'transcript';
    const selfUser = 'You';
    const liveMessages = {};
    let recorderActive = false;
    let activeTabSession = null;

    const fmtDate = ms => new Date(ms).toLocaleString();

    /**
     * Formats a span in milliseconds as "1h 04m" / "7m 30s" / "12s".
     *
     * @param {number} ms
     *
     * @returns {string}
     */
    function fmtDuration(ms) {
        if (!ms || ms < 0) return '';
        const s = Math.round(ms / 1000);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
        if (m) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
        return `${s}s`;
    }

    /**
     * The one place that decides whether a rendered line is showing.
     *
     * The search box and the speaker dropdown both used to write
     * element.style.display directly, so whichever ran last silently discarded
     * the other: picking a speaker threw away the search, and typing threw away
     * the speaker.
     */
    const filters = { query: '', speaker: '' };

    function lineMatches(el) {
        const meta = el.querySelector('.meta');
        const speaker = meta ? meta.dataset.speaker || '' : '';
        if (filters.speaker && speaker.toLowerCase() !== filters.speaker.toLowerCase()) return false;
        if (filters.query && !el.textContent.toLowerCase().includes(filters.query)) return false;
        return true;
    }

    function applyFilters() {
        content.querySelectorAll('.message').forEach(el => {
            el.style.display = lineMatches(el) ? 'flex' : 'none';
        });
    }

    /** The lines currently on screen, in order - what Copy and Export act on. */
    const visibleMessages = () =>
        [...content.querySelectorAll('.message')].filter(m => m.style.display !== 'none');

    /**
     * Flattens a stored transcript into the lines to display, oldest first.
     *
     * Both renderers used to take only the LAST message of each speaker, so a
     * transcript kept every line but showed one per person; and because they
     * walked transcript.order - the order speakers were first heard - the
     * timestamps on screen did not run in order either.
     *
     * @param {object} transcript
     *
     * @returns {Array<{uid: string, user: string, text: string, ts: string, t: number, seq: number}>}
     */
    function flattenTranscript(transcript) {
        const entries = (transcript && transcript.entries) || {};
        const lines = [];

        for (const uid of Object.keys(entries)) {
            const entry = entries[uid];
            if (!entry) continue;

            const messages = Array.isArray(entry.messages) && entry.messages.length
                ? entry.messages
                : (entry.lastText ? [{ text: entry.lastText, ts: '', t: 0, seq: 0 }] : []);

            for (const msg of messages) {
                if (!msg || !msg.text) continue;
                lines.push({
                    uid,
                    user: entry.user || 'Unknown',
                    text: msg.text,
                    ts: msg.ts || '',
                    t: msg.t || 0,
                    seq: msg.seq != null ? msg.seq : 0
                });
            }
        }

        return lines.sort((a, b) => (a.t - b.t) || (a.seq - b.seq));
    }

    /**
     * Builds one transcript bubble. Text goes in through textContent, never
     * interpolated into markup.
     *
     * @param {{uid: string, user: string, text: string, ts: string}} line
     *
     * @returns {HTMLElement}
     */
    function buildMessage(line) {
        const div = document.createElement('div');
        div.className = `message ${line.user === selfUser ? 'self' : 'other'}`;
        div.dataset.uid = line.uid;

        const bubble = document.createElement('div');
        bubble.className = 'bubble';

        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.dataset.speaker = line.user;
        meta.textContent = `${line.user} • ${line.ts || ''}`;

        const text = document.createElement('div');
        text.className = 'text';
        text.textContent = line.text;

        bubble.append(meta, text);
        div.appendChild(bubble);
        return div;
    }

    // Init
    async function init() {
        bindMenu();

        const settings = await getSettings();
        const tab = await getActiveTab();
        const meetingId = normalizeMeetingId(extractMeetingIdFromUrl(tab?.url || ''));
        const index = await getMasterIndex();
        const now = Date.now();

        recorderActive = tab && tab.id != null ? await checkRecorderInPage(tab.id) : false;
        renderTopControls(settings.autoRecord, recorderActive);

        // Nothing is recorded until the user has seen what this does and said
        // yes. Until then the panel shows the consent card and no more.
        if (!settings.consented) {
            showConsentCard(settings);
            controls.classList.remove('visible');
            return;
        }

        const liveMatch = (index.list || []).find(i =>
            normalizeMeetingId(i.meetingId) === meetingId &&
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


        if (settings.autoRecord === true && !recorderActive) {
            const started = await startRecordingFlow();
            recorderActive = !!started;
            updateRecorderButton(recorderActive);
        }
        controls.classList.add('visible');

    }

    /**
     * The one-time card that asks before anything is recorded.
     *
     * The extension stores what people said in a meeting. Doing that the first
     * time the panel happens to open - which is what `autoRecord ?? true` did -
     * is not a decision the user ever made.
     */
    function showConsentCard(settings) {
        clearViewExceptTop();
        const top = document.getElementById('topControls');
        if (top) top.style.display = 'none';

        const card = document.createElement('section');
        card.className = 'consent-card';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-labelledby', 'consentTitle');

        const h = document.createElement('h2');
        h.id = 'consentTitle';
        h.textContent = 'Before you record';

        const body = document.createElement('p');
        body.textContent = 'Gmeet Kit saves the text of Google Meet\u2019s live captions '
            + 'so you can read the meeting back later. Transcripts stay on this computer '
            + 'and are never uploaded.';

        const law = document.createElement('p');
        law.className = 'consent-law';
        law.textContent = 'Recording or transcribing a conversation is regulated in some places, '
            + 'and often needs everyone\u2019s agreement. Tell the other participants before you start.';

        const autoLabel = document.createElement('label');
        autoLabel.className = 'consent-auto';
        const auto = document.createElement('input');
        auto.type = 'checkbox';
        auto.id = 'consentAutoRecord';
        // Someone upgrading from a version without this card already had
        // auto-record switched on. Starting the box unticked would quietly
        // turn their own setting off the moment they accepted.
        auto.checked = settings?.autoRecord === true;
        const autoText = document.createElement('span');
        autoText.textContent = 'Start recording automatically in future meetings';
        autoLabel.append(auto, autoText);

        const row = document.createElement('div');
        row.className = 'consent-actions';

        const no = document.createElement('button');
        no.className = 'btn-secondary';
        no.id = 'consentDecline';
        no.textContent = 'Not now';
        no.addEventListener('click', async () => {
            await setSettings({ consented: true, autoRecord: false });
            await init();
        });

        const yes = document.createElement('button');
        yes.className = 'btn-primary';
        yes.id = 'consentAccept';
        yes.textContent = 'I understand';
        yes.addEventListener('click', async () => {
            await setSettings({ consented: true, autoRecord: !!auto.checked });
            await init();
        });

        row.append(no, yes);
        card.append(h, body, law, autoLabel, row);
        content.appendChild(card);
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
            [SETTINGS_KEY], r => res({ ...DEFAULT_SETTINGS, ...(r[SETTINGS_KEY] || {}) }))
        );
    }

    /**
     * Merges a patch into the stored settings.
     *
     * This used to replace the whole object, so saving the auto-record checkbox
     * erased every other setting - including the record of consent.
     *
     * @param {object} patch
     *
     * @returns {Promise<object>} the settings as they now stand
     */
    async function setSettings(patch) {
        const merged = { ...(await getSettings()), ...patch };
        await new Promise(res => chrome.storage.sync.set({ [SETTINGS_KEY]: merged }, () => res()));
        return merged;
    }

    const MEETING_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

    /**
     * Reduces a path segment to a meeting code, or null.
     *
     * This was called in two places and defined in none, so every switch to the
     * Live Transcript tab threw a ReferenceError, fell into the catch, and
     * discarded whatever session had been preloaded.
     *
     * @param {string|null} id
     *
     * @returns {string|null}
     */
    function normalizeMeetingId(id) {
        if (!id) return null;
        const trimmed = String(id).trim().toLowerCase();
        return MEETING_CODE.test(trimmed) ? trimmed : null;
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

        // There used to be an executeScript fallback here, using an API this
        // extension never declared a permission for - so the namespace was
        // undefined and the fallback only ever threw into its own catch.
        // Adding the permission would widen what the extension may do, so the
        // dead branch is gone instead: no answer from the tab means no recorder.
        return false;
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
        const titleBox = document.createElement('div');
        const title = document.createElement('div');
        title.className = 'meeting-title';
        title.id = 'meetingTitle';
        const sub = document.createElement('div');
        sub.className = 'meeting-sub';
        sub.id = 'meetingSub';
        titleBox.append(title, sub);
        meetHeader.appendChild(titleBox);

        const auto = document.createElement('label');
        auto.className = 'auto-record';
        const autoInput = document.createElement('input');
        autoInput.type = 'checkbox';
        autoInput.id = 'autoRecordCheckbox';
        autoInput.checked = !!autoRecordChecked;
        const autoText = document.createElement('span');
        autoText.textContent = 'Auto-record';
        auto.append(autoInput, autoText);
        autoInput.addEventListener('change', e => setSettings({ autoRecord: !!e.target.checked }));

        const btn = document.createElement('button');
        btn.id = 'recorderToggle';
        btn.className = `recorder-btn ${isActive ? 'active' : ''}`;
        btn.textContent = isActive ? 'Stop recording' : 'Start recording';

        // The status line: what the recorder is actually doing, as opposed to
        // what the button last asked it to do.
        const status = document.createElement('div');
        status.id = 'recorderStatus';
        status.className = 'recorder-status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');

        // Header, then controls, then status - each on its own line. Four
        // children in one flex row squeezed the meeting code onto three lines
        // and split "Stop recording" across two at panel width.
        const actions = document.createElement('div');
        actions.className = 'controls-row';
        actions.append(auto, btn);

        wrapper.append(meetHeader, actions, status);
        content.prepend(wrapper);
        setRecorderStatus(isActive ? 'recording' : 'idle');
    }

    /**
     * Shows what the recorder is doing, and keeps the button honest about it.
     *
     * The panel used to set `recorderActive` when it asked the recorder to
     * start and never hear another word: the recorder emits recording_started,
     * recording_stopped and recorder_failed, and nothing here listened to any
     * of them. A recorder that could not find the caption container left the
     * button reading "Stop recording" for the rest of the call, so the panel
     * claimed to be recording a transcript that was never being written.
     *
     * @param {'idle'|'recording'|'starting'|'failed'|'stopped'|'storage-full'} state
     * @param {string} [detail]
     */
    function setRecorderStatus(state, detail) {
        const el = document.getElementById('recorderStatus');
        if (!el) return;

        const text = {
            idle: 'Not recording',
            starting: 'Starting\u2026',
            recording: 'Recording',
            stopped: 'Stopped \u2014 transcript saved',
            failed: 'Could not start \u2014 captions are unavailable on this page',
            'storage-full': 'Storage is full \u2014 delete old transcripts to keep recording'
        }[state] || '';

        el.dataset.state = state;
        el.textContent = detail ? `${text} (${detail})` : text;
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

    /** Storage key holding every session recorded for one meeting. */
    const sessionsKey = meetingId => `${STORAGE_PREFIX}${meetingId}_sessions`;

    function getLocal(keys) {
        return new Promise(res => chrome.storage.local.get(keys, r => res(r || {})));
    }

    function setLocal(obj) {
        return new Promise(res => chrome.storage.local.set(obj, () => res()));
    }

    function removeLocal(keys) {
        return new Promise(res => chrome.storage.local.remove(keys, () => res()));
    }

    /**
     * Summarises a stored session for its history card.
     *
     * @param {object|undefined} sessionObj
     *
     * @returns {{lines: number, speakers: string[]}}
     */
    function summarise(sessionObj) {
        const lines = flattenTranscript(sessionObj?.transcript || {});
        const speakers = [...new Set(lines.map(l => l.user).filter(Boolean))];
        return { lines: lines.length, speakers };
    }

    /**
     * Removes one recorded session, and its entry in the master index.
     *
     * There was no way to do this at all: the extension stored what people said
     * in a meeting, permanently, with no delete anywhere in the UI.
     *
     * @param {string} meetingId
     * @param {string} sessionId
     */
    async function deleteSession(meetingId, sessionId) {
        const key = sessionsKey(meetingId);
        const stored = await getLocal([key, MASTER_INDEX_KEY]);

        const remaining = (stored[key] || []).filter(x => x.sessionId !== sessionId);
        if (remaining.length) await setLocal({ [key]: remaining });
        else await removeLocal([key]);

        const index = stored[MASTER_INDEX_KEY] || { list: [] };
        index.list = (index.list || []).filter(x => x.sessionId !== sessionId);
        await setLocal({ [MASTER_INDEX_KEY]: index });
    }

    /** Removes every transcript this extension has stored. */
    async function deleteAllSessions() {
        const index = await getMasterIndex();
        const keys = [...new Set((index.list || []).map(i => sessionsKey(i.meetingId)))];
        if (keys.length) await removeLocal(keys);
        await setLocal({ [MASTER_INDEX_KEY]: { list: [] } });
    }

    /**
     * Builds the row of actions on a history card.
     *
     * @param {object} item - master index entry
     * @param {object|undefined} sessionObj
     *
     * @returns {HTMLElement}
     */
    function historyActions(item, sessionObj) {
        const row = document.createElement('div');
        row.className = 'history-actions';

        const exportOne = document.createElement('button');
        exportOne.className = 'icon-btn';
        exportOne.type = 'button';
        exportOne.textContent = 'Export';
        exportOne.setAttribute('aria-label', `Export transcript for ${item.meetingId}`);
        exportOne.addEventListener('click', e => {
            // Exporting used to mean: open the session, then press Export.
            e.stopPropagation();
            const rows = [['Speaker', 'Time', 'Text']];
            flattenTranscript(sessionObj?.transcript || {})
                .forEach(l => rows.push([l.user, l.ts, l.text]));
            if (rows.length === 1) {
                flashButton(exportOne, 'Empty');
                return;
            }
            const stamp = new Date(item.startedAt || Date.now()).toISOString().slice(0, 10);
            download(`${item.meetingId}_${stamp}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
            flashButton(exportOne, 'Saved');
        });

        const del = document.createElement('button');
        del.className = 'icon-btn danger';
        del.type = 'button';
        del.textContent = 'Delete';
        del.setAttribute('aria-label', `Delete transcript for ${item.meetingId}`);
        del.addEventListener('click', async e => {
            e.stopPropagation();
            // Click once to arm, again to delete - a transcript is not
            // something to lose to a stray tap, and a confirm() dialog in a
            // side panel is heavier than this deserves.
            if (del.dataset.confirm !== '1') {
                del.dataset.confirm = '1';
                del.textContent = 'Sure?';
                setTimeout(() => {
                    if (!del.isConnected) return;
                    delete del.dataset.confirm;
                    del.textContent = 'Delete';
                }, 3000);
                return;
            }
            await deleteSession(item.meetingId, item.sessionId);
            renderHistoryList();
        });

        row.append(exportOne, del);
        return row;
    }

    async function renderHistoryList() {
        historyListEl.textContent = '';
        const idx = await getMasterIndex();

        // A Set of object references never deduplicates anything, which is what
        // this was. Session ids are what identify a recording.
        const seen = new Set();
        const list = (idx.list || [])
            .filter(item => {
                if (!item || seen.has(item.sessionId)) return false;
                seen.add(item.sessionId);
                return true;
            })
            .sort((a, b) => (b.lastAccessed || b.startedAt || 0) - (a.lastAccessed || a.startedAt || 0))
            .slice(0, 50);

        if (!list.length) {
            const empty = document.createElement('div');
            empty.className = 'empty';
            empty.textContent = 'No recorded meetings yet.';
            historyListEl.appendChild(empty);
            return;
        }

        // One read covering every meeting on the list, rather than one per card.
        const stored = await getLocal([...new Set(list.map(i => sessionsKey(i.meetingId)))]);

        list.forEach(item => {
            const sessionObj = (stored[sessionsKey(item.meetingId)] || [])
                .find(x => x.sessionId === item.sessionId);
            const { lines, speakers } = summarise(sessionObj);
            const live = Math.abs(Date.now() - (item.lastAccessed || 0)) < 60000;

            const card = document.createElement('div');
            card.className = 'history-card';
            card.tabIndex = 0;
            card.setAttribute('role', 'button');
            card.setAttribute('aria-label',
                `${item.meetingId}, ${fmtDate(item.startedAt)}, ${lines} lines`);

            const head = document.createElement('div');
            head.className = 'history-head';
            const id = document.createElement('div');
            id.className = 'history-meetid';
            id.textContent = item.meetingId || '';
            head.appendChild(id);

            if (live) {
                const badge = document.createElement('span');
                badge.className = 'live-badge';
                badge.textContent = 'Live';
                head.appendChild(badge);
            }

            const meta = document.createElement('div');
            meta.className = 'history-meta';
            meta.textContent = fmtDate(item.startedAt);

            // Three sessions of the same standup used to be indistinguishable:
            // every card showed the meeting code and a date, and nothing else.
            const stats = document.createElement('div');
            stats.className = 'history-stats';
            const duration = fmtDuration((item.lastAccessed || 0) - (item.startedAt || 0));
            const bits = [`${lines} ${lines === 1 ? 'line' : 'lines'}`];
            if (duration) bits.push(duration);
            if (speakers.length) {
                bits.push(speakers.length <= 2
                    ? speakers.join(', ')
                    : `${speakers.slice(0, 2).join(', ')} +${speakers.length - 2}`);
            }
            stats.textContent = bits.join('  \u00b7  ');

            const open = () => openHistorySession(item.meetingId, item.sessionId, item);
            card.addEventListener('click', open);
            card.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    open();
                }
            });

            card.append(head, meta, stats, historyActions(item, sessionObj));
            historyListEl.appendChild(card);
        });
    }

    // menu & tabs
    let menuBound = false;
    function bindMenu() {
        // init() runs again after the consent card is answered, so this must
        // not stack a second listener on every button.
        if (menuBound) return;
        menuBound = true;
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
        // This used to hide the panel, wait 120 ms and then do the work, so
        // every tab switch cost a visible eighth of a second for no reason.
        // The fade is a CSS transition on the new content instead.
        activeTab = tab;

        menuButtons.forEach(b => {
            const on = b.dataset.tab === tab;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', String(on));
        });

        // A filter left over from the previous view hides lines in this one.
        resetFilters();

        const topControls = document.getElementById('topControls');
        controls.classList.toggle('visible', tab === 'transcript');
        historyListEl.style.display = tab === 'history' ? 'flex' : 'none';
        if (topControls) topControls.style.display = (tab === 'transcript') ? 'flex' : 'none';

        const meetHeader = document.querySelector('.meeting-header');
        if (meetHeader) meetHeader.style.display = (tab === 'transcript') ? 'flex' : 'none';
        if (tab !== 'transcript') document.querySelector('.go-live-wrapper')?.remove();

        if (tab === 'history') {
            clearView();
            renderHistoryList();
            return;
        }

        if (tab === 'settings') {
            clearView();
            renderSettings();
            return;
        }

        // On every switch to Live, check for a recent stored session first.
        tryLoadRecentLiveSession().then(loaded => {
            if (!loaded) {
                activeTabSession = null;
                clearViewExceptTop();
                content.querySelector('.history-back-row')?.remove();
            }
            if (!activeTabSession) renderLiveTranscript();
        }).catch(e => {
            console.error('tryLoadRecentLiveSession error', e);
            activeTabSession = null;
            clearViewExceptTop();
            content.querySelector('.history-back-row')?.remove();
            renderLiveTranscript();
        });
    }

    function resetFilters() {
        filters.query = '';
        filters.speaker = '';
        searchInput.value = '';
        speakerFilter.value = '';
    }

    // ---- helper: clear view but keep top controls if present ----
    function clearViewExceptTop() {
        const top = document.getElementById('topControls');
        // clear everything and re-add topControls (if exists) so controls stay consistent
        content.textContent = '';
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

        // Oldest first. Insertion order used to stand in for chronology, which
        // put a speaker's later lines wherever they were first heard.
        uids.map(uid => liveMessages[uid])
            .filter(record => record && record.elem)
            .sort((a, b) => (a.lastTs || 0) - (b.lastTs || 0))
            .forEach(record => content.appendChild(record.elem));

        refreshSpeakerFilter();

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

        // Rebuild liveMessages with one entry per utterance, matching the keys
        // the realtime handler uses so later updates land on the right bubble.
        for (const line of flattenTranscript(sessionObj.transcript || {})) {
            liveMessages[`${line.uid}#${line.seq}`] = {
                elem: buildMessage(line),
                text: line.text,
                lastTs: line.t || Date.now()
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

            // Every line the session recorded, oldest first.
            for (const line of flattenTranscript(sessionObj.transcript || {})) {
                content.appendChild(buildMessage(line));
            }

            refreshSpeakerFilter();

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

    }

    function clearView() {
        const top = document.getElementById('topControls');
        content.textContent = '';
        if (top)
            content.appendChild(top);
    }

    // settings UI

    /**
     * An accessible on/off control.
     *
     * The toggle was a bare <div> with a click handler: not focusable, not
     * operable from the keyboard, and invisible to a screen reader.
     *
     * @param {string} id
     * @param {boolean} value
     * @param {string} label
     * @param {(next: boolean) => void} onChange
     *
     * @returns {HTMLButtonElement}
     */
    function buildToggle(id, value, label, onChange) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.id = id;
        toggle.className = `toggle${value ? ' active' : ''}`;
        toggle.setAttribute('role', 'switch');
        toggle.setAttribute('aria-checked', String(!!value));
        toggle.setAttribute('aria-label', label);
        toggle.addEventListener('click', () => {
            const next = !toggle.classList.contains('active');
            toggle.classList.toggle('active', next);
            toggle.setAttribute('aria-checked', String(next));
            onChange(next);
        });
        return toggle;
    }

    /**
     * One labelled row in the settings list.
     *
     * @param {string} label
     * @param {string} hint
     * @param {HTMLElement} control
     *
     * @returns {HTMLElement}
     */
    function settingsRow(label, hint, control) {
        const row = document.createElement('div');
        row.className = 'settings-option';

        const text = document.createElement('div');
        text.className = 'settings-text';
        const title = document.createElement('span');
        title.className = 'settings-label';
        title.textContent = label;
        text.appendChild(title);

        if (hint) {
            const sub = document.createElement('span');
            sub.className = 'settings-hint';
            sub.textContent = hint;
            text.appendChild(sub);
        }

        row.append(text, control);
        return row;
    }

    function buildNumber(id, value, min, max, unit, onChange) {
        const field = document.createElement('div');
        field.className = 'settings-field';

        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'settings-number';
        input.id = id;
        input.min = String(min);
        input.max = String(max);
        input.value = String(value);
        input.addEventListener('change', () => {
            const n = Math.min(max, Math.max(min, Number(input.value) || min));
            input.value = String(n);
            onChange(n);
        });

        // "60" on its own says nothing about what it counts.
        const label = document.createElement('span');
        label.className = 'settings-unit';
        label.textContent = unit;
        input.setAttribute('aria-describedby', `${id}Unit`);
        label.id = `${id}Unit`;

        field.append(input, label);
        return field;
    }

    /**
     * How much room the stored transcripts take.
     *
     * Nothing showed this, so there was no way to tell whether the 10 MB the
     * browser allows was about to run out - and a full quota is what stops the
     * recorder writing.
     *
     * @returns {Promise<{bytes: number, sessions: number}>}
     */
    async function storageUsage() {
        const index = await getMasterIndex();
        const sessions = (index.list || []).length;
        const bytes = await new Promise(res => {
            try {
                chrome.storage.local.getBytesInUse(null, n => {
                    void chrome.runtime.lastError;
                    res(typeof n === 'number' ? n : 0);
                });
            } catch (e) {
                res(0);
            }
        });
        return { bytes, sessions };
    }

    const fmtBytes = n => n < 1024 ? `${n} B`
        : n < 1048576 ? `${(n / 1024).toFixed(0)} KB`
            : `${(n / 1048576).toFixed(1)} MB`;

    async function renderSettings() {
        clearView();
        const settings = await getSettings();

        const list = document.createElement('div');
        list.className = 'settings-list';

        list.appendChild(settingsRow(
            'Auto-record captions',
            'Start recording as soon as you join a meeting.',
            buildToggle('autoRecordToggle', settings.autoRecord, 'Auto-record captions',
                next => setSettings({ autoRecord: next }))
        ));

        list.appendChild(settingsRow(
            'Continue a meeting within',
            'Rejoining inside this window adds to the same transcript instead of starting a new one.',
            buildNumber('mergeWindow', settings.mergeWindowSecs, 10, 3600, 'seconds',
                n => setSettings({ mergeWindowSecs: n }))
        ));

        list.appendChild(settingsRow(
            'Meetings to keep',
            'Older transcripts are deleted automatically once you pass this many.',
            buildNumber('keepMeetings', settings.keepMeetings, 1, 100, 'meetings',
                n => setSettings({ keepMeetings: n }))
        ));

        const usage = document.createElement('div');
        usage.className = 'settings-usage';
        usage.id = 'storageUsage';
        list.appendChild(usage);

        const danger = document.createElement('div');
        danger.className = 'settings-danger';

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.id = 'deleteAll';
        clearBtn.className = 'btn-danger';
        clearBtn.textContent = 'Delete all transcripts';
        clearBtn.addEventListener('click', async () => {
            if (clearBtn.dataset.confirm !== '1') {
                clearBtn.dataset.confirm = '1';
                clearBtn.textContent = 'Delete everything \u2014 click again';
                setTimeout(() => {
                    if (!clearBtn.isConnected) return;
                    delete clearBtn.dataset.confirm;
                    clearBtn.textContent = 'Delete all transcripts';
                }, 4000);
                return;
            }
            await deleteAllSessions();
            Object.keys(liveMessages).forEach(k => delete liveMessages[k]);
            renderSettings();
        });

        danger.appendChild(clearBtn);
        list.appendChild(danger);

        const policy = document.createElement('a');
        policy.className = 'settings-policy';
        policy.href = 'https://ajeesh05.github.io/gmeet_kit/privacy-policy.html';
        policy.target = '_blank';
        policy.rel = 'noopener noreferrer';
        policy.textContent = 'How Gmeet Kit handles your transcripts';
        list.appendChild(policy);

        content.appendChild(list);

        const { bytes, sessions } = await storageUsage();
        usage.textContent = `${sessions} ${sessions === 1 ? 'transcript' : 'transcripts'} stored, using ${fmtBytes(bytes)}.`;
    }

    // search & export
    searchInput.addEventListener('input', () => {
        filters.query = searchInput.value.trim().toLowerCase();
        applyFilters();
    });

    /**
     * Quotes one CSV field.
     *
     * A field beginning with =, +, - or @ is prefixed with a single quote:
     * spreadsheets otherwise treat it as a formula, so a transcript line is
     * enough to make Excel execute something on open.
     *
     * @param {*} value
     *
     * @returns {string}
     */
    function csvCell(value) {
        let v = String(value ?? '');
        if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
        return `"${v.replace(/"/g, '""')}"`;
    }

    function toCsv(rows) {
        return rows.map(r => r.map(csvCell).join(',')).join('\r\n');
    }

    function download(filename, text, mime) {
        const blob = new Blob([text], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        // Without this the blob is held for the life of the panel.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    exportBtn.addEventListener('click', () => {
        const lines = visibleMessages().map(readMessage);
        if (!lines.length) {
            flashButton(exportBtn, 'Nothing');
            return;
        }

        const meetingId = activeTabSession?.meetingId
            || document.getElementById('meetingTitle')?.textContent.replace(/^Meeting:\s*/, '')
            || 'transcript';
        const stamp = new Date().toISOString().slice(0, 10);
        const filename = `${meetingId || 'transcript'}_${stamp}.csv`;

        const rows = [['Speaker', 'Time', 'Text']];
        lines.forEach(l => rows.push([l.user, l.ts, l.text]));

        download(filename, toCsv(rows), 'text/csv;charset=utf-8');
        flashButton(exportBtn, `${lines.length} lines`);
    });

    // ---------------------- Realtime message handler (live captions) ----------------------
    chrome.runtime.onMessage.addListener((msg, sender, sendResp) => {
        try {
            // only react to messages from the recorder
            if (!msg || msg.source !== 'gmeet_caption_recorder' || !msg.payload) return;
            const p = msg.payload;

            // The recorder's lifecycle, which this listener used to drop on the
            // floor: handleRealtimePayload returns early without a uniqueId and
            // a text, so every one of these fell through silently.
            if (handleLifecycle(p)) {
                sendResp?.({ ok: true });
                return true;
            }

            handleRealtimePayload(p);
            sendResp?.({ ok: true });
        } catch (e) {
            console.error('Realtime listener error', e);
        }
        return true;
    });

    /**
     * Reflects a recorder lifecycle event in the UI.
     *
     * @param {object} p - realtime payload
     *
     * @returns {boolean} true when the payload was a lifecycle event
     */
    /** Drops the "Live" marker from the header once recording has ended. */
    function clearLiveMarker() {
        const sub = document.getElementById('meetingSub');
        if (sub) sub.textContent = sub.textContent.replace(/\s*\u2022\s*Live\s*$/, '');
    }

    function handleLifecycle(p) {
        switch (p.type) {
            case 'recording_started':
                recorderActive = true;
                updateRecorderButton(true);
                setRecorderStatus('recording');
                if (p.meetingId) showMeetingHeader(p.meetingId, p.startedAt, true);
                return true;

            case 'recording_stopped':
                recorderActive = false;
                updateRecorderButton(false);
                setRecorderStatus('stopped');
                clearLiveMarker();
                return true;

            case 'recorder_failed':
                recorderActive = false;
                updateRecorderButton(false);
                setRecorderStatus('failed');
                clearLiveMarker();
                return true;

            case 'storage_error':
                setRecorderStatus('storage-full');
                return true;

            default:
                return false;
        }
    }

    /**
     * Identifies one rendered line: a speaker plus the sequence number of the
     * utterance. Keying on the speaker alone meant a second utterance replaced
     * the first one's bubble instead of following it.
     *
     * @param {object} p - realtime payload
     *
     * @returns {string}
     */
    function messageKey(p) {
        return `${p.uniqueId}#${p.seq != null ? p.seq : 0}`;
    }

    function handleRealtimePayload(p) {
        // sanity checks
        if (!p || !p.uniqueId || !p.text) return;
        // Do not show live captions when viewing a stored session
        if (activeTabSession) return;
        // Allow search in live transcript OR history session
        if (activeTab !== 'transcript' && !activeTabSession) return;

        // Normalize user label for matching your UI expectation
        const userLabel = p.user || 'Unknown';

        // One entry per utterance, so a speaker can hold several lines.
        const key = messageKey(p);
        const existing = liveMessages[key];

        if (!existing) {
            // One builder for live and for history. This path used to assemble
            // the bubble with innerHTML and its own escaper, so the two views
            // could drift apart and only one of them was structurally safe.
            const div = buildMessage({
                uid: p.uniqueId,
                user: userLabel,
                text: p.text,
                ts: p.ts || ''
            });

            // "Waiting for live captions..." stayed on screen above the
            // captions it was waiting for.
            content.querySelector('.empty')?.remove();

            content.appendChild(div);
            liveMessages[key] = { elem: div, text: p.text, lastTs: p.t || Date.now() };

            // A speaker heard for the first time mid-call has to reach the
            // dropdown: it was only ever filled on a full re-render, so during
            // a live call it stayed empty and the filter did nothing.
            refreshSpeakerFilter();
            div.style.display = lineMatches(div) ? 'flex' : 'none';
            scrollToBottomIfPinned();
            return;
        }

        // existing entry - a caption that is still growing corrects its line
        if (existing.text !== p.text || p.type === 'caption_update' || p.replaced) {
            const txtEl = existing.elem.querySelector('.text');
            if (txtEl) txtEl.textContent = p.text;
            const metaEl = existing.elem.querySelector('.meta');
            if (metaEl) {
                metaEl.dataset.speaker = userLabel;
                metaEl.textContent = `${userLabel} • ${p.ts || ''}`;
            }
            existing.text = p.text;
            existing.lastTs = p.t || Date.now();
            existing.elem.style.display = lineMatches(existing.elem) ? 'flex' : 'none';
        }
    }

    /**
     * Scrolls to the newest line, unless the user has scrolled up to read.
     *
     * Yanking the view back to the bottom on every caption makes a live
     * transcript impossible to read while the meeting is still going.
     */
    function scrollToBottomIfPinned() {
        const distance = content.scrollHeight - content.scrollTop - content.clientHeight;
        if (distance > 120) return;
        setTimeout(() => { content.scrollTop = content.scrollHeight; }, 30);
    }

    /**
     * Rebuilds the speaker dropdown, keeping whatever the user had chosen.
     *
     * This used to reset the select on every call, so any re-render silently
     * dropped the current selection back to "All Speakers".
     */
    function refreshSpeakerFilter() {
        const speakers = new Set();
        content.querySelectorAll('.message .meta').forEach(meta => {
            const name = meta.dataset.speaker || meta.textContent.split('\u2022')[0].trim();
            if (name) speakers.add(name);
        });

        const wanted = filters.speaker;
        const current = [...speakerFilter.options].map(o => o.value).filter(Boolean).sort();
        const next = [...speakers].sort();
        if (current.join('\u0000') === next.join('\u0000')) return;

        speakerFilter.textContent = '';
        const all = document.createElement('option');
        all.value = '';
        all.textContent = 'All Speakers';
        speakerFilter.appendChild(all);

        next.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            speakerFilter.appendChild(opt);
        });

        // Keep the selection if that speaker is still on screen.
        speakerFilter.value = next.includes(wanted) ? wanted : '';
        filters.speaker = speakerFilter.value;
    }

    speakerFilter.addEventListener('change', () => {
        filters.speaker = speakerFilter.value;
        applyFilters();
    });

    /**
     * Reads a rendered bubble back into fields.
     *
     * @param {HTMLElement} el
     *
     * @returns {{user: string, ts: string, text: string}}
     */
    function readMessage(el) {
        const meta = el.querySelector('.meta');
        const parts = (meta?.textContent || '').split('\u2022');
        return {
            user: meta?.dataset.speaker || parts[0]?.trim() || '',
            ts: parts[1]?.trim() || '',
            text: el.querySelector('.text')?.textContent.trim() || ''
        };
    }

    /** Briefly confirms an action on the button the user just pressed. */
    function flashButton(btn, message) {
        if (!btn || btn.dataset.flashing) return;
        const original = btn.textContent;
        btn.dataset.flashing = '1';
        btn.textContent = message;
        btn.classList.add('flash');
        setTimeout(() => {
            btn.textContent = original;
            btn.classList.remove('flash');
            delete btn.dataset.flashing;
        }, 1400);
    }

    document.getElementById('copyAll').addEventListener('click', async () => {
        const btn = document.getElementById('copyAll');
        // Copy what is on screen. Copying lines the filter is hiding is not
        // what "Copy" looks like it does.
        const lines = visibleMessages().map(readMessage);

        if (!lines.length) {
            flashButton(btn, 'Nothing');
            return;
        }

        const output = lines.map(l => `${l.user} @ ${l.ts}: ${l.text}`).join('\n');

        try {
            await navigator.clipboard.writeText(output);
            flashButton(btn, `Copied ${lines.length}`);
        } catch (e) {
            console.error('copy failed', e);
            flashButton(btn, 'Copy failed');
        }
    });

    // init
    init();
})();