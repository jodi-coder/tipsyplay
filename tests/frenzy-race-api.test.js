/* Five Letter Frenzy race server: the shared PHP functions and the real endpoint, run with PHP's own web server.
   Run: node --test frenzy-race-api.test.js   (skipped when php is not installed) */
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const L = require("../play/frenzy-logic.js");
const W = require("../data/frenzy-words.js");

const HAVE_PHP = spawnSync("php", ["-v"]).status === 0;
const php = (code) => {
  const r = spawnSync("php", ["-r", 'require "' + ROOT + '/api/frenzy-lib.php"; ' + code], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const skip = HAVE_PHP ? {} : { skip: "php is not installed" };

/* ---------- colours ---------- */
test("colours: repeated letters, ABBEY against ABBAS, and a letter that is in the secret once", skip, () => {
  assert.deepEqual(php('echo json_encode(mark_guess("abbas","abbey"));'), ["locked", "locked", "locked", "absent", "absent"]);
  assert.deepEqual(L.markGuess("abbas", "abbey"), ["locked", "locked", "locked", "absent", "absent"]);
  // the secret has one e: it locks in place, so the earlier e's are absent, and the r moves
  assert.deepEqual(php('echo json_encode(mark_guess("crane","eerie"));'), ["absent", "absent", "moved", "absent", "locked"]);
  assert.deepEqual(L.markGuess("crane", "eerie"), ["absent", "absent", "moved", "absent", "locked"]);
  // one l locks, the other l moves, one a moves
  assert.deepEqual(php('echo json_encode(mark_guess("alley","llama"));'), ["moved", "locked", "moved", "absent", "absent"]);
  // two copies in the secret, three in the guess: only two light up
  assert.deepEqual(php('echo json_encode(mark_guess("books","ooooo"));'), ["absent", "locked", "locked", "absent", "absent"]);
  assert.deepEqual(php('echo json_encode(mark_guess("abbey","babes"));'), L.markGuess("abbey", "babes"));
});
test("colours: the PHP and JavaScript versions agree on thousands of random pairs", skip, () => {
  const pairs = [];
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const alpha = "abcdeklmnorst";
  const word = () => Array.from({ length: 5 }, () => alpha[rnd(alpha.length)]).join("");
  for (let i = 0; i < 3000; i++) pairs.push([word(), word()]);
  const got = php('$p=json_decode(file_get_contents("php://stdin"),true); $o=[]; foreach($p as $x) $o[]=mark_guess($x[0],$x[1]); echo json_encode($o);'.replace("file_get_contents(\"php://stdin\")", JSON.stringify(JSON.stringify(pairs))));
  pairs.forEach(([s, g], i) => assert.deepEqual(got[i], L.markGuess(s, g), s + " " + g));
});

/* ---------- the word for a room ---------- */
test("word choice: the same room code, round and salt always give the same word; it varies with each", skip, () => {
  const a = JSON.stringify(W.answers.slice(0, 800));
  const word = (salt, room, round) => php('echo json_encode(frenzy_race_word(' + JSON.stringify(salt) + ',' + JSON.stringify(room) + ',' + round + ',' + a + '));');
  assert.equal(word("salt", "ABCD", 1), word("salt", "ABCD", 1));
  assert.equal(word("salt", "ABCD", 1), word("salt", "abcd", 1), "the code is not case sensitive");
  assert.ok(W.answers.slice(0, 800).includes(word("salt", "ABCD", 1)));
  const rounds = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((r) => word("salt", "ABCD", r)));
  assert.ok(rounds.size >= 5, "different rounds give different words");
  const rooms = new Set(["ABCD", "ABCE", "WXYZ", "HJKM", "NPQR", "STUV", "BCDF", "GHJK"].map((c) => word("salt", c, 1)));
  assert.ok(rooms.size >= 5, "different rooms give different words");
  const salts = new Set(["a", "b", "c", "d", "e", "f"].map((s) => word(s, "ABCD", 1)));
  assert.ok(salts.size >= 4, "the secret salt changes the word, so the public list alone can't give it away");
});
test("word choice: spread across the list, not stuck on a few words", skip, () => {
  const a = JSON.stringify(W.answers);
  const got = php('$o=[]; for($i=1;$i<=500;$i++) $o[]=frenzy_race_word("s","ABCD",$i,' + a + '); echo json_encode($o);');
  assert.ok(new Set(got).size > 400);
});

/* ---------- the endpoint ---------- */
let server, base, store;
test.before(async () => {
  if (!HAVE_PHP) return;
  store = fs.mkdtempSync(path.join(os.tmpdir(), "frenzy-race-"));
  const port = 18000 + Math.floor(Math.random() * 1500);
  server = spawn("php", ["-S", "127.0.0.1:" + port, "-t", ROOT], { env: { ...process.env, FRENZY_TEST: "1", FRENZY_STORAGE: store, FRENZY_RATE_MAX: "100000" }, stdio: "ignore" });
  base = "http://127.0.0.1:" + port + "/api/frenzy-word.php";
  for (let i = 0; i < 60; i++) {
    try { await fetch(base); break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); }
  }
});
test.after(() => { if (server) server.kill(); if (store) fs.rmSync(store, { recursive: true, force: true }); });

