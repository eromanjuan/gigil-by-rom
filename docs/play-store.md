# Publishing Gigil to Google Play

Everything here is prepared. What's left needs your Google Play Console account
and its web forms — those can't be automated. Work top to bottom.

## The upload file

- **App bundle:** `android/app/build/outputs/bundle/release/app-release.aab`
  (also copied to `android/gigil-release.aab` for convenience)
- Play requires the **.aab**, not the .apk. The .apk is only for the website's
  direct download.
- Signed with the private upload key in `android/gigil-upload.keystore`.
  **Back that file and its password up somewhere safe.** If you lose it you have
  to ask Google to reset your upload key before you can ship an update. The
  password is in `android/keystore.properties` (gitignored — never commit it).

## Before you can submit

1. **Play Console account** — one-time US$25 at
   <https://play.google.com/console>. Register as a personal developer (or a
   business; personal is fine for this).
2. **Privacy policy URL** — already live at <https://gigil.web.app/privacy.html>.
   Paste that into the Play listing where it asks.
3. Enroll in **Play App Signing** when prompted (the default). Google then holds
   the real signing key and your upload key just authenticates uploads.

## Store listing (copy/paste)

- **App name:** Gigil
- **Short description** (max 80 chars):
  > Don't hold it in. Build a target and take the day's anger out on it.
- **Full description:**
  > Gigil is a stress toy. When someone has been living rent-free in your head
  > all week and you would never actually lay a finger on them — build them
  > here instead, and let it out on a pile of polygons.
  >
  > Build a 3D target: pick the hair, the outfit, the colours. Optionally give
  > it a face from a photo — the photo is mapped to the head entirely on your
  > device and is never uploaded. Then punch, slap, poke, pinch, throttle, spit,
  > or type an insult and throw the word itself.
  >
  > The damage is deliberately cartoonish — swelling and comic bruises, never
  > anything photoreal — and one button wipes it all clean.
  >
  > • Runs entirely on your device. No account, no ads, no data collected.
  > • Your photos never leave your phone.
  > • Touch controls: tap to punch, swipe to slap, hold two fingers to throttle.
  >
  > A toy, not a threat. If the anger frightens you, talk to a real person.

- **Category:** Games → Casual (or Simulation)
- **Tags:** stress relief, casual, sandbox
- **Contact email:** info@lumenmarketingusa.com

## Graphics you still need to supply

Play requires these and they can't be generated from the code:

- **App icon** 512×512 — use `public/icons/icon-512.png` (already the brand mark).
- **Feature graphic** 1024×500 — a banner. Not made yet; say the word and I'll
  design one.
- **Phone screenshots** — at least 2, up to 8. Take these from the running app
  on a phone or the browser at a phone size (the customiser, a hit landing, the
  bruised face). I can't screenshot a device from here.

## Data safety form

Answer: **No data collected or shared.** Justification is the privacy policy —
the app has no backend and processes photos locally. When it asks about photos,
the honest answer is that they are accessed but not collected/transmitted.

## Content rating questionnaire

Select category **Game**, then:

- Violence: **Yes — cartoon/fantasy violence.** It is stylised and never
  realistic or bloody. Expect a rating around **Teen / PEGI 12**.
- Sexual content: No.
- Language: No (any words are typed by the user, not authored content).
- Controlled substances: No.
- User-generated content: The typed insults and uploaded photos stay on-device
  and are never shared with other users, so there is no UGC moderation surface —
  answer No to social features.

## Target API level

The bundle targets API 35 (Android 15), above Play's current minimum. No action.

## After it's approved

Point the website's Android button at the Play listing instead of the direct
APK — a store install is safer and auto-updates. Tell me the listing URL and
I'll switch it over.
