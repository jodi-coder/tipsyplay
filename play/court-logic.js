/* Hot Take Court rules, with no UI and no Firebase.
   The acting host's phone runs a game through these functions; tests load the same file in Node.
   Time is always passed in and the random source can be replaced, so every step is repeatable.

   One case per turn: case (pick a take) -> opening -> prosecution -> deliberation (secret votes)
   -> verdict (votes flip one at a time) -> sentencing (skipped on a hung jury) -> scores -> next case.
   After the last case: end (scoreboard, then awards). */
(function(root){
"use strict";

var MIN_PLAYERS=3, MAX_PLAYERS=8, NAME_MAX=12, OPTIONS=3, SENTENCE_OPTIONS=3;
var T={caseMs:10000, opening:30000, prosecution:20000, deliberation:10000, verdictBase:2200, verdictCard:700, sentencing:12000, scores:4500};
var PHASES=["case","opening","prosecution","deliberation","verdict","sentencing","scores","end"];

/* Shorter timers for automated tests (?emulator=1&fast=1), still long enough for a script to click. */
function fast(){Object.assign(T, {caseMs:4000, opening:4000, prosecution:6000, deliberation:5000, verdictBase:2600, verdictCard:300, sentencing:5000, scores:1500})}
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
function shuffle(list, rng){var r=rng||defaultRng, a=list.slice(), i, j, t; for(i=a.length-1;i>0;i--){j=r(i+1); t=a[i]; a[i]=a[j]; a[j]=t} return a}

/* ---------- setup ---------- */
function newGame(players, opts){
  opts=opts||{};
  if(!players||players.length<MIN_PLAYERS||players.length>MAX_PLAYERS) throw new Error("Need "+MIN_PLAYERS+" to "+MAX_PLAYERS+" players.");
  var names={}, scores={}, stats={}, order=[];
  players.forEach(function(p){
    order.push(p.uid); names[p.uid]=cleanName(p.name).slice(0, NAME_MAX)||"Player"; scores[p.uid]=0;
    stats[p.uid]={convicted:0, acquitted:0, guiltyVotes:0, majority:0, swing:0, objections:0, prosecuted:0};
  });
  var laps=opts.laps===2?2:1;
  return {v:1, order:order, seats:order.slice(), names:names, scores:scores, stats:stats,
    pack:/^(mild|spicy|extra)$/.test(opts.pack)?opts.pack:"mild", na:!!opts.na, laps:laps, cases:laps*order.length,
    caseNo:0, played:0, usedTakes:[], usedSentences:[],
    phase:"idle", deadline:0, defendant:"", prosecutor:"", offer:[], take:"", picked:false, rested:{},
    objections:{}, votes:{}, verdict:null, sentenceOptions:[], sentVotes:{}, choice:"", outcome:null, drank:{}, log:[], end:null, note:""};
}
function jurors(G){return G.order.filter(function(u){return u!==G.defendant&&u!==G.prosecutor})}
function inGame(G, uid){return G.order.indexOf(uid)>=0}
/* Draw n unused items from a list, starting over only when the list runs out. */
function draw(list, used, n, rng){
  var pool=[], i, out=[];
  for(i=0;i<list.length;i++) if(used.indexOf(i)<0) pool.push(i);
  if(pool.length<n){used.length=0; pool=[]; for(i=0;i<list.length;i++) pool.push(i)}
  pool=shuffle(pool, rng).slice(0, n);
  pool.forEach(function(k){used.push(k); out.push(list[k])});
  return out;
}

/* ---------- a case ---------- */
/* Seats rotate: the next present player is the Defendant. A Prosecutor is drawn from the others, fewest cases first. */
function startCase(G, data, now, rng, away){
  var r=rng||defaultRng, n=G.seats.length, tries=0, d="";
  while(tries<n){
    d=G.seats[(G.caseNo+tries)%n];
    if(inGame(G, d)&&!(away&&away[d])) break;
    tries++; d="";
  }
  G.caseNo+=tries;
  if(!d||G.order.length<MIN_PLAYERS){finish(G); return G}
  G.defendant=d;
  var others=G.order.filter(function(u){return u!==d&&!(away&&away[u])});
  if(!others.length) others=G.order.filter(function(u){return u!==d});
  var least=Math.min.apply(null, others.map(function(u){return G.stats[u].prosecuted}));
  var pool=others.filter(function(u){return G.stats[u].prosecuted===least});
  G.prosecutor=pool[r(pool.length)];
  G.offer=draw(data.takes[G.pack]||data.takes.mild, G.usedTakes, OPTIONS, r);
  G.take=""; G.picked=false; G.rested={}; G.objections={}; G.votes={}; G.verdict=null;
  G.sentenceOptions=[]; G.sentVotes={}; G.choice=""; G.outcome=null; G.drank={}; G.note="";
  G.phase="case"; G.deadline=now+T.caseMs;
  return G;
}
function pickTake(G, uid, i){
  if(G.phase!=="case"||uid!==G.defendant||G.picked) return false;
  i=+i; if(!(i>=0&&i<G.offer.length)) return false;
  G.take=G.offer[i]; G.picked=true; return true;
}
/* The speaker can finish early ("I rest my case"). */
function rest(G, uid){
  if(G.phase==="opening"&&uid===G.defendant){G.rested.opening=true; return true}
  if(G.phase==="prosecution"&&uid===G.prosecutor){G.rested.prosecution=true; return true}
  return false;
}
/* Any juror, once per case, during the prosecution. Just for fun: it changes nothing. */
function object(G, uid){
  if(G.phase!=="prosecution"||jurors(G).indexOf(uid)<0||G.objections[uid]) return false;
  G.objections[uid]=true; G.stats[uid].objections+=1; return true;
}
/* v: "g" (guilty) or "n" (not guilty). The first vote is final. */
function vote(G, uid, v){
  if(G.phase!=="deliberation"||jurors(G).indexOf(uid)<0||G.votes[uid]||!/^[gn]$/.test(v)) return false;
  G.votes[uid]=v; return true;
}
function allVoted(G, away){return jurors(G).every(function(u){return !!G.votes[u]||!!(away&&away[u])})}
/* Count the votes. A tie, including no votes at all, is a hung jury. */
function decide(G, now, rng){
  var g=0, n=0, cards=[];
  jurors(G).forEach(function(u){var v=G.votes[u]; if(v==="g") g++; else if(v==="n") n++; if(v) cards.push({uid:u, v:v})});
  var result=g>n?"guilty":n>g?"not":"hung";
  G.verdict={result:result, g:g, n:n, cards:shuffle(cards, rng)};
  score(G);
  G.phase="verdict"; G.deadline=now+T.verdictBase+T.verdictCard*cards.length;
  return G.verdict;
}
/* Defendant +2 for Not Guilty, Prosecutor +1 for Guilty, every juror on the majority side +1. Hung: nobody scores. */
function score(G){
  var v=G.verdict; if(!v||v.result==="hung") return;
  var win=v.result==="guilty"?"g":"n", margin=Math.abs(v.g-v.n);
  if(v.result==="not"){G.scores[G.defendant]+=2; G.stats[G.defendant].acquitted+=1}
  else{G.scores[G.prosecutor]+=1; G.stats[G.defendant].convicted+=1}
  jurors(G).forEach(function(u){
    var mine=G.votes[u]; if(mine==="g") G.stats[u].guiltyVotes+=1;
    if(mine===win){G.scores[u]+=1; G.stats[u].majority+=1; if(margin===1) G.stats[u].swing+=1}
  });
}
/* Sentencing: guilty -> the Defendant chooses; not guilty -> the Prosecutor does. Hung -> skipped. */
function chooser(G){var v=G.verdict; if(!v||v.result==="hung") return ""; return v.result==="guilty"?G.defendant:G.prosecutor}
function openSentencing(G, data, now, rng){
  if(!chooser(G)){toScores(G, now); return}
  if(G.verdict.result==="guilty") G.sentenceOptions=draw(data.sentences, G.usedSentences, SENTENCE_OPTIONS, rng);
  G.altPose=data.poses[(rng||defaultRng)(data.poses.length)];
  G.phase="sentencing"; G.deadline=now+T.sentencing;
}
/* kind: "drink", "alt" (the jury's sentence, or a pose when not guilty) or "pass". */
function choose(G, uid, kind){
  if(G.phase!=="sentencing"||uid!==chooser(G)||G.choice||!/^(drink|alt|pass)$/.test(kind)) return false;
  G.choice=kind; return true;
}
function sentVote(G, uid, i){
  if(G.phase!=="sentencing"||G.verdict.result!=="guilty"||jurors(G).indexOf(uid)<0||G.sentVotes[uid]!=null) return false;
  i=+i; if(!(i>=0&&i<G.sentenceOptions.length)) return false;
  G.sentVotes[uid]=i; return true;
}
function sentencingDone(G, away){
  if(!G.choice) return false;
  if(G.verdict.result!=="guilty") return true;
  return jurors(G).every(function(u){return G.sentVotes[u]!=null||!!(away&&away[u])});
}
/* The jury's pick: most votes; a tie goes to the earliest option; no votes means the first option. */
function winningSentence(G){
  var counts=G.sentenceOptions.map(function(){return 0});
  Object.keys(G.sentVotes).forEach(function(u){counts[G.sentVotes[u]]+=1});
  var best=0; counts.forEach(function(c, i){if(c>counts[best]) best=i});
  return {i:best, text:G.sentenceOptions[best]||"", counts:counts};
}
/* One drink per player per case at most; a second penalty, or points-only mode, becomes the alternative. */
function drinkOrAlt(G, uid){
  if(G.na||G.drank[uid]) return "alt";
  G.drank[uid]=true; return "drink";
}
function resolveSentence(G, now){
  var who=chooser(G), pick=G.choice||"pass", out={uid:who, result:G.verdict.result, pick:pick, what:"pass", sentence:"", pose:G.altPose||""};
  if(G.verdict.result==="guilty"){var w=winningSentence(G); out.sentence=w.text; out.counts=w.counts}
  if(pick==="drink") out.what=drinkOrAlt(G, who);
  else if(pick==="alt") out.what="alt";
  if(!G.choice) out.timedOut=true;
  G.outcome=out;
  G.log.push({caseNo:G.played+1, defendant:G.defendant, prosecutor:G.prosecutor, take:G.take, verdict:G.verdict.result, g:G.verdict.g, n:G.verdict.n, what:out.what});
  toScores(G, now);
}
function toScores(G, now){
  if(G.verdict&&G.verdict.result==="hung"&&!G.outcome) G.log.push({caseNo:G.played+1, defendant:G.defendant, prosecutor:G.prosecutor, take:G.take, verdict:"hung", g:G.verdict.g, n:G.verdict.n, what:"none"});
  G.played+=1; G.caseNo+=1;
  G.phase="scores"; G.deadline=now+T.scores;
}
/* A case is thrown out (the host changed, or a speaker left): nobody scores for it, nobody drinks. */
function dismiss(G, now, note){
  if(G.phase==="end"||G.phase==="idle"||G.phase==="scores") return false;
  if(G.verdict) unscore(G);
  G.verdict=null; G.outcome=null; G.note=note||"Case dismissed.";
  G.played+=1; G.caseNo+=1; G.phase="scores"; G.deadline=now+T.scores;
  return true;
}
function unscore(G){
  var v=G.verdict; if(!v||v.result==="hung") return;
  var win=v.result==="guilty"?"g":"n", margin=Math.abs(v.g-v.n);
  if(v.result==="not"){G.scores[G.defendant]-=2; G.stats[G.defendant].acquitted-=1}
  else{G.scores[G.prosecutor]-=1; G.stats[G.defendant].convicted-=1}
  jurors(G).forEach(function(u){
    var mine=G.votes[u]; if(mine==="g") G.stats[u].guiltyVotes-=1;
    if(mine===win){G.scores[u]-=1; G.stats[u].majority-=1; if(margin===1) G.stats[u].swing-=1}
  });
}
function nextCase(G, data, now, rng, away){
  if(G.played>=G.cases||G.order.length<MIN_PLAYERS){finish(G); return}
  startCase(G, data, now, rng, away);
}

/* The host's clock. Returns what happened, or "". */
function tick(G, data, now, rng, away){
  switch(G.phase){
  case "case":
    if(G.picked||now>=G.deadline){
      if(!G.picked){G.take=G.offer[(rng||defaultRng)(G.offer.length)]; G.picked=true}
      G.stats[G.prosecutor].prosecuted+=1;
      G.phase="opening"; G.deadline=now+T.opening; return "opening";
    } break;
  case "opening":
    if(G.rested.opening||now>=G.deadline||(away&&away[G.defendant])){G.phase="prosecution"; G.deadline=now+T.prosecution; return "prosecution"} break;
  case "prosecution":
    if(G.rested.prosecution||now>=G.deadline||(away&&away[G.prosecutor])){G.phase="deliberation"; G.deadline=now+T.deliberation; return "deliberation"} break;
  case "deliberation":
    if(now>=G.deadline||allVoted(G, away)){decide(G, now, rng); return "verdict"} break;
  case "verdict":
    if(now>=G.deadline){openSentencing(G, data, now, rng); return G.phase} break;
  case "sentencing":
    if(now>=G.deadline||sentencingDone(G, away)||(away&&away[chooser(G)]&&!G.choice&&G.verdict.result!=="guilty")){resolveSentence(G, now); return "scores"} break;
  case "scores":
    if(now>=G.deadline){nextCase(G, data, now, rng, away); return G.phase} break;
  }
  return "";
}
/* A player leaves. If they were speaking this case, the case is thrown out. */
function leave(G, uid, now){
  var i=G.order.indexOf(uid); if(i<0) return false;
  var speaking=uid===G.defendant||uid===G.prosecutor;
  G.order.splice(i, 1); delete G.votes[uid]; delete G.sentVotes[uid]; delete G.objections[uid];
  if(G.order.length<MIN_PLAYERS){finish(G); return true}
  if(speaking&&G.phase!=="scores"&&G.phase!=="end"){
    if(G.verdict&&G.phase!=="verdict"){ /* already decided: let it stand, close sentencing */
      if(G.phase==="sentencing"){G.choice=G.choice||"pass"; resolveSentence(G, now)}
    }else{
      if(G.verdict) unscore(G);
      G.verdict=null; G.note=G.names[uid]+" left, so this case was dismissed.";
      G.played+=1; G.caseNo+=1; G.phase="scores"; G.deadline=now+T.scores;
    }
  }
  return true;
}

/* ---------- the end ---------- */
function standings(G){
  return Object.keys(G.scores).map(function(u){return {uid:u, name:G.names[u], score:G.scores[u], here:G.order.indexOf(u)>=0}})
    .sort(function(a,b){return b.score-a.score||a.name.localeCompare(b.name)});
}
function topBy(G, key){
  var best=0, who=[];
  Object.keys(G.stats).forEach(function(u){var v=G.stats[u][key]; if(v>best){best=v; who=[u]} else if(v===best&&v>0) who.push(u)});
  return best>0?{uids:who, count:best}:null;
}
/* Up to four awards, each only if someone earned it. Ties share. */
function awards(G){
  var out=[], a;
  if((a=topBy(G, "convicted"))) out.push({key:"convicted", title:"Most Convicted", line:"Found guilty "+a.count+" time"+(a.count===1?"":"s")+".", uids:a.uids});
  if((a=topBy(G, "acquitted"))) out.push({key:"smooth", title:"Smooth Talker", line:"Walked free "+a.count+" time"+(a.count===1?"":"s")+".", uids:a.uids});
  if((a=topBy(G, "guiltyVotes"))) out.push({key:"hanging", title:"Hanging Judge", line:"Voted guilty "+a.count+" time"+(a.count===1?"":"s")+".", uids:a.uids});
  if((a=topBy(G, "swing"))) out.push({key:"swing", title:"Swing Vote", line:"On the winning side of "+a.count+" one-vote verdict"+(a.count===1?"":"s")+".", uids:a.uids});
  else if((a=topBy(G, "majority"))) out.push({key:"swing", title:"Swing Vote", line:"Sided with the jury "+a.count+" time"+(a.count===1?"":"s")+".", uids:a.uids});
  return out;
}
function finish(G){
  G.phase="end"; G.deadline=0;
  G.end={standings:standings(G), awards:awards(G)};
}

/* ---------- what everyone may see ---------- */
function copy(o){var out={}; Object.keys(o||{}).forEach(function(k){out[k]=o[k]}); return out}
/* Never the three offered takes (they go privately to the Defendant), never a vote before the verdict. */
function publicView(G){
  var p=G.phase, v={v:1, phase:p, pack:G.pack, na:G.na, caseNo:Math.min(G.played+1, G.cases), cases:G.cases, order:G.order.slice(), names:copy(G.names), scores:copy(G.scores),
    defendant:G.defendant, prosecutor:G.prosecutor, take:(p==="case")?"":G.take, objections:Object.keys(G.objections),
    votesIn:p==="deliberation"?Object.keys(G.votes).length:0, jurors:jurors(G), note:G.note||""};
  if(p==="verdict"||p==="sentencing"||p==="scores") v.verdict=G.verdict;
  if(p==="sentencing"){
    v.chooser=chooser(G); v.sentenceOptions=G.sentenceOptions.slice(); v.pose=G.altPose||"";
    v.sentVotesIn=Object.keys(G.sentVotes).length; v.chosen=!!G.choice;
  }
  if(p==="scores") v.outcome=G.outcome;
  if(p==="end") v.end=G.end;
  return v;
}

var api={fast:fast, MIN_PLAYERS:MIN_PLAYERS, MAX_PLAYERS:MAX_PLAYERS, NAME_MAX:NAME_MAX, T:T, PHASES:PHASES, rng:defaultRng,
  cleanName:cleanName, nameError:nameError, shuffle:shuffle, newGame:newGame, jurors:jurors, startCase:startCase, pickTake:pickTake, rest:rest,
  object:object, vote:vote, allVoted:allVoted, decide:decide, chooser:chooser, openSentencing:openSentencing, choose:choose, sentVote:sentVote,
  winningSentence:winningSentence, drinkOrAlt:drinkOrAlt, resolveSentence:resolveSentence, dismiss:dismiss, nextCase:nextCase, tick:tick, leave:leave,
  standings:standings, awards:awards, finish:finish, publicView:publicView};
root.CourtLogic=api;
if(typeof module!=="undefined"&&module.exports) module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
