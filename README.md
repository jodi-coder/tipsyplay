# TipsyPlay

TipsyPlay is a phone-friendly party-game app for adults of legal drinking age. One phone runs the night: every game is opt-in, and every game offers a non-alcoholic alternative (points, finger-folds, or silly dares) so mixed groups can play together.

It is a static progressive web app — plain HTML, CSS, and JavaScript. There is no build step, no backend, and no package install. Open the files as they are.

## Preview locally

From the repository root:

```bash
python3 -m http.server
```

Then open `http://localhost:8000`. A local server is required so the service worker and app manifest load correctly; opening `index.html` as a file will not.

## Hosting

Hostinger serves this repository root as `public_html`. The site files (`index.html`, `manifest.webmanifest`, `sw.js`, and the rest) live at the root so they are the public site, with no build or copy step.

## Comment admin

Spot pages store comments in Firebase Realtime Database. Visitors post with anonymous sign-in. They cannot edit or delete comments.

To delete comments, add your signed-in uid in the Firebase console (this bypasses client security rules):

1. Open `/admin-comments.html` on the live site. The page shows the uid for the browser you are using. It is not linked in the nav, and search engines are asked not to index it.
2. In Realtime Database, set `admins/<that-uid>` to `true`.
3. Reload `/admin-comments.html`. Delete buttons appear only after that node exists.

`database.rules.json` in this repo is the full ruleset to paste into the Firebase console. It is not deployed automatically. Room rules stay as they are. Comment deletes are allowed only when `admins/<uid>` exists.
