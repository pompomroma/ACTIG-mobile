# Requirement → implementation map

Each numbered item from the original request, where it lives, and its iOS
feasibility status. ✅ = built within iOS rules · 🟡 = approximated (iOS forbids
the literal form) · 🔜 = scaffolded, needs device-side wiring/model.

| # | Requirement | Status | Where |
|---|---|---|---|
| 1 | Auto-run on power-on | 🟡 | Siri/Shortcut launcher + automations — `Core/Intents/ACTIGIntents.swift`, `Shortcuts/README.md` |
| 1 | Save all history (tasks, commands, results) | ✅ | `Core/Memory/HistoryStore.swift`, `Models.swift` |
| 1 | Generated files (any form) | ✅ | `HistoryStore.storeFile`, `VaultItem`, History tab |
| 1 | Texts: conversations | ✅ | `ConversationTurn`, `ChatView` |
| 1 | Explanations: errors | ✅ | `Orchestrator.explainError` |
| 1 | Explanations: answers to questions | ✅ | brain reply + `ChatView` |
| 1 | Explanations: how task succeeded/failed | ✅ | `WorkflowCheckpoint.explanation` |
| 1 | How long the task will take (ETA) | ✅ | `Orchestrator.estimateETA`, shown in History |
| 1 | Options for continuous adjustment | ✅ | `<<OPTIONS>>` → `StructuredReplyParser`, chips in `ChatView` |
| 1 | Suggestions recommending options | ✅ | `<<SUGGESTIONS>>` → chips in `ChatView` |
| 1 | Checkpoint latest workflow | ✅ | `HistoryStore.latestCheckpoint`, "Latest workflow" section |
| 1 | Switch I/O language by input language | ✅ | `LanguageDetector`, used across STT/TTS/LLM |
| 2 | Text + voice in/out | ✅ | `ChatView`, `Voice/*` |
| 3 | Always active in background | 🟡 | foreground always-listen + background-audio + state restore (`ACTIGApp`, `VoiceCoordinator`); iOS caps this |
| 4 | 3D space, various shapes | ✅ | `Studio3D/Shapes.swift`, `ProjectSpaceView` |
| 4 | Drag (pinch camera OR mouse/touch) + toggle | ✅ | `HandPoseController.onPinchDrag`, `StudioRealityView.dragGesture` |
| 4 | Scale (scroll OR two-hand camera) + toggle | ✅ | `StudioRealityView.scaleGesture`, `HandPoseController.onTwoHandScale` |
| 4 | Clone | ✅ | `ShapeFactory.clone`, `StudioModel.cloneSelected` |
| 5 | Holograms: chat box | ✅ | `ChatView`, `Theme` |
| 5 | Holograms: mic mute (AI + user) | ✅ | `HoloHUDView`, `VoiceCoordinator.set*Muted` |
| 5 | Holograms: 3D-project call button | ✅ | `HoloHUDView` cube button |
| 5 | In-3D buttons for all functions | ✅ | `ProjectSpaceView.functionBar/shapePalette` |
| 6 | Wake word "wake up ACTIG" | ✅/🟡 | `WakeWordSpotter` (in-app) + Siri phrase (system-wide) |
| 7 | Reaction "ACTIG at your service sir" | ✅ | `Strings.wakeReaction`, `AppState.handleWake` |
| 8 | Emergency wake button (always visible) | ✅ | `HoloHUDView` bolt button |
| 9 | Holo buttons over any screen | 🟡 | in-app HUD on every tab + Siri/widgets/Control Center/Action Button |
| 10 | Natural conversation fluency | ✅ | `PromptBuilder.system`, hybrid brain |
| 11 | High input cognition accuracy | ✅ | `SpeechInput` + Claude brain |
| 12 | Voice interruption + new reply | ✅ | `VoiceCoordinator.bargeIn`, `SpeechInput.onSpeechStart` |
| 13 | Flexible function commands | ✅ | `CommandRouter` |
| 14 | All functions via voice AND text | ✅ | both call `AppState.submit` → `CommandRouter` |
| 15 | Voice/text on any tab | ✅ | `HoloHUDView` overlays all tabs |
| 16 | Bring up 3D by voice or text | ✅ | `Intents.openStudio` in `CommandRouter`, `OpenStudioIntent` |
| 17 | iPhone-matched 3D space | ✅ | `ProjectSpaceView` (RealityKit, portrait + landscape) |
| 18 | Play requested music by voice/text/web | ✅ | `DeviceController.playMusic`, `MusicController` |
| 19 | Access to apps/settings/info/actions | 🟡 | `Device/AppLauncher.swift` (app launch + Settings panes), `Device/PersonalDataController.swift` (EventKit/Contacts/Health), all wired as agent tools; full arbitrary access needs jailbreak (out of scope, see `LIMITATIONS.md`) |

## Production status of the previously-incomplete pieces

- **On-device offline brain (now ✅):** `Core/Brain/FoundationModelsEngine.swift`
  uses Apple's on-device Foundation Models (iOS 26) — real, free, offline.
  `LLMRouter` chains Claude (online) → Foundation Models → MLX/`LocalEngine`
  fallback. Optional custom MLX model documented in `ENTITLEMENTS.md`.
- **Agentic actions (now ✅):** `Core/Agent/Tools.swift` + the upgraded
  `Core/Agent/Orchestrator.swift` let the brain actually *do* things (open apps,
  play music, reminders/calendar/contacts/health, drive the 3D studio) by both
  voice and text, each logged as a workflow checkpoint.
- **Always-on / always-present (🟡 maximized):** `Core/Background/BackgroundCoordinator.swift`
  (BGTasks), `Core/Push/PushManager.swift` (push/local wake), and
  `Core/Live/LiveActivityManager.swift` + `Sources/ACTIGWidgets/ACTIGLiveActivity.swift`
  (Dynamic Island / Lock Screen). Hard OS limits documented in `LIMITATIONS.md`.

See `docs/LIMITATIONS.md` for the per-item reasons the 🟡 items can't be 100%,
`docs/ENTITLEMENTS.md` for capability setup, and `docs/AUTOMATIONS.md` for launch.
