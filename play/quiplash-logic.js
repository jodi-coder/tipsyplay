/* Quiplash rules, with no UI and no Firebase.
   The host's phone runs a game through these functions. Tests load the same file in Node.
   Everything here is deterministic apart from the random source, which callers can replace in tests.

   The game: each round one prompt goes to two players, who each write an answer in private.
   Everyone else votes for the funnier answer. The author of the losing answer takes a drink or
   the alternative. A tie is nobody's drink. The pairing walks the table so answer counts stay even. */
(function(root){
"use strict";

var MIN_PLAYERS=3, MAX_PLAYERS=12, NAME_MAX=12, ANSWER_MAX=80;
var MIN_ROUNDS=3, MAX_ROUNDS=20;

/* ---------- randomness ---------- */
function cryptoObj(){
  if(typeof globalThis!=="undefined"&&globalThis.crypto&&globalThis.crypto.getRandomValues) return globalThis.crypto;
  throw new Error("crypto.getRandomValues is not available");
}
function cryptoU32(){var a=new Uint32Array(1); cryptoObj().getRandomValues(a); return a[0]}
/* Uniform integer in [0, n) from 32-bit values, by rejection. */
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

/* ---------- names and answers ---------- */
function cleanName(raw){return String(raw||"").replace(/[<>]/g,"").replace(/\s+/g," ").trim()}
/* Names: non-empty, at most 12 characters, unique ignoring case. Returns an error message or "". */
function nameError(name, others){
  var n=cleanName(name);
  if(!n) return "Add your name first.";
  if(n.length>NAME_MAX) return "Names can be up to "+NAME_MAX+" characters.";
  var low=n.toLowerCase();
  if((others||[]).some(function(o){return cleanName(o).toLowerCase()===low})) return "Someone already has that name. Try another.";
  return "";
}
function cleanAnswer(raw){return String(raw||"").replace(/[<>]/g,"").replace(/\s+/g," ").trim().slice(0, ANSWER_MAX)}
function answerError(ans){
  var a=cleanAnswer(ans);
  if(!a) return "Type an answer first.";
  return "";
}
function clampRounds(r){
  r=Math.round(Number(r)||0);
  if(r<MIN_ROUNDS) return MIN_ROUNDS;
  if(r>MAX_ROUNDS) return MAX_ROUNDS;
  return r;
}

/* ---------- matchups ----------
   Walk the table so every player answers a near-equal number of prompts and never faces the same
   partner twice in a row. Round i pairs offset start a with partner a step away; the step grows so
   pairings spread out. Prompts come from a shuffled deck, reused in order if rounds exceed the deck. */
function makeMatchups(uids, rounds, promptCount, rng){
  rng=rng||{};
  var n=uids.length;
  var people=shuffle(uids, rng.u32);
  var deck=[], i;
  for(i=0;i<promptCount;i++) deck.push(i);
  deck=shuffle(deck, rng.u32);
  var out=[];
  for(i=0;i<rounds;i++){
    var step=1+(Math.floor(i/n)%(n-1));
    var a=people[i%n];
    var b=people[(i+step)%n];
    if(b===a) b=people[(i+step+1)%n];
    out.push({a:a, b:b, prompt:deck[i%deck.length]});
  }
  return out;
}

/* ---------- votes ----------
   ballots: {voterUid: "a"|"b"}. Only non-authors vote. Majority of cast votes wins; equal is a tie. */
function tallyVotes(ballots, matchup){
  var a=0, b=0;
  Object.keys(ballots||{}).forEach(function(v){
    if(v===matchup.a||v===matchup.b) return;       // the two authors never vote on their own matchup
    var pick=ballots[v];
    if(pick==="a") a++; else if(pick==="b") b++;
  });
  var winner=a>b?"a":b>a?"b":null;
  return {a:a, b:b, winner:winner, tie:winner===null};
}
function voters(uids, matchup){
  return uids.filter(function(u){return u!==matchup.a&&u!==matchup.b});
}

/* ---------- drinks ----------
   The author of the losing answer drinks or does the alternative. A tie is nobody's drink.
   setting "none" turns the drink into the alternative, so the banner lists no drinkers. */
function amountLabel(setting){return setting==="shots"?"one shot":"one drink"}
function roundDrinks(matchup, result, setting){
  if(!result||result.tie) return null;
  var loser=result.winner==="a"?matchup.b:matchup.a;
  var none=setting==="none";
  return {
    loser:loser,
    line:none?"Funnier answer wins. The other author takes the alternative.":"Funnier answer wins. The other author drinks.",
    drinkers:none?[]:[loser],
    amount:none?"":amountLabel(setting),
    noDrinking:none
  };
}

/* ---------- game engine ---------- */
function newGame(players, setting, rounds, promptCount, rng){
  if(players.length<MIN_PLAYERS||players.length>MAX_PLAYERS) throw new Error("Need "+MIN_PLAYERS+" to "+MAX_PLAYERS+" players.");
  var uids=players.map(function(p){return p.uid});
  return {
    players:players.map(function(p){return {uid:p.uid, name:p.name}}),
    order:uids,
    setting:/^(sips|shots|none)$/.test(setting)?setting:"sips",
    matchups:makeMatchups(uids, clampRounds(rounds), promptCount, rng),
    round:0, score:{}, history:[], winner:null
  };
}
function nameOf(g, uid){var p=g.players.filter(function(x){return x.uid===uid})[0]; return p?p.name:"Player"}
function current(g){return g.round<g.matchups.length?g.matchups[g.round]:null}
function answerCounts(g){
  var c={};
  g.order.forEach(function(u){c[u]=0});
  g.matchups.forEach(function(m){if(c[m.a]!=null)c[m.a]++; if(c[m.b]!=null)c[m.b]++});
  return c;
}
/* Resolve the current round from the two answers and the ballots, then advance. */
function resolveRound(g, answers, ballots){
  var m=current(g); if(!m) return null;
  var result=tallyVotes(ballots, m);
  var winnerUid=result.tie?null:(result.winner==="a"?m.a:m.b);
  if(winnerUid){g.score[winnerUid]=(g.score[winnerUid]||0)+1}
  var banner=roundDrinks(m, result, g.setting);
  var entry={
    round:g.round, prompt:m.prompt, a:m.a, b:m.b,
    ansA:cleanAnswer(answers&&answers[m.a]), ansB:cleanAnswer(answers&&answers[m.b]),
    votesA:result.a, votesB:result.b, winner:winnerUid, tie:result.tie, banner:banner
  };
  g.history.push(entry);
  g.round++;
  if(g.round>=g.matchups.length) g.winner=leaders(g);
  return entry;
}
/* The player (or tied players) with the most matchup wins. */
function leaders(g){
  var best=0, who=[];
  g.order.forEach(function(u){
    var s=g.score[u]||0;
    if(s>best){best=s; who=[u]} else if(s===best&&best>0){who.push(u)}
  });
  return {score:best, uids:who};
}
function standings(g){
  return g.order.map(function(u){return {uid:u, name:nameOf(g, u), score:g.score[u]||0}})
    .sort(function(x,y){return y.score-x.score});
}
function finish(g){
  return {
    winner:g.winner||leaders(g),
    standings:standings(g),
    rounds:g.history.length
  };
}

var api={
  MIN_PLAYERS:MIN_PLAYERS, MAX_PLAYERS:MAX_PLAYERS, NAME_MAX:NAME_MAX, ANSWER_MAX:ANSWER_MAX, MIN_ROUNDS:MIN_ROUNDS, MAX_ROUNDS:MAX_ROUNDS,
  randomInt:randomInt, shuffle:shuffle,
  cleanName:cleanName, nameError:nameError, cleanAnswer:cleanAnswer, answerError:answerError, clampRounds:clampRounds,
  makeMatchups:makeMatchups, tallyVotes:tallyVotes, voters:voters, amountLabel:amountLabel, roundDrinks:roundDrinks,
  newGame:newGame, nameOf:nameOf, current:current, answerCounts:answerCounts, resolveRound:resolveRound,
  leaders:leaders, standings:standings, finish:finish
};
if(typeof module!=="undefined"&&module.exports) module.exports=api;
else root.QuiplashLogic=api;
})(typeof window!=="undefined"?window:this);
