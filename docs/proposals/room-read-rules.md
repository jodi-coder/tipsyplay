# DRAFT: room read rules

Not for publish. `firebase-rules.json` and `database.rules.json` stay as they are. This note is a proposal only.

## Problem

Today almost every room read rule is `auth != null && $code.matches(...)`. Anonymous sign-in is open to anyone, so a browser that knows or guesses a room code can read that room's `players`, `kc/*`, `nhie/*`, `notes`, `tally`, `strokes` and `skips` without ever joining. The 4-letter code space is 23^4, about 280,000. `rooms` has no list permission, so codes cannot be listed, but they can be probed.

Reveal-gated nodes (`answers`, `sealed`, `call`) also let a non-member read them once a round is revealed.

## Proposed change

Reads, not writes, change. Writes are untouched.

Define two checks:

```
M(rooms) = root.child('rooms').child($code).child('players').child(auth.uid).exists()
        || root.child('rooms').child($code).child('meta').child('hostUid').val() == auth.uid
```

`M(mlt)` is the same with `mlt` and `$pin`. The host clause matters for Who's Most Likely, where `meta.nohost` can mean the host is not in `players`.

| Path | Read rule after the change |
|---|---|
| `meta` (both trees) | Unchanged. A joiner has no player row yet and must read it. |
| `rooms/$code/players` | Existing check `&& (meta.status == 'lobby' \|\| M)` |
| `rooms/$code/players/$uid` | New: `auth != null && auth.uid == $uid`, so a returning phone can always read its own row |
| `answered`, `revealed`, `skips`, `notes`, `tally`, `strokes`, `kc/{play,ask,pick,who,house,mates,react}`, `nhie/{play,say,cast,who,react}` | Existing check `&& M` |
| `answers/$game/$round`, `sealed/$game/$round`, `call/$game/$round` | Existing reveal check `&& M` |
| `answers/…/$uid`, `sealed/…/$uid` | Unchanged: owner only |
| `secret`, `kc/pile` | Unchanged: host, or drawer |
| `mlt/$pin/{players,play,reveal,custom}` | Same pattern with `M(mlt)`. `players` follows the lobby-or-member rule and gets the same `$uid` own-row read. |
| `mlt/$pin/cast` | Unchanged: host, or the voter |

29 read rules change or are added. The structural diff against the current file shows only `.read` entries; no `.write` or `.validate` rule moves.

`docs/proposals/room-read-rules.gen.py` regenerates the patched ruleset from `database.rules.json`:

```bash
python3 docs/proposals/room-read-rules.gen.py /path/to/rules-proposed.json
```

## Why `players` is open in the lobby

`joinRoom()` in `play/join.js` reads the whole `players` list to check the 12-player cap and to see whether the uid already has a row. `play/most-likely.js` does the same at join time. A non-member has to be able to read `players` to join. Once `meta.status` leaves `lobby`, new players are rejected anyway, so the list closes to non-members at the same moment.

The remaining exposure is names and connection flags in a lobby whose code someone has guessed.

## What this closes and what it does not

Closes:

- Reading live `nhie/cast` votes, `nhie/say`, `nhie/who` and `kc/who` without joining.
- Reading `notes`, `tally`, `strokes` and `skips` without joining.
- Reading revealed answers without joining.
- Reading `players` once a game is running.

Does not close:

- A member can still read the live `nhie/cast` votes of other members. That is a game-design question, not a membership one.
- `notes` is still readable by every member before reveal. Check each game's `notes` payload before relying on it.
- Anyone who guesses a code can still join a lobby before the game starts. That is intended.
- The 12-player cap stays client-only.

## Client effects to check

- `join.js` reads `players` before it checks `meta.status`. After the change, a stranger joining a started room gets a permission error, which `friendly()` shows as "That room isn't available." The old "started" message needs the status check to move above the `players` read. That is a one-line reorder.
- `multi.js` reads only `players/<own uid>` at join, which the new `$uid` rule covers.
- A player who leaves removes their own row. Any listener still attached then gets a permission error. Several are attached with a no-op error callback; check that `leaveRoom()` stops listeners before the row is removed.
- Presence only sets `connected:false`, so a dropped phone keeps its row and its access.
- The host writes `meta` and then its own `players` row. Listeners attach after both, so the host clause is a safety net rather than a race fix.

## Testing

Not tested. The Firebase CLI is not installed in the session that wrote this draft, so the rules were checked only for JSON validity and for which paths changed. Before publishing, run both rule files through the Realtime Database emulator (ports are set in `firebase.json`) with at least these cases:

1. Non-member reads `rooms/ABCD/notes` mid-game: denied.
2. Non-member reads `rooms/ABCD/players` in the lobby: allowed. Mid-game: denied.
3. Member reads `answers` before reveal: denied except their own row. After reveal: allowed.
4. Host of a Who's Most Likely room with `nohost` reads `play`: allowed.
5. A phone that dropped and reconnected reads its own `players/$uid`: allowed.

As with every rules change here, it takes effect only when pasted into the Firebase console, and both rules files must be changed together.
