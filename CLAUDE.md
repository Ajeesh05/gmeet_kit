# Gmeet Kit

Google Meet enhancements: auto-mute, camera off, push-to-talk, auto-join, leave
confirmation, saved meeting links, recent-meeting tracking, caption recording.

Autonomy: **audit** — propose findings, do not implement unless an issue
explicitly says to.

## Architecture

Classic scripts, three separate execution contexts. Getting the context wrong is
the most common way to break this extension.

```
scripts/meet-dom.js                finds things in Meet's UI - BOTH worlds
scripts/background.js              service worker: sessions, side panel, routing
scripts/content-scripts/           ISOLATED world, on https://meet.google.com/*
  inject-scripts.js                  document_start; injects enhancer into the page
  ports.js                           document_start; relays settings to the page
  fullscreen.js, caption-recorder.js document_idle
scripts/enhancer.js                MAIN world - runs in Meet's own JS context
scripts/popup/{popup,designscript,saved-links}.js   one shared global scope
scripts/sidebar.js                 side panel
```

**The bridge:** popup → service worker → `chrome.tabs.sendMessage` → `ports.js`
(isolated) → `window.postMessage` → `enhancer.js` (main world). `enhancer.js` is
the only code that can touch Meet's DOM, and the only reason it can is the
`web_accessible_resources` entry.

`enhancer.js` posts `enhancerReady` as soon as its listener exists, and
`ports.js` replays the settings on hearing it. Do not remove that handshake:
settings were previously relayed on a 500ms timer, and if `enhancer.js` had not
finished loading, both copies were lost and the tab ran with everything off.
`ports.js` also re-asks over `chrome.runtime.sendMessage` rather than the port,
because a port dies with the worker and posting into a dead one recovers
nothing.

`popup.html` loads its three scripts as separate classic scripts, so they share
one global scope. A function defined in `saved-links.js` is callable from
`popup.js`. `eslint.config.js` lists those shared names explicitly.

## Invariants

- **`meetingIdFromUrl` reads the code from the path**, so `?authuser=0`,
  `?pli=1` and a trailing slash are all still the same meeting. `MEETING_REGEX`
  now matches the *code* (`abc-defg-hij`), not a whole url. It must keep
  rejecting `/new`, `/landing` and uppercase codes.
- **`findTabsBySubdomain` compares hostnames exactly.** It must keep rejecting
  `meet.google.com.evil.test`. `meetingIdFromUrl` checks the hostname the same
  way, and also requires https.
- **In-flight sessions are restored whenever the worker starts**, not only on
  `chrome.runtime.onStartup`. MV3 discards the worker mid-call; without this a
  meeting in progress is never recorded.
- **Meeting history is capped**: 10 entries per meeting, 10 meetings total.
  Transcript retention is separate and user-set (`keepMeetings`, default 15);
  `caption-recorder.js` must read it rather than hard-code a limit.
- **Only `enhancer.js` is web-accessible.** Content scripts must not be.
- **`ports.js` keeps asking for settings until they arrive**, with backoff,
  bounded by `INIT_MAX_ATTEMPTS` *and* `INIT_DEADLINE_MS`. A short budget is a
  silent-failure bug, not a small one: when the ask stops, the tab runs the rest
  of the call with every feature off and nothing reports it. The previous 8
  tries at 800ms gave the service worker 5.6s, which a cold MV3 worker on a
  loaded machine can miss.

## Meet's DOM

**`scripts/meet-dom.js` is the only file allowed to know what Meet's markup
looks like.** If you are about to write a selector anywhere else, put it there
instead. Everything that reaches into the call — `enhancer.js`, `fullscreen.js`,
`caption-recorder.js` — goes through `MeetDom`.

Meet's UI is build output. Every selector pinned to a generated value has
already broken: the captions button (`r8qRAd`), the "getting ready" spinner
(`OMfBQ`), the self tile (`aTv5jf`). And `UywwFc-RLmnJb`, used as the join
button for years, was never a button at all — it is Material's ripple span,
inside *every* button on the page, so `querySelector` returned whichever came
first in the DOM.

So no lookup depends on one signal. Each target is a list of strategies tried
in order, strongest first:

1. **Icon ligature** — the text inside Meet's `<i class="google-symbols
   notranslate">` nodes: `mic_off`, `videocam`, `call_end`. Material Symbols
   names, describing the control's current state, and Google marks the nodes
   `notranslate`, so they read the same in every language.
2. **Keyboard shortcut** — Meet writes it into the label: `"Turn on microphone
   (ctrl + d)"`. The letters do not change per locale.
