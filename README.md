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
