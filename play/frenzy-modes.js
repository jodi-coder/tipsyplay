/* Five Letter Frenzy: the rules around Solo and Race, with no screen and no network.
   Solo: the daily word, stats and streaks, the spoiler-free result card.
   Race: who is ahead, and the final order. Tests load this same file in Node. */
(function(root){
"use strict";

var MAX_GUESSES=6;

/* ---------- Solo: the daily word ---------- */
/* Local calendar date as YYYY-MM-DD, so everyone on the same date sees the same word. */
function dateKey(d){
  d=d||new Date();
  var m=d.getMonth()+1, day=d.getDate();
  return d.getFullYear()+"-"+(m<10?"0":"")+m+"-"+(day<10?"0":"")+day;
}
/* FNV-1a, 32 bit: small, fast, and the same everywhere. */
function hash32(text){
  var h=0x811c9dc5, i;
  for(i=0;i<text.length;i++){h^=text.charCodeAt(i); h=Math.imul(h, 0x01000193)>>>0}
  return h>>>0;
}
function dailyIndex(key, count){return count>0?hash32("frenzy-daily|"+key)%count:0}
function dailyWord(key, answers){return answers.length?answers[dailyIndex(key, answers.length)]:""}

/* ---------- Solo: stats ---------- */
function newStats(){return {played:0, wins:0, streak:0, best:0, dist:[0,0,0,0,0,0], lost:0}}
/* won: true or false. guesses: how many it took (1 to 6) when won. Returns a new object. */
function applyResult(stats, won, guesses){
  var s=JSON.parse(JSON.stringify(stats||newStats()));
  if(!s.dist||s.dist.length!==MAX_GUESSES) s.dist=[0,0,0,0,0,0];
  s.played+=1;
  if(won){
    s.wins+=1; s.streak+=1; if(s.streak>s.best) s.best=s.streak;
    var i=Math.min(MAX_GUESSES, Math.max(1, guesses|0))-1; s.dist[i]+=1;
  }else{s.streak=0; s.lost+=1}
  return s;
}
function winPct(stats){return stats&&stats.played?Math.round(100*stats.wins/stats.played):0}
/* Stats as they might come out of localStorage: anything odd becomes a fresh, safe object. */
function cleanStats(raw){
  var base=newStats();
  if(!raw||typeof raw!=="object") return base;
  function n(v){v=+v; return isFinite(v)&&v>=0?Math.floor(v):0}
  var out={played:n(raw.played), wins:n(raw.wins), streak:n(raw.streak), best:n(raw.best), lost:n(raw.lost), dist:base.dist.slice()};
  if(Array.isArray(raw.dist)) for(var i=0;i<MAX_GUESSES;i++) out.dist[i]=n(raw.dist[i]);
  if(out.best<out.streak) out.best=out.streak;
  return out;
}

/* ---------- Solo: the result card ---------- */
var EMOJI={locked:"🟩", moved:"🟨", absent:"⬛"};
/* rows: an array of mark arrays. Colours and shapes only, never a letter. */
function emojiGrid(rows){
  return rows.map(function(marks){return marks.map(function(m){return EMOJI[m]||EMOJI.absent}).join("")}).join("\n");
}
/* kind: "Daily" or "Random". Nothing in this text can spoil the word. */
function shareText(kind, key, won, rows){
  var score=won?rows.length+"/"+MAX_GUESSES:"X/"+MAX_GUESSES;
  var title="Five Letter Frenzy "+kind+(kind==="Daily"?" "+key:"")+" "+score;
  return title+"\n\n"+emojiGrid(rows)+"\n\ntipsyplay.com/games/five-letter-frenzy.html";
}

/* ---------- Race: standings ---------- */
/* One player's row: {uid, n (guesses used), solved, out (used all guesses, or time ran out), tms (solve time in ms)}.
   Order: solved first (fewest guesses, then fastest), then players who are out, then anyone still playing.
   Players level on every measure share a rank. */
function bucket(p){return p.solved?0:(p.out||(p.n|0)>=MAX_GUESSES)?1:2}
function sameScore(a, b){
  if(bucket(a)!==bucket(b)) return false;
  if(bucket(a)===0) return (a.n|0)===(b.n|0)&&(+a.tms||0)===(+b.tms||0);
  if(bucket(a)===1) return (a.n|0)===(b.n|0);
  return (a.n|0)===(b.n|0);
}
function compare(a, b){
  var ba=bucket(a), bb=bucket(b);
  if(ba!==bb) return ba-bb;
  if(ba===0){
    if((a.n|0)!==(b.n|0)) return (a.n|0)-(b.n|0);
    return (+a.tms||0)-(+b.tms||0);
  }
  return (b.n|0)-(a.n|0);    /* out or playing: the one who got further in is listed first */
}
function rankRace(list, nameOf){
  var rows=list.slice().sort(function(a, b){
    var c=compare(a, b); if(c) return c;
    var an=nameOf?nameOf(a.uid):a.uid, bn=nameOf?nameOf(b.uid):b.uid;
    return String(an).localeCompare(String(bn));
  });
  var rank=0;
  return rows.map(function(p, i){
    if(i===0||!sameScore(rows[i-1], p)) rank=i+1;
    return Object.assign({}, p, {rank:rank, tied:(i>0&&sameScore(rows[i-1], p))||(i<rows.length-1&&sameScore(p, rows[i+1])), status:p.solved?"solved":bucket(p)===1?"out":"playing"});
  });
}
/* The race is over when nobody is still playing. */
function raceDone(list){return list.length>0&&list.every(function(p){return bucket(p)<2})}
/* Short line for a result: "1st · solved in 3 · 0:42". */
function ordinal(n){var s=["th","st","nd","rd"], v=n%100; return n+(s[(v-20)%10]||s[v]||s[0])}
function clock(ms){var t=Math.max(0, Math.round(ms/1000)); return Math.floor(t/60)+":"+(t%60<10?"0":"")+(t%60)}
function resultLine(p){
  if(p.status==="solved") return ordinal(p.rank)+" · solved in "+p.n+(p.tms!=null?" · "+clock(p.tms):"");
  if(p.status==="out") return "Out after "+p.n+" guess"+(p.n===1?"":"es");
  return "Still playing · "+p.n+" guess"+(p.n===1?"":"es");
}

/* ---------- Race: key hashes ---------- */
/* SHA-256 of an ASCII string, as hex. Each player keeps a secret key and publishes only its hash; the word server
   checks the key against the hash the host registered. Written out here so it works on any page and in Node. */
var SHA_K=null, SHA_H=null;
function firstPrimes(n){var out=[], c=2, i, ok; while(out.length<n){ok=true; for(i=0;i<out.length&&out[i]*out[i]<=c;i++) if(c%out[i]===0){ok=false; break} if(ok) out.push(c); c++} return out}
function frac32(x){return Math.floor((x-Math.floor(x))*4294967296)>>>0}
function sha256Hex(text){
  if(!SHA_K){var pr=firstPrimes(64); SHA_K=pr.map(function(p){return frac32(Math.cbrt(p))}); SHA_H=pr.slice(0, 8).map(function(p){return frac32(Math.sqrt(p))})}
  var bytes=[], i, j;
  for(i=0;i<text.length;i++) bytes.push(text.charCodeAt(i)&255);
  var bits=bytes.length*8;
  bytes.push(0x80); while(bytes.length%64!==56) bytes.push(0);
  for(i=7;i>=0;i--) bytes.push(i>=4?0:(bits>>>(8*i))&255);
  var h=SHA_H.slice(), w=new Array(64);
  function rotr(x, n){return (x>>>n)|(x<<(32-n))}
  for(var off=0;off<bytes.length;off+=64){
    for(i=0;i<16;i++) w[i]=((bytes[off+4*i]<<24)|(bytes[off+4*i+1]<<16)|(bytes[off+4*i+2]<<8)|bytes[off+4*i+3])>>>0;
    for(i=16;i<64;i++){
      var s0=rotr(w[i-15], 7)^rotr(w[i-15], 18)^(w[i-15]>>>3), s1=rotr(w[i-2], 17)^rotr(w[i-2], 19)^(w[i-2]>>>10);
      w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;
    }
    var a=h[0], b=h[1], c=h[2], d=h[3], e=h[4], f=h[5], g=h[6], hh=h[7];
    for(i=0;i<64;i++){
      var S1=rotr(e, 6)^rotr(e, 11)^rotr(e, 25), ch=(e&f)^(~e&g), t1=(hh+S1+ch+SHA_K[i]+w[i])>>>0;
      var S0=rotr(a, 2)^rotr(a, 13)^rotr(a, 22), mj=(a&b)^(a&c)^(b&c), t2=(S0+mj)>>>0;
      hh=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    h[0]=(h[0]+a)>>>0; h[1]=(h[1]+b)>>>0; h[2]=(h[2]+c)>>>0; h[3]=(h[3]+d)>>>0; h[4]=(h[4]+e)>>>0; h[5]=(h[5]+f)>>>0; h[6]=(h[6]+g)>>>0; h[7]=(h[7]+hh)>>>0;
  }
  return h.map(function(x){return ("00000000"+x.toString(16)).slice(-8)}).join("");
}
function randomHex(bytes){
  var out="", i, a;
  if(typeof crypto!=="undefined"&&crypto.getRandomValues){a=new Uint8Array(bytes); crypto.getRandomValues(a); for(i=0;i<bytes;i++) out+=("0"+a[i].toString(16)).slice(-2); return out}
  for(i=0;i<bytes;i++) out+=("0"+Math.floor(Math.random()*256).toString(16)).slice(-2);
  return out;
}

var api={sha256Hex:sha256Hex, randomHex:randomHex, MAX_GUESSES:MAX_GUESSES, dateKey:dateKey, hash32:hash32, dailyIndex:dailyIndex, dailyWord:dailyWord,
  newStats:newStats, applyResult:applyResult, winPct:winPct, cleanStats:cleanStats, emojiGrid:emojiGrid, shareText:shareText,
  rankRace:rankRace, raceDone:raceDone, ordinal:ordinal, clock:clock, resultLine:resultLine};
if(typeof module!=="undefined"&&module.exports) module.exports=api;
else root.FrenzyModes=api;
})(typeof window!=="undefined"?window:this);
