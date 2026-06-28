# ACTIG — Local Agentic AI for iPhone 14 Pro Max

ACTIG is a JARVIS-style, voice-and-text agentic assistant for iOS with a
holographic HUD and an Iron-Man-style 3D modeling workspace driven by hand
gestures.

> **Read this first — what iOS does and does not allow.**
> A few things in the original request are *impossible on a stock,
> non-jailbroken iPhone* because Apple's sandbox forbids them at the OS level.
> This project builds the maximum that is allowed and approximates the rest as
> closely as iOS permits. See [iOS Reality Check](#ios-reality-check).

---

## What's in here

```
project.yml                 XcodeGen project definition (generate the .xcodeproj from this)
Sources/ACTIG/
  App/                      SwiftUI entry, app state, scene restoration
  Core/
    Brain/                  Hybrid LLM: on-device engine + Claude API client + router
    Agent/                  Orchestrator (plan→act→observe), command router, ETA
    Memory/                 History store (SwiftData) + file vault
    Intents/                App Intents / Siri / Shortcuts
  Voice/                    Wake word, STT, TTS, duplex audio + barge-in
  UI/                       Holographic HUD, chat, options/suggestion cards
  Studio3D/                 RealityKit workspace, shapes, gestures (Vision hand pose)
  Device/                   Music + sanctioned cross-app / settings control
  Support/                  Info.plist, entitlements
Tests/ACTIGTests/           Unit tests (router, history, language, command parser)
Shortcuts/                  The "drop-in file" launcher (build instructions)
.github/workflows/          Cloud build → TestFlight (no Mac required)
```

## Requirements

- iPhone 14 Pro Max (A16, LiDAR) on **iOS 18+** for the full feature set.
  (Simulator covers chat, history, HUD, and touch-based 3D.)
- **Xcode 15+** to build.
- **XcodeGen** (`brew install xcodegen`) to generate the project.
- A **Claude API key** for the cloud brain (optional). The offline brain is
  real: Apple's on-device **Foundation Models** (iOS 26) via
  `Core/Brain/FoundationModelsEngine.swift`, with an optional bundled MLX model
  and a deterministic final fallback — so ACTIG answers with no network.
- See `docs/ENTITLEMENTS.md` (capability setup), `docs/LIMITATIONS.md` (per-item
  iOS limits + approximations), and `docs/AUTOMATIONS.md` (auto-launch setup).
- An **Apple Developer account** ($99/yr) is required for Siri, widgets,
  app groups, background audio, and TestFlight. A free account allows 7-day
  sideloading with a reduced entitlement set.

## Build & run

```bash
brew install xcodegen          # one time
xcodegen generate              # creates ACTIG.xcodeproj from project.yml
open ACTIG.xcodeproj           # build & run on Simulator or device
```

Set your Claude API key at runtime (Settings tab in-app) or via the
`ACTIG_CLAUDE_API_KEY` environment variable in the run scheme. Keys are stored
in the Keychain, never in source.

### No Mac / no Xcode? (recommended for most people)

You don't need a Mac or Xcode — CI builds everything in the cloud. Two install
paths, both covered step-by-step in **[`docs/INSTALL_NO_MAC.md`](docs/INSTALL_NO_MAC.md)**:

- **TestFlight** (paid Apple Developer account): push a version tag → CI signs
  and uploads → install over-the-air from the TestFlight app on your iPhone.
  Repo secrets: `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`,
  `APP_STORE_CONNECT_API_KEY` (base64 `.p8`), `APPLE_TEAM_ID`.
- **Download `.ipa` + sideload** (free Apple ID, Windows or Mac PC): every push
  uploads an **`ACTIG-unsigned-ipa`** artifact under the Actions run; install it
  with **AltStore** or **Sideloadly**, which re-sign with your own Apple ID.

---

## iOS Reality Check

| You asked for | Stock iOS | What ACTIG does instead |
|---|---|---|
| Run automatically when the phone powers on | ❌ No app can launch on boot | A **Shortcut** + Focus / charging / NFC **personal automation** launches ACTIG in ~1 tap; the App Intent makes it Siri-triggerable |
| Stay always-active in the background | ❌ Apps are suspended | Always-listening while foreground/active, a short background-audio window, and instant **state restoration** on relaunch |
| Wake word from any screen / when locked | ⚠️ Only Siri owns a global wake word | On-device **"wake up ACTIG"** spotter while the app is active, **plus** "Hey Siri, ACTIG" for system-wide reach |
| Holographic buttons floating over other apps / web / home | ❌ iOS has no third-party system overlay | Full holo HUD **inside the app**; system-wide entry via Siri, **Lock/Home-Screen widgets**, a **Control Center control**, and the **Action Button** |
| Total access to all apps / Settings / accounts | ❌ The sandbox blocks it | Sanctioned control only: URL schemes & `x-callback-url`, **App Intents/Shortcuts**, EventKit/Contacts/Photos/Health (with permission), MusicKit, and deep-links into Settings panes |
| "Input one file and it works forever" | ❌ Apps must be compiled & signed | Ships as a real signed app; the **Shortcut** is the only true drop-in file and is used as the launcher |

Everything else — voice & text in/out, language auto-switching, natural
conversation, voice interruption (barge-in), full history with checkpoints,
the 3D workspace with pinch-drag / two-hand-scale / clone, music playback —
is implemented within these rules.

## Feature → code map

See [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) for a line-by-line mapping of
each numbered requirement to the file that implements it.

## Security

API keys live in the Keychain. No secrets are committed. Cross-app and device
actions always go through iOS permission prompts — ACTIG cannot and does not
bypass them.
