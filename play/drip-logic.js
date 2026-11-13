/* Slow Drip rules, with no UI and no Firebase.
   The host's phone (or the practice mode) runs a game through these functions. Tests load the same file in Node.
   Time is always passed in, and the random source can be replaced, so every step is repeatable in tests. */
(function(root){
"use strict";

var MIN_PLAYERS=3, MAX_PLAYERS=10, NAME_MAX=12;
var T={drip:10000, bet:3000, seat:10000, payout:7000};
var START_SHOWN=0.3, BOX_DROPS=2, GUESS_MAX=60;
/* The no-drink alternative shown on every drink banner. */
var ALTS=[
  "hold a statue pose for 5 seconds",
  "do a 5-second robot dance",
  "give the table a slow, dramatic bow",
  "name three fruits in 5 seconds",
  "stand on one leg until the next letter drops",
  "talk like a pirate until the next letter drops"
];

/* ---------- randomness ---------- */
function defaultRng(n){
  var c=typeof globalThis!=="undefined"&&globalThis.crypto;
  if(c&&c.getRandomValues){
    var a=new Uint32Array(1), limit=Math.floor(4294967296/n)*n;
    for(;;){c.getRandomValues(a); if(a[0]<limit) return a[0]%n}
  }
  return Math.floor(Math.random()*n);
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

/* ---------- answer checking ---------- */
/* Lower case, accents removed, "&" read as "and", everything that is not a letter or digit becomes one space. */
function fold(s){
  var t=String(s==null?"":s);
  if(t.normalize) t=t.normalize("NFD").replace(/[̀-ͯ]/g,"");
  return t.toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").trim();
}
function words(s){var f=fold(s); return f?f.split(" "):[]}
/* Typos between two words: insert, delete, swap one letter, or two neighbours the wrong way round, each counts 1. */
function typos(a, b){
  var m=a.length, n=b.length, i, j, d=[];
  for(i=0;i<=m;i++){d[i]=[i]}
  for(j=1;j<=n;j++) d[0][j]=j;
  for(i=1;i<=m;i++) for(j=1;j<=n;j++){
    var cost=a.charAt(i-1)===b.charAt(j-1)?0:1;
    d[i][j]=Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+cost);
    if(i>1&&j>1&&a.charAt(i-1)===b.charAt(j-2)&&a.charAt(i-2)===b.charAt(j-1)) d[i][j]=Math.min(d[i][j], d[i-2][j-2]+1);
  }
  return d[m][n];
}
function letterCount(phrase){return words(phrase).join("").length}
/* About one typo per 8 letters across the whole phrase. */
function typoBudget(phrase){return Math.floor(letterCount(phrase)/8)}
/* A word still counts as present with a small slip: none for words of 1 to 3 letters, 1 for 4 to 7, 2 for longer. */
function wordSlack(len){return len<=3?0:len<=7?1:2}
/* True when the guess is the phrase: case, punctuation, accents and extra spaces ignored, a few typos allowed,
   and every word of the phrase present, in order. */
function matches(guess, phrase){
  var g=words(guess), p=words(phrase), i, total=0;
  if(!g.length||!p.length) return false;
  if(g.join("")===p.join("")) return true; /* only the spacing differs */
  if(g.length!==p.length) return false;    /* a word is missing or extra */
  for(i=0;i<p.length;i++){
    var t=typos(g[i], p[i]);
    if(t>wordSlack(p[i].length)) return false;
    total+=t;
  }
  return total<=typoBudget(phrase);
}

/* ---------- the board ---------- */
function isLetter(ch){return /[A-Za-z0-9]/.test(ch)}
function slots(phrase){var out=[], i; for(i=0;i<phrase.length;i++) if(isLetter(phrase.charAt(i))) out.push(i); return out}
/* Which characters start visible: every space and punctuation mark, plus about 30% of the letters. */
function initialShown(phrase, rng){
  var r=rng||defaultRng, sl=slots(phrase), shown=[], i;
  for(i=0;i<phrase.length;i++) shown.push(!isLetter(phrase.charAt(i)));
  var k=Math.min(Math.round(sl.length*START_SHOWN), Math.max(0, sl.length-1)), pool=sl.slice();
  for(i=0;i<k;i++){var j=r(pool.length); shown[pool[j]]=true; pool.splice(j,1)}
  return shown;
}
function hiddenCount(G){var n=0, i; for(i=0;i<G.shown.length;i++) if(!G.shown[i]) n++; return n}
function shownFraction(G){var total=slots(G.phrase).length; return total?(total-hiddenCount(G))/total:1}
/* What guests get: the phrase with every hidden letter replaced by "_". */
function mask(phrase, shown){
  var s="", i; for(i=0;i<phrase.length;i++) s+=shown[i]?phrase.charAt(i):"_"; return s;
}
function revealOne(G, rng){
  var r=rng||defaultRng, pool=[], i;
  for(i=0;i<G.shown.length;i++) if(!G.shown[i]) pool.push(i);
  if(!pool.length) return -1;
  var at=pool[r(pool.length)]; G.shown[at]=true; return at;
}

/* ---------- game setup ---------- */
function newGame(players, opts){
  if(!players||players.length<MIN_PLAYERS||players.length>MAX_PLAYERS) throw new Error("Need "+MIN_PLAYERS+" to "+MAX_PLAYERS+" players.");
  var names={}, scores={}, order=[];
  players.forEach(function(p){order.push(p.uid); names[p.uid]=cleanName(p.name).slice(0, NAME_MAX)||"Player"; scores[p.uid]=0});
  return {v:1, order:order, names:names, scores:scores, na:!!(opts&&opts.na), round:0, used:[], phase:"idle",
    phrase:"", cat:"", shown:[], drops:0, deadline:0, remain:0, solver:"", bets:{}, missed:{}, box:{}, drank:{}, payout:null, end:null};
}
/* Each phrase is used once per game before any repeats. */
function pickPhrase(G, list, rng){
  var r=rng||defaultRng, pool=[], i;
  for(i=0;i<list.length;i++) if(G.used.indexOf(i)<0) pool.push(i);
  if(!pool.length){G.used=[]; for(i=0;i<list.length;i++) pool.push(i)}
  var idx=pool[r(pool.length)];
  G.used.push(idx);
  return list[idx];
}
function startRound(G, list, now, rng){
  var p=pickPhrase(G, list, rng);
  G.round+=1; G.phrase=p.text; G.cat=p.cat;
  G.shown=initialShown(p.text, rng);
  G.drops=0; G.solver=""; G.bets={}; G.missed={}; G.box={}; G.drank={}; G.payout=null; G.end=null; G.remain=0;
  G.phase="drip"; G.deadline=now+T.drip;
  return G;
}

/* ---------- a solve attempt ---------- */
function canBuzz(G, uid){return G.phase==="drip"&&G.order.indexOf(uid)>=0&&!G.box[uid]}
/* at: the moment the database received the buzz. The drip clock stops there and resumes with what was left. */
function buzz(G, uid, at, now){
  if(!canBuzz(G, uid)) return false;
  G.solver=uid; G.bets={}; G.missed={}; G.payout=null;
  G.remain=Math.max(0, Math.min(T.drip, G.deadline-(at||now)));
  G.phase="bet"; G.deadline=now+T.bet;
  return true;
}
function bettors(G){return G.order.filter(function(u){return u!==G.solver})}
/* v: "s" (they will solve it), "f" (they will fail) or "p" (pass: no bet, no drink either way). The first pick is final. */
function placeBet(G, uid, v){
  if(G.phase!=="bet"||uid===G.solver||G.order.indexOf(uid)<0||!/^[sfp]$/.test(v)||G.bets[uid]) return false;
  G.bets[uid]=v; return true;
}
function allBetsIn(G, away){
  return bettors(G).every(function(u){return !!G.bets[u]||!!(away&&away[u])});
}
/* The window closes. No pick counts as FAIL. A player whose phone is away is passed instead. */
function closeBets(G, now, away){
  if(G.phase!=="bet") return false;
  bettors(G).forEach(function(u){
    if(G.bets[u]) return;
    if(away&&away[u]) G.bets[u]="p"; else{G.bets[u]="f"; G.missed[u]=true}
  });
  G.phase="seat"; G.deadline=now+T.seat;
  return true;
}
function submitGuess(G, uid, text, now, rng){
  if(G.phase!=="seat"||uid!==G.solver) return false;
  var guess=String(text==null?"":text).replace(/\s+/g," ").trim().slice(0, GUESS_MAX);
  resolve(G, matches(guess, G.phrase), guess, false, now, rng);
  return true;
}
/* The payout table. One drink per player per round at most: after that the same penalty becomes the alternative. */
function resolve(G, correct, guess, timeout, now, rng){
  var r=rng||defaultRng, due=[], safe=[];
  if(!correct) due.push({uid:G.solver, why:timeout?"ran out of time":"wrong guess"});
  else safe.push(G.solver);
  bettors(G).forEach(function(u){
    var b=G.bets[u];
    if(b==="p"){safe.push(u); return}
    if(correct&&b==="f") due.push({uid:u, why:"bet FAIL"});
    else if(!correct&&b==="s") due.push({uid:u, why:"bet SOLVE"});
    else safe.push(u);
  });
  var drinks=due.map(function(d){
    var capped=!!G.drank[d.uid];
    if(!capped&&!G.na) G.drank[d.uid]=true;
    return {uid:d.uid, why:d.why, what:(capped||G.na)?"alt":"drink", capped:capped};
  });
  G.payout={correct:!!correct, timeout:!!timeout, guess:guess||"", solver:G.solver, bets:copy(G.bets), missed:copy(G.missed),
    drinks:drinks, safe:safe, alt:ALTS[r(ALTS.length)], na:G.na};
  if(correct){
    G.scores[G.solver]=(G.scores[G.solver]||0)+1;
    finishRound(G, G.solver, "solved");
  }else{
    /* penalty box: 2 more letters, or the rest of the round when fewer than 2 are still hidden */
    G.box[G.solver]=hiddenCount(G)<BOX_DROPS?"round":BOX_DROPS;
    G.phase="payout"; G.deadline=now+T.payout;
  }
  return G.payout;
}
function resumeDrip(G, now){
  if(G.phase!=="payout") return false;
  G.solver=""; G.bets={}; G.missed={}; G.payout=null;
  G.phase="drip"; G.deadline=now+G.remain; G.remain=0;
  return true;
}
function finishRound(G, solver, reason){
  var i; for(i=0;i<G.shown.length;i++) G.shown[i]=true;
  G.phase="end"; G.deadline=0;
  G.end={phrase:G.phrase, solver:solver||"", reason:reason};
  if(reason!=="solved"){G.payout=null; G.solver=""}
}
/* The host changed mid-round, or the table fell apart: show the phrase, nobody drinks. */
function voidRound(G){if(G.phase==="end"||G.phase==="over"||G.phase==="idle") return false; finishRound(G, "", "void"); return true}
function endGame(G){G.phase="over"; G.deadline=0; return G}

/* One letter drops: counters in the penalty box go down, and the round ends when nothing is hidden. */
function drop(G, now, rng){
  revealOne(G, rng); G.drops+=1;
  Object.keys(G.box).forEach(function(u){
    if(G.box[u]==="round") return;
    G.box[u]-=1; if(G.box[u]<=0) delete G.box[u];
  });
  if(hiddenCount(G)===0){finishRound(G, "", "dripped"); return}
  G.deadline=G.deadline+T.drip;
  if(G.deadline<=now) G.deadline=now+T.drip;
}
/* The host's clock. Returns the name of what happened, or "" when nothing was due. */
function tick(G, now, rng, away){
  if(G.phase==="drip"){
    if(now>=G.deadline){drop(G, now, rng); return G.phase==="end"?"end":"drop"}
  }else if(G.phase==="bet"){
    if(now>=G.deadline||allBetsIn(G, away)){closeBets(G, now, away); return "seat"}
  }else if(G.phase==="seat"){
    if(now>=G.deadline){resolve(G, false, "", true, now, rng); return "payout"}
  }else if(G.phase==="payout"){
    if(now>=G.deadline){resumeDrip(G, now); return "drip"}
  }
  return "";
}
/* A player leaves. Their attempt, if they were solving, is cancelled and nobody drinks for it. */
function leave(G, uid, now){
  var i=G.order.indexOf(uid); if(i<0) return false;
  G.order.splice(i,1); delete G.bets[uid]; delete G.box[uid];
  if(G.order.length<2){if(G.phase!=="over"){if(G.phase!=="end"&&G.phase!=="idle") finishRound(G, "", "void"); endGame(G)} return true}
  if(uid===G.solver&&(G.phase==="bet"||G.phase==="seat")){
    G.solver=""; G.bets={}; G.missed={}; G.payout=null; G.phase="drip"; G.deadline=now+G.remain; G.remain=0;
  }
  return true;
}

/* ---------- what everyone may see ---------- */
function copy(o){var out={}; Object.keys(o||{}).forEach(function(k){out[k]=o[k]}); return out}
function standings(G){
  return Object.keys(G.scores).map(function(u){return {uid:u, name:G.names[u], score:G.scores[u], here:G.order.indexOf(u)>=0}})
    .sort(function(a,b){return b.score-a.score||a.name.localeCompare(b.name)});
}
/* Never contains the phrase before the round is over, and never a bet before the payout. */
function publicView(G){
  var over=G.phase==="end"||G.phase==="over";
  return {v:1, round:G.round, cat:G.cat, mask:over?G.phrase:mask(G.phrase, G.shown), order:G.order.slice(), names:copy(G.names), scores:copy(G.scores),
    na:G.na, drops:G.drops, hidden:over?0:hiddenCount(G), solver:G.solver||"", box:copy(G.box),
    betsIn:G.phase==="bet"?Object.keys(G.bets).length:0,
    payout:(G.phase==="payout"||over)?G.payout:null, end:over?G.end:null};
}

/* ---------- practice bots ---------- */
/* Chance that one bot buzzes during dt milliseconds. It climbs steeply as more of the phrase shows. */
function botBuzzChance(fraction, dt){
  var f=Math.max(0, Math.min(1, fraction)), rate=0.01+0.35*f*f*f;
  return 1-Math.exp(-rate*dt/1000);
}
/* Chance that a bot that buzzed actually knows the phrase. */
function botKnowsChance(fraction){return Math.max(0.1, Math.min(0.95, Math.pow(Math.max(0, fraction), 1.5)))}

var api={
  MIN_PLAYERS:MIN_PLAYERS, MAX_PLAYERS:MAX_PLAYERS, NAME_MAX:NAME_MAX, T:T, START_SHOWN:START_SHOWN, BOX_DROPS:BOX_DROPS, GUESS_MAX:GUESS_MAX, ALTS:ALTS,
  rng:defaultRng, cleanName:cleanName, nameError:nameError,
  fold:fold, words:words, typos:typos, typoBudget:typoBudget, matches:matches, letterCount:letterCount,
  isLetter:isLetter, slots:slots, initialShown:initialShown, hiddenCount:hiddenCount, shownFraction:shownFraction, mask:mask, revealOne:revealOne,
  newGame:newGame, pickPhrase:pickPhrase, startRound:startRound, canBuzz:canBuzz, buzz:buzz, bettors:bettors, placeBet:placeBet, allBetsIn:allBetsIn,
  closeBets:closeBets, submitGuess:submitGuess, resolve:resolve, resumeDrip:resumeDrip, voidRound:voidRound, endGame:endGame, drop:drop, tick:tick, leave:leave,
  standings:standings, publicView:publicView, botBuzzChance:botBuzzChance, botKnowsChance:botKnowsChance
};
root.DripLogic=api;
if(typeof module!=="undefined"&&module.exports) module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
