---
name: gmeet-kit-marketplace-listing
---

# Gmeet Kit — Store listing copy

Use this text when filling in the Chrome Web Store listing and the Google
Workspace Marketplace SDK "Store Listing" tab.

## Short description (≤ 132 characters)

```
Auto-mute, auto-disable camera, saved & recent meeting links, and full-screen mode for Google Meet.
```

## Long description

```
Gmeet Kit adds the convenience features Google Meet is missing.

• Auto-mute and auto-disable camera when you join a meeting
• Save frequently used meeting links for one-click access
• See your recent meetings with join times, right from the toolbar
• Distraction-free full-screen mode for shared presentations
• Optional local caption/transcript recording, saved only on your device

Gmeet Kit runs entirely in your browser. It does not collect, transmit, or
sell any of your data, and it does not require sign-in or access to your
Google account — see the Privacy Policy for details.

Gmeet Kit is an independent, unofficial project and is not affiliated with,
endorsed by, or sponsored by Google LLC.
```

## Category

- Primary: Communication / Video Conferencing (Chrome Web Store)
- Google Workspace Marketplace: "Meetings" or "Productivity"

## Language

English

## Support links

- Homepage: https://ajeesh05.github.io/gmeet_kit/
- Privacy policy: https://ajeesh05.github.io/gmeet_kit/privacy-policy.html
- Terms of service: https://ajeesh05.github.io/gmeet_kit/terms-of-service.html
- Support / issues: https://github.com/Ajeesh05/gmeet_kit/issues

## Assets checklist

- [x] 128×128 icon — `images/icon128.png`
- [ ] At least 1 screenshot, 1280×800 or 640×400 (Marketplace typically wants
      3–5). Not yet produced — capture these from the running extension
      (popup UI, side panel, and a meeting with a feature active).
- [ ] Optional small promo tile 440×280 and marquee 1400×560 (Chrome Web
      Store only, not required to publish).

## Permission justifications (Chrome Web Store "Privacy practices" tab)

- `activeTab` / `tabs` — detect the active Google Meet tab and open saved
  meeting links in a new or existing tab.
- `storage` — save the user's settings and saved/recent meeting links
  locally.
- `sidePanel` — show the extension's side panel UI.
- Host permission `https://meet.google.com/*` — the content scripts that
  provide auto-mute, auto-disable camera, full-screen mode, and caption
  recording only run on Google Meet pages.

Single purpose statement: "Enhances the Google Meet web experience with
meeting-join automation, quick access to saved/recent meeting links, and an
optional local caption recorder."
