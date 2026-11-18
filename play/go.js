/* Join by code: looks up which game a room is running and sends the player there.
   Every game writes its room to rooms/CODE/meta with a "kind". Signed-in players may read meta (see database.rules.json). */
var ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
var PAGES = {
  "nhie": "../games/never-have-i-ever.html",
  "vt": "../games/vault-traitor.html",
  "sd": "slow-drip.html",
  "ql": "../games/punchline-duel.html",
  "ml": "../games/odd-word-out.html",
  "fl": "../games/five-letter-frenzy.html",
  "hc": "hot-take-court.html",
  "cc": "category-countdown.html",
  "kings-cup": "../games/kings-cup.html",
  "split": "../games/split-decision.html",
  "story-chain": "story-chain.html",
  "card-lottery": "card-lottery.html",
  "two-truths": "two-truths.html",
  "sketchy-guess": "sketchy-guess.html",
  "rule-maker": "rule-maker.html",
  "hot-take-court": "hot-take-court.html",
  "category-countdown": "category-countdown.html"
};
var $ = function (id) { return document.getElementById(id) };
function normCode(v) {
  var s = String(v || ""), m = s.match(/(?:room|code)=([A-Za-z]{4})/i);
  if (m) return m[1].toUpperCase();
  return s.toUpperCase().replace(/[^ABCDEFGHJKMNPQRSTUVWXYZ]/g, "").slice(0, 4);
}
function validCode(c) { return /^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(c) }
function say(text, err) { var m = $("gomsg"); m.textContent = text; m.classList.toggle("err", !!err) }
var EMU = /[?&]emulator=1(?:&|$)/.test(location.search);

var dbReady = null;
function connect() {
  if (dbReady) return dbReady;
  dbReady = (async function () {
    var base = "https://www.gstatic.com/firebasejs/12.4.0/";
    var appMod = await import(base + "firebase-app.js");
    var authMod = await import(base + "firebase-auth.js");
    var dbMod = await import(base + "firebase-database.js");
    var cfg = await import("../firebase-config.js?v=17");
    var app = appMod.initializeApp(cfg.firebaseConfig);
    var auth = authMod.getAuth(app), db = dbMod.getDatabase(app);
    if (EMU) { authMod.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true }); dbMod.connectDatabaseEmulator(db, "127.0.0.1", 9000) }
    if (auth.authStateReady) await auth.authStateReady();
    if (!auth.currentUser) await authMod.signInAnonymously(auth);
    return { db: db, ref: dbMod.ref, get: dbMod.get };
  })();
  dbReady.catch(function () { dbReady = null });
  return dbReady;
}

async function go(code) {
  if (!validCode(code)) { say("Enter the 4-letter code from the host's screen.", true); return }
  $("gocode").value = code;
  say("Finding room " + code + "…");
  try {
    var f = await connect();
    var snap = await f.get(f.ref(f.db, "rooms/" + code + "/meta"));
    var meta = snap.exists() ? snap.val() : null;
    if (!meta) { say("No room called " + code + ". Check the code with the host.", true); return }
    var page = PAGES[meta.kind];
    if (!page) { say("That room is running a game this page doesn't know yet. Ask the host which game it is.", true); return }
    var url = page + "?room=" + code + (EMU ? "&emulator=1" : "");
    location.replace(url);
  } catch (e) {
    console.error(e);
    say("Couldn't reach the game server. Check your connection and try again.", true);
  }
}

$("goform").addEventListener("submit", function (e) { e.preventDefault(); go(normCode($("gocode").value)) });
var first = normCode((location.search.match(/[?&](?:room|code)=([^&]*)/i) || [])[1] || "");
if (first) go(first); else $("gocode").focus();
if (EMU) window.__tpGo = { pages: PAGES, normCode: normCode };
