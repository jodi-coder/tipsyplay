/* Mole rules, with no UI and no Firebase.
   The host's phone runs a game through these functions. Tests load the same file in Node.
   Everything here is deterministic apart from the random source, which callers can replace in tests.

   The game: every round, all but one player see a secret word; the mole sees only the category.
   Everyone gives a one-word clue out loud, then votes in secret for who the mole is.
   If the group catches the mole, the mole still gets one guess at the word to steal the round.
   A fresh mole is drawn each round so everyone takes a turn. */
(function(root){
"use strict";

var MIN_PLAYERS=4, MAX_PLAYERS=10, NAME_MAX=12;
var MIN_ROUNDS=3, MAX_ROUNDS=15;

/* ---------- randomness ---------- */
function cryptoObj(){
  if(typeof globalThis!=="undefined"&&globalThis.crypto&&globalThis.crypto.getRandomValues) return globalThis.crypto;
  throw new Error("crypto.getRandomValues is not available");
}
function cryptoU32(){var a=new Uint32Array(1); cryptoObj().getRandomValues(a); return a[0]}
function randomInt(n, u32Source){
  var src=u32Source||cryptoU32;
  if(n<=1) return 0;
  var limit=Math.floor(4294967296/n)*n;
  for(;;){var x=src(); if(x<limit) return x%n}
}
function shuffle(arr, u32Source){
  var list=arr.slice(), i, j, t;
  for(i=list.length-1;i>0;i--){j=randomInt(i+1, u32Source); t=list[i]; list[i]=list[j]; list[j]=t}
  return list;
}

/* ---------- names ---------- */
function cleanName(raw){return String(raw||"").replace(/[<>]/g,"").replace(/\s+/g," ").trim()}
function nameError(name, others){
  var n=cleanName(name);
  if(!n) return "Add your name first.";
  if(n.length>NAME_MAX) return "Names can be up to "+NAME_MAX+" characters.";
  var low=n.toLowerCase();
  if((others||[]).some(function(o){return cleanName(o).toLowerCase()===low})) return "Someone already has that name. Try another.";
  return "";
}
function clampRounds(r){
  r=Math.round(Number(r)||0);
  if(r<MIN_ROUNDS) return MIN_ROUNDS;
  if(r>MAX_ROUNDS) return MAX_ROUNDS;
  return r;
}

/* ---------- rounds ----------
   Each round draws a word from a shuffled deck and a mole that walks the shuffled player list,
   so every player is the mole a near-equal number of times and never twice in a row when it can be helped. */
function makeRounds(uids, rounds, deckLen, rng){
  rng=rng||{};
  var people=shuffle(uids, rng.u32);
  var deck=[], i;
  for(i=0;i<deckLen;i++) deck.push(i);
  deck=shuffle(deck, rng.u32);
  var out=[];
  for(i=0;i<rounds;i++){
    out.push({word:deck[i%deck.length], mole:people[i%people.length]});
  }
  return out;
}

/* ---------- votes ----------
   ballots: {voterUid: targetUid}. A majority is more than half of the active players. */
function tally(ballots, active){
  var counts={}, best=null, bestN=0, i;
  Object.keys(ballots||{}).forEach(function(v){
    var t=ballots[v];
    if(active.indexOf(v)<0||active.indexOf(t)<0||t===v) return;
    counts[t]=(counts[t]||0)+1;
  });
  Object.keys(counts).forEach(function(t){if(counts[t]>bestN){bestN=counts[t]; best=t}});
  var tiedTop=Object.keys(counts).filter(function(t){return counts[t]===bestN});
  var majority=bestN>0&&bestN*2>active.length&&tiedTop.length===1;
  return {counts:counts, target:majority?best:null, votes:bestN, majority:majority};
}

/* ---------- drinks ----------
   One drink per round, no stacking. The losing side drinks.
   mole not caught, or caught but steals the word: the group (everyone but the mole) drinks.
   mole caught and fails the steal: the mole drinks. */
function amountLabel(setting){return setting==="shots"?"one shot":"one drink"}
function roundDrinks(outcome, g, setting){
  var m=current(g), group=g.order.filter(function(u){return u!==m.mole});
  var drinkers, line;
  if(outcome.caught&&!outcome.stole){drinkers=[m.mole]; line="The mole is caught. The mole drinks."}
  else if(outcome.caught&&outcome.stole){drinkers=group; line="Caught, but the mole stole the word. The group drinks."}
  else {drinkers=group; line="The mole slipped away. The group drinks."}
  var none=setting==="none";
  return {
    drinkers:none?[]:drinkers.slice(),
    line:line,
    amount:none?"":amountLabel(setting),
    noDrinking:none
  };
}

/* ---------- game engine ---------- */
function newGame(players, setting, rounds, deckLen, rng){
  if(players.length<MIN_PLAYERS||players.length>MAX_PLAYERS) throw new Error("Need "+MIN_PLAYERS+" to "+MAX_PLAYERS+" players.");
  var uids=players.map(function(p){return p.uid});
  return {
    players:players.map(function(p){return {uid:p.uid, name:p.name}}),
    order:uids,
    setting:/^(sips|shots|none)$/.test(setting)?setting:"sips",
    rounds:makeRounds(uids, clampRounds(rounds), deckLen, rng),
    round:0, score:{}, history:[], winner:null
  };
}
function nameOf(g, uid){var p=g.players.filter(function(x){return x.uid===uid})[0]; return p?p.name:"Player"}
function current(g){return g.round<g.rounds.length?g.rounds[g.round]:null}
function moleCounts(g){
  var c={}; g.order.forEach(function(u){c[u]=0});
  g.rounds.forEach(function(r){if(c[r.mole]!=null) c[r.mole]++});
  return c;
}
/* Did the group catch the mole? Majority target equals the mole. */
function voteOutcome(g, ballots){
  var m=current(g); if(!m) return null;
  var t=tally(ballots, g.order);
  return {caught:t.target===m.mole, accused:t.target, counts:t.counts, majority:t.majority};
}
/* Resolve the round. stole is true only when the mole was caught and then guessed the word. */
function finishRound(g, outcome){
  var m=current(g), group=g.order.filter(function(u){return u!==m.mole});
  if(outcome.caught&&!outcome.stole){ group.forEach(function(u){g.score[u]=(g.score[u]||0)+1}) }
  else if(outcome.caught&&outcome.stole){ g.score[m.mole]=(g.score[m.mole]||0)+1 }
  else { g.score[m.mole]=(g.score[m.mole]||0)+2 }
  var banner=roundDrinks(outcome, g, g.setting);
  var entry={round:g.round, word:m.word, mole:m.mole, caught:outcome.caught, accused:outcome.accused, stole:!!outcome.stole, banner:banner};
  g.history.push(entry);
  g.round++;
  if(g.round>=g.rounds.length) g.winner=leaders(g);
  return entry;
}
function leaders(g){
  var best=0, who=[];
  g.order.forEach(function(u){var s=g.score[u]||0; if(s>best){best=s; who=[u]} else if(s===best&&best>0){who.push(u)}});
  return {score:best, uids:who};
}
function standings(g){
  return g.order.map(function(u){return {uid:u, name:nameOf(g, u), score:g.score[u]||0}})
    .sort(function(x,y){return y.score-x.score});
}
function finish(g){return {winner:g.winner||leaders(g), standings:standings(g), rounds:g.history.length}}

var api={
  MIN_PLAYERS:MIN_PLAYERS, MAX_PLAYERS:MAX_PLAYERS, NAME_MAX:NAME_MAX, MIN_ROUNDS:MIN_ROUNDS, MAX_ROUNDS:MAX_ROUNDS,
  randomInt:randomInt, shuffle:shuffle, cleanName:cleanName, nameError:nameError, clampRounds:clampRounds,
  makeRounds:makeRounds, tally:tally, amountLabel:amountLabel, roundDrinks:roundDrinks,
  newGame:newGame, nameOf:nameOf, current:current, moleCounts:moleCounts, voteOutcome:voteOutcome, finishRound:finishRound,
  leaders:leaders, standings:standings, finish:finish
};
if(typeof module!=="undefined"&&module.exports) module.exports=api;
else root.MoleLogic=api;
})(typeof window!=="undefined"?window:this);
