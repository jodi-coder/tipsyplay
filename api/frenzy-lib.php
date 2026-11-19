<?php
/* Shared Five Letter Frenzy functions. Pure: no storage, no output. The word server (frenzy-word.php) and the
   tests both load this file, so they use exactly the same logic. */

/* Colours for a guess. Locked letters are counted first; a repeated letter only marks "moved" for the copies
   still left in the secret. Both arguments are lower-case, 5 letters. */
function mark_guess($secret, $guess) {
    $marks = array("absent", "absent", "absent", "absent", "absent");
    $spare = array();
    for ($i = 0; $i < 5; $i++) {
        if ($guess[$i] === $secret[$i]) $marks[$i] = "locked";
        else {
            $ch = $secret[$i];
            if (!isset($spare[$ch])) $spare[$ch] = 0;
            $spare[$ch]++;
        }
    }
    for ($i = 0; $i < 5; $i++) {
        if ($marks[$i] === "locked") continue;
        $ch = $guess[$i];
        if (!empty($spare[$ch])) {
            $marks[$i] = "moved";
            $spare[$ch]--;
        }
    }
    return $marks;
}

/* The word for one race. The same room code, round and salt always give the same word. The salt stays on the
   server, so a player who has the public word list still can't work out a room's word from its code. Nothing
   stores the word: it is recomputed whenever it is needed. */
function frenzy_race_word($salt, $room, $round, $answers) {
    $n = count($answers);
    if ($n < 1) return "";
    $digest = hash_hmac("sha256", "frenzy-race|" . strtoupper((string) $room) . "|" . (int) $round, (string) $salt, true);
    $x = unpack("N", substr($digest, 0, 4));
    return $answers[$x[1] % $n];
}

/* A player proves who they are with a secret key. The host registers only its hash, taken from the player's own
   public entry in the room, so the server never needs the raw key until the player uses it. */
function frenzy_pkh($pk) {
    return hash("sha256", (string) $pk);
}
function frenzy_pid_ok($pid) {
    return is_string($pid) && preg_match('/^[A-Za-z0-9]{6,40}$/', $pid) === 1;
}
function frenzy_pk_ok($pk) {
    return is_string($pk) && preg_match('/^[a-f0-9]{16,64}$/', $pk) === 1;
}

/* The state of one race, with no word in it. $players is keyed by pid. */
function frenzy_new_race($room, $round, $hostPid, $roster, $goAtMs, $limitSec, $penalty, $nowSec) {
    $players = array();
    foreach ($roster as $pid => $pkh) $players[$pid] = array("guesses" => array(), "solved" => false, "tms" => null, "last" => 0);
    return array(
        "room" => $room, "round" => (int) $round, "host" => $hostPid, "roster" => $roster, "players" => $players,
        "goAt" => (int) $goAtMs, "limit" => (int) $limitSec * 1000, "penalty" => $penalty,
        "ended" => false, "seen" => $nowSec, "created" => $nowSec
    );
}
function frenzy_player_done($p) {
    return !empty($p["solved"]) || count($p["guesses"]) >= 6;
}
/* A race is over when the host ended it, the time ran out, or every player has solved or used all six guesses. */
function frenzy_race_over($race, $nowMs) {
    if (!empty($race["ended"])) return true;
    if ($race["limit"] > 0 && $nowMs >= $race["goAt"] + $race["limit"]) return true;
    foreach ($race["players"] as $p) if (!frenzy_player_done($p)) return false;
    return true;
}
/* The player's own state, as it is safe to show them. Never the word. */
function frenzy_me($race, $pid, $nowMs) {
    $p = $race["players"][$pid];
    $out = !$p["solved"] && (count($p["guesses"]) >= 6 || frenzy_race_over($race, $nowMs));
    $rows = array();
    foreach ($p["guesses"] as $g) $rows[] = array("g" => $g["guess"], "m" => $g["marks"]);
    return array("n" => count($p["guesses"]), "solved" => !empty($p["solved"]), "out" => $out, "guesses" => $rows, "tms" => $p["tms"]);
}
/* What every player did, for the results screen: guess counts and solve times only. */
function frenzy_summary($race, $nowMs) {
    $out = array();
    foreach ($race["players"] as $pid => $p) {
        $out[] = array("pid" => $pid, "n" => count($p["guesses"]), "solved" => !empty($p["solved"]), "tms" => $p["tms"]);
    }
    return $out;
}
