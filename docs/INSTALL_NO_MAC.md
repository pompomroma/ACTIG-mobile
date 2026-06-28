# Installing ACTIG without a Mac, Xcode, or a paid Apple account

GitHub Actions builds everything in the cloud. **You do NOT need Xcode, a Mac,
App Store Connect, or the $99 Apple Developer Program** for the main path below —
just a normal (free) Apple ID.

---

## Path B (recommended for you) — download the `.ipa` and sideload (FREE)

No App Store Connect. No paid account. A free Apple ID is enough.

### 1. Get the `.ipa`
Easiest — from the auto-published release (a link you can even open in Safari on
the iPhone):

> **github.com/pompomroma/ACTIG-mobile/releases/tag/build-latest** → download
> **`ACTIG-unsigned.ipa`**

(That release is rebuilt automatically on every push. Alternatively: repo →
**Actions** → latest **iOS Build** run → **Artifacts** → `ACTIG-unsigned-ipa`.)

### 2. Sign + install it with a free tool
iOS requires the app to be signed by *some* Apple ID; these tools do it with
*yours* automatically — no App Store Connect, no paid membership.

**Option 1 — AltStore (needs a Windows or Mac computer once):**
1. Install **AltServer** on the PC (altstore.io) + iTunes & iCloud on Windows.
2. Plug in the iPhone → install **AltStore** onto it from AltServer.
3. In AltStore on the phone: **My Apps → +**, choose `ACTIG-unsigned.ipa`, sign
   in with your free Apple ID. It signs and installs.
4. iPhone **Settings → General → VPN & Device Management → your Apple ID → Trust**.

**Option 2 — SideStore (computer needed only once):** like AltStore, but after a
one-time USB pairing it can **re-sign on the phone over Wi-Fi**, so you rarely
touch the computer again. See sidestore.io.

**Option 3 — Sideloadly (Windows/Mac):** plug in the phone, drag in the `.ipa`,
enter your free Apple ID, click **Start**.

### Free-Apple-ID caveats (and they're fine)
The tools strip capabilities a free account can't use; ACTIG degrades gracefully:
- **7-day expiry** — re-open AltStore/SideStore weekly to refresh (can auto-refresh on Wi-Fi).
- **No push, no HealthKit, limited App Groups/Siri.** Still fully working: the
  on-device offline AI, voice (wake word + barge-in), text chat, the 3D studio
  with hand gestures, history/checkpoints, the holo HUD, and music/app launching.
- Wake word + gestures need the real device (not the Simulator).

---

## Path A (optional) — TestFlight, only if you ever get the paid account

Requires the $99 Apple Developer Program + App Store Connect. If you don't have
these, **skip this entirely — Path B does not need them.** Steps (for later):
add repo secrets `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`,
`APP_STORE_CONNECT_API_KEY` (base64 `.p8`), `APPLE_TEAM_ID`; push a `v*` tag; CI
signs in the cloud and uploads to TestFlight; install via the TestFlight app.

---

## "I have no computer at all"

iOS still requires a trusted signer, and the easy computer-free options don't fit
this device:
- **TrollStore** (permanent, no computer, no account) only works on iOS 14–16.x
  (some 17.0). An iPhone 14 Pro Max on iOS 26 is **not** supported.
- **AltStore PAL** (alternative marketplace, install over the air) is **EU-only**,
  iOS 17.4+. If you're in the EU this can work without a computer.

Otherwise you need a computer **once** (a friend's Windows PC is enough) to do the
initial AltStore/SideStore pairing. After that, SideStore refreshes on-device.
There is no fully on-phone install for a full native app on iOS 26 outside the EU
— that's an Apple restriction, not a gap in ACTIG (see `LIMITATIONS.md`).
