# Installing ACTIG without a Mac or Xcode

You never touch Xcode — GitHub Actions builds everything in the cloud. Pick the
path that matches what you have.

---

## Path A — TestFlight (over-the-air, needs a paid Apple Developer account)

Best experience: install straight from the phone, no computer needed after setup.

**One-time setup (in a browser):**
1. Enroll in the **Apple Developer Program** ($99/yr) → developer.apple.com.
2. In **App Store Connect → Users and Access → Integrations → App Store Connect
   API**, create an **API Key** (Role: App Manager). Note the **Key ID** and
   **Issuer ID**, and download the `.p8` file once.
3. In App Store Connect, create the app record for bundle id `com.actig.app`.
4. In the GitHub repo → **Settings → Secrets and variables → Actions**, add:
   - `APP_STORE_CONNECT_KEY_ID` = your Key ID
   - `APP_STORE_CONNECT_ISSUER_ID` = your Issuer ID
   - `APP_STORE_CONNECT_API_KEY` = the `.p8` contents, base64-encoded
     (`base64 -i AuthKey_XXXX.p8` on any machine, or an online base64 tool)
   - `APPLE_TEAM_ID` = your 10-character Team ID (from the developer portal)

**Each release:**
1. Create a version tag and push it — e.g. on github.com use **Releases → Draft
   a new release → tag `v0.1.0` → Publish**. (No git CLI needed.)
2. The **Archive & TestFlight** job signs the app in the cloud (no Mac) and
   uploads it.
3. On your iPhone, install **TestFlight** from the App Store, sign in with your
   Apple ID, and ACTIG appears there to install. Updates are one tap.

---

## Path B — Download the `.ipa` and sideload (no Mac, free Apple ID OK)

Every push already builds an **unsigned `.ipa`** as a downloadable artifact. You
sign + install it from a **Windows or Mac PC** using a free tool; the tool
re-signs with *your* Apple ID.

**Get the .ipa:**
1. GitHub repo → **Actions** → open the latest **iOS Build** run.
2. Scroll to **Artifacts** → download **`ACTIG-unsigned-ipa`** → unzip to get
   `ACTIG-unsigned.ipa`.

**Install with AltStore (Windows or Mac):**
1. Install **AltServer** on your PC (altstore.io) + iTunes & iCloud (Windows).
2. Connect the iPhone, install **AltStore** onto it from AltServer.
3. In AltStore on the phone (or via AltServer): **My Apps → + → pick
   `ACTIG-unsigned.ipa`**, sign in with your Apple ID. It signs and installs.
4. Trust the developer: iPhone **Settings → General → VPN & Device Management →
   your Apple ID → Trust**.

**Or Sideloadly** (sideloadly.io, Windows/Mac): plug in the phone, drag the
`.ipa` in, enter your Apple ID, click **Start**.

### Free-Apple-ID caveats (Path B)
A free Apple ID can't use certain capabilities; AltStore/Sideloadly strip the
ones it isn't entitled to, and ACTIG degrades gracefully:
- **7-day expiry** — re-sign weekly (AltStore can auto-refresh over Wi-Fi).
- **No push, no HealthKit, limited App Groups/Siri** — wake word, on-device AI,
  voice, 3D studio, history, widgets and the rest still work.
- The custom wake word and gestures need the real device (not a simulator).

For the full feature set (push wake, HealthKit, persistent Siri), use **Path A**.

---

## Which should I use?
- Have/willing to pay for the Developer Program → **Path A (TestFlight)**: cleanest.
- Want it free and have a Windows PC → **Path B (AltStore/Sideloadly)**.
- No PC at all and no paid account → unfortunately iOS requires *some* trusted
  signer; there is no pure on-phone install for a full app (see LIMITATIONS.md).
