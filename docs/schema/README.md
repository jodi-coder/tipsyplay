# Game page FAQ and HowTo schema (template only)

This folder is a wiring guide. It is not live markup. Nothing here is included from a page, and the placeholders must not be copied into `games/*.html` until the visible FAQ and steps exist.

The site root is what Hostinger publishes from `main`. Keep this change off `main` until Jeff approves a separate pass that inserts real copy.

## Pages this template is for

Each of these 14 pages already has one `BreadcrumbList` JSON-LD block and no `FAQPage` or `HowTo` block:

1. `games/never-have-i-ever.html`
2. `games/story-chain.html`
3. `games/whos-most-likely.html`
4. `games/hot-take-court.html`
5. `games/card-lottery.html`
6. `games/cup-toss.html`
7. `games/category-countdown.html`
8. `games/two-truths.html`
9. `games/sketchy-guess.html`
10. `games/rule-maker.html`
11. `games/split-decision.html`
12. `games/vibe-checkpoint.html`
13. `games/chaos-crew.html`
14. `games/kings-cup.html`

`games/index.html` is the catalog, not one of the 14. Leave it alone in the schema pass.

## Google guidance (needs review)

Checked against the Google Search Central changelog on 2026-11-10:

- **HowTo rich results are deprecated.** The changelog records that How-to structured-data docs were removed because the rich result is no longer shown on desktop or mobile. The 8 August 2023 Search Central post, updated 14 September 2023, is the original notice: How-to rich results stopped on 13 September 2023.
- **FAQ rich results are retired for every site.** The 8 May 2026 changelog entry says the FAQ rich result would no longer appear in Google Search starting 7 May 2026. The 15 June 2026 entry says the FAQ rich-result documentation was removed for that reason. The 2023 restriction to government and health sites is no longer the current line.
- Google's 2023 post still says unused structured data does not cause problems for Search and also has no visible effect. That sentence is why markup can stay once it matches the page. It is not a reason to expect a rich result.
- **Needs review** before anyone tells SEO that this markup will change Google's result appearance. Re-read the Search Central changelog on the day of the real insert. Other consumers of schema.org are outside this note.

Visible questions and steps are the part that helps a reader. The JSON-LD only restates them.

## Wiring, when copy exists

1. SEO writes 3 to 5 questions per game, including "Can I play without drinking?", plus short HowTo steps. The words have to be safe for the house rules: one optional sip or a named alternative, passing is fine, nothing stacks, no chugging.
2. Put that copy on the page in HTML the reader can open. The homepage FAQ uses `<details>` and `<summary>` (`index.html`). Game pages can do the same. Add matching `id="setup"` and `id="rules"` targets if the HowTo step URLs use those fragments. The existing Setup and Rules headings are the source for the steps.
3. Replace every `{{PLACEHOLDER}}` in `game-faq-template.json`. Delete `$comment` and any key you are not using (`totalTime` when there is no real duration). The question "Can I play {{GAME_NAME}} without drinking?" can be reworded, but the visible sentence and the JSON sentence must match.
4. Merge the two nodes into the page's existing `<script type="application/ld+json">` as one `@graph` that still contains the current `BreadcrumbList`. One script per page. Do not add a second, conflicting graph, and do not leave placeholder braces in the page.
5. Check the JSON parses. Google's Rich Results Test will not show an FAQ or HowTo appearance; use it only as a syntax check. Confirm the age line on the page is still exactly `You must be of legal drinking age in your location.` and that the existing `G-BHY4BXF3V3` tag is unchanged.

`{{CANONICAL_URL}}` is the page's current canonical, for example `https://tipsyplay.com/games/kings-cup.html`.

## What this pass must not do

- Do not add the template, or empty FAQ schema, to a live page.
- Do not edit `sitemap.xml`, `sw.js`, Firebase rules, or `firebase-config.js` for this template.
- Do not add a new third-party script. The Google tag already on each game page stays as it is.
