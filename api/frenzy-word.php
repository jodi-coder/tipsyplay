<?php
/* Five Letter Frenzy word keeper. PHP 7.4+ , no Composer, no database, no Firebase.
   The word is chosen here and stored OUTSIDE the web root, in a frenzy-rooms
   folder next to public_html (or FRENZY_STORAGE, if that is set). Phones send a
   room code and a guess. This script returns colored marks only. The word itself
   is returned only after the round is solved, six guesses are used, or the host
   ends the round.

   On Hostinger the site lives in public_html, so the default folder is
   /home/<user>/domains/tipsyplay.com/frenzy-rooms. private/ is only a backup
   deny rule. This script never writes the word under the web root, and it never
   uses the system temp directory.

   Needs Jeff to check in hPanel if anything below is missing:
   - PHP 7.4 or newer, with the json extension (standard).
   - The account can create a folder next to public_html. If the first Start says
     "Word storage is not available.", create that folder by hand (outside
     public_html) and make it writable by PHP, or set FRENZY_STORAGE to another
     path that is also outside public_html.
   - The openssl extension, so results can be signed. Without it the script still
     runs, but phones cannot check that the marks were really produced here.
   - Apache AllowOverride and mod_rewrite, so the root .htaccess can forbid /private/.
   - Do not set FRENZY_TEST on the live site. It exists only so local tests can
     ask for a known word.

   The signing key is created on first use inside the storage folder. Do not
   commit that file and do not put a Firebase service account on this server. */
require_once __DIR__ . "/frenzy-lib.php";
ini_set("display_errors", "0");
header("Content-Type: application/json; charset=utf-8");
header("Cache-Control: no-store");
header("X-Content-Type-Options: nosniff");

if ($_SERVER["REQUEST_METHOD"] === "GET") {
    $op = isset($_GET["op"]) ? $_GET["op"] : "";
    if ($op === "pubkey") {
        $pub = public_key_pem();
        echo json_encode(array("ok" => $pub !== "", "pem" => $pub));
        exit;
    }
    http_response_code(405);
    echo json_encode(array("ok" => false, "error" => "POST only"));
    exit;
}
if ($_SERVER["REQUEST_METHOD"] !== "POST") {
    http_response_code(405);
    echo json_encode(array("ok" => false, "error" => "POST only"));
    exit;
}

$raw = file_get_contents("php://input");
$req = json_decode($raw, true);
if (!is_array($req)) $req = array();
$op = isset($req["op"]) ? (string) $req["op"] : "";
$room = isset($req["room"]) ? strtoupper((string) $req["room"]) : "";
$token = isset($req["token"]) ? (string) $req["token"] : "";

if (!preg_match('/^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/', $room)) {
    fail(400, "bad room");
}

$ip = client_ip();
$isRace = strpos($op, "race-") === 0;
if ($isRace) {
    if (!rate_ok("race-ip-" . sha1($ip), 240) || !rate_ok("race-room-" . $room, 400)) fail(429, "slow down");
} else if (!rate_ok("ip-" . sha1($ip)) || !rate_ok("room-" . $room)) {
    fail(429, "slow down");
}

cleanup_old();

if ($isRace) {
    echo json_encode(race_route($op, $room, $req));
    exit;
}

if ($op === "start") {
    $testWord = "";
    if (getenv("FRENZY_TEST") === "1" && isset($req["testWord"])) {
        $testWord = strtolower((string) $req["testWord"]);
    }
    $out = start_round($room, $token, $testWord);
    echo json_encode($out);
    exit;
}

