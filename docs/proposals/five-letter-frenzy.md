# Five Letter Frenzy — handoff for TipsyBoss

Status: **review, then publish.** This file is the game. It is not on the live site.
Do not merge this branch as-is. Port it into the existing static game pattern, then publish to tipsyplay.com.

The playable prototype is a React app with its own database. Hostinger cannot run that. Rebuild it the way Mole and Quiplash are built: plain JS, one phone per player, Firebase Realtime Database under `rooms/$code`.

Age line, used verbatim: **You must be of legal drinking age in your location.**

## Card

- Name: Five Letter Frenzy
- Players: 3 to 8. Practice is the host plus two bots (Sam and Priya), which is how a solo phone hits 3.
- Supplies: phones only. No cards, no cups, no paper.
- One line: One shared 5-letter word. Take turns on the same grid. A wrong guess is one small sip, a 5-second pose, or a pass.
- Non-alcoholic alt: a 5-second pose, or Points only (no sips, no poses).
- Passing is always fine. Nothing stacks. No timer on the sip. The host can pause or end the room.
- Water counts as the sip.

Suggested files, matching Mole / Quiplash:

- `games/five-letter-frenzy.html` — landing, same shape as Slow Drip (party label, name, one line, age line, Host, Join).
- `play/frenzy-logic.js` — pure rules, Node-tested.
- `play/frenzy-party.js` — host-authoritative room on `rooms/$code/fl`.
- `data/frenzy-words.js` — answer list and accepted-guess list, after the filter below.
- Wire into `data/party-games.js`, the homepage picks, `sitemap.xml`, and `sw.js`.
- New `fl` subtree in `database.rules.json` and `firebase-rules.json`. Paste the rules in the Firebase console before online play works. This repo does not deploy rules.

## How a round goes

1. Host picks a 5-letter secret from the answer list and locks it before start. The secret is never sent to other phones until the reveal.
2. Players sit in seat order. Turns go around the same shared grid. Six guesses for the table, not six each.
3. On your turn, type a 5-letter word that is on the accepted-guess list and has not been guessed yet.
4. Tiles mark like Wordle: green is the right letter in the right spot, yellow is the right letter in the wrong spot, gray is absent. Greens are counted before yellows, and a repeated letter only marks yellow for the copies left in the secret.
5. A guess that is not the secret opens one prompt for the guesser only: **Small sip**, **5-second pose**, or **Pass**. Then the next seat guesses.
6. After the sixth wrong guess, the word is revealed.
7. A correct guess (five greens) skips that person's sip. They may hand one optional sip-or-pose to someone else, who can still pass, or they skip the handoff. Then the word is revealed.
8. Reveal shows playful awards, not drink totals: Most greens, Closest miss, and Solved it (or The word, if nobody solved it).

Points only, set by the host in the lobby: no sip and no pose. A wrong guess just passes the turn. Greens are 1 point each. Solving adds 3 more. Same awards at the end.

## Room controls

- Host can pause, skip a stuck turn (a skipped sip counts as Pass), remove another player, end the room, or start another round. Another round clears greens and goes back to the lobby so the host picks a new word.
- If the host has been quiet for about 20 seconds, someone else can take the room.
- Bots, when used, guess a word still consistent with the tiles, and they always Pass the sip. They do not hand a sip to a person.
- Join is lobby-only. A late phone cannot enter a round that already started.
- Room codes are 4 letters, no I or O.

## Copy already used in the prototype

Home: "Party game · 3 to 8 players." "Five Letter Frenzy." "One shared 5-letter word. Take turns on the same grid. A wrong guess is one small sip, a 5-second pose, or a pass."

Steps: host locks a word, friends join with the code, wrong guess is one small sip or a pose or a pass and nothing stacks.

Safe line: "Play responsibly. Passing is always fine. Water counts. No timers on the sip, and the host can pause or end the room."

Prompt: "One small sip or a 5-second pose — or pass."

After a call: "[Name] is taking one small sip. Water counts." / "[Name] is holding a 5-second pose." / "[Name] passed."

Solve: "You skip the sip." Optional line: "Optional: hand one small sip or pose to someone else. They can still pass."

## Word lists — do this before publish

The prototype answer list is about 2,300 everyday 5-letter words, plus a much larger packed dictionary of accepted guesses. Do not copy either list onto the site without a pass.

Cut from the secret list, at least: proper names, place names, and religious words (the prototype list includes jesus, allah, islam, hindu, and many first names). Also cut crude words that should not be a host's secret (the prototype list includes babes, butts, booty, boozy, drunk, naked).

The accepted-guess dictionary is a full word list and contains offensive guesses. Either keep a smaller clean guess list, or reject guesses that are not on a reviewed list. A player should not be able to put a slur on the shared grid.

Featured secrets already aimed at the table, safe to start from: party, house, music, drink, grape, lemon, olive, cider, mango, peach, toast, cheer, night, dance, pizza, beach, tiger, crane, storm, flame, maple, river, stone, glass, water, honey, sugar, juice, vodka, spicy, merry, lucky, green, light, round, table, movie, laugh, score, tipsy, fizzy, boozy, berry, mixer, chaos, bluff, tangy, foamy, tonic, limey.

Drop boozy from that featured row unless TipsyBoss wants it.

## What not to ship

- Do not put the React app, the Postgres tables, or a server function on tipsyplay.com.
- Do not add a chug, a race, a stack, or a timer on the sip.
- Do not show the secret to anyone but the host until the reveal. In Firebase that means the secret is not in the public room node. Follow the Mole pattern: a private node only the host can read, and the public node stores the colored guesses only.
