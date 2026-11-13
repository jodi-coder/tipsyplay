/* Vault Traitor rules, with no UI and no Firebase.
   The host's phone runs a game through these functions. Tests load the same file in Node.
   Everything here is deterministic apart from the random source, which callers can replace in tests. */
(function(root){
"use strict";

var GUESS_LIMIT=10, LIES_PER_TRAITOR=2, FAST_CRACK=4;
var MIN_PLAYERS=3, MAX_PLAYERS=8, NAME_MAX=12;

/* ---------- randomness ---------- */
function cryptoObj(){
  if(typeof globalThis!=="undefined"&&globalThis.crypto&&globalThis.crypto.getRandomValues) return globalThis.crypto;
  throw new Error("crypto.getRandomValues is not available");
}
function cryptoByte(){var a=new Uint8Array(1); cryptoObj().getRandomValues(a); return a[0]}
function cryptoU32(){var a=new Uint32Array(1); cryptoObj().getRandomValues(a); return a[0]}
/* One digit, exactly uniform: bytes 250..255 are rejected so 0..249 maps evenly onto 0..9. */
function randomDigit(byteSource){
  var src=byteSource||cryptoByte;
  for(;;){var b=src(); if(b<250) return b%10}
}
function makeCode(byteSource){var s="", i; for(i=0;i<4;i++) s+=randomDigit(byteSource); return s}
/* Uniform integer in [0, n) from 32-bit values, by rejection. */
function randomInt(n, u32Source){
  var src=u32Source||cryptoU32;
  var limit=Math.floor(4294967296/n)*n;
  for(;;){var x=src(); if(x<limit) return x%n}
}

/* ---------- setup ---------- */
function traitorCount(n){return n>=6?2:1}
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
function dealRoles(uids, u32Source){
  var list=uids.slice(), i, j, t;
  for(i=list.length-1;i>0;i--){j=randomInt(i+1, u32Source); t=list[i]; list[i]=list[j]; list[j]=t}
  var k=traitorCount(uids.length), roles={};
  uids.forEach(function(u){roles[u]="codebreaker"});
  for(i=0;i<k;i++) roles[list[i]]="traitor";
  return roles;
}

/* ---------- scoring ---------- */
/* Mastermind feedback. Black = exact matches. White = multiset intersection of the digits left after blacks. */
function score(code, guess){
  var black=0, i, restC={}, restG={}, white=0;
  for(i=0;i<4;i++){
    if(code[i]===guess[i]) black++;
    else{restC[code[i]]=(restC[code[i]]||0)+1; restG[guess[i]]=(restG[guess[i]]||0)+1}
  }
  Object.keys(restG).forEach(function(d){white+=Math.min(restG[d], restC[d]||0)});
  return {b:black, w:white};
}
function isGuess(g){return /^[0-9]{4}$/.test(String(g||""))}
function feedbackText(f){
  return f.b+" exact, "+f.w+" misplaced";
}

/* ---------- lies ---------- */
var LIE_KEYS=["b+1","b-1","w+1","w-1"];
function applyLie(f, key){
  var b=f.b, w=f.w;
  if(key==="b+1") b++; else if(key==="b-1") b--; else if(key==="w+1") w++; else if(key==="w-1") w--; else return null;
  if(b<0||b>4||w<0||w>4||b+w>4) return null;
  if(b===4) return null; // 4 exact without a win would expose the lie
  return {b:b, w:w};
}
function lieOptions(f){
  var out=[];
  if(!f||f.b>=4) return out; // a cracked code ends the round: nothing to lie about
  LIE_KEYS.forEach(function(k){var r=applyLie(f, k); if(r) out.push({key:k, b:r.b, w:r.w})});
  return out;
}
function lieLabel(key){
  return {"b+1":"One more exact", "b-1":"One fewer exact", "w+1":"One more misplaced", "w-1":"One fewer misplaced"}[key]||key;
}

/* ---------- votes ---------- */
/* ballots: {voterUid: targetUid}. active: uids still in the game. A majority is more than half of active. */
function tally(ballots, active){
  var counts={}, best=null, bestN=0;
  Object.keys(ballots||{}).forEach(function(v){
    var t=ballots[v];
    if(active.indexOf(v)<0||active.indexOf(t)<0||t===v) return;
    counts[t]=(counts[t]||0)+1;
  });
  Object.keys(counts).forEach(function(t){if(counts[t]>bestN){bestN=counts[t]; best=t}});
  var majority=bestN*2>active.length;
  return {counts:counts, target:majority?best:null, votes:bestN, majority:majority};
}
function voteCost(result){return result==="tie"?1:result==="wrong"?2:0}

/* ---------- drinks ---------- */
/* events: [{type, uids:[...]}] for one turn. Returns one banner listing every affected player once.
   setting "none" turns every drink into the alternative, so the banner has no drinkers. */
var EVENT_LINES={
  pass:"Pass token used.",
  wrong:"Wrong call.",
  correct:"A Traitor is out.",
  undetected:"Someone's lie got through. Codebreakers drink.",
  fast:"Cracked fast. Traitors drink."
};
function amountLabel(setting){return setting==="shots"?"one shot":"one drink"}
function resolveDrinks(events, setting){
  var seen={}, affected=[], lines=[];
  (events||[]).forEach(function(e){
    if(EVENT_LINES[e.type]&&lines.indexOf(EVENT_LINES[e.type])<0) lines.push(EVENT_LINES[e.type]);
    (e.uids||[]).forEach(function(u){if(!seen[u]){seen[u]=1; affected.push(u)}});
  });
  if(!affected.length) return null;
  var none=setting==="none";
  return {
    lines:lines,
    affected:affected,
    drinkers:none?[]:affected.slice(),
    amount:none?"":amountLabel(setting),
    noDrinking:none
  };
}

/* ---------- game engine ---------- */
function newGame(players, setting, rng){
  rng=rng||{};
  if(players.length<MIN_PLAYERS||players.length>MAX_PLAYERS) throw new Error("Need "+MIN_PLAYERS+" to "+MAX_PLAYERS+" players.");
  var uids=players.map(function(p){return p.uid});
  var roles=dealRoles(uids, rng.u32), liesLeft={}, passLeft={};
  uids.forEach(function(u){passLeft[u]=true; if(roles[u]==="traitor") liesLeft[u]=LIES_PER_TRAITOR});
  return {
    players:players.map(function(p){return {uid:p.uid, name:p.name}}),
    order:uids, setting:/^(sips|shots|none)$/.test(setting)?setting:"sips",
    code:makeCode(rng.byte), roles:roles, liesLeft:liesLeft, passLeft:passLeft,
    removed:{}, skipVote:{}, history:[], pending:null, used:0, penalty:0, turn:0,
    votes:[], lies:[], events:[], winner:null, reason:"", log:[]
  };
}
function nameOf(g, uid){var p=g.players.filter(function(x){return x.uid===uid})[0]; return p?p.name:"Player"}
function active(g){return g.order.filter(function(u){return !g.removed[u]})}
function activeTraitors(g){return active(g).filter(function(u){return g.roles[u]==="traitor"})}
function guessesLeft(g){return GUESS_LIMIT-g.used-g.penalty}
function currentTurn(g){
  var list=g.order, n=list.length, i;
  for(i=0;i<n;i++){var u=list[(g.turn+i)%n]; if(!g.removed[u]){g.turn=(g.turn+i)%n; return u}}
  return null;
}
function nextTurn(g){g.turn=(g.turn+1)%g.order.length; return currentTurn(g)}
function note(g, line){g.log.push(line)}
function end(g, winner, reason){if(!g.winner){g.winner=winner; g.reason=reason; note(g, "END: "+winner+" win ("+reason+")")}}

/* A guess from the player whose turn it is. Duplicates cost nothing and keep the turn. */
function submitGuess(g, uid, guess){
  if(g.winner) return {error:"over"};
  if(uid!==currentTurn(g)) return {error:"turn"};
  if(!isGuess(guess)) return {error:"format"};
  if(g.history.some(function(h){return h.guess===guess})){note(g, nameOf(g, uid)+" repeated "+guess+": warned, no guess used"); return {duplicate:true}}
  g.used++;
  var truth=score(g.code, guess);
  if(guess===g.code){
    g.history.push({n:g.used, by:uid, guess:guess, truth:truth, shown:truth, lieBy:null, lieKey:null});
    note(g, "Guess "+g.used+" by "+nameOf(g, uid)+": "+guess+" -> cracked");
    end(g, "codebreakers", "cracked the code");
    return {win:true};
  }
  g.pending={n:g.used, by:uid, guess:guess, truth:truth};
  return {seal:true, liars:liars(g)};
}
/* Traitors who may lie on the pending guess: still in, lies left, and at least one valid option. */
function liars(g){
  if(!g.pending) return [];
  var opts=lieOptions(g.pending.truth);
  if(!opts.length) return [];
  return activeTraitors(g).filter(function(u){return (g.liesLeft[u]||0)>0});
}
/* Close the seal window. choice is null (truth) or {uid, key}. Invalid choices fall back to the truth. */
function seal(g, choice){
  var p=g.pending; if(!p) return null;
  var shown=p.truth, lieBy=null, lieKey=null;
  if(choice&&liars(g).indexOf(choice.uid)>=0){
    var r=applyLie(p.truth, choice.key);
    if(r){shown=r; lieBy=choice.uid; lieKey=choice.key; g.liesLeft[choice.uid]--; g.lies.push({by:lieBy, n:p.n, key:lieKey, truth:p.truth, shown:r, exposed:false})}
  }
  var entry={n:p.n, by:p.by, guess:p.guess, truth:p.truth, shown:shown, lieBy:lieBy, lieKey:lieKey};
  g.history.push(entry); g.pending=null;
  note(g, "Guess "+entry.n+" by "+nameOf(g, entry.by)+": "+entry.guess+" -> shown "+feedbackText(shown)+(lieBy?" (LIE by "+nameOf(g, lieBy)+" "+lieKey+", truth "+feedbackText(entry.truth)+")":""));
  if(guessesLeft(g)<=0) end(g, "traitors", "ran out of guesses");
  return entry;
}
function usePass(g, uid){
  if(g.winner) return {error:"over"};
  if(uid!==currentTurn(g)) return {error:"turn"};
  if(!g.passLeft[uid]) return {error:"none"};
  g.passLeft[uid]=false;
  g.events.push({type:"pass", uids:[uid]});
  note(g, nameOf(g, uid)+" used their pass token");
  return {ok:true};
}
/* Who votes: everyone still in, except players serving a "skip your next vote" penalty (consumed here). */
function voters(g){return active(g).filter(function(u){return !g.skipVote[u]})}
function vote(g, caller, ballots){
  if(g.winner) return {error:"over"};
  var act=active(g), sitting=act.filter(function(u){return g.skipVote[u]});
  var clean={};
  Object.keys(ballots||{}).forEach(function(v){if(sitting.indexOf(v)<0) clean[v]=ballots[v]});
  sitting.forEach(function(u){delete g.skipVote[u]});
  var t=tally(clean, act), result;
  if(!t.majority) result="tie";
  else result=g.roles[t.target]==="traitor"?"correct":"wrong";
  var cost=voteCost(result);
  g.penalty+=cost;
  var rec={n:g.used, caller:caller, target:t.target, votes:t.votes, of:act.length, counts:t.counts, ballots:clean, result:result, cost:cost, sat:sitting};
  g.votes.push(rec);
  if(result==="correct"){
    g.removed[t.target]="caught";
    g.lies.forEach(function(l){if(l.by===t.target) l.exposed=true});
    g.events.push({type:"correct", uids:[t.target]});
  }else if(result==="wrong"){
    g.events.push({type:"wrong", uids:[caller]});
  }
  note(g, "Vote called by "+nameOf(g, caller)+": "+(result==="tie"?"no majority, -1 guess":result==="correct"?nameOf(g, t.target)+" caught (Traitor)":nameOf(g, t.target)+" accused wrongly, -2 guesses")+" ["+t.votes+" of "+act.length+"]");
  if(!activeTraitors(g).length) end(g, "codebreakers", "caught every Traitor");
  else if(guessesLeft(g)<=0) end(g, "traitors", "ran out of guesses");
  return rec;
}
/* A player leaves mid-game. Their role is revealed. A Traitor leaving counts as caught, with no drinks. */
function leave(g, uid){
  if(g.removed[uid]) return null;
  var wasTurn=!g.winner&&currentTurn(g)===uid;
  g.removed[uid]="left";
  if(g.roles[uid]==="traitor") g.lies.forEach(function(l){if(l.by===uid) l.exposed=true});
  note(g, nameOf(g, uid)+" left (was "+g.roles[uid]+")");
  if(!g.winner&&!activeTraitors(g).length) end(g, "codebreakers", "every Traitor is gone");
  if(wasTurn&&!g.winner) currentTurn(g);
  return {role:g.roles[uid], short:active(g).length<MIN_PLAYERS};
}
/* Alternative to a drink, chosen privately: skip your next vote, or give up your pass token. */
function alternatives(g, uid){
  var out=["skipvote"];
  if(g.passLeft[uid]) out.push("token");
  return out;
}
function applyChoice(g, uid, choice){
  if(choice==="skipvote"){g.skipVote[uid]=true; return "skipvote"}
  if(choice==="token"&&g.passLeft[uid]){g.passLeft[uid]=false; return "token"}
  if(choice==="drink"&&g.setting!=="none") return "drink";
  g.skipVote[uid]=true; return "skipvote"; // no answer, or an invalid one, counts as the alternative
}
/* Drinks for the turn that just finished, merged into one banner. */
function turnDrinks(g){
  var b=resolveDrinks(g.events, g.setting); g.events=[];
  return b;
}
/* Round end: every lie still hidden makes the Codebreakers drink once; a crack in 4 guesses or fewer makes the Traitors drink. */
function finish(g){
  var undetected=g.lies.filter(function(l){return !l.exposed});
  var ev=[];
  if(undetected.length) ev.push({type:"undetected", uids:active(g).filter(function(u){return g.roles[u]==="codebreaker"})});
  if(g.winner==="codebreakers"&&g.reason==="cracked the code"&&g.used<=FAST_CRACK) ev.push({type:"fast", uids:activeTraitors(g)});
  var banner=resolveDrinks(ev, g.setting);
  return {
    winner:g.winner, reason:g.reason, code:g.code, roles:g.roles,
    lies:g.lies.map(function(l){return {by:l.by, n:l.n, key:l.key, truth:l.truth, shown:l.shown, status:l.exposed?"exposed":"undetected"}}),
    votes:g.votes.map(function(v){return {n:v.n, caller:v.caller, target:v.target, votes:v.votes, of:v.of, result:v.result, cost:v.cost}}),
    summary:{
      guessesUsed:g.used, liesTold:g.lies.length,
      correct:g.votes.filter(function(v){return v.result==="correct"}).length,
      wrong:g.votes.filter(function(v){return v.result==="wrong"}).length,
      ties:g.votes.filter(function(v){return v.result==="tie"}).length
    },
    banner:banner
  };
}

var api={
  GUESS_LIMIT:GUESS_LIMIT, LIES_PER_TRAITOR:LIES_PER_TRAITOR, FAST_CRACK:FAST_CRACK, MIN_PLAYERS:MIN_PLAYERS, MAX_PLAYERS:MAX_PLAYERS, NAME_MAX:NAME_MAX,
  randomDigit:randomDigit, makeCode:makeCode, randomInt:randomInt, traitorCount:traitorCount, cleanName:cleanName, nameError:nameError, dealRoles:dealRoles,
  score:score, isGuess:isGuess, feedbackText:feedbackText, applyLie:applyLie, lieOptions:lieOptions, lieLabel:lieLabel,
  tally:tally, voteCost:voteCost, amountLabel:amountLabel, resolveDrinks:resolveDrinks,
  newGame:newGame, nameOf:nameOf, active:active, activeTraitors:activeTraitors, guessesLeft:guessesLeft, currentTurn:currentTurn, nextTurn:nextTurn,
  submitGuess:submitGuess, liars:liars, seal:seal, usePass:usePass, voters:voters, vote:vote, leave:leave,
  alternatives:alternatives, applyChoice:applyChoice, turnDrinks:turnDrinks, finish:finish
};
if(typeof module!=="undefined"&&module.exports) module.exports=api;
else root.VaultLogic=api;
})(typeof window!=="undefined"?window:this);