3. **Accessible name** — matched against a small multi-language vocabulary, not
   one English string. Anchor where a substring would be ambiguous: "Jump to
   most recent captions" also contains *captions*.
4. **`jsname`** — current values, last resort, expected to rot.

**Read state from the icon, not the label.** The icon shows what the control
*is*; the label offers what pressing it would *do*, which is the opposite and
reads backwards in half the locales. `MeetDom.toggleState` falls back to
`data-is-muted`, then `aria-pressed`, then the label — and returns `null`
rather than guessing.

**Never treat `data-iml` as an identity.** It is a per-element render
timestamp. Meet builds a fresh `<img>` for each caption block, so keying on it
turned one speaker into a new person on every turn.

**A caption block is one utterance.** Meet grows the block while someone keeps
talking and opens a new one when the speaker changes. Correct the message a
block already owns; append when a new block appears.

**Rot should be visible.** `MeetDom.health()` reports which strategy answered
for each target; `MeetDom.broken()` lists the ones nothing answered for. A
target that has fallen through to its last layer is a warning that the ones
above it have already gone.

## Testing

`background.js` is loaded unmodified by the `vm` harness. Install fake timers
before loading — the module starts a heartbeat `setInterval` at top level.

E2E serves a stub over **https at `meet.google.com` itself**, via
`--host-resolver-rules` with the certificate trusted by public-key hash
(`meet.google.com` is HSTS-preloaded, which refuses a blanket cert bypass). So
the manifest's content-script matches apply for real.

The stub gives each control the same three signals real Meet does — an icon
ligature, the shortcut in the label, and an accessible name — so every layer
gets exercised. `?strip=icons,shortcuts,labels,jsname` and `?lang=de|ja`
simulate a rebuild: those tests remove signals and check the features still
work, which is the only way to find out whether the fallbacks are real.

`tests/unit/meet-dom.test.js` does the same at the unit level, one layer at a
time. Add a case there for any new target.

The stub cannot tell you that Meet has renamed something. It tells you the
extension behaves correctly against the shape recorded in it. That shape was
captured from a real call on **2026-09-22**; re-check it against a live meeting
before trusting a selector change.

Testing against real Meet needs a signed-in account and a host to admit the
browser, so it happens only when the repository owner sets it up and asks for
it — never unattended.

## Known defects — unfixed, tracked in ext-automation/FINDINGS.md

1. **The local speaker is labelled "You".** Meet does not put the local user's
   name in the caption DOM. Reading it from the participants panel would add a
   second set of selectors to a surface that already moves, so the label stays
   until there is a stable source for it.
2. `fetchNewMeets` in `scripts/popup/saved-links.js` assigns an implicit global
   (`html = await response.text()`). It is inside the "choose your meeting url"
   feature, which is **working and must not be touched** — see Hard boundaries.
   These are the 2 errors the lint ratchet still allows.

The six defects listed here previously — the missing `normalizeMeetingId`, the
undeclared `chrome.scripting` call, `minimum_chrome_version`, worker-memory
session loss, the retry that passed its counter as the message, and nine
implicit globals — are all fixed and covered by tests.

## Transcripts

The caption recorder and the side panel hold what people said in a meeting, so
they carry rules the rest of the extension does not.

- **Recording is opt-in and stays opt-in.** `DEFAULT_SETTINGS.autoRecord` is
  `false`, and both auto-start paths in `caption-recorder.js` test
  `settings.autoRecord === true` — an unset setting is not consent. The side
  panel shows the consent card until `consented` is true and records nothing
  before then.
- **The panel never claims a recording it does not have.** `caption-recorder.js`
  emits `recording_started`, `recording_stopped`, `recorder_failed` and
  `storage_error`; `handleLifecycle` in `sidebar.js` must handle all four. A
  recorder that cannot start must leave the button on "Start recording".
- **Every transcript must be deletable** from the UI, one session at a time and
  all at once.
- **Persisting is debounced** (`SAVE_DEBOUNCE_MS`, 2s) and flushed on stop and
  on `pagehide`. Saving per caption mutation rewrites the whole transcript on
  every word: quadratic, and measured at 23.4 MB of writes for a 17 KB
  transcript.
- **`interceptDisable` must never fire while the user is typing.** Meet's
  captions shortcut is a bare `c`, caught in the capture phase; without the
  `isTyping` guard the key cannot be typed anywhere in Meet.
