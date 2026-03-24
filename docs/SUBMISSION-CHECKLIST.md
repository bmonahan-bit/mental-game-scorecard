# Mental Game Scorecard — App Store Submission Checklist
# Work through this in order before submitting

## PHASE 1: ACCOUNTS & SETUP (Start immediately — takes 24-48hrs)
- [ ] Apply for Apple Developer Program at developer.apple.com/programs ($99/yr)
- [ ] Set up support@mentalgamescorecard.com (can forward to Paul's email)
- [ ] Create App Store Connect listing (can do before Xcode build)
- [ ] Register App ID: com.paulmonahan.mentalgamescorecard

## PHASE 2: CODE (1-2 hours once on a Mac)
- [ ] Copy files from outputs folder to project:
      - mental-game-scorecard.jsx → src/
      - main.jsx → src/ (replace existing)
      - index.html → project root (replace existing)
      - manifest.json → public/
      - vite.config.js → project root (replace existing)
      - capacitor.config.ts → project root
      - supabaseClient.js → src/ (optional, for future auth)
      - useAuth.js → src/ (optional)
      - usePromo.js → src/ (optional)
- [ ] Run: npm install @capacitor/core @capacitor/cli @capacitor/ios
- [ ] Run: npx cap init (if first time)
- [ ] Run: npm run build
- [ ] Run: npx cap sync
- [ ] Run: npx cap open ios → opens Xcode

## PHASE 3: XCODE (30-60 mins)
- [ ] Set Bundle Identifier: com.paulmonahan.mentalgamescorecard
- [ ] Set Version: 1.0.0 and Build: 1
- [ ] Set Deployment Target: iOS 15.0
- [ ] Add app icons (1024×1024 PNG, no alpha, no rounding):
      - Drag into Assets.xcassets → AppIcon
- [ ] Add splash screen image (2732×2732 PNG on dark background)
- [ ] Set display name: "Mental Game"
- [ ] Test on real iPhone (Connect via USB → select device → Run)
- [ ] Fix any layout issues on real device
- [ ] Archive: Product → Archive

## PHASE 4: APP STORE CONNECT
- [ ] Create new app listing
- [ ] Paste metadata from app-store-metadata.md
- [ ] Upload screenshots (use app-store-screenshots.html as reference)
- [ ] Fill out App Privacy (select "Data Not Collected")
- [ ] Set age rating: 4+
- [ ] Set price: Free
- [ ] Submit build from Xcode Archive
- [ ] Add review notes (copy from app-store-metadata.md)

## PHASE 5: BEFORE SUBMITTING — Apple Review Checklist
- [ ] Test on iPhone SE (smallest screen — 375pt wide)
- [ ] Test on iPad (app should work in portrait)
- [ ] Test offline mode
- [ ] Test Start Round → log heroes/bandits → Finish → Save
- [ ] Test Settings → Clear All Data
- [ ] Test Privacy Policy opens and is readable
- [ ] Test Terms link works
- [ ] Test dark mode and light mode
- [ ] Rate App button shows (will work once App ID is set)
- [ ] No white screens when navigating
- [ ] No console errors in Xcode

## PHASE 6: AFTER APPROVAL
- [ ] Update YOUR_APP_STORE_ID in mental-game-scorecard.jsx with real ID
- [ ] Set up Supabase (add .env vars) when ready for accounts
- [ ] Generate promo codes (see usePromo.js instructions)
- [ ] Set up supabase-setup.sql when ready for cloud sync
- [ ] Submit update via App Store Connect

## FILES SUMMARY
| File | Location | Purpose |
|------|----------|---------|
| mental-game-scorecard.jsx | src/ | Main app |
| main.jsx | src/ | Entry point |
| index.html | root | HTML shell |
| manifest.json | public/ | PWA manifest |
| vite.config.js | root | Build config |
| capacitor.config.ts | root | iOS config |
| supabaseClient.js | src/ | Auth backend |
| useAuth.js | src/ | Auth hook |
| usePromo.js | src/ | Promo codes |
| app-store-metadata.md | — | App Store copy |
| app-store-screenshots.html | — | Screenshot reference |
| supabase-setup.sql | — | DB schema |

## QUICK PROMO CODE SETUP (no backend needed)
1. Open mentalgamescorecard.netlify.app in browser
2. Open browser console (F12)
3. Run:
   async function hash(code) {
     const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code.toUpperCase()));
     return [...new Uint8Array(buf)].map(x=>x.toString(16).padStart(2,'0')).join('');
   }
   hash('PAUL2026').then(console.log)
4. Copy the hash into VALID_CODE_HASHES in usePromo.js
5. Suggested launch codes: PAUL2026, MENTALGOLF, COACHFREE, BETA2026