const player = (n) => { const pk = crypto.randomBytes(16).toString("hex"); return { pid: "Player" + n + crypto.randomBytes(4).toString("hex"), pk, pkh: crypto.createHash("sha256").update(pk).digest("hex") }; };
async function call(body) {
  const res = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) };
}
let roomSeq = 0;
const ROOMS = "ABCDEFGHJKMNPQRSTUVWXYZ";
const nextRoom = () => { const n = roomSeq++; return ROOMS[n % 23] + ROOMS[(n * 7 + 3) % 23] + ROOMS[(n * 5 + 1) % 23] + "Q"; };
async function newRace(opts) {
  opts = opts || {};
  const room = nextRoom(), P = [player(1), player(2), player(3)];
  const roster = P.map((p) => ({ pid: p.pid, pkh: p.pkh }));
  const start = await call({ op: "race-start", room, round: 1, pid: P[0].pid, pk: P[0].pk, roster, countdownMs: opts.countdownMs == null ? 0 : opts.countdownMs, testWord: opts.word === null ? undefined : (opts.word || "crane"), penalty: opts.penalty, limitMs: opts.limitMs });
  assert.equal(start.status, 200, start.text);
  const g = (p, guess, n, round) => call({ op: "race-guess", room, round: round || 1, pid: p.pid, pk: p.pk, guess, n });
  return { room, P, g, start, all: [start] };
}
const realWord = (room, round) => {
  const salt = fs.readFileSync(path.join(store, "race.salt"), "utf8").trim();
  return php('echo json_encode(frenzy_race_word(' + JSON.stringify(salt) + ',' + JSON.stringify(room) + ',' + round + ',' + JSON.stringify(W.answers) + '));');
};

test("endpoint: no response before the race is over ever contains the secret word", skip, async () => {
  const forced = await newRace({ word: "crane" });
  const real = await newRace({ word: null });
  const secret = realWord(real.room, 1);
  const seen = [forced.start, real.start];
  const send = async (r, body) => { const out = await call(Object.assign({ room: r.room, round: 1 }, body)); seen.push(out); return out; };
  for (const [r, word] of [[forced, "crane"], [real, secret]]) {
    const [a, b, c] = r.P;
    seen.push(await r.g(a, "house", 0));                                    // a wrong guess
    seen.push(await r.g(a, "house", 0));                                    // the same guess again
    seen.push(await r.g(a, "short", 0));                                    // a different guess, same number
    seen.push(await r.g(a, "ab", 1));                                       // too short
    seen.push(await r.g(a, "whore", 1));                                    // a blocked word
    seen.push(await r.g(a, "plumb", 5));                                    // out of turn
    seen.push(await r.g({ pid: a.pid, pk: "00".repeat(16) }, "plumb", 1));  // the wrong key
    seen.push(await r.g({ pid: "Stranger123", pk: a.pk }, "plumb", 0));     // not in the room
    seen.push(await r.g(a, "plumb", 1, 2));                                 // the wrong round
    await send(r, { op: "race-me", pid: a.pid, pk: a.pk });
    await send(r, { op: "race-reveal", pid: a.pid, pk: a.pk });             // not over: refused
    await send(r, { op: "race-end", pid: b.pid, pk: b.pk });                // not the host
    await send(r, { op: "race-me", pid: "nope", pk: "nope" });
    await send(r, { op: "race-bogus", pid: a.pid, pk: a.pk });
    seen.push(await r.g(b, word, 0));                                       // b solves it: the reply still has no word
    seen.push(await r.g(b, word, 1));                                       // after solving
    await send(r, { op: "race-me", pid: b.pid, pk: b.pk });
  }
  assert.ok(seen.length >= 30, "checked " + seen.length + " responses");
  for (const out of seen) {
    /* A player's own guess list can hold the word only because that player typed it and solved the race. Everywhere
       else in a response, the word must never appear. */
    const rest = JSON.stringify(Object.assign({}, out.json, { guesses: undefined })).toLowerCase();
    for (const w of [secret, "crane"]) assert.ok(!rest.includes(w), "a response held the word: " + out.text);
    assert.equal(out.json.word, undefined);
    for (const row of out.json.guesses || []) {
      if (row.g === secret || row.g === "crane") assert.deepEqual(row.m, ["locked", "locked", "locked", "locked", "locked"], "only a solver's own winning guess");
    }
  }
  // the only place the word appears is the reveal, and only once the race is over
  const early = await call({ op: "race-reveal", room: forced.room, round: 1, pid: forced.P[0].pid, pk: forced.P[0].pk });
  assert.equal(early.status, 403); assert.equal(early.json.word, undefined);
  await call({ op: "race-end", room: forced.room, round: 1, pid: forced.P[0].pid, pk: forced.P[0].pk });
  const late = await call({ op: "race-reveal", room: forced.room, round: 1, pid: forced.P[1].pid, pk: forced.P[1].pk });
  assert.equal(late.status, 200); assert.equal(late.json.word, "crane");
});

