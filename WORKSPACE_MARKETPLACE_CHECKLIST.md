---
name: gmeet-kit-workspace-marketplace-checklist
---

# Getting Gmeet Kit onto Google Workspace Marketplace

Gmeet Kit doesn't call any Google Workspace API and doesn't need OAuth
scopes — it's a pure Chrome-storage/content-script extension. That keeps this
path simple: no OAuth verification, no CASA security assessment. What's left
is publishing to the Chrome Web Store and then linking that listing from the
Google Workspace Marketplace SDK. These steps all require your own Google
account/billing and a browser, so they're listed here for you to run through
manually.

## 1. Host the legal pages

- [ ] Enable GitHub Pages on `Ajeesh05/gmeet_kit`, source = `docs/` folder on
      `main`. This publishes:
      - `https://ajeesh05.github.io/gmeet_kit/`
      - `https://ajeesh05.github.io/gmeet_kit/privacy-policy.html`
      - `https://ajeesh05.github.io/gmeet_kit/terms-of-service.html`
- [ ] Confirm all three URLs load once Pages finishes deploying (can take a
      few minutes after first enabling).

## 2. Publish (or update) on the Chrome Web Store

- [ ] Sign in to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
      (one-time $5 registration fee if you don't already have a developer
      account).
- [ ] Upload/update the packaged extension (zip the `gmeet_kit/` folder,
      excluding `.git` and the `docs/` and `.md` files — only the extension
      runtime files belong in the package).
- [ ] Fill in the **Privacy practices** tab using `MARKETPLACE_LISTING.md`:
      single purpose statement, permission justifications, and the privacy
      policy URL from step 1.
- [ ] Fill in the **Store listing** tab using `MARKETPLACE_LISTING.md`
      (description, category, screenshots — capture screenshots from the
      running extension first, see the checklist in that file).
- [ ] Submit for review and wait for approval. Note the **Extension ID**
      shown in the dashboard — you'll need it in step 4.

## 3. Create/select a Google Cloud project

- [ ] In [Google Cloud Console](https://console.cloud.google.com/), create a
      project (or reuse an existing one you control).
- [ ] Enable the **Google Workspace Marketplace SDK** API for that project
      (APIs & Services → Library → search "Google Workspace Marketplace
      SDK").
- [ ] Configure the **OAuth consent screen** (APIs & Services → OAuth
      consent screen). Even though Gmeet Kit requests no scopes, Marketplace
      still requires this to be filled in: app name, support email,
      developer contact email, app logo, and the homepage/privacy
      policy/terms URLs from step 1. Since no sensitive/restricted scopes
      are requested, this does not require Google's OAuth verification
      review.

## 4. Configure the Marketplace SDK listing

In Cloud Console → Google Workspace Marketplace SDK → **App Configuration**:

- [ ] App type: **Chrome Extension**.
- [ ] Extension ID: paste the ID from step 2.
- [ ] OAuth scopes: leave empty — Gmeet Kit doesn't call any Google API.
- [ ] Visibility: start with **Private** (restricted to your own Workspace
      domain, if you have one) to test the listing end-to-end, then switch
      to **Public** once you're happy with it.

In the **Store Listing** tab of the SDK (this is separate from, and mirrors,
the Chrome Web Store listing):

- [ ] Paste the same short/long description, category, icon, and screenshots
      from `MARKETPLACE_LISTING.md`.
- [ ] Paste the support, privacy policy, and terms of service URLs.

- [ ] Click **Publish**. Google may take some time to review it, since the
      SDK team spot-checks listings even without OAuth scopes.

## 5. Be ready to explain the caption-recording feature

The extension can locally record Google Meet's live captions as a
transcript (see `docs/privacy-policy.html`). If a reviewer asks about it
during either the Chrome Web Store review or the Marketplace review,
point them to:

- It reads only the caption text Google Meet already renders on-screen — no
  raw audio/video capture, no screen recording.
- Everything stays in `chrome.storage.local` on the user's device; nothing
  is transmitted anywhere.
- The privacy policy calls out that recording-consent laws vary by
  jurisdiction and puts that responsibility on the user.

If you'd rather not carry that review risk for the first submission, you
can ship an initial version with `autoRecord`/caption recording disabled by
default (it already is) or gate it behind an explicit settings toggle with
an in-product consent notice — happy to wire that up if you want it before
submitting.
