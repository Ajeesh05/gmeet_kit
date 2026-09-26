# Changelog

## 2.4.0 - 2026-09-26

### Added

- **You are asked before anything is recorded.** The side panel opens on a short
  explanation of what the transcript feature does, where transcripts are kept,
  and that recording a conversation needs the other participants' agreement in
  many places. Nothing is recorded until you answer, and auto-record is off
  unless you turn it on.
- **Transcripts can be deleted** - one at a time from the History list, or all at
  once from Settings. Previously there was no way to remove a recording.
- **Settings covers more than one switch**: how long a rejoin still counts as the
  same meeting, how many meetings to keep, and how much room the stored
  transcripts are using.
- **History says what each recording contains** - line count, duration and who
  spoke - so repeat meetings on the same code can be told apart, and each one
  can be exported without opening it first.

### Fixed

- **Joining a call on a busy machine could leave every setting switched off.**
  The page gave the extension's background service 5.6 seconds to answer and
  then stopped asking for the rest of the call, so auto-mute, auto-camera-off,
  push-to-talk and leave-confirmation all silently did nothing. It now keeps
  asking, backing off as it goes.
- **The side panel said it was recording when it was not.** If captions could not
  be started, or recording was stopped from the page, the button went on reading
  "Stop recording" for the rest of the call. The panel now follows the recorder
  and shows plainly when a recording failed to start or storage is full.
- **The letter "c" could not be typed anywhere in Meet while recording.** The
  captions shortcut was intercepted everywhere, including the chat box, so the
  keystroke was swallowed and a dialog appeared instead.
- **Searching and filtering by speaker cancelled each other out.** Choosing a
  speaker discarded the search, and typing discarded the speaker. They now
  apply together.
- **The speaker filter was empty during a live call**, so it did nothing until
  the transcript was reopened.
- **Copy and Export ignored the filter** and gave no sign they had worked. They
  now act on what is on screen and say how many lines they took. Exported files
  carry the date, and a caption that looks like a spreadsheet formula is no
  longer treated as one when the file is opened.
- **The bottom bar did not fit the panel** - Copy was clipped and Export was off
  screen entirely.
- **"Waiting for live captions" stayed on screen** above the captions it was
  waiting for.
- Saving one setting erased the others.
- The transcript no longer jumps to the newest line while you are scrolled up
  reading.
- Recording repeatedly in one call left duplicate handlers behind, so Meet's
  captions shortcut stopped working normally after the first stop.
- **Live transcripts kept only the last thing each person said.** Every new
  caption overwrote the previous one, so a recording held a single line per
  speaker no matter how long the meeting ran.
- **Transcripts split one person into several speakers.** Speakers were
  identified by a value Google regenerates for every caption, so two people
  over three turns produced five entries. Two speakers are now two speakers.
- **Auto-record could never start.** It looked for a captions button Google had
  renamed, so it waited forever and recorded nothing unless captions were
  switched on by hand.
- **Transcripts were shown out of order**, and only the last line of each
  speaker was displayed even when more had been recorded.
- **A fresh install broke every feature** until a setting was changed by hand.
- **"Leave confirmation" did not stop you leaving.** Choosing Cancel ended the
  call anyway.
- **Push to talk keyed the microphone while you typed** - pressing space in the
  chat box cut your audio in and out.
- **Settings changed with the keyboard were never saved.** The switch moved on
  screen and nothing else happened.
- **Meetings opened from a calendar link or a second account were not recorded**,
  because the link carried a query string.
- **Meetings in progress were lost** when Chrome shut the extension down in the
  background, which it does routinely during a call.
- **Auto-join could press the wrong button**, and "fit screen" appeared on your
  own video.
- The Live Transcript tab reported an error and discarded the session in
  progress every time it was opened.
- Saved meeting names are shown as text; a name containing markup can no longer
  affect the popup.

### Changed

- Meet's controls are now found by several independent signals rather than one
  internal name, so a Google redesign degrades gradually instead of silently
  disabling a feature. Controls are found in any interface language.
- The extension writes to disk **ten times less** during a call. A 100-sentence
  meeting used to write 23.4 MB to save a 17 KB transcript, because the whole
  transcript was rewritten on every word; it now writes 2.34 MB.
- The panel is operable from the keyboard and readable by a screen reader:
  every control takes focus and shows it, the auto-record switch is a real
  switch, and button labels meet the contrast standard.
- Switching tabs is immediate; it used to pause for an eighth of a second.
- Debug logging no longer appears in the browser console.
