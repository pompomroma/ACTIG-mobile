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

## Path C (no computer at all, no account) — install the WEB APP (PWA)

This needs **only your iPhone and Safari**. No computer, no Apple ID, no signing.

1. Open **https://pompomroma.github.io/ACTIG-mobile/** in **Safari**.
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Launch **ACTIG** from your Home Screen — it runs full-screen like an app and
   works offline after the first load.
4. In the app's **Settings**, paste a **Claude API key** for the smartest replies
   (optional; basic offline replies work without it).

**What works in the PWA:** holographic chat, **voice in & out**, the wake phrase
"wake up ACTIG" → "ACTIG at your service sir" (where the browser supports
speech recognition), language auto-switch, the **3D studio** (spawn / drag /
scale / clone shapes, plus optional camera hand-gestures), and saved history.

**What's native-only** (a browser can't do these): Siri, Home-Screen widgets,
Control Center, HealthKit, Apple's on-device model, and launching other apps.
For those, use Path A (TestFlight) or Path B (sideload) with a computer/account.

> First deploy: a repo admin enables Pages once — repo **Settings → Pages →
> Build and deployment → Source: GitHub Actions** (doable from Safari). After
> that the URL above is live and updates on every push.

## Native, no computer (regional / paid options)
- **TrollStore** (permanent, no computer/account) only works on iOS 14–16.x
  (some 17.0). iPhone 14 Pro Max on iOS 26 is **not** supported.
- **AltStore PAL** (alt marketplace, over-the-air) is **EU-only**, iOS 17.4+.
- **$99 TestFlight** (Path A) is fully drivable from Safari + the TestFlight app —
  no computer — if you ever get the paid account.

For a full *native* app with none of those, you need a computer **once** for the
AltStore/SideStore pairing — an Apple restriction, not a gap in ACTIG.
