# DRAFT: late-join rules

Not for publish. `firebase-rules.json` and `database.rules.json` stay as they are. This note is a proposal only.

Today a new phone can write `rooms/$code/players/$uid` or `mlt/$pin/players/$uid` only when that row already exists, or when `meta.status` is `lobby`. After the host starts the game, a stranger who knows the code is rejected. The client now says the room is closed to new players and offers a fresh room instead of widening this rule.

## Proposed diff

```diff
--- a/firebase-rules.json
+++ b/firebase-rules.json
@@ rooms/$code/players/$uid .write
- (data.exists() || root.child('rooms').child($code).child('meta').child('status').val() == 'lobby')
+ (data.exists() || root.child('rooms').child($code).child('meta').child('status').val().matches(/^(lobby|play)$/))

@@ mlt/$pin/players/$uid .write
- (data.exists() || root.child('mlt').child($pin).child('meta').child('status').val() == 'lobby')
+ (data.exists() || root.child('mlt').child($pin).child('meta').child('status').val().matches(/^(lobby|play)$/))
```

`over` stays closed. The host can still delete a player row. No other path changes.

## What this widens

Anyone who can sign in anonymously and who knows the 4-letter room code, or the 6-character Who's Most Likely code, could create their own player row after the game has started.

That lets a late arrival:

- appear in the player list without the host admitting them
- write the answers, votes, draws, or casts the rules already allow for a seated player
- read the prompts, scores, and names already visible to the room

It does not let them overwrite someone else's row, change `meta`, or become host. The code is still the only gate, and a 4-letter code is short enough to guess. A started game would no longer be a closed set of people.

Ship this only if the table wants true mid-game drop-in. Until then, Restart with same game opens a new code through the existing host write.
