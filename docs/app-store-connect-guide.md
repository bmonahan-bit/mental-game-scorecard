# App Store Connect Setup Guide
# Mental Game Scorecard — Step by step

## Prerequisites checklist
- [x] Apple Developer account active
- [x] Apple Sign In configured in Clerk
- [x] App ID registered: com.paulmonahan.mentalgamescorecard
- [ ] Support email: support@mentalgamescorecard.com (pending Paul)
- [ ] App icon: 1024x1024 PNG (pending Paul)
- [ ] Screenshots: 1290x2796px minimum 3 (pending)
- [ ] Privacy policy URL live (privacy.html — deploy to Netlify)

---

## Step 1 — Create the App Record

1. Go to appstoreconnect.apple.com
2. Click My Apps → blue + button → New App
3. Fill in:
   - Platform: iOS
   - Name: Mental Game Scorecard
   - Primary Language: English (U.S.)
   - Bundle ID: com.paulmonahan.mentalgamescorecard (select from dropdown)
   - SKU: mentalgamescorecard-001
   - User Access: Full Access
4. Create

---

## Step 2 — App Information

Left sidebar → App Information:
- Name: Mental Game Scorecard
- Subtitle: Track Your Mental Golf Game
- Privacy Policy URL: https://mental-game-scorecard.netlify.app/privacy.html
- Category: Primary = Sports, Secondary = Health & Fitness
- Content Rights: No third-party content
- Age Rating: click Edit → answer questionnaire (all None/No → results in 4+)

---

## Step 3 — Pricing and Availability

Left sidebar → Pricing and Availability:
- Price: Free (tier 0)
- Availability: All territories (or select specific countries)
- No pre-orders needed

---

## Step 4 — App Privacy

Left sidebar → App Privacy → Get Started:

Data types to declare:
- Contact Info → Email Address → Used for app functionality, linked to user
- Identifiers → User ID → Used for app functionality, linked to user
- Usage Data → Product Interaction → Used for analytics, not linked to user
- Diagnostics → Crash Data → Used for app functionality, not linked to user

Do NOT declare:
- Health/fitness data (Mental Net is not a health metric by Apple's definition)
- Location (we use approximate location for weather only — not stored)
- Financial info (no payments currently)

---

## Step 5 — Prepare the Version (1.0.0)

Left sidebar → iOS App → 1.0 Prepare for Submission:

### App Screenshots (required before submission)
- Device: iPhone 6.7" Display (1290 x 2796)
- Minimum 3, maximum 10
- Recommended order:
  1. Home screen — shows Paul's brand, Start Round button
  2. Scorecard with Heroes/Bandits open — shows the core feature
  3. Round Stats — shows Mental Net result
  4. Dashboard — shows trends over time
  5. Coach Portal — shows the coaching feature

HOW TO TAKE SCREENSHOTS:
- Open the live site on iPhone in Safari
- Add to Home Screen (Share → Add to Home Screen)
- Open from home screen (full screen, no browser chrome)
- Take screenshots with side button + volume up
- AirDrop to Mac or upload via iCloud
- Resize to exactly 1290x2796 if needed

### Description
(paste from app-store-metadata-updated.md)

### Keywords (100 chars max)
golf,mental game,scorecard,mindset,coaching,heroes,bandits,performance,focus,Paul Monahan

### Support URL
https://mental-game-scorecard.netlify.app

### Marketing URL
https://paulmonahan.com

### Version
1.0.0

### What's New
First release. Track your mental game alongside your strokes using Paul Monahan's Heroes and Bandits framework.

---

## Step 6 — Build Upload (requires Xcode + Capacitor)

This step requires the native iOS build. Steps:
1. Install Xcode from Mac App Store
2. Run: npm install @capacitor/core @capacitor/ios
3. Run: npx cap init
4. Run: npx cap add ios
5. Run: npx cap sync
6. Open in Xcode: npx cap open ios
7. Set signing team to your Apple Developer account
8. Archive → Distribute → App Store Connect
9. Build appears in App Store Connect under TestFlight

---

## Step 7 — App Review Information

Left sidebar → App Review Information:
- Sign-in required: Yes
  - Username: (create a test account on the live site)
  - Password: (test account password)
- Notes for reviewer:
  (paste from app-store-metadata-updated.md → App Store Review Notes section)
- Demo account: create one at mental-game-scorecard.netlify.app before submission

---

## Step 8 — Version Release

- Automatic release after approval (recommended for 1.0)
- Or manual release if you want to control timing

---

## What you can do RIGHT NOW (without support email or icon):
- [x] Step 1 — Create the app record
- [x] Step 2 — Fill in app information (use placeholder privacy URL for now)
- [x] Step 3 — Set pricing to free
- [x] Step 4 — App privacy declarations
- [ ] Step 5 — Needs screenshots and icon
- [ ] Step 6 — Needs Xcode setup
- [ ] Step 7 — Needs test account and support email
- [ ] Step 8 — After everything above

---

## Timeline estimate
- Steps 1-4 today: 30 minutes
- Screenshots: 1 hour once you have the icon
- Xcode + Capacitor setup: 2-3 hours (do this as a dedicated session)
- App review after submission: 1-3 days typically
