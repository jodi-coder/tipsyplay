/* Pure rules for Split Decision.
   No DOM, no Firebase. Browser and node tests both load this file.
   Mechanisms are original to TipsyPlay. They are not Majority Rules,
   Wavelength, or Lowest Unique Number — those were inspiration only. */
(function(global){
"use strict";
var LENGTH = {split:8};
var MIN_PLAYERS = 2;
var MAX_PLAYERS = 10;

function hashStr(s){
  var h=2166136261, i, c;
  s=String(s||"");
  for(i=0;i<s.length;i++){
    c=s.charCodeAt(i);
    h^=c;
    h=Math.imul(h, 16777619);
  }
  return h>>>0;
}
function mulberry32(seed){
  var a=seed>>>0;
  return function(){
    a=a+0x6D2B79F5|0;
    var t=Math.imul(a^a>>>15, 1|a);
    t=t+Math.imul(t^t>>>7, 61|t)^t;
    return ((t^t>>>14)>>>0)/4294967296;
  };
}
function shuffle(list, seed){
  var a=list.slice(), rng=mulberry32(hashStr(seed)), i, j, t;
  for(i=a.length-1;i>0;i--){
    j=Math.floor(rng()*(i+1));
    t=a[i]; a[i]=a[j]; a[j]=t;
  }
  return a;
}
function dealIds(all, seed, used, count){
  var seen={}, bag, fresh, dealt, i;
  (used||[]).forEach(function(id){seen[id]=1});
  bag=shuffle(all, seed).filter(function(id){return !seen[id]});
  if(bag.length<count){
    fresh=shuffle(all, String(seed)+"|wrap|"+String((used||[]).length));
    for(i=0;i<fresh.length && bag.length<all.length;i++){
      if(!seen[fresh[i]] && bag.indexOf(fresh[i])<0) bag.push(fresh[i]);
    }
    for(i=0;i<fresh.length && bag.length<count;i++){
      if(bag.indexOf(fresh[i])<0) bag.push(fresh[i]);
    }
  }
  dealt=bag.slice(0, count);
  return {dealt:dealt, used:(used||[]).concat(dealt)};
}
function inviteUrl(origin, path, code, game){
  var host="", base, local;
  try{host=new URL(origin).host}catch(e){host=String(origin||"").replace(/^https?:\/\//,"").split("/")[0]}
  local=/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
  base=local?String(origin||"").replace(/\/$/,"")+path:"https://tipsyplay.com"+path;
  return base+"?room="+code+"&game="+game;
}

/* ---- Split Decision scoring (Phase 1) ----
   Cheat-proof scoring would need server-side code (Cloud Functions), which is
   out of scope for this phase. The host's phone runs scoreRound once per round
   and writes the result; every phone then shows that one stored result. */
var SPLIT_SECONDS = 20;
var HOLD_SECONDS = 15;          /* reveal + leaderboard before the next round starts on its own */
var SPLIT_ROUNDS = 8;
var SUDDEN_MAX = 3;             /* sudden-death rounds before a tie is shared */
var STAKES = [1, 2, 3];
var RESULTS = {exact:"exact", one:"one-away", miss:"miss", missed:"missed"};
var POINTS = {"exact":2, "one-away":1, "miss":0, "missed":0};

function cleanStake(v){v=+v; return v===2||v===3?v:1}
/* Seal: "A", then "A|guess|stake". A missing stake is 1x. */
function parseSplitSeal(raw){
  var parts;
  if(raw==null || raw==="") return {pref:null, pred:null, stake:1};
  parts=String(raw).split("|");
  if(parts[0]!=="A" && parts[0]!=="B") return {pref:null, pred:null, stake:1};
  if(parts.length<2 || !/^\d+$/.test(parts[1])) return {pref:parts[0], pred:null, stake:1};
  return {pref:parts[0], pred:+parts[1], stake:cleanStake(parts[2])};
}
function encodeSplitSeal(pref, pred, stake){
  if(pref!=="A" && pref!=="B") return "";
  if(pred==null || pred==="") return pref;
  return pref+"|"+String(pred)+(stake&&cleanStake(stake)!==1?"|"+cleanStake(stake):"");
}
/* Confidence betting: EXACT and ONE AWAY multiply by the stake; a MISS at 2x costs 1, at 3x costs 2. */
function stakePoints(result, stake){
  stake=cleanStake(stake);
  if(result===RESULTS.missed) return 0;
  if(result===RESULTS.miss) return stake===1?0:1-stake;
  return POINTS[result]*stake;
}

/* players: [{id, answer:"A"|"B"|null, prediction:number|null}] in round order.
   N is every player in the round. A player's prediction is how many OTHER
   players chose A, so a player who chose A is compared with A minus 1.
   A repeated id is a duplicate submission: the first one wins. */
function scoreRound(players){
  var seen={}, list=[], aCount=0, bCount=0, n, rows;
  (players||[]).forEach(function(p){
    if(!p || p.id==null || seen[p.id]) return;
    seen[p.id]=1;
    var ans=p.answer==="A"||p.answer==="B"?p.answer:null;
    list.push({id:String(p.id), answer:ans, prediction:p.prediction, stake:cleanStake(p.stake)});
    if(ans==="A") aCount++;
    else if(ans==="B") bCount++;
  });
  n=list.length;
  /* The minority side has strictly fewer pickers; an even split has no minority. */
  var minority=aCount<bCount&&aCount>0?"A":bCount<aCount&&bCount>0?"B":null;
  rows=list.map(function(p){
    var pred=p.prediction, target, error, result;
    if(!p.answer) return {id:p.id, answer:null, prediction:null, stake:1, target:null, error:null, result:RESULTS.missed, base:0, points:0, minority:false};
    var valid=typeof pred==="number" && isFinite(pred) && Math.floor(pred)===pred && pred>=0 && pred<=n-1;
    target=p.answer==="A"?aCount-1:aCount;
    if(!valid) return {id:p.id, answer:p.answer, prediction:null, stake:1, target:target, error:null, result:RESULTS.miss, base:0, points:0, minority:p.answer===minority};
    error=Math.abs(pred-target);
    result=error===0?RESULTS.exact:error===1?RESULTS.one:RESULTS.miss;
    /* base is the Phase 1 score (2/1/0); points applies the confidence stake. */
    return {id:p.id, answer:p.answer, prediction:pred, stake:p.stake, target:target, error:error, result:result, base:POINTS[result], points:stakePoints(result, p.stake), minority:p.answer===minority};
  });
  var answered=aCount+bCount;
  return {n:n, aCount:aCount, bCount:bCount, answered:answered, minority:minority, pctA:answered?Math.round(aCount*100/answered):0, rows:rows};
}

/* Running totals. prev: {id:{total, exact, hits, played, streak}} from the last stored round. */
function nextStats(prev, scored){
  var out={};
  Object.keys(prev||{}).forEach(function(id){out[id]=Object.assign({}, prev[id])});
  scored.rows.forEach(function(r){
    var p=out[r.id]||{total:0, exact:0, hits:0, played:0, streak:0, best:0, minority:0, bold:0};
    var hit=r.result===RESULTS.exact||r.result===RESULTS.one;
    var streak=hit?(p.streak||0)+1:0;
    out[r.id]={
      total:(p.total||0)+r.points,
      exact:(p.exact||0)+(r.result===RESULTS.exact?1:0),
      hits:(p.hits||0)+(hit?1:0),
      played:(p.played||0)+1,
      streak:streak,
      best:Math.max(p.best||0, streak),
      minority:(p.minority||0)+(r.minority?1:0),
      bold:(p.bold||0)+((r.stake||1)>1&&r.points>0?r.points:0)
    };
  });
  return out;
}

/* Stored row, one per player, at nhie/cast/$uid (max 128 chars).
   v3|game|round|answer|prediction|stake|result|points|total|exact|hits|played|streak|best|minority|bold
   v2 rows (Phase 1, no stake or award fields) still decode. */
var CODES={"exact":"E", "one-away":"O", "miss":"M", "missed":"X"};
var UNCODES={E:"exact", O:"one-away", M:"miss", X:"missed"};
function encodeResult(gameId, round, row, stat){
  return ["v3", gameId|0, round|0, row.answer||"-", row.prediction==null?"-":row.prediction, cleanStake(row.stake), CODES[row.result]||"X", row.points|0,
    stat.total|0, stat.exact|0, stat.hits|0, stat.played|0, stat.streak|0, stat.best|0, stat.minority|0, stat.bold|0].join("|");
}
function decodeResult(raw){
  var p=String(raw||"").split("|");
  if(p[0]==="v2" && p.length===12) p=p.slice(0, 5).concat(["1"], p.slice(5), [p[11], "0", "0"]).map(String);
  else if(p[0]!=="v3" || p.length!==16) return null;
  if(!UNCODES[p[6]]) return null;
  var num=function(i){var v=+p[i]; return isFinite(v)?v:0};
  return {gameId:num(1), round:num(2), answer:p[3]==="A"||p[3]==="B"?p[3]:null, prediction:p[4]==="-"?null:num(4), stake:cleanStake(p[5]),
    result:UNCODES[p[6]], points:num(7), total:num(8), exact:num(9), hits:num(10), played:num(11), streak:num(12), best:num(13), minority:num(14), bold:num(15)};
}

/* Leaderboard from stored rows. entries: [{id, name, total, points (this round), exact, hits, played, streak}].
   Equal totals share a rank (1, 1, 3). Biggest mover = most places gained since the last round. */
function rankOf(sorted, key){
  var ranks={}, i, last=null, rank=0;
  for(i=0;i<sorted.length;i++){
    if(sorted[i][key]!==last){rank=i+1; last=sorted[i][key]}
    ranks[sorted[i].id]=rank;
  }
  return ranks;
}
function byName(a, b){return String(a.name||a.id).localeCompare(String(b.name||b.id))}
function rankBoard(entries, firstRound){
  var list=(entries||[]).map(function(e){
    return Object.assign({}, e, {before:(e.total||0)-(e.points||0), accuracy:e.played?Math.round((e.hits||0)*100/e.played):0});
  });
  var prev=list.slice().sort(function(a, b){return b.before-a.before||byName(a, b)});
  var prevRank=rankOf(prev, "before");
  list.sort(function(a, b){return b.total-a.total||b.exact-a.exact||byName(a, b)});
  var rank=rankOf(list, "total");
  var top=list.length?list[0].total:0, best=0, mover=null;
  prev.forEach(function(p, i){p.prevIndex=i});
  var prevIndex={}; prev.forEach(function(p){prevIndex[p.id]=p.prevIndex});
  list.forEach(function(e){
    e.rank=rank[e.id];
    e.prevRank=prevRank[e.id];
    e.prevIndex=prevIndex[e.id];
    e.moved=e.prevRank-e.rank;
    e.leader=top>0 && e.total===top;
    if(!firstRound && e.moved>best){best=e.moved; mover=e.id}
  });
  list.forEach(function(e){e.mover=e.id===mover});
  return list;
}

/* After the last regular round (or a sudden-death round): the ids tied on the top total, or [] if there is a single leader. */
function tiedLeaders(entries){
  var list=entries||[], top=-Infinity;
  list.forEach(function(e){if(e.total>top) top=e.total});
  var ids=list.filter(function(e){return e.total===top}).map(function(e){return e.id});
  return ids.length>1?ids:[];
}
/* What the host does after a round's results. round is 0-based; sudden is how many sudden-death rounds have been played. */
function afterRound(round, entries, sudden){
  var tied;
  if(round+1<SPLIT_ROUNDS) return {next:"round"};
  tied=tiedLeaders(entries);
  if(tied.length && (sudden||0)<SUDDEN_MAX) return {next:"sudden", ids:tied};
  return {next:"over", shared:tied.length>1};
}
/* End-of-game awards from the stored running stats. An award with no one above 0 is left out; ties share it. */
var AWARDS=[
  {key:"reader", title:"Mind reader", field:"exact", line:function(v){return v+" exact "+(v===1?"guess":"guesses")}},
  {key:"contrarian", title:"Contrarian", field:"minority", line:function(v){return "Minority side "+v+(v===1?" time":" times")}},
  {key:"streak", title:"Hot streak", field:"best", line:function(v){return v+" scoring "+(v===1?"round":"rounds")+" in a row"}},
  {key:"near", title:"So close", field:"near", line:function(v){return v+" one-away "+(v===1?"guess":"guesses")}},
  {key:"roller", title:"High roller", field:"bold", line:function(v){return v+" points won on 2x and 3x"}}
];
function gameAwards(entries){
  var out=[];
  AWARDS.forEach(function(a){
    var best=0, ids=[];
    (entries||[]).forEach(function(e){
      var v=a.field==="near"?(e.hits||0)-(e.exact||0):(e[a.field]||0);
      if(v>best){best=v; ids=[e.id]}
      else if(v===best&&v>0) ids.push(e.id);
    });
    if(best>0) out.push({key:a.key, title:a.title, ids:ids, value:best, line:a.line(best)});
  });
  return out;
}

var QUIPS={
  "exact":["You read the room like a menu.","Mind reader. Slightly unsettling.","Called it. Take a bow.","Nailed the split to the person."],
  "one-away":["So close you could taste it.","One off. The room had one surprise.","Nearly psychic. Nearly.","A whisker away."],
  "miss":["The room had other plans.","Bold guess. Wrong, but bold.","Your friends are a mystery.","That's why we play."],
  "missed":["Too busy with your drink?","The clock won this one.","Sat this one out. Fair.","Next round's yours."]
};
function quipFor(result, seed){
  var list=QUIPS[result]||QUIPS.miss;
  return list[hashStr(seed)%list.length];
}

/* "video" or "still". Still on reduced motion, Save-Data, or 2g/3g. */
function mediaMode(env){
  env=env||{};
  if(env.reducedMotion) return "still";
  var c=env.connection;
  if(c && (c.saveData || /^(slow-2g|2g|3g)$/.test(String(c.effectiveType||"")))) return "still";
  return "video";
}

function checkDeck(cards, expect, categories){
  var ids={}, cats={}, i, card, errors=[];
  if(!cards || cards.length<expect) errors.push("count "+(cards?cards.length:0)+" < "+expect);
  for(i=0;i<(cards||[]).length;i++){
    card=cards[i];
    if(!card.id || ids[card.id]) errors.push("id "+card.id);
    ids[card.id]=1;
    cats[card.cat]=(cats[card.cat]||0)+1;
    if(!card.q) errors.push("blank "+card.id);
  }
  (categories||[]).forEach(function(cat){
    if((cats[cat]||0)<12) errors.push(cat+" "+(cats[cat]||0));
  });
  return errors;
}

var api={
  LENGTH:LENGTH, MIN_PLAYERS:MIN_PLAYERS, MAX_PLAYERS:MAX_PLAYERS,
  hashStr:hashStr, shuffle:shuffle, dealIds:dealIds, inviteUrl:inviteUrl,
  SPLIT_SECONDS:SPLIT_SECONDS, HOLD_SECONDS:HOLD_SECONDS, SPLIT_ROUNDS:SPLIT_ROUNDS, SUDDEN_MAX:SUDDEN_MAX, STAKES:STAKES,
  RESULTS:RESULTS, POINTS:POINTS, stakePoints:stakePoints, tiedLeaders:tiedLeaders, afterRound:afterRound, gameAwards:gameAwards,
  parseSplitSeal:parseSplitSeal, encodeSplitSeal:encodeSplitSeal, scoreRound:scoreRound, nextStats:nextStats,
  encodeResult:encodeResult, decodeResult:decodeResult, rankBoard:rankBoard, quipFor:quipFor, QUIPS:QUIPS, mediaMode:mediaMode,
  checkDeck:checkDeck
};
global.PosterLogic=api;
if(typeof module!=="undefined" && module.exports) module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
