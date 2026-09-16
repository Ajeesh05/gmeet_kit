# Gmeet Kit

Google Meet enhancements: auto-mute, camera off, push-to-talk, auto-join, leave
confirmation, saved meeting links, recent-meeting tracking, caption recording.

Autonomy: **audit** — propose findings, do not implement unless an issue
explicitly says to. This project has known unfixed defects; see below.

## Architecture

Classic scripts, three separate execution contexts. Getting the context wrong is
the most common way to break this extension.

```
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

`popup.html` loads its three scripts as separate classic scripts, so they share
one global scope. A function defined in `saved-links.js` is callable from
`popup.js`. `eslint.config.js` lists those shared names explicitly.

## Invariants

- **`MEETING_REGEX` is an exact match**: `https://meet.google.com/xxx-xxxx-xxx`
  with no query string and no trailing slash.
- **`findTabsBySubdomain` compares hostnames exactly.** It must keep rejecting
  `meet.google.com.evil.test`.
- **Meeting history is capped**: 10 entries per meeting, 10 meetings total.
- **Only `enhancer.js` is web-accessible.** Content scripts must not be.

## Testing

`background.js` is loaded unmodified by the `vm` harness. Install fake timers
before loading — the module starts a 1-second `setInterval` at top level.

E2E serves a stub over **https at `meet.google.com` itself**, via
`--host-resolver-rules` with the certificate trusted by public-key hash
(`meet.google.com` is HSTS-preloaded, which refuses a blanket cert bypass). So
the manifest's content-script matches apply for real.

Meet's own DOM is **not** reproduced — its class names are obfuscated and
generated. Tests cover the origin, the injection contract, the postMessage
bridge and session tracking, not the call controls. Do not add tests that assert
on Meet's internal class names; they will rot.

Real Meet is never used: it needs a login, and automating it would breach
Google's terms.

## Known defects — unfixed, tracked in ext-automation/FINDINGS.md

1. **`scripts/sidebar.js` calls `normalizeMeetingId()`, which is defined nowhere.**
   `sidebar.html` loads only `sidebar.js`, so nothing supplies it.
   `tryLoadRecentLiveSession()` throws `ReferenceError` every time it runs.
2. `sidebar.js:126` calls `chrome.scripting.executeScript`, but `scripting` is
   not in the manifest permissions. Fixing this by *adding* the permission is a
   permission change and needs explicit approval; removing the call is not.
3. `minimum_chrome_version` is 88, but `chrome.sidePanel` needs Chrome 114.
4. `meetingSessions` lives only in service-worker memory with a 1-second
   `setInterval` mirroring it to `storage.local`. MV3 recycles the worker at
   will, so in-flight meetings are lost. `chrome.alarms` is the intended fix.
5. `sendMessageToActiveTab`'s retry passes the retry count as the message.
6. Nine implicit globals across four files, held at exactly nine by the ratchet.

Defects 1–3 are why this project is `audit`. Fixing them moves it to `propose`.

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
