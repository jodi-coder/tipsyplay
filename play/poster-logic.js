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

function splitPoints(prediction, actual, eligibleCount){
  var diff;
  if(eligibleCount<2) return {points:0, unscored:true, reason:"need-two"};
  if(prediction==null || prediction==="pass" || prediction==="") return {points:0, unscored:false, reason:"pass"};
  diff=Math.abs(+prediction-+actual);
  if(eligibleCount===2) return {points:diff===0?1:0, unscored:false, reason:diff===0?"exact":"miss"};
  if(diff===0) return {points:2, unscored:false, reason:"exact"};
  if(diff===1) return {points:1, unscored:false, reason:"adjacent"};
  return {points:0, unscored:false, reason:"miss"};
}
function parseSplitSeal(raw){
  var parts;
  if(raw==null || raw==="" || raw==="pass") return {pref:"pass", pred:null};
  parts=String(raw).split("|");
  if(parts[0]!=="A" && parts[0]!=="B") return {pref:"pass", pred:null};
  if(parts.length<2 || parts[1]==="") return {pref:parts[0], pred:null};
  if(parts[1]==="pass") return {pref:parts[0], pred:"pass"};
  if(!/^\d+$/.test(parts[1])) return {pref:parts[0], pred:null};
  return {pref:parts[0], pred:+parts[1]};
}
function encodeSplitSeal(pref, pred){
  if(pref!=="A" && pref!=="B") return "pass";
  if(pred==null) return pref;
  if(pred==="pass") return pref+"|pass";
  return pref+"|"+String(pred);
}
function othersChoseA(prefs, eligible, selfUid){
  var count=0, denom=0, i, uid;
  for(i=0;i<eligible.length;i++){
    uid=eligible[i];
    if(uid===selfUid) continue;
    denom++;
    if(prefs[uid]==="A") count++;
  }
  return {count:count, denom:denom};
}
function scoreSplitRound(frozenEligible, sealedByUid){
  var prefs={}, rows=[], aCount=0, bCount=0, i, uid, parsed, tally, self;
  frozenEligible=frozenEligible||[];
  sealedByUid=sealedByUid||{};
  for(i=0;i<frozenEligible.length;i++){
    uid=frozenEligible[i];
    parsed=parseSplitSeal(sealedByUid[uid]);
    prefs[uid]=parsed.pref==="A"||parsed.pref==="B"?parsed.pref:null;
    if(prefs[uid]==="A") aCount++;
    else if(prefs[uid]==="B") bCount++;
  }
  for(i=0;i<frozenEligible.length;i++){
    uid=frozenEligible[i];
    parsed=parseSplitSeal(sealedByUid[uid]);
    self=othersChoseA(prefs, frozenEligible, uid);
    tally=splitPoints(parsed.pred, self.count, frozenEligible.length);
    rows.push({
      uid:uid,
      pref:parsed.pref,
      pred:parsed.pred,
      actual:self.count,
      denom:self.denom,
      points:tally.points,
      unscored:tally.unscored,
      reason:tally.reason
    });
  }
  return {
    eligible:frozenEligible.slice(),
    eligibleCount:frozenEligible.length,
    aCount:aCount,
    bCount:bCount,
    unscored:frozenEligible.length<2,
    rows:rows
  };
}
function eligibleFromPref(roster, tally){
  return (roster||[]).filter(function(uid){return tally && tally[uid]===1});
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
  splitPoints:splitPoints, parseSplitSeal:parseSplitSeal, encodeSplitSeal:encodeSplitSeal,
  othersChoseA:othersChoseA, scoreSplitRound:scoreSplitRound, eligibleFromPref:eligibleFromPref,
  checkDeck:checkDeck
};
global.PosterLogic=api;
if(typeof module!=="undefined" && module.exports) module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
