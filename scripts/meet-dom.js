/**
 * @fileoverview One place that knows how to find things in Google Meet.
 *
 * Meet's markup is build output. Class names and `jsname` values are minified
 * symbols that change without notice - `r8qRAd`, `OMfBQ` and `aTv5jf` have all
 * already moved, and `UywwFc-RLmnJb` was never a button at all, just Material's
 * ripple span that every button carries. Accessible names survive rebuilds
 * better, but they are English, so matching them strands every other locale.
 *
 * So nothing here depends on a single signal. Each target is a list of
 * strategies tried in order, strongest first:
 *
 *   1. ICON LIGATURE - the text inside Meet's <i class="google-symbols
 *      notranslate"> elements: "mic_off", "videocam", "call_end". These are
 *      Material Symbols names, they describe the control's current state, and
 *      Google marks the nodes `notranslate`, so they are identical in every
 *      language.
 *   2. KEYBOARD SHORTCUT - Meet writes the shortcut into the label, e.g.
 *      "Turn on microphone (ctrl + d)". The letters do not change per locale.
 *   3. ACCESSIBLE NAME - matched against a small multi-language vocabulary
 *      rather than one English string.
 *   4. JSNAME - the current minified values, as a last resort. Expected to rot;
 *      when it does, the layers above carry the feature.
 *
 * Every lookup is recorded. `MeetDom.health()` reports which strategy answered
 * for each target, or that nothing did, so selector rot shows up as a
 * diagnostic instead of a feature that quietly stopped working.
 *
 * Loaded as a classic script into both worlds: listed in content_scripts for
 * the isolated world, and injected ahead of enhancer.js for the page's world.
 *
 * @author Ajeesh T
 */

