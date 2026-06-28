# Auto-launch & persistent-presence setup (closest to "runs on power-on")

iOS can't launch a third-party app at boot (see `LIMITATIONS.md`). These
one-time setups get you as close as the OS allows — usually a single tap or an
automatic trigger tied to how you start using the phone.

## 1. The launcher Shortcut
Build the ACTIG Shortcut (see `Shortcuts/README.md`): Shortcuts → + → Add Action
→ **Wake ACTIG** → name it "ACTIG". This calls `WakeACTIGIntent`, opens the app,
and ACTIG replies "ACTIG at your service sir."

## 2. Personal automations (run it without tapping)
Shortcuts → **Automation** → Create Personal Automation → pick a trigger, then
**Run Shortcut → ACTIG**, and turn **Ask Before Running** off:

- **When charger connects** — effectively "when I plug in / dock".
- **When NFC tag scanned** — tap phone to a tag (car, desk).
- **When a Focus turns on** — e.g. a "JARVIS" Focus.
- **At a time of day** / **When CarPlay connects** / **When app opened**.

## 3. Hardware & system entry points (always available)
- **Action Button** (14 Pro Max): Settings → Action Button → Shortcut → ACTIG.
- **Control Center**: add the ACTIG control (Wake ACTIG).
- **Lock/Home-Screen widgets**: add the ACTIG widget.
- **Dynamic Island / Lock Screen Live Activity**: while ACTIG is running it shows
  a persistent mic control (`actig://wake`).
- **Siri**: "Hey Siri, ACTIG" / "Wake up ACTIG".

## 4. Remote / scheduled wake
With Push enabled, a notification from your own server or a Shortcut automation,
when tapped, queues a wake (`PushManager`). ACTIG also schedules a "tap to wake"
local notification when iOS grants a background window.

## What still can't happen
None of the above runs ACTIG's AI *while the screen is off and the app is
closed* — iOS suspends the process. The wake word listens only while ACTIG is
active or in its audio session. This is an OS limit, not a configuration gap.