test("endpoint: marks come from the secret word, solved is reported, and the solve time is recorded", skip, async () => {
  const r = await newRace({ word: "crane" });
  const a = await r.g(r.P[0], "crate", 0);
  assert.deepEqual(a.json.marks, ["locked", "locked", "locked", "absent", "locked"]);
  assert.equal(a.json.solved, false); assert.equal(a.json.n, 1);
  const b = await r.g(r.P[0], "crane", 1);
  assert.equal(b.json.solved, true); assert.equal(b.json.n, 2); assert.equal(typeof b.json.tms, "number");
});
test("endpoint: guesses are rejected after the player has solved or is out of guesses", skip, async () => {
  const r = await newRace({ word: "crane" });
  const [a, b] = r.P;
  assert.equal((await r.g(a, "crane", 0)).json.solved, true);
  const after = await r.g(a, "house", 1);
  assert.equal(after.status, 409); assert.equal(after.json.error, "round over");
  for (const [i, w] of ["house", "music", "stone", "plumb", "bugle", "fjord"].entries()) assert.equal((await r.g(b, w, i)).status, 200, w);
  const seventh = await r.g(b, "zesty", 6);
  assert.equal(seventh.status, 409); assert.equal(seventh.json.error, "round over");
  const me = await call({ op: "race-me", room: r.room, round: 1, pid: b.pid, pk: b.pk });
  assert.equal(me.json.n, 6); assert.equal(me.json.out, true); assert.equal(me.json.solved, false);
});
test("endpoint: sending the same guess number twice is ignored, and never counted twice", skip, async () => {
  const r = await newRace({ word: "crane" });
  const [a] = r.P;
  const first = await r.g(a, "house", 0);
  const again = await r.g(a, "house", 0);
  assert.equal(again.status, 200); assert.equal(again.json.duplicate, true);
  assert.deepEqual(again.json.marks, first.json.marks);
  assert.equal(again.json.n, 1);
  const me = await call({ op: "race-me", room: r.room, round: 1, pid: a.pid, pk: a.pk });
  assert.equal(me.json.n, 1);
  assert.equal((await r.g(a, "music", 0)).status, 409, "a different word under an old number is refused");
  assert.equal((await r.g(a, "house", 1)).status, 409, "the same word under a new number is refused");
  assert.equal((await r.g(a, "music", 1)).json.n, 2);
});
test("endpoint: nobody can guess for another player, and strangers are refused", skip, async () => {
  const r = await newRace({ word: "crane" });
  const [a, b] = r.P;
  const forged = await call({ op: "race-guess", room: r.room, round: 1, pid: a.pid, pk: b.pk, guess: "house", n: 0 });
  assert.equal(forged.status, 403);
  const stranger = player(9);
  assert.equal((await call({ op: "race-guess", room: r.room, round: 1, pid: stranger.pid, pk: stranger.pk, guess: "house", n: 0 })).status, 403);
  assert.equal((await call({ op: "race-me", room: r.room, round: 1, pid: a.pid, pk: "zz" })).status, 403);
  // a stranger can't start over a race in play
  const evil = await call({ op: "race-start", room: r.room, round: 2, pid: stranger.pid, pk: stranger.pk, roster: [{ pid: stranger.pid, pkh: stranger.pkh }] });
  assert.equal(evil.status, 409);
});
test("endpoint: nothing can be guessed before the countdown ends", skip, async () => {
  const r = await newRace({ word: "crane", countdownMs: 3000 });
  const early = await r.g(r.P[0], "house", 0);
  assert.equal(early.status, 409); assert.equal(early.json.error, "not yet");
  assert.ok(r.start.json.goAt - r.start.json.now >= 2900);
});
test("endpoint: the 10 second lockout penalty", skip, async () => {
  const r = await newRace({ word: "crane", penalty: "lockout" });
  assert.equal((await r.g(r.P[0], "house", 0)).status, 200);
  const locked = await r.g(r.P[0], "music", 1);
  assert.equal(locked.status, 409); assert.equal(locked.json.error, "locked out");
  assert.ok(locked.json.wait > 8000 && locked.json.wait <= 10000);
  assert.equal((await r.g(r.P[1], "house", 0)).status, 200, "another player is not locked out");
  const free = await newRace({ word: "crane", penalty: "none" });
  assert.equal((await free.g(free.P[0], "house", 0)).status, 200);
  assert.equal((await free.g(free.P[0], "music", 1)).status, 200);
});
test("endpoint: the race ends when everyone is done, when the host ends it, or when the timer runs out", skip, async () => {
  const ask = (r, p) => call({ op: "race-reveal", room: r.room, round: 1, pid: p.pid, pk: p.pk });
  const all = await newRace({ word: "crane" });
  assert.equal((await ask(all, all.P[0])).status, 403);
  await all.g(all.P[0], "crane", 0); await all.g(all.P[1], "crane", 0);
  assert.equal((await ask(all, all.P[0])).status, 403, "one player is still playing");
  await all.g(all.P[2], "crane", 0);
  const done = await ask(all, all.P[2]);
  assert.equal(done.status, 200); assert.equal(done.json.word, "crane");
  assert.equal(done.json.results.length, 3);
  assert.ok(done.json.results.every((x) => x.solved && x.n === 1));
  const host = await newRace({ word: "crane" });
  assert.equal((await call({ op: "race-end", room: host.room, round: 1, pid: host.P[1].pid, pk: host.P[1].pk })).status, 403);
  assert.equal((await call({ op: "race-end", room: host.room, round: 1, pid: host.P[0].pid, pk: host.P[0].pk })).status, 200);
  assert.equal((await ask(host, host.P[1])).status, 200);
  assert.equal((await host.g(host.P[1], "house", 0)).status, 409, "no guesses once the race is over");
  const timed = await newRace({ word: "crane", limitMs: 600 });
  assert.equal((await timed.g(timed.P[0], "house", 0)).status, 200);
  await new Promise((r) => setTimeout(r, 800));
  assert.equal((await timed.g(timed.P[0], "music", 1)).status, 409);
  const me = await call({ op: "race-me", room: timed.room, round: 1, pid: timed.P[1].pid, pk: timed.P[1].pk });
  assert.equal(me.json.out, true, "a player still playing when time runs out counts as out");
  assert.equal((await ask(timed, timed.P[1])).status, 200);
});
test("endpoint: round numbers matter, and the next round has its own word and board", skip, async () => {
  const r = await newRace({ word: null });
  const [a] = r.P;
  const roster = r.P.map((p) => ({ pid: p.pid, pkh: p.pkh }));
  await call({ op: "race-end", room: r.room, round: 1, pid: a.pid, pk: a.pk });
  const next = await call({ op: "race-start", room: r.room, round: 2, pid: a.pid, pk: a.pk, roster, countdownMs: 0 });
  assert.equal(next.status, 200); assert.equal(next.json.round, 2);
  assert.equal((await r.g(a, "house", 0, 1)).status, 404, "round 1 is gone");
  const w1 = realWord(r.room, 1), w2 = realWord(r.room, 2);
  const out = await r.g(a, w2, 0, 2);
  assert.equal(out.json.solved, true, "round 2 plays the word for round 2");
  assert.ok(!out.text.includes(w2));
  assert.ok(w1.length === 5);
});
test("endpoint: bad requests are refused cleanly", skip, async () => {
  const room = nextRoom();
  assert.equal((await call({ op: "race-start", room: "x", round: 1 })).status, 400);
  assert.equal((await call({ op: "race-start", room, round: 0, pid: "abcdefgh", pk: "a".repeat(32) })).status, 400);
  assert.equal((await call({ op: "race-start", room, round: 1, pid: "abcdefgh", pk: "nothex", roster: [] })).status, 400);
  assert.equal((await call({ op: "race-guess", room, round: 1, pid: "abcdefgh", pk: "a".repeat(32), guess: "house", n: 0 })).status, 404);
  for (const bad of [{ roster: "no" }, { roster: [{ pid: "abcdefgh", pkh: "short" }] }]) {
    const p = player(1);
    const out = await call(Object.assign({ op: "race-start", room, round: 1, pid: p.pid, pk: p.pk }, bad));
    assert.equal(out.status, 400);
  }
});
