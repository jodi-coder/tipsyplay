# Game page FAQ schema

The 14 game pages now include a visible FAQ (`<section class="faq" id="faq">`) and a `FAQPage` node in the same `<script type="application/ld+json">` as the existing `BreadcrumbList`. The JSON question and answer strings match the visible text. There is no `HowTo` node.

`game-faq-template.json` is the empty shape used before the copy existed. Do not paste the placeholders onto a page.

## Google guidance (needs review)

Checked against the Google Search Central changelog on 2026-11-10: FAQ rich results stopped for every site on 7 May 2026, and the docs were removed on 15 June 2026. Unused structured data does not cause problems for Search and also has no visible effect. Recheck the changelog before anyone promises a rich result.

## Left off the public page (needs review)

These handoff sentences are editor notes, not player copy, so they are not in the visible FAQ or the JSON-LD:

- Story Chain player-count answer: the “Earlier Dev notes” sentence and the “NEEDS DEV SOURCE CHECK” instruction. The page says the public listing is 3–10.
- Hot Take Court: the “Dev notes” sentence and “Do not describe that checkbox…”.
- Split Decision: “Do not call it points-only…”.
- Category Countdown: “Dev notes the timer is a naming timer, not a sip timer.”