- **The recorder's document listeners are bound to an `AbortController`** and
  released by the stop function, so repeated start/stop does not stack them.
- **One builder for a transcript line.** `buildMessage` serves both the live and
  the stored view, and sets text with `textContent`. Do not reintroduce an
  `innerHTML` path.
- `tests/unit/sidebar.test.js` loads `sidebar.html` into jsdom and runs
  `sidebar.js` against it. Seeds must be built per test — the storage mock
  shallow-copies, so a shared nested object leaks between tests.

## Autonomous agent contract

You are running unattended in GitHub Actions against an approved issue. Nobody
is watching this run. Everything below is enforced by CI as well as stated here,
so working around a rule fails the build rather than shipping.

### Prime directive

Preserve existing behaviour. Change only what the approved issue asks for.

If the issue is ambiguous, or you find that doing it properly requires a
decision that is not yours to make, stop and say so in `.ai/result.json` with
`"status": "blocked"`. A blocked run that explains itself is a good outcome. A
run that guesses and ships is not.

### Hard boundaries

Each of these fails CI, so there is no version of the task that goes better by
crossing one:

- **Never edit `.github/**` or `project.yml`.** Workflows carry the deployment
  credentials' blast radius; `project.yml` holds the permission baseline. The CI
  guard rejects any `ai/*` branch that touches them.
- **Never add a permission or host permission** to `manifest.json`, or an OAuth
  scope to `appsscript.json`, unless the issue body contains the exact line
  `PERMISSION CHANGE APPROVED`. The permission gate diffs every PR against
  `project.yml` and fails on growth.
- **Never edit `.eslint-baseline.json` or `.manifest-baseline.json`.** Those
  record known problems so they cannot grow. Widening one hides a real defect
  instead of fixing it.
- **Never delete or weaken a test to make a build pass.** If a test is genuinely
  wrong, fix the test and explain why in your summary. If you cannot tell
  whether the test or the code is wrong, you are blocked.
- **Never rewrite a file wholesale** when a targeted edit would do.
- **Never commit a credential**, and never write one into a test fixture.

### How to work

1. Read `CLAUDE.md`, `project.yml`, and the issue. Read the files you intend to
   change before changing them.
2. Make the smallest change that fully does what the issue asks.
3. Add or update tests that would have caught the bug, or that pin the new
   behaviour. A fix with no test is not finished.
4. Run `npm run check` (lint, manifest, permission gate, unit tests). Then run
   `npm run e2e` if the change touches anything a browser exercises.
5. When something fails, read the actual error before changing anything. Fix the
   cause. Re-run. Repeat until green or until you are genuinely stuck.
6. Write `.ai/result.json` as the last thing you do.

### Definition of done

`npm run check` passes, and `npm run e2e` passes if you ran it. Not "should
pass" — you have seen it pass.

### Output contract

Write `.ai/result.json` before you finish. The workflow reads this file, not
your prose, so it must be valid JSON and it must be honest. Claiming success
that CI then contradicts is the worst outcome available to you; `blocked` is
always better.

```json
{
  "status": "success",
  "summary": "one or two sentences, in plain past tense",
  "files_changed": ["path/one.js"],
  "tests_added": 3,
  "version_bump": "patch",
  "bump_rationale": "why patch rather than minor or major",
  "permission_changes": [],
  "blocked_reason": null,
  "checks_run": ["npm run check", "npm run e2e"]
}
```

- `status`: `"success"` or `"blocked"`
- `version_bump`: `"patch"` bug fix · `"minor"` backward-compatible feature ·
  `"major"` breaking change · `"none"` no user-visible change.

  **Report the bump; do not apply it.** Leave the `version` in `manifest.json`
  alone. Release automation owns version numbers, so that they are assigned once
  at release time rather than by each branch independently — two branches in
  flight would otherwise both claim the same next version. Chrome versions are
  1–4 dotted integers, so `1.2.3-beta` is never a legal value anyway.
- `permission_changes`: every permission or scope added, `[]` if none
- `blocked_reason`: required when blocked — what you needed and could not decide

### Repository conventions

- Node 22+, ES modules in test code.
- Test helpers under `tests/helpers/` are **synced from `ext-automation/tools/`**.
  Do not edit them here; a change would be overwritten on the next sync. If one
  is wrong, say so in your summary.
- Unit tests are Vitest under `tests/unit/`. E2E is Playwright under `tests/e2e/`
  and loads the packed extension into real Chromium.
- Extension source is plain, unbundled MV3. There is no build step and adding
  one is out of scope unless the issue says otherwise.
