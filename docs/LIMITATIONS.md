# iOS limitations — per item, with Apple's reason and ACTIG's approximation

A paid Apple Developer Program membership unlocks **entitlements**, not the
**sandbox**. The items below are impossible for *any* third-party app (free or
paid) on a non-jailbroken iPhone. For each: Apple's technical reason, and exactly
what ACTIG does instead.

| Original ask | Why it's impossible on stock iOS | ACTIG's maximal approximation |
|---|---|---|
| Run automatically when the phone powers on | iOS launches no third-party code at boot; apps only start on explicit user action or a system-delivered event (push, background task, location). There is no "launch on boot" API even with MDM for normal apps. | Launcher **Shortcut** + a **personal automation** (charger/NFC/Focus/time) that runs it; **Action Button**; `WakeACTIGIntent` for Siri; state restoration resumes the last session instantly. See `AUTOMATIONS.md`. |
| Stay always-active in the background | The OS suspends apps shortly after backgrounding to preserve battery/security; only specific modes (audio, location, VoIP, BLE) keep a process alive, and none allow general always-listening. | Foreground always-listening; a background **audio** session window; **BGAppRefresh/BGProcessing** tasks (`BackgroundCoordinator`) for periodic resume; a **push / local notification** "tap to wake" (`PushManager`). |
| Wake word ("wake up ACTIG") from any screen / when locked | Only Apple's own Siri has a system-wide always-on acoustic trigger; third-party apps get the microphone only while active or in an audio session. | On-device spotter (`WakeWordSpotter`) while active; **"Hey Siri, ACTIG"** via App Intents for true system-wide invocation; emergency button + widgets + Control Center + Action Button. |
| Holographic buttons floating over other apps / web / home screen | iOS has no third-party system-overlay/window API (unlike Android's `TYPE_APPLICATION_OVERLAY`). An app can only draw inside its own scenes. | Full holo HUD inside the app; a **Live Activity / Dynamic Island** control (`ACTIGLiveActivity`) that persists on the Lock Screen; Home/Lock-Screen **widgets**; **Control Center** control; **Action Button**. |
| Total access to all apps / accounts / Settings / actions | The sandbox isolates every app; there is no API to read another app's data or invoke its internal functions, and Settings can't be changed programmatically. | Sanctioned surface only: URL schemes / `x-callback-url` (`AppLauncher`), App Intents/Shortcuts, **EventKit/Contacts/Photos/HealthKit** with permission (`PersonalDataController`), **MusicKit** playback, and deep links into the Settings panes Apple exposes. |
| "Input one file and it works forever" | iOS only runs signed, installed app bundles; you can't drop an executable onto the device. | Ships as a real signed app (Xcode sideload or TestFlight). The **Shortcut** is the one true shareable file and is used as the launcher. |

Everything else in the original request is implemented for real: hybrid online +
**on-device offline** brain (Apple Foundation Models), full voice & text I/O with
language auto-switching, barge-in interruption, the agentic tool loop that
actually performs actions, the 3D studio with touch + hand-gesture control, full
history with checkpoints, and the holographic HUD.

The only way to exceed this list is a jailbreak, which is out of scope (fragile,
insecure, breaks on updates, and not something this project will implement).