(function (root) {
    'use strict';

    /** name -> { strategy, at } for the last successful lookup, or null. */
    const health = Object.create(null);

    const CLICKABLE = 'button, [role="button"], [role="menuitem"]';

    /**
     * Accessible name of an element, from whichever attribute carries it.
     *
     * @param {Element} el
     *
     * @returns {string} lower-cased, or '' when there is none
     */
    function nameOf(el) {
        if (!el || !el.getAttribute) return '';
        const raw = el.getAttribute('aria-label')
            || el.getAttribute('data-tooltip')
            || el.getAttribute('title')
            || '';
        return raw.trim().toLowerCase();
    }

    /**
     * Material Symbols ligatures inside an element.
     *
     * The ligature is the icon's name in plain text - "mic_off", "call_end" -
     * and Meet renders it inside a notranslate node, so it reads the same in
     * every language.
     *
     * @param {Element} el
     *
     * @returns {string[]}
     */
    function iconsOf(el) {
        if (!el || !el.querySelectorAll) return [];
        const nodes = el.querySelectorAll('i, .google-symbols, .google-material-icons, .notranslate');
        const found = [];

        for (const node of nodes) {
            const text = (node.textContent || '').trim();
            // Ligature names are lower snake_case and never contain spaces.
            if (text && /^[a-z][a-z0-9_]*$/.test(text)) found.push(text);
        }

        // The element may be the icon itself.
        const own = (el.textContent || '').trim();
        if (!found.length && /^[a-z][a-z0-9_]*$/.test(own)) found.push(own);

        return found;
    }

    const hasIcon = (el, names) => iconsOf(el).some(icon => names.includes(icon));

    /**
     * Runs strategies in order and records which one answered.
     *
     * @param {string} target - name used in health()
     * @param {Array<[string, function(): (Element|null)]>} strategies
     *
     * @returns {Element|null}
     */
    function resolve(target, strategies) {
        for (const [strategy, find] of strategies) {
            let el = null;
            try {
                el = find();
            } catch (e) {
                el = null;
            }
            if (el) {
                health[target] = { strategy, at: Date.now() };
                return el;
            }
        }
        health[target] = { strategy: null, at: Date.now() };
        return null;
    }

    /** First clickable element satisfying a predicate. */
    function pick(predicate) {
        for (const el of document.querySelectorAll(CLICKABLE)) {
            if (predicate(el)) return el;
        }
        return null;
    }

    /**
     * Words for each control in the languages Meet is most used in.
     *
     * Only ever consulted after the icon and shortcut strategies, so a missing
     * language degrades to "one layer less", not to a broken feature.
     */
    // No \b anchors: CJK has no word boundaries, so \bマイク never matches.
    // These are only ever tested against a control's accessible name, where a
    // loose substring match is what we want.
    const WORDS = {
        microphone: /(microphone|micrófono|microfone|mikrofon|micro|microfono|マイク|마이크|麦克风|麥克風|ميكروفون|माइक)/i,
        camera: /(camera|cámara|câmera|kamera|caméra|videocamera|カメラ|카메라|摄像头|攝影機|كاميرا|कैमरा)/i,
        leave: /(leave call|leave|verlassen|salir|sair|quitter|abbandona|退出|나가기|مغادرة|छोड)/i,
        captions: /(captions|subtítulos|legendas|untertitel|sous-titres|sottotitoli|字幕|자막|التسميات|कैप्शन)/i,
        join: /(join|beitreten|unirse|entrar|rejoindre|partecipa|参加|참여|加入|انضم|शामिल)/i
    };

    /** Shortcut hints Meet writes into the label; same letters in every locale. */
    const SHORTCUT = {
        mic: /ctrl\s*\+\s*d/i,
        camera: /ctrl\s*\+\s*e/i
    };

    /**
     * What the label says pressing the control would DO.
     *
     * The action is the opposite of the state: a button offering "turn off" is
     * attached to something currently on. Only consulted when the icon,
     * data-is-muted and aria-pressed have all come back empty.
     */
    const ACTION = {
        turnOff: /(turn off|switch off|\bmute\b|ausschalten|stummschalten|desactivar|silenciar|desativar|désactiver|couper|disattiva|オフ|ミュート|끄기|음소거|关闭|關閉|إيقاف)/i,
        turnOn: /(turn on|switch on|unmute|einschalten|aktivieren|activar|ativar|activer|attiva|オン|ミュート解除|켜기|开启|開啟|تشغيل)/i
    };

    const ICONS = {
        micOn: ['mic'],
        micOff: ['mic_off'],
        cameraOn: ['videocam'],
        cameraOff: ['videocam_off', 'video_camera_front_off'],
        leave: ['call_end'],
        captions: ['closed_caption', 'closed_caption_off', 'closed_caption_disabled', 'subtitles', 'subtitles_off']
    };

    const MIC_ICONS = [...ICONS.micOn, ...ICONS.micOff];
    const CAMERA_ICONS = [...ICONS.cameraOn, ...ICONS.cameraOff];

    /**
     * Reads a toggle's state from whatever the control exposes.
     *
     * Preference order matters: the icon shows what the control IS, whereas the
     * label says what pressing it would DO, which is the opposite and reads
     * backwards in half the locales.
     *
     * @param {Element|null} el
     * @param {string[]} offIcons - ligatures meaning "currently off"
     *
     * @returns {boolean|null} true = on, false = off, null = cannot tell
     */
    function toggleState(el, offIcons) {
        if (!el) return null;

        const icons = iconsOf(el);
        if (icons.some(i => offIcons.includes(i))) return false;
        if (icons.length && icons.some(i => MIC_ICONS.includes(i) || CAMERA_ICONS.includes(i))) return true;

        // Meet has shipped data-is-muted on these controls.
        const muted = el.getAttribute('data-is-muted');
        if (muted === 'true') return false;
        if (muted === 'false') return true;

        const pressed = el.getAttribute('aria-pressed');
        if (pressed === 'true') return true;
        if (pressed === 'false') return false;

        // Last resort: read the offered action and invert it. Checked in this
        // order because "unmute" contains "mute".
        const name = nameOf(el);
        if (ACTION.turnOn.test(name)) return false;
        if (ACTION.turnOff.test(name)) return true;

        return null;
    }

    const MeetDom = {
        /** @returns {Element|null} the microphone toggle */
        micButton() {
            return resolve('micButton', [
                ['icon', () => pick(el => hasIcon(el, MIC_ICONS))],
                ['shortcut', () => pick(el => SHORTCUT.mic.test(nameOf(el)))],
                ['label', () => pick(el => WORDS.microphone.test(nameOf(el)))],
                ['jsname', () => document.querySelector('button[jsname="hw0c9"]')]
            ]);
        },

        /** @returns {Element|null} the camera toggle */
        cameraButton() {
            return resolve('cameraButton', [
                ['icon', () => pick(el => hasIcon(el, CAMERA_ICONS))],
                ['shortcut', () => pick(el => SHORTCUT.camera.test(nameOf(el)))],
                ['label', () => pick(el => WORDS.camera.test(nameOf(el)))],
                ['jsname', () => document.querySelector('button[jsname="psRWwc"]')]
            ]);
        },

        /** @returns {Element|null} the leave-call button */
        leaveButton() {
            return resolve('leaveButton', [
                ['icon', () => pick(el => hasIcon(el, ICONS.leave))],
                ['label', () => pick(el => WORDS.leave.test(nameOf(el)))],
                ['jsname', () => document.querySelector('[jsname="CQylAd"]')]
            ]);
        },

        /** @returns {Element|null} the captions toggle */
        captionsButton() {
            const isJumpControl = el => /jump|recent|bottom/i.test(nameOf(el));
            return resolve('captionsButton', [
                ['icon', () => pick(el => hasIcon(el, ICONS.captions))],
                // "Jump to most recent captions" also contains the word.
                ['label', () => pick(el => WORDS.captions.test(nameOf(el)) && !isJumpControl(el))],
                ['jsname', () => document.querySelector('button[jsname="RrG0hf"]')
                    || document.querySelector('button[jsname="r8qRAd"]')]
            ]);
        },

        /**
         * The lobby's primary action.
         *
         * Hardest target here: it carries no icon and its wording varies with
         * whether the host screens arrivals. The structural fallback is the
         * one enabled control in the lobby that is not a device toggle.
         *
         * @returns {Element|null}
         */
        joinButton() {
            const deviceControl = el =>
                hasIcon(el, MIC_ICONS) || hasIcon(el, CAMERA_ICONS)
                || SHORTCUT.mic.test(nameOf(el)) || SHORTCUT.camera.test(nameOf(el))
                || WORDS.microphone.test(nameOf(el)) || WORDS.camera.test(nameOf(el));

            return resolve('joinButton', [
                ['label', () => pick(el =>
                    WORDS.join.test(nameOf(el) || (el.textContent || '').trim().toLowerCase())
                    && !deviceControl(el))],
                ['structure', () => {
                    if (MeetDom.leaveButton()) return null;         // already in the call
                    const candidates = Array.from(document.querySelectorAll('button'))
                        .filter(el => !el.disabled && !deviceControl(el) && iconsOf(el).length === 0
                            && (el.textContent || '').trim().length > 0);
                    return candidates.length === 1 ? candidates[0] : null;
                }]
            ]);
        },

        /** @returns {boolean|null} true when the microphone is live */
        micOn() {
            return toggleState(MeetDom.micButton(), ICONS.micOff);
        },

        /** @returns {boolean|null} true when the camera is on */
        cameraOn() {
            return toggleState(MeetDom.cameraButton(), ICONS.cameraOff);
        },

        /** @returns {boolean} true when captions are currently showing */
        captionsOn() {
            const el = MeetDom.captionsButton();
            if (!el) return false;

            const icons = iconsOf(el);
            if (icons.includes('closed_caption_off') || icons.includes('subtitles_off')) return false;

            const pressed = el.getAttribute('aria-pressed');
            if (pressed === 'true') return true;
            if (pressed === 'false') return false;

            // English fallback: the label offers the action, so "turn off" means on.
            return /turn off/.test(nameOf(el));
        },

        /** @returns {boolean} whether the lobby is ready to be joined */
        readyToJoin() {
            const button = MeetDom.joinButton();
            return !!button
                && !button.disabled
                && button.getAttribute('aria-disabled') !== 'true';
        },

        /** @returns {boolean} whether we are in the call */
        inCall() {
            return !!MeetDom.leaveButton();
        },

        /** @returns {Element[]} participant tiles */
        tiles() {
            return Array.from(document.querySelectorAll('[data-participant-id]'));
        },

        /**
         * @param {Element} tile
         *
         * @returns {boolean} whether the tile belongs to the local user
         */
        isSelfTile(tile) {
            if (!tile || !tile.getAttribute) return false;
            return tile.hasAttribute('data-self-name')
                || !!tile.querySelector('[data-self-name]')
                || tile.getAttribute('data-is-self') === 'true';
        },

        /**
         * The "more options" control inside the local user's own tile.
         *
         * Scoped to the self tile on purpose: there is a "More options" in the
         * call's bottom bar too, and the previous code looked inside a
         * container (jsname="JS8eVc") that no longer holds either of them.
         *
         * @returns {Element|null}
         */
        selfTileMoreOptions() {
            return resolve('selfTileMoreOptions', [
                ['icon', () => {
                    const tile = MeetDom.tiles().find(MeetDom.isSelfTile);
                    if (!tile) return null;
                    return Array.from(tile.querySelectorAll(CLICKABLE))
                        .find(el => hasIcon(el, ['more_vert', 'more_horiz'])) || null;
                }],
                ['legacy-container', () => {
                    const host = document.querySelector('[jsname="JS8eVc"]');
                    return host ? host.querySelector(CLICKABLE) : null;
                }]
            ]);
        },

        /** @returns {Element|null} the live-captions container */
        captionsContainer() {
            const looksLikeCaptions = el => WORDS.captions.test(nameOf(el));
            return resolve('captionsContainer', [
                ['jsname', () => document.querySelector('[jsname="dsyhDe"]')],
                ['role', () => Array.from(document.querySelectorAll('[role="region"], [role="log"], [aria-live]'))
                    .find(looksLikeCaptions) || null],
                ['structure', () => {
                    // The region holding blocks that pair an avatar with text.
                    const regions = Array.from(document.querySelectorAll('[role="region"], [aria-live]'));
                    return regions.find(r => r.querySelector('img') && (r.textContent || '').trim().length > 0)
                        || null;
                }]
            ]);
        },

        /**
         * Walks up from a mutated node to the caption block that owns it.
         *
         * @param {Node} node
         * @param {Element|null} container
         *
         * @returns {Element|null}
         */
        captionBlockOf(node, container) {
            let el = node;
            if (el && el.nodeType === 3) el = el.parentElement;
            if (!el || !el.closest) return null;

            const byClass = el.closest('.nMcdL');
            if (byClass) return byClass;

            if (!container || !container.contains(el)) return null;

            // Structural: climb to the outermost node still inside the
            // container that pairs an avatar with text.
            let best = null;
            let cursor = el;
            while (cursor && cursor !== container) {
                if (cursor.querySelector && cursor.querySelector('img')) best = cursor;
                cursor = cursor.parentElement;
            }
            return best;
        },

        /**
         * Splits a caption block into speaker and text without relying on
         * Meet's generated class names.
         *
         * The shape Meet renders is an avatar image, a short name beside it and
         * the spoken text in its own node. Class names are tried first because
         * they are exact while they last; the structural read is what keeps
         * this working after they change.
         *
         * @param {Element} block
         *
         * @returns {{user: string, text: string, avatar: string|null}|null}
         */
        readCaptionBlock(block) {
            if (!block || !block.querySelector) return null;

            const img = block.querySelector('img');
            const avatar = img ? img.src || null : null;

            const byClass = {
                user: block.querySelector('.KcIKyf, .NWpY1d'),
                text: block.querySelector('.ygicle, .VbkSUe')
            };

            if (byClass.user && byClass.text) {
                health.captionBlock = { strategy: 'class', at: Date.now() };
                return {
                    user: (byClass.user.textContent || '').trim(),
                    text: (byClass.text.textContent || '').trim(),
                    avatar
                };
            }

            // Structural: the name sits next to the avatar and is short; the
            // spoken text is the longest leaf that is not the name.
            const leaves = Array.from(block.querySelectorAll('*'))
                .filter(el => el.children.length === 0 && (el.textContent || '').trim())
                .map(el => ({ el, text: (el.textContent || '').trim() }));

            if (!leaves.length) return null;

            const nameHost = img ? img.closest('div') : null;
            let user = leaves.find(l => nameHost && nameHost.contains(l.el) && l.text.length <= 60);
            if (!user) user = leaves.slice().sort((a, b) => a.text.length - b.text.length)[0];

            const body = leaves
                .filter(l => l.el !== user.el)
                .sort((a, b) => b.text.length - a.text.length)[0];

            if (!body) return null;

            health.captionBlock = { strategy: 'structure', at: Date.now() };
            return { user: user.text, text: body.text, avatar };
        },

        /**
         * Caption blocks inside the container.
         *
         * @param {Element} container
         *
         * @returns {Element[]}
         */
        captionBlocks(container) {
            if (!container) return [];

            const byClass = container.querySelectorAll('.nMcdL');
            if (byClass.length) return Array.from(byClass);

            // Structural: direct children that pair an image with text.
            return Array.from(container.children)
                .filter(el => el.querySelector && el.querySelector('img') && (el.textContent || '').trim());
        },

        /**
         * What answered for each target, and what did not answer at all.
         *
         * @returns {object} target -> { strategy, at }; strategy null = not found
         */
        health() {
            return JSON.parse(JSON.stringify(health));
        },

        /**
         * Targets that could not be found on the last attempt.
         *
         * @returns {string[]}
         */
        broken() {
            return Object.keys(health).filter(k => health[k] && health[k].strategy === null);
        },

        // exposed for tests and diagnostics
        _internals: { nameOf, iconsOf, toggleState, WORDS, ICONS, SHORTCUT, ACTION }
    };

    root.MeetDom = MeetDom;

})(typeof globalThis !== 'undefined' ? globalThis : window);
