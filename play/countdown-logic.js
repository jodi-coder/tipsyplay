/* Category Countdown rules, with no UI and no Firebase. Two modes:
   Spotlight: one player names as many answers as they can for a category with a target; others can challenge.
     intro -> answer -> cvote (only if something was challenged) -> result -> next player.
   Hot Potato: everyone shares a category and adds one answer per turn; repeats, rejected answers and timeouts knock
     players out until one is left. intro -> turn -> window (challenge?) -> cvote (if challenged) -> turn ... -> result.
   Time is always passed in and the random source can be replaced, so every step is repeatable in tests. */
(function(root){
"use strict";

var MIN_PLAYERS=3, MAX_PLAYERS=10, NAME_MAX=12, ANSWER_MAX=60;
var T={intro:3000, answer:30000, cvote:6000, result:6000, window:3000, potatoVote:5000, laps:[8000, 6000, 5000]};
function fast(){Object.assign(T, {intro:1200, answer:9000, cvote:4000, result:3000, window:2500, potatoVote:4000, laps:[6000, 5000, 4000]})}

function defaultRng(n){
  var c=typeof globalThis!=="undefined"&&globalThis.crypto;
  if(c&&c.getRandomValues){var a=new Uint32Array(1), limit=Math.floor(4294967296/n)*n; for(;;){c.getRandomValues(a); if(a[0]<limit) return a[0]%n}}
  return Math.floor(Math.random()*n);
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

/* ---------- answer matching ---------- */
/* One word to its simple singular: berries -> berry, boxes -> box, cats -> cat. Short words and -ss are left alone. */
function singular(w){
  if(w.length>4&&/ies$/.test(w)) return w.slice(0, -3)+"y";
  if(w.length>4&&/(ches|shes|sses|xes|zes)$/.test(w)) return w.slice(0, -2);
  if(w.length>3&&/s$/.test(w)&&!/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}
/* Case, accents, punctuation, extra spaces, a leading "the/a/an" and simple plurals don't matter. */
function key(text){
  var t=String(text==null?"":text);
  if(t.normalize) t=t.normalize("NFD").replace(/[̀-ͯ]/g, "");
  t=t.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/^(the|a|an) /, "");
  return t.split(" ").filter(Boolean).map(singular).join(" ");
}
function typos(a, b){
  var m=a.length, n=b.length, i, j, d=[];
  if(Math.abs(m-n)>2) return 3;
  for(i=0;i<=m;i++) d[i]=[i];
  for(j=1;j<=n;j++) d[0][j]=j;
  for(i=1;i<=m;i++) for(j=1;j<=n;j++){
    d[i][j]=Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+(a.charAt(i-1)===b.charAt(j-1)?0:1));
    if(i>1&&j>1&&a.charAt(i-1)===b.charAt(j-2)&&a.charAt(i-2)===b.charAt(j-1)) d[i][j]=Math.min(d[i][j], d[i-2][j-2]+1);
  }
  return d[m][n];
}
/* Same answer: identical once normalised, identical without spaces, or one slip apart on a single word of 6+ letters
   (only single words, so "grade a" and "grade b" stay different). */
function same(a, b){
  var ka=key(a), kb=key(b);
  if(!ka||!kb) return false;
  if(ka===kb) return true;
  var sa=ka.replace(/ /g, ""), sb=kb.replace(/ /g, "");
  if(sa===sb) return true;
  return ka.indexOf(" ")<0&&kb.indexOf(" ")<0&&Math.min(sa.length, sb.length)>=6&&typos(sa, sb)<=1;
}
function isRepeat(G, text){return G.answers.some(function(a){return a.status!=="dup"&&same(a.text, text)})}

/* ---------- setup ---------- */
function newGame(players, opts){
  opts=opts||{};
  if(!players||players.length<MIN_PLAYERS||players.length>MAX_PLAYERS) throw new Error("Need "+MIN_PLAYERS+" to "+MAX_PLAYERS+" players.");
  var names={}, scores={}, stats={}, order=[];
  players.forEach(function(p){
    order.push(p.uid); names[p.uid]=cleanName(p.name).slice(0, NAME_MAX)||"Player"; scores[p.uid]=0;
    stats[p.uid]={accepted:0, challenged:0, freezes:0, gaps:0, gapMs:0};
  });
  var laps=opts.laps===2?2:1, mode=opts.mode==="potato"?"potato":"spot";
  return {v:1, mode:mode, order:order, seats:order.slice(), names:names, scores:scores, stats:stats,
    pack:/^(mild|spicy|extra)$/.test(opts.pack)?opts.pack:"mild", diff:/^(easy|medium|hard)$/.test(opts.diff)?opts.diff:"mixed", na:!!opts.na,
    laps:laps, rounds:mode==="spot"?laps*order.length:laps*3, played:0, seat:0, usedCats:[],
    phase:"idle", deadline:0, phaseAt:0, cat:null, actor:"", answers:[], challenges:{}, cvotes:{}, voteIds:[], lastAt:0,
    alive:[], out:[], turn:0, lap:0, lapStart:"", current:"", drank:{}, drinks:[], choices:{}, outcome:null, end:null, note:""};
}
function pickCategory(G, data, rng){
  var r=rng||defaultRng, list=data.list, pool=[], i;
  for(i=0;i<list.length;i++){
    var c=list[i];
    if(c.pack!==G.pack) continue;
    if(G.diff!=="mixed"&&c.d!==G.diff) continue;
    if(G.usedCats.indexOf(i)<0) pool.push(i);
  }
  if(!pool.length){G.usedCats=[]; return pickCategory(G, data, r)}
  var k=pool[r(pool.length)]; G.usedCats.push(k);
  return {text:list[k].text, d:list[k].d, target:list[k].target};
}
function startRound(G, data, now, rng, away){
  if(G.played>=G.rounds||G.order.length<MIN_PLAYERS){finish(G); return G}
  G.cat=pickCategory(G, data, rng);
  G.answers=[]; G.challenges={}; G.cvotes={}; G.voteIds=[]; G.drank={}; G.drinks=[]; G.choices={}; G.outcome=null; G.note=""; G.current="";
  if(G.mode==="spot"){
    var n=G.seats.length, tries=0, a="";
    while(tries<n){a=G.seats[(G.seat+tries)%n]; if(G.order.indexOf(a)>=0&&!(away&&away[a])) break; a=""; tries++}
    G.seat+=tries;
    if(!a){finish(G); return G}
    G.actor=a;
  }else{
    G.alive=G.order.filter(function(u){return !(away&&away[u])});
    if(G.alive.length<2) G.alive=G.order.slice();
    var start=G.played%G.alive.length;
    G.alive=G.alive.slice(start).concat(G.alive.slice(0, start));
    G.out=[]; G.turn=0; G.lap=0; G.actor=G.alive[0];
  }
  setPhase(G, "intro", now, T.intro);
  return G;
}
function setPhase(G, p, now, ms){G.phase=p; G.phaseAt=now; G.deadline=ms?now+ms:0}

/* ---------- answers and challenges ---------- */
/* Returns {ok}, {dup:true} (a repeat), or {error}. In Hot Potato a repeat knocks the player out. */
function addAnswer(G, uid, text, now){
  var phaseOk=(G.mode==="spot"&&G.phase==="answer")||(G.mode==="potato"&&G.phase==="turn");
  if(!phaseOk||uid!==G.actor) return {error:"Not your turn."};
  var t=String(text==null?"":text).replace(/\s+/g, " ").trim().slice(0, ANSWER_MAX);
  if(!key(t)) return {error:"Type an answer."};
  if(isRepeat(G, t)){
    if(G.mode==="potato"){knock(G, uid, "repeat", now, t); return {dup:true, out:true}}
    return {dup:true};
  }
  var gap=now-(G.lastAt||G.phaseAt); G.lastAt=now;
  var a={id:"a"+G.answers.length, uid:uid, text:t, at:now, status:"ok"};
  G.answers.push(a);
  G.stats[uid].gaps+=1; G.stats[uid].gapMs+=Math.max(0, gap);
  if(G.mode==="potato"){G.current=a.id; setPhase(G, "window", now, T.window)}
  return {ok:true, id:a.id};
}
function canChallenge(G, uid){
  if(G.order.indexOf(uid)<0) return false;
  if(G.mode==="spot") return G.phase==="answer"&&uid!==G.actor;
  return G.phase==="window"&&uid!==G.actor;
}
/* on: true to challenge, false to take it back. */
function challenge(G, uid, id, on){
  if(!canChallenge(G, uid)) return false;
  var a=G.answers.filter(function(x){return x.id===id&&x.status==="ok"})[0]; if(!a) return false;
  if(G.mode==="potato"&&id!==G.current) return false;
  var c=G.challenges[id]||(G.challenges[id]={});
  if(on===false){if(!c[uid]) return false; delete c[uid]; if(!Object.keys(c).length) delete G.challenges[id]; return true}
  if(c[uid]) return false;
  c[uid]=true; return true;
}
function challengedIds(G){return Object.keys(G.challenges).filter(function(id){return Object.keys(G.challenges[id]).length>0})}
function voters(G){var answerer=G.actor; return G.order.filter(function(u){return u!==answerer})}
function openVote(G, now){
  G.voteIds=challengedIds(G);
  G.voteIds.forEach(function(id){var a=G.answers.filter(function(x){return x.id===id})[0]; if(a) G.stats[a.uid].challenged+=1});
  G.cvotes={};
  setPhase(G, "cvote", now, G.mode==="spot"?T.cvote:T.potatoVote);
}
/* v: "u" keeps it, "d" throws it out. One vote per voter per answer. */
function castVote(G, uid, id, v){
  if(G.phase!=="cvote"||voters(G).indexOf(uid)<0||G.voteIds.indexOf(id)<0||!/^[ud]$/.test(v)) return false;
  var m=G.cvotes[id]||(G.cvotes[id]={});
  if(m[uid]) return false;
  m[uid]=v; return true;
}
function allVoted(G, away){
  var vs=voters(G).filter(function(u){return !(away&&away[u])});
  return G.voteIds.every(function(id){var m=G.cvotes[id]||{}; return vs.every(function(u){return !!m[u]})});
}
/* More thumbs down than up removes an answer; a tie keeps it. */
function closeVote(G){
  var rejected=[];
  G.voteIds.forEach(function(id){
    var m=G.cvotes[id]||{}, up=0, down=0;
    Object.keys(m).forEach(function(u){if(m[u]==="d") down++; else up++});
    var a=G.answers.filter(function(x){return x.id===id})[0];
    if(a){a.up=up; a.down=down; if(down>up){a.status="out"; rejected.push(a)}}
  });
  return rejected;
}

/* ---------- drinks ---------- */
function drinkOrAlt(G, uid){if(G.na||G.drank[uid]) return "alt"; G.drank[uid]=true; return "drink"}
function owe(G, uid, why){G.drinks.push({uid:uid, why:why, what:drinkOrAlt(G, uid)})}
/* kind: "drink", "alt" or "pass". Never blocks the game. */
function choose(G, uid, kind){
  if(!/^(drink|alt|pass)$/.test(kind)) return false;
  if(!G.drinks.some(function(d){return d.uid===uid})||G.choices[uid]) return false;
  G.choices[uid]=kind; return true;
}

/* ---------- Spotlight ---------- */
function resolveSpot(G, now){
  var ok=G.answers.filter(function(a){return a.status==="ok"}), hit=ok.length>=G.cat.target;
  G.scores[G.actor]+=ok.length+(hit?1:0);
  G.stats[G.actor].accepted+=ok.length;
  if(hit) G.order.forEach(function(u){if(u!==G.actor) owe(G, u, G.names[G.actor]+" hit the target")});
  else{owe(G, G.actor, "missed the target"); G.stats[G.actor].freezes+=1}
  G.outcome={mode:"spot", actor:G.actor, count:ok.length, target:G.cat.target, hit:hit};
  setPhase(G, "result", now, T.result);
}

/* ---------- Hot Potato ---------- */
function lapTime(G){return T.laps[Math.min(G.lap, T.laps.length-1)]}
function knock(G, uid, why, now, text){
  var i=G.alive.indexOf(uid); if(i<0) return;
  G.alive.splice(i, 1);
  if(i<G.turn) G.turn--;
  G.out.push({uid:uid, why:why, text:text||"", at:now});
  if(why==="time"||G.out.length===1) G.stats[uid].freezes+=1;
  owe(G, uid, why==="repeat"?"said a repeat":why==="rejected"?"had an answer thrown out":"ran out of time");
  if(G.alive.length<=1){endPotato(G, now); return}
  nextTurn(G, now, true);
}
function nextTurn(G, now, stay){
  if(!stay) G.turn+=1;
  if(G.turn>=G.alive.length){G.turn=0; G.lap+=1}
  G.actor=G.alive[G.turn]; G.current="";
  setPhase(G, "turn", now, lapTime(G));
}
function endPotato(G, now){
  var winner=G.alive[0]||"", second=G.out.length?G.out[G.out.length-1].uid:"";
  if(winner) G.scores[winner]+=3;
  if(second) G.scores[second]+=1;
  G.order.forEach(function(u){G.stats[u].accepted+=G.answers.filter(function(a){return a.uid===u&&a.status==="ok"}).length});
  G.actor=""; G.outcome={mode:"potato", winner:winner, second:second};
  setPhase(G, "result", now, T.result);
}

/* ---------- the clock ---------- */
function nextRound(G, data, now, rng, away){
  G.played+=1;
  if(G.mode==="spot") G.seat+=1;
  startRound(G, data, now, rng, away);
}
function tick(G, data, now, rng, away){
  var p=G.phase;
  if(p==="intro"&&now>=G.deadline){
    if(G.mode==="spot"){setPhase(G, "answer", now, T.answer); G.lastAt=now}
    else setPhase(G, "turn", now, lapTime(G));
    return G.phase;
  }
  if(G.mode==="spot"){
    if(p==="answer"&&now>=G.deadline){if(challengedIds(G).length) openVote(G, now); else resolveSpot(G, now); return G.phase}
    if(p==="cvote"&&(now>=G.deadline||allVoted(G, away))){closeVote(G); resolveSpot(G, now); return G.phase}
  }else{
    if(p==="turn"&&(now>=G.deadline||(away&&away[G.actor]))){knock(G, G.actor, "time", now); return G.phase}
    if(p==="window"&&now>=G.deadline){if(challengedIds(G).length) openVote(G, now); else nextTurn(G, now); return G.phase}
    if(p==="cvote"&&(now>=G.deadline||allVoted(G, away))){
      var who=G.actor, out=closeVote(G);
      if(out.length) knock(G, who, "rejected", now, out[0].text); else nextTurn(G, now);
      return G.phase;
    }
  }
  if(p==="result"&&now>=G.deadline){nextRound(G, data, now, rng, away); return G.phase}
  return "";
}
/* A player leaves: out of the order; in Hot Potato they are simply out (no drink); a Spotlight actor's round ends. */
function leave(G, uid, now){
  var i=G.order.indexOf(uid); if(i<0) return false;
  G.order.splice(i, 1);
  if(G.order.length<MIN_PLAYERS){finish(G); return true}
  if(G.mode==="potato"&&G.alive.indexOf(uid)>=0&&G.phase!=="result"){
    var k=G.alive.indexOf(uid); G.alive.splice(k, 1); if(k<G.turn) G.turn--;
    if(G.alive.length<=1) endPotato(G, now);
    else if(uid===G.actor) nextTurn(G, now, true);
  }else if(G.mode==="spot"&&uid===G.actor&&G.phase!=="result"){
    G.note=G.names[uid]+" left, so this round was skipped."; G.outcome=null; setPhase(G, "result", now, T.result);
  }
  return true;
}
/* The host changed mid-vote: throw out the round's challenges (nobody drinks) and move on. */
function dismiss(G, now, note){
  if(G.phase!=="cvote") return false;
  G.voteIds=[]; G.cvotes={}; G.note=note||"Round skipped.";
  if(G.mode==="spot"){G.outcome=null; setPhase(G, "result", now, T.result)}
  else nextTurn(G, now);
  return true;
}

/* ---------- the end ---------- */
function standings(G){
  return Object.keys(G.scores).map(function(u){return {uid:u, name:G.names[u], score:G.scores[u], here:G.order.indexOf(u)>=0}})
    .sort(function(a,b){return b.score-a.score||a.name.localeCompare(b.name)});
}
function top(G, val, low){
  var best=null, who=[];
  Object.keys(G.stats).forEach(function(u){
    var v=val(G.stats[u]); if(v==null||v<=0&&!low) return;
    if(best===null||(low?v<best:v>best)){best=v; who=[u]} else if(v===best) who.push(u);
  });
  return best===null?null:{uids:who, value:best};
}
function awards(G){
  var out=[], a;
  if((a=top(G, function(s){return s.gaps>=2?s.gapMs/s.gaps:null}, true))) out.push({key:"fastest", title:"Fastest Mouth", line:"One answer every "+(a.value/1000).toFixed(1)+" seconds.", uids:a.uids});
  if((a=top(G, function(s){return s.challenged})) ) out.push({key:"challenged", title:"Most Challenged", line:a.value+" answer"+(a.value===1?"":"s")+" put on trial.", uids:a.uids});
  if((a=top(G, function(s){return s.accepted}))) out.push({key:"royal", title:"Category Royalty", line:a.value+" answer"+(a.value===1?"":"s")+" accepted.", uids:a.uids});
  if((a=top(G, function(s){return s.freezes}))) out.push({key:"freeze", title:"Brain Freeze", line:"Froze "+a.value+" time"+(a.value===1?"":"s")+".", uids:a.uids});
  return out;
}
function finish(G){setPhase(G, "end", G.phaseAt||0, 0); G.end={standings:standings(G), awards:awards(G)}}

/* ---------- what everyone may see ---------- */
function copy(o){var out={}; Object.keys(o||{}).forEach(function(k){out[k]=o[k]}); return out}
/* Answers and challenges are public; how people voted on a challenge stays hidden until the vote closes. */
function publicView(G){
  var v={v:1, mode:G.mode, phase:G.phase, pack:G.pack, na:G.na, round:Math.min(G.played+1, G.rounds), rounds:G.rounds,
    order:G.order.slice(), names:copy(G.names), scores:copy(G.scores), cat:G.cat, actor:G.actor, note:G.note||"",
    answers:G.answers.map(function(a){var o={id:a.id, uid:a.uid, text:a.text, status:a.status}; if(G.phase!=="cvote"&&a.up!=null){o.up=a.up; o.down=a.down} return o}),
    challenges:{}, voteIds:G.phase==="cvote"?G.voteIds.slice():[], votesIn:0, drinks:G.drinks.slice(), choices:copy(G.choices), outcome:G.outcome};
  Object.keys(G.challenges).forEach(function(id){v.challenges[id]=Object.keys(G.challenges[id])});
  if(G.phase==="cvote") v.votesIn=G.voteIds.reduce(function(n, id){return n+Object.keys(G.cvotes[id]||{}).length}, 0);
  if(G.mode==="potato"){v.alive=G.alive.slice(); v.out=G.out.slice(); v.lap=G.lap; v.current=G.current; v.turnMs=lapTime(G)}
  if(G.phase==="end") v.end=G.end;
  return v;
}

var api={fast:fast, MIN_PLAYERS:MIN_PLAYERS, MAX_PLAYERS:MAX_PLAYERS, NAME_MAX:NAME_MAX, ANSWER_MAX:ANSWER_MAX, T:T, rng:defaultRng,
  cleanName:cleanName, nameError:nameError, singular:singular, key:key, typos:typos, same:same, isRepeat:isRepeat,
  newGame:newGame, pickCategory:pickCategory, startRound:startRound, addAnswer:addAnswer, canChallenge:canChallenge, challenge:challenge,
  challengedIds:challengedIds, voters:voters, openVote:openVote, castVote:castVote, allVoted:allVoted, closeVote:closeVote,
  drinkOrAlt:drinkOrAlt, choose:choose, resolveSpot:resolveSpot, lapTime:lapTime, knock:knock, nextTurn:nextTurn, endPotato:endPotato,
  nextRound:nextRound, tick:tick, leave:leave, dismiss:dismiss, standings:standings, awards:awards, finish:finish, publicView:publicView};
root.CountdownLogic=api;
if(typeof module!=="undefined"&&module.exports) module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
