# Entitlements & capabilities setup (paid Apple Developer account)

ACTIG declares these in `Sources/ACTIG/Support/ACTIG.entitlements`,
`Sources/ACTIG/Support/Info.plist`, and `project.yml`. With a **paid** membership
you must also enable the matching capabilities in the Apple Developer portal and
in Xcode → target → **Signing & Capabilities**.

## In the Apple Developer portal (Certificates, Identifiers & Profiles)
For App ID `com.actig.app` (and the widget `com.actig.app.widgets`), enable:

- **App Groups** — create `group.com.actig.shared` (shared store for app + widgets).
- **SiriKit** — for "Hey Siri, ACTIG" App Intents.
- **Push Notifications** — for remote wake (`aps-environment`).
- **HealthKit** — for step/health reads.
- **Background Modes** — Audio, Background fetch, Background processing, Remote notifications.
- (Optional) **Increased Memory Limit** — headroom for an on-device MLX model.

## In Xcode → Signing & Capabilities (target: ACTIG)
Add capabilities: App Groups (`group.com.actig.shared`), Siri, Push
Notifications, Background Modes (check Audio, Background fetch, Background
processing, Remote notifications), HealthKit, and Communication/Live Activities
is enabled via `NSSupportsLiveActivities` in Info.plist (no toggle needed).

Set **DEVELOPMENT_TEAM** (your Team ID) in `project.yml` `settings.base` or via a
local `Secrets.xcconfig` (git-ignored).

## On-device offline model (Apple Foundation Models)
No entitlement needed. `FoundationModelsEngine` uses the system model on iOS 26
where Apple Intelligence is enabled; it auto-reports unavailable otherwise and
the router falls back to the bundled MLX model / deterministic offline reply.

## Optional: bundle an MLX model (custom offline brain)
Add the package in `project.yml`:

```yaml
packages:
  MLXSwift:
    url: https://github.com/ml-explore/mlx-swift-examples
    from: "1.0.0"
```

Add it to the `ACTIG` target `dependencies`, then implement the MLX path in
`Sources/ACTIG/Core/Brain/LocalEngine.swift` (`generate(_:)`), and bundle the
quantized weights (kept out of git via `.gitignore`).

## API key (cloud brain)
The Claude key is read from the Keychain (Settings tab) or the
`ACTIG_CLAUDE_API_KEY` env var. Never commit it.