if ($op !== "beat" && $op !== "guess" && $op !== "end" && $op !== "reveal") {
    fail(400, "bad op");
}
$guess = isset($req["guess"]) ? (string) $req["guess"] : "";
$n = isset($req["n"]) ? (int) $req["n"] : -1;
$out = with_state($room, function ($state) use ($op, $token, $guess, $n) {
    if ($state === null || !isset($state["token"]) || !hash_equals((string) $state["token"], $token)) {
        http_response_code(403);
        return array("out" => array("ok" => false, "error" => "bad token"));
    }
    if ($op === "beat") {
        $state["seen"] = time();
        return array("state" => $state, "out" => array("ok" => true));
    }
    if ($op === "guess") return take_guess($state, $guess, $n);
    if ($op === "end") {
        $state["ended"] = true;
        $state["seen"] = time();
        return array("state" => $state, "out" => reveal_body($state, true));
    }
    if (!round_open_for_reveal($state)) {
        http_response_code(403);
        return array("out" => array("ok" => false, "error" => "not yet"));
    }
    return array("out" => reveal_body($state, true));
});
echo json_encode($out);
exit;

function fail($code, $error) {
    http_response_code($code);
    echo json_encode(array("ok" => false, "error" => $error));
    exit;
}
function client_ip() {
    if (!empty($_SERVER["REMOTE_ADDR"])) return (string) $_SERVER["REMOTE_ADDR"];
    return "0";
}
function storage_dir() {
    static $dir = null;
    if ($dir !== null) return $dir;
    $env = getenv("FRENZY_STORAGE");
    if (is_string($env) && $env !== "") $chosen = $env;
    else $chosen = dirname(__DIR__, 2) . "/frenzy-rooms";
    if (!is_dir($chosen)) {
        if (!@mkdir($chosen, 0700, true) && !is_dir($chosen)) {
            error_log("frenzy-word: cannot create storage at " . $chosen);
            fail(500, "Word storage is not available.");
        }
    }
    if (!is_writable($chosen)) {
        error_log("frenzy-word: storage is not writable at " . $chosen);
        fail(500, "Word storage is not available.");
    }
    $dir = $chosen;
    return $dir;
}
function rate_max() {
    $n = getenv("FRENZY_RATE_MAX");
    if ($n !== false && (int) $n > 0) return (int) $n;
    return 60;
}
function rate_ok($key, $max = null) {
    $path = storage_dir() . "/rl-" . preg_replace('/[^a-z0-9-]/', "", $key) . ".json";
    $now = time();
    $fh = fopen($path, "c+");
    if (!$fh) {
        error_log("frenzy-word: rate limit file is not writable at " . $path);
        fail(500, "Word storage is not available.");
    }
    flock($fh, LOCK_EX);
    $raw = stream_get_contents($fh);
    $hits = json_decode($raw, true);
    if (!is_array($hits)) $hits = array();
    $keep = array();
    foreach ($hits as $t) { if ($now - (int) $t < 60) $keep[] = (int) $t; }
    $ok = count($keep) < ($max === null ? rate_max() : $max);
    if ($ok) $keep[] = $now;
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($keep));
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);
    return $ok;
}
function cleanup_old() {
    $dir = storage_dir();
    $cut = time() - 8 * 3600;
    foreach (glob($dir . "/*.json") as $file) {
        if (strpos(basename($file), "rl-") === 0) {
            if (filemtime($file) < $cut) @unlink($file);
            continue;
        }
        $raw = @file_get_contents($file);
        $state = json_decode($raw, true);
        $seen = is_array($state) && isset($state["seen"]) ? (int) $state["seen"] : filemtime($file);
        if ($seen < $cut) @unlink($file);
    }
}
function room_path($room, $suffix = "") {
    return storage_dir() . "/" . $room . $suffix . ".json";
}
function load_state($room) {
    $path = room_path($room);
    if (!is_file($path)) return null;
    $state = json_decode(file_get_contents($path), true);
    return is_array($state) ? $state : null;
}
function save_state($room, $state) {
    $path = room_path($room);
    $fh = fopen($path, "c+");
    if (!$fh) fail(500, "storage");
    flock($fh, LOCK_EX);
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($state));
    fflush($fh);
    flock($fh, LOCK_UN);
    fclose($fh);
    @chmod($path, 0600);
}
function with_state($room, $fn, $suffix = "") {
    $path = room_path($room, $suffix);
    $fh = fopen($path, "c+");
    if (!$fh) fail(500, "storage");
    flock($fh, LOCK_EX);
    $raw = stream_get_contents($fh);
    $state = json_decode($raw, true);
    if (!is_array($state)) $state = null;
    $result = $fn($state);
    if (isset($result["state"])) {
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, json_encode($result["state"]));
        fflush($fh);
    }
    flock($fh, LOCK_UN);
    fclose($fh);
    @chmod($path, 0600);
    return $result["out"];
}
function load_lists() {
    static $lists = null;
    if ($lists !== null) return $lists;
    $src = file_get_contents(dirname(__DIR__) . "/data/frenzy-words.js");
    $start = strpos($src, "var data=");
    $end = strpos($src, "};", $start === false ? 0 : $start);
    if ($start === false || $end === false) fail(500, "word list");
    $json = substr($src, $start + 9, $end - ($start + 9) + 1);
    $json = str_replace(array("{answers:", ",guesses:", ",blocked:"), array('{"answers":', ',"guesses":', ',"blocked":'), $json);
    $data = json_decode($json, true);
    if (!is_array($data) || empty($data["answers"]) || empty($data["guesses"])) fail(500, "word list");
    $guesses = array();
    foreach ($data["guesses"] as $w) $guesses[$w] = 1;
    foreach ($data["answers"] as $w) $guesses[$w] = 1;
    $blocked = array();
    if (!empty($data["blocked"])) foreach ($data["blocked"] as $w) $blocked[$w] = 1;
    $lists = array("answers" => array_values($data["answers"]), "guesses" => $guesses, "blocked" => $blocked);
    return $lists;
}
function pick_word($testWord) {
    $lists = load_lists();
    if ($testWord !== "" && isset($lists["guesses"][$testWord]) && in_array($testWord, $lists["answers"], true)) return $testWord;
    $answers = $lists["answers"];
    $i = random_int(0, count($answers) - 1);
    return $answers[$i];
}
function round_open_for_reveal($state) {
    return !empty($state["solved"]) || !empty($state["exhausted"]) || !empty($state["ended"]);
}
function signing_key() {
    $path = storage_dir() . "/sign.pem";
    if (!function_exists("openssl_pkey_new")) return null;
    $fh = fopen($path, "c+");
    if (!$fh) {
        error_log("frenzy-word: cannot open signing key at " . $path);
        return null;
    }
    flock($fh, LOCK_EX);
    $pem = stream_get_contents($fh);
    if (!is_string($pem) || strpos($pem, "PRIVATE KEY") === false) {
        $res = openssl_pkey_new(array("private_key_bits" => 2048, "private_key_type" => OPENSSL_KEYTYPE_RSA));
        $pem = "";
        if ($res) openssl_pkey_export($res, $pem);
        if ($pem === "") {
            flock($fh, LOCK_UN);
            fclose($fh);
            return null;
        }
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, $pem);
        fflush($fh);
        @chmod($path, 0600);
    }
    flock($fh, LOCK_UN);
    fclose($fh);
    $key = openssl_pkey_get_private($pem);
    return $key ? $key : null;
}
function public_key_pem() {
    $key = signing_key();
    if (!$key) return "";
    $details = openssl_pkey_get_details($key);
    return isset($details["key"]) ? $details["key"] : "";
}
function sign_text($text) {
    $key = signing_key();
    if (!$key) return "";
    $sig = "";
    if (!openssl_sign($text, $sig, $key, OPENSSL_ALGO_SHA256)) return "";
    return base64_encode($sig);
}
function seal($state, $guess, $marks, $includeWord) {
    $word = ($includeWord && round_open_for_reveal($state)) ? $state["word"] : "";
    $text = $state["room"] . "|" . count($state["guesses"]) . "|" . $guess . "|" . implode(",", $marks) . "|" . (!empty($state["solved"]) ? "1" : "0") . "|" . (round_open_for_reveal($state) ? "1" : "0") . "|" . $word;
    return array("text" => $text, "sig" => sign_text($text), "word" => $word);
}
function reveal_body($state, $includeWord) {
    $seal = seal($state, "", array(), $includeWord);
    $body = array(
        "ok" => true,
        "ended" => round_open_for_reveal($state),
        "solved" => !empty($state["solved"]),
        "n" => count($state["guesses"]),
        "seal" => $seal["text"],
        "sig" => $seal["sig"]
    );
    if ($includeWord && $seal["word"] !== "") $body["word"] = $seal["word"];
    return $body;
}
function start_round($room, $token, $testWord) {
    return with_state($room, function ($state) use ($room, $token, $testWord) {
        $now = time();
        $idle = 120;
        $open = is_array($state) && isset($state["token"]) && is_string($state["token"]) && $state["token"] !== "";
        /* No token: only a missing round, a finished round, or 2 minutes of silence. */
        $noTokenOk = !$open
            || round_open_for_reveal($state)
            || ($now - (int) $state["seen"] >= $idle);
        $tokenOk = $open && $token !== "" && strlen($token) === strlen($state["token"]) && hash_equals($state["token"], $token);
        if (!$noTokenOk && !$tokenOk) {
            http_response_code(409);
            return array("out" => array("ok" => false, "error" => "round in play"));
        }
        $word = pick_word($testWord);
        $next = array(
            "room" => $room,
            "word" => $word,
            "token" => bin2hex(random_bytes(16)),
            "guesses" => array(),
            "solved" => false,
            "exhausted" => false,
            "ended" => false,
            "seen" => $now,
            "created" => $now
        );
        return array("state" => $next, "out" => array("ok" => true, "token" => $next["token"], "n" => 0));
    });
}
function take_guess($state, $guess, $n) {
    $guess = strtolower(preg_replace('/[^a-z]/', "", $guess));
    if (strlen($guess) !== 5) fail(400, "Use exactly 5 letters.");
    $lists = load_lists();
    /* Any five letters are a fair guess. Only blocked words (slurs, crude words) are refused. */
    if (isset($lists["blocked"][$guess])) fail(400, "Not a word we accept. Try another one.");
    if ($n !== count($state["guesses"])) fail(409, "out of turn");
    if (count($state["guesses"]) >= 6 || !empty($state["exhausted"]) || !empty($state["ended"])) fail(409, "round over");
    foreach ($state["guesses"] as $prev) {
        if ($prev["guess"] === $guess) fail(409, "Already guessed.");
    }
    $marks = mark_guess($state["word"], $guess);
    $solved = $marks === array("locked", "locked", "locked", "locked", "locked");
    $state["guesses"][] = array("guess" => $guess, "marks" => $marks);
    if ($solved) $state["solved"] = true;
    if (count($state["guesses"]) >= 6) $state["exhausted"] = true;
    $state["seen"] = time();
    /* The guess response never includes the word. The host asks to reveal only
       when the round is ready to show it to the whole table. */
    $seal = seal($state, $guess, $marks, false);
    return array("state" => $state, "out" => array(
        "ok" => true,
        "marks" => $marks,
        "solved" => $solved,
        "n" => count($state["guesses"]),
        "ended" => round_open_for_reveal($state),
        "seal" => $seal["text"],
        "sig" => $seal["sig"]
    ));
}

