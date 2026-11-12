# TipsyPlay — Revised MVP Plan (PWA)

> **Age notice (used verbatim everywhere):** “You must be of legal drinking age in your location.”

## Audience
Adults of legal drinking age hosting casual game nights, pre-games, or hangouts who want one phone to run the fun. Mixed groups are expected: some drink, some don't — every game works for both.

## Principles
- Every game is **opt-in**; passing is always fine, no explanation needed.
- Every game shows a **clearly visible non-alcoholic alternative** (points, finger-folds, silly dares).
- **No** rapid/excessive drinking: no chugging, shotgunning, finishing drinks, drinking races, or escalating penalties. Max one small optional sip per turn.
- Original copy and visuals only (CSS, emoji, self-authored SVG/PNG icons).

## App approach: Progressive Web App
- Plain HTML/CSS/JS, no build step, no server code of our own, no accounts (anonymous sign-in only), no payments. Online rooms and spot comments use Firebase Realtime Database.
- `manifest.webmanifest` (standalone, dark theme), generated icons (192/512, 180 apple-touch).
- `sw.js` caches all app files on install → works offline after first load; cache-first with network fallback.
- Apple meta tags (`apple-mobile-web-app-capable`, `black-translucent` status bar) so “Add to Home Screen” launches full-screen.
- App shell: sticky header, bottom tab bar (Home, Games, Favourites, Settings), `overscroll-behavior:none`.
- localStorage only: age confirmation, favourites, settings (non-alcoholic default, default spice level, reminders, reset age gate).

## Screens
Age gate · Home · Game library (filters: players, supplies, vibe chill/wild, phone-playable; hearts) · Game detail (Never Have I Ever) · Play screen · Favourites · Settings · Responsible play.

## Ten starter games (each with a non-alcoholic alt)
1. **Never Have I Ever** — optional sip *or* fold a finger / score a point. *(playable)*
2. **Story Chain** — break the theme: optional sip *or* 5-sec dramatic pose.
3. **Who's Most Likely** — most votes: optional sip *or* 10-sec acceptance speech.
4. **Hot Take Court** — guilty verdict: optional sip *or* lose a point.
5. **Card Lottery** — wrong red/black guess: optional sip (once per round max) *or* tally mark.
6. **Cup Toss Challenge** — replaces beer pong/flip cup: ping-pong into **water-filled** cups for points only; nobody drinks from game cups.
7. **Category Countdown** — stumble: optional sip *or* animal impression.
8. **Two Truths & a Twist** — fooled guessers give you a point.
9. **Sketchy Guess** — drawing game, team points only.
10. **Rule Maker** — replaces Kings Cup: cards create silly table rules; slip-ups = one optional sip *or* a point; **no** "king's cup" to finish, no escalation.

## iPhone notes
viewport-fit=cover + safe-area insets; tap targets ≥44px; inputs/selects 16px (no auto-zoom); no hover-only interactions; `touch-action:manipulation`; swipe + tap on cards; Screen Wake Lock (iOS 16.4+) keeps the screen on during play; prefers-reduced-motion respected; Add to Home Screen for app mode.

## Future step (needs explicit approval — NOT done)
Create a GitHub repo and deploy the static files to Hostinger on TipsyPlay.com (HTTPS required for the service worker). Nothing has been connected, purchased, or deployed.

## Current inventory (November 2026)

The original ten games below are all hosted rooms now, plus King's Cup, Split Decision, Vibe Checkpoint, and Chaos Crew. Count-based marketing copy should follow the games list, not this historical "ten".

Rooms and spot comments use Firebase Anonymous Authentication. Rules in `database.rules.json` and `firebase-rules.json` match each other and are published only by pasting them in the Firebase console. This repo does not deploy rules.

Host handover stays deferred. A takeover rule cannot require the earliest connected `joinedAt`, because Realtime Database rules cannot rank every player. A weaker any-member claim was not left in the rules files. The client does not record `disconnectedAt` and does not offer a claim button. `hostUid` stays with the player who created the room, which is the restriction already on `main`.

Clearing reactions each round stays deferred. Current rules allow a player to create a reaction and do not allow deleting one. A host-delete permission was not left unused in the rules files. Each phone throttles its own reactions to about one every 1.5 seconds and leaves old reactions in place.

## 30-day plan
- **Week 1:** Local PWA preview (this build); gather feedback on look & flow.
- **Week 2:** Make 2–3 more games playable (Who's Most Likely, Category Countdown, Story Chain); more original prompts.
- **Week 3:** Accessibility + copy review; test on real iPhones (Safari + Home Screen); responsible-play review.
- **Week 4:** With approval: GitHub repo, Hostinger deploy, domain hookup, privacy page, basic launch.
