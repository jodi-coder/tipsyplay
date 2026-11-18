# Split Decision clips (optional)

The game works without any files here. When a file is missing, the phone falls back to the still image. If the still image is missing too, it uses the CSS animation in `play/poster.css`.

Each clip has up to three files, all with the same name:

| Name | Phase | Files |
|---|---|---|
| `tension-loop` | Question countdown | `tension-loop.webm`, `tension-loop.mp4`, `tension-loop.jpg` |
| `reveal-burst` | Reveal | `reveal-burst.webm`, `reveal-burst.mp4`, `reveal-burst.jpg` |
| `winner-celebrate` | Final result | `winner-celebrate.webm`, `winner-celebrate.mp4`, `winner-celebrate.jpg` |

- Clips: 3 to 6 seconds, seamless loop, no audio track, under 1 MB each. The page plays them muted and inline.
- Stills: JPG, under 100 KB, the same framing as the clip. They are shown on reduced motion, Save-Data, or 2g/3g connections.
- The strip is 96px tall and full width, cropped with `object-fit: cover`, so keep the action in the centre band.
- Use the Sky palette only.
- `sw.js` never caches these files. No version bump is needed when you add or replace them.
