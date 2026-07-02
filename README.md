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
    Brain/                  Hybrid LLM: on-device engine + Nemotron API client + router
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
- A **NVIDIA API key** for the cloud brain (optional). The offline brain is
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

Set your NVIDIA API key at runtime (Settings tab in-app) or via the
`ACTIG_LLM_API_KEY` environment variable in the run scheme. Keys are stored
in the Keychain, never in source.

### No computer at all? Install the web app (PWA) — only your iPhone

Zero setup, no GitHub settings, **no API key**: open this in **Safari → Share →
Add to Home Screen** —
**https://raw.githack.com/pompomroma/ACTIG-mobile/3d56a57e18c74cf7525f4890ffb0f02a72a15fbc/web/index.html**
(served straight from the repo by a free CDN; the long code is a commit hash, used
because the working branch name contains slashes that CDNs can't parse). No PC, no Apple account, no
signing, no key. The AI answers immediately via a free, browser-friendly brain.
Covers chat, voice in/out, wake word, language switch, **file attachments**
(📎 — attach code/data/text files or images to a request), the 3D studio,
history, and **Vibe Build** (see below); native-only features (Siri, widgets,
HealthKit, Apple's on-device model) need the native app.

**Vibe Build — describe a program, get a testable link.** In the **Build** tab
(or just say/type "build me a neon snake game" / "build a 3D spaceship viewer"),
ACTIG generates a complete, self-contained client-side web program, runs it in a
live in-browser preview, and gives you an **Open** link + a **ZIP** of the source
(3D emitted as text glTF/OBJ). It auto-announces "build finished" via chat, voice,
and a notification. It uses the configured brain — NVIDIA Nemotron if you set a
key + the proxy (`web/proxy/`), otherwise the free brain. Builds are
**checkpointed and auto-resume**: iOS freezes a backgrounded web app, so a build
can't keep computing while you're in another app, but ACTIG saves progress after
every stage and picks up where it left off the moment you return — and holds a
screen wake-lock so a build isn't killed by the screen sleeping. (True
keep-running-in-the-background needs a server; the `web/proxy/` worker is where
that would live.)

**Saved programs + AI edits.** Tap **💾 Save** to keep a build in a persistent
on-device **library** (IndexedDB) that survives restarts. **Open** any saved
program back into the preview, then request changes — **✎ Apply change** or just
say/type "make the snake red" / "add a score counter" — and ACTIG edits the
loaded program, re-tests it, updates the preview, and re-saves it. **＋ New**
starts a fresh build. (The library is local to the device; each program is also
downloadable as a ZIP or publishable to a URL for real backup.)

**Attachment analysis.** Attach files (📎) to a build or an adjustment and ACTIG
uses them: text/code/data files are read and used directly, and **images are
vision-analyzed into a design brief** (palette, typography, layout, components,
mood, and animation/motion) that steers the generated or edited program — so you
can send a mockup and say "build this" or "make it match this design". (Vision
quality depends on the active model; without vision the image is still embedded.)

**3D studio — model, attach, merge, export.** Spawn shapes and drag to move; toggle
**↔ Stretch** to strain objects per-axis (drag = X/Y, pinch/wheel = Z) for detailed
modeling. **🔗 Attach** → tap objects you've dragged together → **✅ Submit** binds
them into a group; **🧊 Mesh** merges the group into one solid. **⬇ Export** downloads
the whole project as a **`.glb`** file. **✋ Gestures** enables camera hand control
(720p60 + GPU + frame-synced tracking, two-hand, smoothed): pinch over an object to
select and drag it, and — with Stretch on — pinch-drag (or two-hand spread) to strain
it. Games built with Vibe Build are generated as **actually playable** games (real
game loop, keyboard + touch controls, scoring, win/lose + restart), not screen mockups.

**Quality pipeline (no extra cost, same model).** Higher output quality comes from
*inference-time* technique, not from changing the model or paying: Vibe Build can
**plan → generate best-of-N candidates → actually run each in a sandbox →
self-critique and auto-repair** the code until a live **Evaluation scorecard**
(parses, 0 runtime/console errors, renders UI, checklist coverage) stops improving.
Pick **Fast / High / Max** in Settings (default **Max** = best-of-3 candidates,
up to 4 auto-repair passes, larger token budget, and extra eval checks for mobile
+ accessibility); higher tiers just make more calls to the *same free endpoint*
(slower, still $0). Note: a model's benchmark
scores and a chip's TOPS are fixed and cannot be changed by the app — this raises
the *measured quality of the generated result*, which is what the scorecard shows. Add a GitHub token in
Settings to also **Publish** a public shareable URL (via Gist + gist.githack).
Note: a static web app can run front-end code from a link but not a real server —
backend needs are approximated in-browser. For a permanent `github.io` URL, the owner can enable
Pages once and run `.github/workflows/pages.yml` — details in
[`docs/INSTALL_NO_MAC.md`](docs/INSTALL_NO_MAC.md).

### No Mac / no Xcode / no paid account? (native, free)

CI builds everything in the cloud. The **free** path needs only a normal Apple ID
— **no Xcode, no Mac, no App Store Connect, no $99 membership.** Full steps in
**[`docs/INSTALL_NO_MAC.md`](docs/INSTALL_NO_MAC.md)**:

- **Free sideload (recommended):** every push auto-publishes the app to the
  **`build-latest`** GitHub Release as **`ACTIG-unsigned.ipa`**. Download it
  (Releases page, or the Actions artifact) and install with **AltStore /
  SideStore / Sideloadly**, which sign it with your own free Apple ID.
- **TestFlight (optional, only with a paid account):** push a `v*` tag → CI signs
  via an App Store Connect API key and uploads. Skip this if you don't have the
  paid program — the free path above doesn't use it.

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
