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
var RESULTS = {exact:"exact", one:"one-away", miss:"miss", missed:"missed"};
var POINTS = {"exact":2, "one-away":1, "miss":0, "missed":0};

function parseSplitSeal(raw){
  var parts;
  if(raw==null || raw==="") return {pref:null, pred:null};
  parts=String(raw).split("|");
  if(parts[0]!=="A" && parts[0]!=="B") return {pref:null, pred:null};
  if(parts.length<2 || !/^\d+$/.test(parts[1])) return {pref:parts[0], pred:null};
  return {pref:parts[0], pred:+parts[1]};
}
function encodeSplitSeal(pref, pred){
  if(pref!=="A" && pref!=="B") return "";
  if(pred==null || pred==="") return pref;
  return pref+"|"+String(pred);
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
    list.push({id:String(p.id), answer:ans, prediction:p.prediction});
    if(ans==="A") aCount++;
    else if(ans==="B") bCount++;
  });
  n=list.length;
  rows=list.map(function(p){
    var pred=p.prediction, target, error, result;
    if(!p.answer) return {id:p.id, answer:null, prediction:null, target:null, error:null, result:RESULTS.missed, points:0};
    var valid=typeof pred==="number" && isFinite(pred) && Math.floor(pred)===pred && pred>=0 && pred<=n-1;
    target=p.answer==="A"?aCount-1:aCount;
    if(!valid) return {id:p.id, answer:p.answer, prediction:null, target:target, error:null, result:RESULTS.miss, points:0};
    error=Math.abs(pred-target);
    result=error===0?RESULTS.exact:error===1?RESULTS.one:RESULTS.miss;
    return {id:p.id, answer:p.answer, prediction:pred, target:target, error:error, result:result, points:POINTS[result]};
  });
  var answered=aCount+bCount;
  return {n:n, aCount:aCount, bCount:bCount, answered:answered, pctA:answered?Math.round(aCount*100/answered):0, rows:rows};
}

/* Running totals. prev: {id:{total, exact, hits, played, streak}} from the last stored round. */
function nextStats(prev, scored){
  var out={};
  Object.keys(prev||{}).forEach(function(id){out[id]=Object.assign({}, prev[id])});
  scored.rows.forEach(function(r){
    var p=out[r.id]||{total:0, exact:0, hits:0, played:0, streak:0};
    var hit=r.points>0;
    out[r.id]={
      total:(p.total||0)+r.points,
      exact:(p.exact||0)+(r.result===RESULTS.exact?1:0),
      hits:(p.hits||0)+(hit?1:0),
      played:(p.played||0)+1,
      streak:hit?(p.streak||0)+1:0
    };
  });
  return out;
}

/* Stored row, one per player, at nhie/cast/$uid (max 128 chars).
   v2|game|round|answer|prediction|result|points|total|exact|hits|played|streak */
var CODES={"exact":"E", "one-away":"O", "miss":"M", "missed":"X"};
var UNCODES={E:"exact", O:"one-away", M:"miss", X:"missed"};
function encodeResult(gameId, round, row, stat){
  return ["v2", gameId|0, round|0, row.answer||"-", row.prediction==null?"-":row.prediction, CODES[row.result]||"X", row.points|0,
    stat.total|0, stat.exact|0, stat.hits|0, stat.played|0, stat.streak|0].join("|");
}
function decodeResult(raw){
  var p=String(raw||"").split("|");
  if(p.length!==12 || p[0]!=="v2" || !UNCODES[p[5]]) return null;
  var num=function(i){var v=+p[i]; return isFinite(v)?v:0};
  return {gameId:num(1), round:num(2), answer:p[3]==="A"||p[3]==="B"?p[3]:null, prediction:p[4]==="-"?null:num(4),
    result:UNCODES[p[5]], points:num(6), total:num(7), exact:num(8), hits:num(9), played:num(10), streak:num(11)};
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
  SPLIT_SECONDS:SPLIT_SECONDS, RESULTS:RESULTS, POINTS:POINTS,
  parseSplitSeal:parseSplitSeal, encodeSplitSeal:encodeSplitSeal, scoreRound:scoreRound, nextStats:nextStats,
  encodeResult:encodeResult, decodeResult:decodeResult, rankBoard:rankBoard, quipFor:quipFor, QUIPS:QUIPS, mediaMode:mediaMode,
  checkDeck:checkDeck
};
global.PosterLogic=api;
if(typeof module!=="undefined" && module.exports) module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