/* ---------------- Race mode ----------------
   Every player races the same word on their own board. The word is never stored: it is recomputed from the room
   code, the round and a server-side salt (frenzy_race_word). Only race-reveal ever returns it, and only once the
   race is over. The state kept here holds guesses, colours and times, nothing that could give the word away. */
function race_salt() {
    $path = storage_dir() . "/race.salt";
    $fh = fopen($path, "c+");
    if (!$fh) fail(500, "Word storage is not available.");
    flock($fh, LOCK_EX);
    $salt = trim((string) stream_get_contents($fh));
    if (strlen($salt) < 32) {
        $salt = bin2hex(random_bytes(32));
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, $salt);
        fflush($fh);
        @chmod($path, 0600);
    }
    flock($fh, LOCK_UN);
    fclose($fh);
    return $salt;
}
function race_word($race) {
    if (!empty($race["forced"])) return $race["forced"];
    $lists = load_lists();
    return frenzy_race_word(race_salt(), $race["room"], $race["round"], $lists["answers"]);
}
function now_ms() {
    return (int) floor(microtime(true) * 1000);
}
function race_err($code, $error, $extra = array()) {
    http_response_code($code);
    return array("out" => array_merge(array("ok" => false, "error" => $error), $extra));
}
/* Who is calling: a player of this race, proven by the secret key whose hash the host registered. */
function race_caller($race, $req) {
    $pid = isset($req["pid"]) ? $req["pid"] : "";
    $pk = isset($req["pk"]) ? $req["pk"] : "";
    if (!frenzy_pid_ok($pid) || !frenzy_pk_ok($pk) || !isset($race["roster"][$pid])) return "";
    return hash_equals((string) $race["roster"][$pid], frenzy_pkh($pk)) ? $pid : "";
}
function race_route($op, $room, $req) {
    $round = isset($req["round"]) ? (int) $req["round"] : 0;
    if ($round < 1 || $round > 99) fail(400, "bad round");
    if ($op === "race-start") {
        return with_state($room, function ($state) use ($room, $round, $req) { return race_start($state, $room, $round, $req); }, "-race");
    }
    if ($op !== "race-guess" && $op !== "race-me" && $op !== "race-end" && $op !== "race-reveal") fail(400, "bad op");
    return with_state($room, function ($race) use ($op, $round, $req) {
        if ($race === null || (int) $race["round"] !== $round) return race_err(404, "no such race");
        $pid = race_caller($race, $req);
        if ($pid === "") return race_err(403, "bad key");
        $now = now_ms();
        $race["seen"] = time();
        if ($op === "race-me") {
            $me = frenzy_me($race, $pid, $now);
            return array("state" => $race, "out" => array_merge(array("ok" => true, "goAt" => $race["goAt"], "now" => $now, "penalty" => $race["penalty"], "limit" => $race["limit"] / 1000), $me));
        }
        if ($op === "race-end") {
            if ($pid !== $race["host"]) return race_err(403, "host only");
            $race["ended"] = true;
            return array("state" => $race, "out" => array("ok" => true, "ended" => true));
        }
        if ($op === "race-reveal") {
            if (!frenzy_race_over($race, $now)) return race_err(403, "not yet");
            return array("state" => $race, "out" => array("ok" => true, "word" => race_word($race), "results" => frenzy_summary($race, $now)));
        }
        return race_guess($race, $pid, $now, isset($req["guess"]) ? (string) $req["guess"] : "", isset($req["n"]) ? (int) $req["n"] : -1);
    }, "-race");
}
function race_start($state, $room, $round, $req) {
    $pid = isset($req["pid"]) ? $req["pid"] : "";
    $pk = isset($req["pk"]) ? $req["pk"] : "";
    $list = isset($req["roster"]) && is_array($req["roster"]) ? $req["roster"] : array();
    if (!frenzy_pid_ok($pid) || !frenzy_pk_ok($pk)) return race_err(400, "bad key");
    if (count($list) < 1 || count($list) > 8) return race_err(400, "bad roster");
    $roster = array();
    foreach ($list as $row) {
        if (!is_array($row) || !isset($row["pid"]) || !isset($row["pkh"]) || !frenzy_pid_ok($row["pid"]) || !is_string($row["pkh"]) || !preg_match('/^[a-f0-9]{64}$/', $row["pkh"])) return race_err(400, "bad roster");
        $roster[$row["pid"]] = $row["pkh"];
    }
    if (!isset($roster[$pid]) || !hash_equals($roster[$pid], frenzy_pkh($pk))) return race_err(403, "bad key");
    $now = time();
    $nowMs = now_ms();
    if (is_array($state) && isset($state["host"])) {
        $over = frenzy_race_over($state, $nowMs);
        $idle = $now - (int) $state["seen"] >= 120;
        /* Only the host of this room may start the next round. A stranger can only take over a room that has gone quiet. */
        if ($state["host"] !== $pid && !$idle && !$over) return race_err(409, "race in play");
        if ($state["host"] === $pid && $round <= (int) $state["round"] && $nowMs >= $state["goAt"] && !$over) return race_err(409, "race in play");
    }
    $limit = isset($req["limit"]) ? (int) $req["limit"] : 0;
    if (!in_array($limit, array(0, 120, 180, 300), true)) $limit = 0;
    $penalty = isset($req["penalty"]) ? (string) $req["penalty"] : "none";
    if (!in_array($penalty, array("none", "lockout", "drink"), true)) $penalty = "none";
    $countdown = 3000;
    $race = null;
    /* Only when the server is run for tests (FRENZY_TEST=1): a known word, a short countdown, a short timer. */
    $test = getenv("FRENZY_TEST") === "1";
    if ($test && isset($req["countdownMs"])) $countdown = max(0, min(3000, (int) $req["countdownMs"]));
    race_salt(); /* made now, so a storage problem shows when the race starts, not halfway through it */
    $race = frenzy_new_race($room, $round, $pid, $roster, $nowMs + $countdown, $limit, $penalty, $now);
    if ($test && isset($req["limitMs"])) $race["limit"] = max(0, (int) $req["limitMs"]);
    if ($test && isset($req["testWord"])) {
        $w = strtolower((string) $req["testWord"]);
        $lists = load_lists();
        if (in_array($w, $lists["answers"], true)) $race["forced"] = $w;
    }
    return array("state" => $race, "out" => array("ok" => true, "round" => $round, "goAt" => $race["goAt"], "now" => $nowMs, "limit" => $race["limit"] / 1000, "penalty" => $penalty));
}
function race_guess($race, $pid, $now, $guess, $n) {
    $guess = strtolower(preg_replace('/[^a-z]/', "", $guess));
    if (strlen($guess) !== 5) return race_err(400, "Use exactly 5 letters.");
    $lists = load_lists();
    if (isset($lists["blocked"][$guess])) return race_err(400, "Not a word we accept. Try another one.");
    if ($now < $race["goAt"] - 700) return race_err(409, "not yet");
    $p = $race["players"][$pid];
    $count = count($p["guesses"]);
    /* The same guess number sent twice is answered again, never counted twice. */
    if ($n >= 0 && $n < $count) {
        $prev = $p["guesses"][$n];
        if ($prev["guess"] === $guess) {
            return array("out" => array("ok" => true, "duplicate" => true, "marks" => $prev["marks"], "solved" => $prev["marks"] === array("locked", "locked", "locked", "locked", "locked"), "n" => $count, "out" => !$p["solved"] && $count >= 6));
        }
        return race_err(409, "out of turn");
    }
    if (!empty($p["solved"]) || $count >= 6 || frenzy_race_over($race, $now)) return race_err(409, "round over", array("n" => $count));
    if ($n !== $count) return race_err(409, "out of turn");
    foreach ($p["guesses"] as $prev) if ($prev["guess"] === $guess) return race_err(409, "Already guessed.");
    if ($race["penalty"] === "lockout" && $count > 0 && $now - $p["last"] < 10000) {
        return race_err(409, "locked out", array("wait" => 10000 - ($now - $p["last"])));
    }
    $marks = mark_guess(race_word($race), $guess);
    $solved = $marks === array("locked", "locked", "locked", "locked", "locked");
    $p["guesses"][] = array("guess" => $guess, "marks" => $marks);
    $p["last"] = $now;
    if ($solved) {
        $p["solved"] = true;
        $p["tms"] = max(0, $now - $race["goAt"]);
    }
    $race["players"][$pid] = $p;
    return array("state" => $race, "out" => array("ok" => true, "marks" => $marks, "solved" => $solved, "n" => count($p["guesses"]), "out" => !$solved && count($p["guesses"]) >= 6, "tms" => $p["tms"], "penalty" => $race["penalty"]));
}
