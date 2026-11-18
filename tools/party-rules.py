#!/usr/bin/env python3
"""Writes the Hot Take Court (hc) and Category Countdown (cc) blocks into both rules files, identically.
Run from the repo root: python3 tools/party-rules.py  (it replaces only rooms/$code/hc and rooms/$code/cc)."""
import json

A = "auth != null && $code.matches(/^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/)"
ROOM = "root.child('rooms').child($code)"
META_HOST = ROOM + ".child('meta').child('hostUid')"
PLAYER = ROOM + ".child('players').child(auth.uid).exists()"

def block(g, phases, inputs):
    gp = ROOM + ".child('" + g + "')"
    H = "(" + gp + ".child('host').val() == auth.uid || (!" + gp + ".child('host').exists() && " + META_HOST + ".val() == auth.uid))"
    PH = gp + ".child('pub').child('phase').val()"
    def pubf(k): return gp + ".child('pub').child('" + k + "').val()"
    def own(cond, validate, secret=False, read_all=False):
        node = {"$uid": {
            ".write": "(" + A + " && auth.uid == $uid && " + PLAYER + " && " + cond + " && newData.exists()) || (" + A + " && " + H + " && !newData.exists())",
            ".validate": "!newData.exists() || (" + validate + ")"}}
        if read_all: node[".read"] = A
        else:
            node[".read"] = A + " && " + H
            node["$uid"][".read"] = A + " && (auth.uid == $uid || " + H + ")"
        return node
    b = {
        "host": {
            ".read": A,
            # the room's host may set it; a player may claim it for themselves only while the acting host's phone is offline
            ".write": "(" + A + " && " + META_HOST + ".val() == auth.uid) || (" + A + " && " + PLAYER + " && newData.val() == auth.uid && " + ROOM + ".child('meta').child('status').val() == 'play' && ((data.exists() && " + ROOM + ".child('players').child(data.val()).child('connected').val() != true) || (!data.exists() && " + ROOM + ".child('players').child(" + META_HOST + ".val()).child('connected').val() != true)))",
            ".validate": "!newData.exists() || (newData.isString() && newData.val().length > 0 && newData.val().length <= 128)"},
        "beat": {".read": A, ".write": A + " && " + H, ".validate": "newData.isNumber()"},
        # a TV or laptop display marks itself here; it is not a player and can write nothing else
        "screen": {".read": A, ".write": A, ".validate": "!newData.exists() || (newData.isNumber() && newData.val() <= now + 60000)"},
        "pub": {".read": A, ".write": A + " && " + H,
            ".validate": "newData.hasChildren(['phase','seq','deadline','data']) && newData.child('phase').isString() && newData.child('phase').val().matches(/^(" + "|".join(phases) + ")$/) && newData.child('seq').isNumber() && newData.child('seq').val() >= 0 && newData.child('seq').val() <= 1000000 && newData.child('deadline').isNumber() && newData.child('data').isString() && newData.child('data').val().length <= 40000 && (!newData.child('a').exists() || (newData.child('a').isString() && newData.child('a').val().length <= 128)) && (!newData.child('b').exists() || (newData.child('b').isString() && newData.child('b').val().length <= 128)) && (!newData.child('c').exists() || (newData.child('c').isString() && newData.child('c').val().length <= 128))"},
        "secret": {".read": A + " && " + H, ".write": A + " && " + H, ".validate": "newData.isString() && newData.val().length <= 60000"},
        "left": {".read": A, "$uid": {
            ".write": "(" + A + " && auth.uid == $uid && " + PLAYER + " && newData.val() == true) || (" + A + " && " + H + " && !newData.exists())",
            ".validate": "!newData.exists() || newData.isBoolean()"}},
    }
    for name, spec in inputs(PH, pubf, H).items():
        if spec.get("nested"):
            # one child per entry ($uid/$n), so quick answers never overwrite each other
            node = own(spec["cond"], "newData.hasChildren()", read_all=spec.get("public", False))
            node["$uid"]["$n"] = {".validate": "$n.matches(/^[0-9]{1,2}$/) && " + spec["validate"]}
            b[name] = node
        elif spec.get("hostwrite"):
            b[name] = {"$uid": {".read": A + " && (auth.uid == $uid || " + H + ")", ".write": A + " && " + H, ".validate": spec["validate"]}}
        else:
            b[name] = own(spec["cond"], spec["validate"], read_all=spec.get("public", False))
    return b

def hc_inputs(PH, pub, H):
    # pub.a = Defendant, pub.b = Prosecutor, pub.c = whoever chooses in sentencing
    notSpeaker = pub("a") + " != auth.uid && " + pub("b") + " != auth.uid"
    return {
        "offer": {"hostwrite": True, "validate": "!newData.exists() || (newData.isString() && newData.val().length <= 2000)"},
        "pick": {"cond": PH + " == 'case' && " + pub("a") + " == auth.uid", "validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 2"},
        "rest": {"cond": "((" + PH + " == 'opening' && " + pub("a") + " == auth.uid) || (" + PH + " == 'prosecution' && " + pub("b") + " == auth.uid))", "validate": "newData.isString() && newData.val().matches(/^(opening|prosecution):[0-9]{1,7}$/)"},
        "obj": {"cond": PH + " == 'prosecution' && " + notSpeaker, "validate": "newData.isNumber()", "public": True},
        "vote": {"cond": PH + " == 'deliberation' && " + notSpeaker, "validate": "newData.isString() && newData.val().matches(/^[gn]:[0-9]{1,7}$/)"},
        "sent": {"cond": PH + " == 'sentencing' && " + notSpeaker, "validate": "newData.isString() && newData.val().matches(/^[0-2]:[0-9]{1,7}$/)"},
        "choice": {"cond": PH + " == 'sentencing' && " + pub("c") + " == auth.uid", "validate": "newData.isString() && newData.val().matches(/^(drink|alt|pass):[0-9]{1,7}$/)"},
    }

def cc_inputs(PH, pub, H):
    # pub.a = the player answering (Spotlight) or whose turn it is / whose answer is up for challenge (Hot Potato)
    return {
        "ans": {"cond": "(" + PH + " == 'answer' || " + PH + " == 'turn') && " + pub("a") + " == auth.uid", "validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 60", "public": True, "nested": True},
        "chal": {"cond": "(" + PH + " == 'answer' || " + PH + " == 'window') && " + pub("a") + " != auth.uid", "validate": "newData.isString() && newData.val().length <= 600", "public": True},
        "cvote": {"cond": PH + " == 'cvote' && " + pub("a") + " != auth.uid", "validate": "newData.isString() && newData.val().length <= 600"},
        "choice": {"cond": ROOM + ".child('meta').child('status').val() == 'play'", "validate": "newData.isString() && newData.val().matches(/^(drink|alt|pass):[0-9]{1,7}$/)"},
    }

HC_PHASES = ["case", "opening", "prosecution", "deliberation", "verdict", "sentencing", "scores", "end"]
CC_PHASES = ["intro", "answer", "cvote", "result", "turn", "window", "scores", "end"]

src = open("firebase-rules.json").read()
r = json.loads(src)
rooms = r["rules"]["rooms"]["$code"]
rooms["hc"] = block("hc", HC_PHASES, hc_inputs)
rooms["cc"] = block("cc", CC_PHASES, cc_inputs)
out = json.dumps(r, indent=2) + ("\n" if src.endswith("\n") else "")
for f in ("firebase-rules.json", "database.rules.json"):
    open(f, "w").write(out)
print("hc paths:", sorted(rooms["hc"])); print("cc paths:", sorted(rooms["cc"]))
