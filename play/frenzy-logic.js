/* Five Letter Frenzy rules, with no UI and no Firebase.
   The host's phone runs a round through these functions. Tests load the same file in Node.
   One secret 5-letter word, one shared grid, at most 6 guesses for the whole table.
   The seat that starts walks forward one player each new round.
   Marks: locked (right letter, right place), moved (right letter, wrong place), absent.
   Locked marks are counted before moved marks. A repeated letter only marks moved
   for the copies still left in the secret. */
(function(root){
"use strict";

var MIN_PLAYERS=3, MAX_PLAYERS=8, NAME_MAX=12, MAX_GUESSES=6, WORD_LEN=5;
var IDLE_MS=120000, FAST_IDLE_MS=2000;
var answers=[], guessSet=null;

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

function cleanName(raw){return String(raw||"").replace(/[<>]/g,"").replace(/\s+/g," ").trim()}
function nameError(name, others){
  var n=cleanName(name);
  if(!n) return "Add your name first.";
  if(n.length>NAME_MAX) return "Names can be up to "+NAME_MAX+" characters.";
  var low=n.toLowerCase();
  if((others||[]).some(function(o){return cleanName(o).toLowerCase()===low})) return "Someone already has that name. Try another.";
  return "";
}
function normalize(raw){return String(raw||"").toLowerCase().replace(/[^a-z]/g,"")}

function useWords(data){
  answers=(data&&data.answers?data.answers:[]).slice();
  guessSet={};
  (data&&data.guesses?data.guesses:[]).forEach(function(w){guessSet[w]=1});
  answers.forEach(function(w){guessSet[w]=1});
}
function hasGuess(w){return !!(guessSet&&guessSet[normalize(w)])}
function isAnswer(w){return answers.indexOf(normalize(w))>=0}
function answerCount(){return answers.length}
function pickWord(rng, avoid){
  if(!answers.length) throw new Error("no words");
  var i, w;
  for(i=0;i<12;i++){w=answers[randomInt(answers.length, rng&&rng.u32)]; if(w!==avoid) return w}
  return w;
}

/* ---------- marks ---------- */
function markGuess(secret, guess){
  secret=normalize(secret); guess=normalize(guess);
  var marks=["absent","absent","absent","absent","absent"], spare={}, i, ch;
  for(i=0;i<WORD_LEN;i++){
    if(guess[i]===secret[i]) marks[i]="locked";
    else {ch=secret[i]; spare[ch]=(spare[ch]||0)+1}
  }
  for(i=0;i<WORD_LEN;i++){
    if(marks[i]==="locked") continue;
    ch=guess[i];
    if(spare[ch]){marks[i]="moved"; spare[ch]--}
  }
  return marks;
}
function lockedCount(marks){return (marks||[]).filter(function(m){return m==="locked"}).length}
function movedCount(marks){return (marks||[]).filter(function(m){return m==="moved"}).length}
function pointsFor(marks, solved){return lockedCount(marks)+(solved?3:0)}

function guessError(word, prior){
  var w=normalize(word);
  if(w.length!==WORD_LEN) return "Use 5 letters.";
  if(!hasGuess(w)) return "That word is not on the list.";
  if((prior||[]).some(function(g){return g===w||(g&&g.word===w)})) return "Already guessed.";
  return "";
}

/* ---------- seats ---------- */
function nextSeat(g, fromUid, connected){
  var ids=g.order, start=ids.indexOf(fromUid), i, u;
  if(start<0) start=0;
  for(i=1;i<=ids.length;i++){
    u=ids[(start+i)%ids.length];
    if(!connected||connected[u]!==false) return u;
  }
  return null;
}
function openingTurn(order, starter, connected){
  if(!order.length) return "";
  var i=((starter%order.length)+order.length)%order.length, u=order[i];
  if(!connected||connected[u]!==false) return u;
  var fake={order:order};
  return nextSeat(fake, u, connected)||"";
}

/* ---------- round ---------- */
function newRound(players, opts){
  opts=opts||{};
  if(players.length<MIN_PLAYERS||players.length>MAX_PLAYERS) throw new Error("Need "+MIN_PLAYERS+" to "+MAX_PLAYERS+" players.");
  var word=normalize(opts.word);
  if(word && word.length!==WORD_LEN) throw new Error("word");
  var order=players.map(function(p){return p.uid});
  var starter=((+opts.starter||0)%order.length+order.length)%order.length;
  var g={
    players:players.map(function(p){return {uid:p.uid, name:cleanName(p.name).slice(0,NAME_MAX)||"Player", dry:!!p.dry}}),
    order:order, word:word, pointsOnly:!!opts.pointsOnly, starter:starter,
    guesses:[], phase:"guess", turn:openingTurn(order, starter, opts.connected),
    paused:false, score:{}, solvedBy:null, handTo:null, log:[]
  };
  order.forEach(function(u){g.score[u]=0});
  return g;
}
function nameOf(g, uid){
  var p=(g.players||[]).filter(function(x){return x.uid===uid})[0];
  return p?p.name:"Player";
}
function playerOf(g, uid){return (g.players||[]).filter(function(p){return p.uid===uid})[0]||null}
function priorWords(g){return g.guesses.map(function(x){return x.word})}

function goGuess(g, fromUid, connected){
  if(g.guesses.length>=MAX_GUESSES){g.phase="end"; g.turn=""; return}
  var n=nextSeat(g, fromUid, connected);
  g.phase="guess";
  g.turn=n||"";
}
function submitGuess(g, uid, raw, connected, dryNow){
  if(g.paused) return {ok:false, error:"Paused."};
  if(g.phase!=="guess") return {ok:false, error:"Wait for your turn."};
  if(uid!==g.turn) return {ok:false, error:"Wait for your turn."};
  var err=guessError(raw, priorWords(g));
  if(err) return {ok:false, error:err};
  var w=normalize(raw), marks=markGuess(g.word, w), solved=lockedCount(marks)===WORD_LEN;
  g.score[uid]=(g.score[uid]||0)+pointsFor(marks, solved);
  g.guesses.push({uid:uid, word:w, marks:marks});
  if(solved){
    g.solvedBy=uid;
    if(g.pointsOnly){g.phase="end"; g.turn=""}
    else {g.phase="handoff"; g.turn=uid; g.handTo=null}
    return {ok:true, solved:true};
  }
  if(g.guesses.length>=MAX_GUESSES){g.phase="end"; g.turn=""; return {ok:true, solved:false, ended:true}}
  var me=playerOf(g, uid), dry=!!dryNow||!!(me&&me.dry);
  if(g.pointsOnly||dry){
    g.log.push({uid:uid, kind:"pass", auto:true});
    goGuess(g, uid, connected);
    return {ok:true, solved:false, skippedPrompt:true};
  }
  g.phase="prompt"; g.turn=uid;
  return {ok:true, solved:false};
}
/* Marks come from the server. This does not know the secret word. */
function applyMarkedGuess(g, uid, raw, marks, connected, dryNow){
  if(g.paused) return {ok:false, error:"Paused."};
  if(g.phase!=="guess") return {ok:false, error:"Wait for your turn."};
  if(uid!==g.turn) return {ok:false, error:"Wait for your turn."};
  var err=guessError(raw, priorWords(g));
  if(err) return {ok:false, error:err};
  if(!marks||marks.length!==WORD_LEN) return {ok:false, error:"marks"};
  var w=normalize(raw), solved=lockedCount(marks)===WORD_LEN;
  g.score[uid]=(g.score[uid]||0)+pointsFor(marks, solved);
  g.guesses.push({uid:uid, word:w, marks:marks.slice()});
  if(solved){
    g.solvedBy=uid;
    if(g.pointsOnly){g.phase="end"; g.turn=""}
    else {g.phase="handoff"; g.turn=uid; g.handTo=null}
    return {ok:true, solved:true};
  }
  if(g.guesses.length>=MAX_GUESSES){g.phase="end"; g.turn=""; return {ok:true, solved:false, ended:true}}
  var me=playerOf(g, uid), dry=!!dryNow||!!(me&&me.dry);
  if(g.pointsOnly||dry){
    g.log.push({uid:uid, kind:"pass", auto:true});
    goGuess(g, uid, connected);
    return {ok:true, solved:false, skippedPrompt:true};
  }
  g.phase="prompt"; g.turn=uid;
  return {ok:true, solved:false};
}
function choose(g, uid, kind, connected){
  if(g.paused||g.phase!=="prompt"||uid!==g.turn) return {ok:false};
  if(!/^(drink|pose|pass)$/.test(kind)) return {ok:false};
  g.log.push({uid:uid, kind:kind});
  if(g.guesses.length>=MAX_GUESSES){g.phase="end"; g.turn=""}
  else goGuess(g, uid, connected);
  return {ok:true};
}
function hand(g, uid, target, connected){
  if(g.paused||g.phase!=="handoff"||uid!==g.turn||g.handTo) return {ok:false};
  if(!target){
    g.log.push({uid:uid, kind:"pass", handoff:true});
    g.phase="end"; g.turn="";
    return {ok:true};
  }
  if(g.order.indexOf(target)<0||target===uid) return {ok:false};
  var them=playerOf(g, target);
  g.handTo=target;
  if(g.pointsOnly||(them&&them.dry)||(connected&&connected[target]===false)){
    g.log.push({uid:target, kind:"pass", handed:true, auto:true});
    g.phase="end"; g.turn="";
    return {ok:true};
  }
  g.turn=target;
  return {ok:true, waiting:true};
}
function answerHand(g, uid, kind){
  if(g.paused||g.phase!=="handoff"||g.handTo!==uid||uid!==g.turn) return {ok:false};
  if(!/^(drink|pose|pass)$/.test(kind)) return {ok:false};
  g.log.push({uid:uid, kind:kind, handed:true});
  g.phase="end"; g.turn="";
  return {ok:true};
}
/* Host skip counts as Pass. A skipped guess does not fill a row. */
function skipTurn(g, connected){
  if(g.phase==="end") return {ok:false};
  var uid=g.turn;
  if(!uid) return {ok:false};
  if(g.phase==="prompt"){
    g.log.push({uid:uid, kind:"pass", host:true});
    if(g.guesses.length>=MAX_GUESSES){g.phase="end"; g.turn=""}
    else goGuess(g, uid, connected);
    return {ok:true};
  }
  if(g.phase==="handoff"){
    g.log.push({uid:uid, kind:"pass", host:true, handed:!!g.handTo});
    g.phase="end"; g.turn="";
    return {ok:true};
  }
  if(g.phase==="guess"){
    var n=nextSeat(g, uid, connected);
    if(!n||n===uid) return {ok:false, stuck:true};
    g.log.push({uid:uid, kind:"pass", host:true, skippedGuess:true});
    g.turn=n;
    return {ok:true};
  }
  return {ok:false};
}
function skipDisconnected(g, connected){
  if(g.paused||!g.turn||!connected||connected[g.turn]!==false) return false;
  var before=g.phase+"|"+g.turn;
  var r=skipTurn(g, connected);
  return !!(r&&r.ok)&&(g.phase+"|"+g.turn)!==before;
}
function removePlayer(g, uid, connected){
  var idx=g.order.indexOf(uid);
  if(idx<0) return {ok:false};
  var wasTurn=g.turn===uid, phase=g.phase;
  g.order.splice(idx, 1);
  g.players=g.players.filter(function(p){return p.uid!==uid});
  if(g.handTo===uid) g.handTo=null;
  if(!g.order.length){g.phase="end"; g.turn=""; return {ok:true}}
  if(wasTurn&&phase!=="end"){
    if(phase==="prompt"||phase==="handoff"){g.phase="end"; g.turn=""; return {ok:true}}
    var u=g.order[idx%g.order.length];
    if(connected&&connected[u]===false) u=nextSeat(g, u, connected)||"";
    g.turn=u;
    g.phase=u?"guess":"end";
  }
  return {ok:true};
}
function setPaused(g, on){if(g.phase==="end") return false; g.paused=!!on; return true}
function awards(g){
  var locks={}, i, u, best=null, n, mv;
  g.order.forEach(function(id){locks[id]=0});
  g.guesses.forEach(function(row){
    n=lockedCount(row.marks); mv=movedCount(row.marks);
    if(locks[row.uid]!=null) locks[row.uid]+=n;
    if(n<WORD_LEN){
      if(!best||n>best.locked||(n===best.locked&&mv>best.moved)) best={uid:row.uid, locked:n, moved:mv, word:row.word};
    }
  });
  var max=0;
  g.order.forEach(function(id){if((locks[id]||0)>max) max=locks[id]});
  var most=max>0?g.order.filter(function(id){return locks[id]===max}):[];
  return {mostLocks:{uids:most, count:max}, closest:best, solvedBy:g.solvedBy||null, word:g.phase==="end"?g.word:""};
}
function publicView(g){
  var names={};
  g.players.forEach(function(p){names[p.uid]=p.name});
  var view={
    v:1, pointsOnly:!!g.pointsOnly, guesses:g.guesses.map(function(row){return {uid:row.uid, word:row.word, marks:row.marks.slice()}}),
    score:Object.assign({}, g.score), order:g.order.slice(), names:names,
    solvedBy:g.solvedBy, handTo:g.handTo, log:g.log.slice(), max:MAX_GUESSES, starter:g.starter
  };
  if(g.seal) view.seal=g.seal;
  if(g.phase==="end"&&g.word){view.word=g.word; view.awards=awards(g)}
  return view;
}

var api={
  MIN_PLAYERS:MIN_PLAYERS, MAX_PLAYERS:MAX_PLAYERS, NAME_MAX:NAME_MAX, MAX_GUESSES:MAX_GUESSES, WORD_LEN:WORD_LEN,
  IDLE_MS:IDLE_MS, FAST_IDLE_MS:FAST_IDLE_MS,
  randomInt:randomInt, cleanName:cleanName, nameError:nameError, normalize:normalize,
  useWords:useWords, hasGuess:hasGuess, isAnswer:isAnswer, answerCount:answerCount, pickWord:pickWord,
  markGuess:markGuess, lockedCount:lockedCount, pointsFor:pointsFor, guessError:guessError,
  nextSeat:nextSeat, openingTurn:openingTurn, newRound:newRound, nameOf:nameOf,
  submitGuess:submitGuess, applyMarkedGuess:applyMarkedGuess, choose:choose, hand:hand, answerHand:answerHand,
  skipTurn:skipTurn, skipDisconnected:skipDisconnected, removePlayer:removePlayer, setPaused:setPaused,
  awards:awards, publicView:publicView
};
if(typeof module!=="undefined"&&module.exports) module.exports=api;
else root.FrenzyLogic=api;
})(typeof window!=="undefined"?window:this);
