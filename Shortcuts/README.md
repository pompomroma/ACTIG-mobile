# ACTIG Launcher Shortcut — the "drop-in file"

A compiled iOS app can't be installed by just dropping a file onto the phone,
but an Apple **Shortcut** *can* — it's a real `.shortcut` file you AirDrop, open
from Files, or import from a link, and it then lives in your Shortcuts app
permanently. ACTIG uses a Shortcut as the launcher so you get as close as iOS
allows to "input one file and it just works."

> The Shortcut **launches ACTIG and triggers wake**; it cannot run the AI by
> itself. The app must be installed first (Xcode sideload or TestFlight).

## What the Shortcut does

It calls ACTIG's `WakeACTIGIntent` (see `Sources/ACTIG/Core/Intents/ACTIGIntents.swift`),
which opens the app and starts listening — ACTIG replies "ACTIG at your service sir."

## Build it (1 minute, on the iPhone)

1. Install the ACTIG app first.
2. Open **Shortcuts** → **+** → **Add Action**.
3. Search **ACTIG** and choose **Wake ACTIG**.
4. Name the shortcut **"ACTIG"** and save.
5. (Optional) Tap **⌄ → Add to Home Screen** for a one-tap icon.

## Make it as automatic as iOS permits (closest to "run on power-on")

Apple blocks launch-on-boot, but you can auto-trigger the Shortcut on events
that effectively cover "I just started using my phone":

- **Shortcuts → Automation → Create Personal Automation**:
  - **When CarPlay connects**, **When charger connects**, **At a time of day**,
    **When an NFC tag is scanned**, or **When a Focus turns on**.
  - Action: **Run Shortcut → ACTIG**. Turn **Ask Before Running** off.
- **Action Button** (14 Pro Max): Settings → Action Button → **Shortcut → ACTIG**.
- **Control Center**: add the ACTIG control for an always-available toggle.
- **Lock Screen / Home Screen widget**: add the ACTIG widget.

## Sharing the file

Once created, open the Shortcut → **Share → Save to Files / AirDrop**. That
exported `.shortcut` is the file you can move between devices. (It's user-built
rather than committed here because a `.shortcut` is signed/zip-packed binary; the
steps above reproduce it exactly.)
