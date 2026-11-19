#!/usr/bin/env python3
"""Writes the Five Letter Frenzy race (frenzy) block into both rules files, identically.
Run from the repo root: python3 tools/frenzy-race-rules.py  (it replaces only rooms/$code/frenzy)."""
import json

A = "auth != null && $code.matches(/^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/)"
ROOM = "root.child('rooms').child($code)"
HOST = ROOM + ".child('meta').child('hostUid').val() == auth.uid"
PLAYER = ROOM + ".child('players').child(auth.uid).exists()"
STATE = ROOM + ".child('frenzy').child('pub').child('state').val()"

def own_write(extra=""):
    # a player writes only their own entry; the host may only clear one
    return "(" + A + " && auth.uid == $uid && " + PLAYER + extra + " && newData.exists()) || (" + A + " && " + HOST + " && !newData.exists())"

block = {
    # the race everyone can see: its state, round, start time, settings and who is racing. Only the host writes it.
    "pub": {
        ".read": A,
        ".write": A + " && " + HOST,
        ".validate": "newData.hasChildren(['state','round','seq']) && newData.child('state').isString() && newData.child('state').val().matches(/^(lobby|race|results)$/) && newData.child('round').isNumber() && newData.child('round').val() >= 1 && newData.child('round').val() <= 99 && newData.child('seq').isNumber() && newData.child('seq').val() >= 0 && newData.child('seq').val() <= 1000000 && (!newData.child('goAt').exists() || newData.child('goAt').isNumber()) && (!newData.child('limit').exists() || (newData.child('limit').isNumber() && newData.child('limit').val() >= 0 && newData.child('limit').val() <= 600)) && (!newData.child('penalty').exists() || newData.child('penalty').val().matches(/^(none|lockout|drink)$/)) && (!newData.child('roster').exists() || (newData.child('roster').isString() && newData.child('roster').val().length <= 600))",
    },
    # each player's key hash, so the host can tell the word server who is racing. A hash, never the key itself.
    "keys": {
        ".read": A,
        "$uid": {
            ".write": own_write(),
            ".validate": "!newData.exists() || (newData.isString() && newData.val().matches(/^[a-f0-9]{64}$/))",
        },
    },
    # progress anyone may see: guesses used, solved or out, and when (server time). No letters, no colours.
    "prog": {
        ".read": A,
        "$uid": {
            ".write": own_write(),
            ".validate": "!newData.exists() || (newData.hasChildren(['n','st']) && newData.child('n').isNumber() && newData.child('n').val() >= 0 && newData.child('n').val() <= 6 && newData.child('st').isString() && newData.child('st').val().matches(/^(play|solved|out)$/) && (!newData.child('t').exists() || (newData.child('t').isNumber() && newData.child('t').val() <= now + 60000)))",
        },
    },
    # a player's own board, letters and colours. Private to them until the race is over.
    "players": {
        ".read": A + " && " + STATE + " == 'results'",
        "$uid": {
            ".read": A + " && (auth.uid == $uid || " + STATE + " == 'results')",
            ".write": own_write(),
            ".validate": "!newData.exists() || (newData.isString() && newData.val().length <= 600)",
        },
    },
}

src = open("firebase-rules.json").read()
r = json.loads(src)
r["rules"]["rooms"]["$code"]["frenzy"] = block
out = json.dumps(r, indent=2) + ("\n" if src.endswith("\n") else "")
for f in ("firebase-rules.json", "database.rules.json"):
    open(f, "w").write(out)
print("frenzy paths:", sorted(block))
