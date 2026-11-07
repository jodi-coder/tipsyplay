(function(){
"use strict";
/* Multiplayer Never Have I Ever.
   Pack lines play themselves. Custom typing is optional for the next round.
   The countdown is only for answering. Sips are never timed.
   rooms/$code/nhie */
var FAST = /[?&]emulator=1(?:&|$)/.test(location.search) && /[?&]fast=1(?:&|$)/.test(location.search);
var ANSWER_MS = FAST ? 1600 : 12000;
var REVEAL_GRACE = FAST ? 800 : 1200;
var LENGTHS = [5, 10, 15];
var EMOS = {clap:"👏", gasp:"😮", laugh:"😂", boo:"👎", party:"🎉"};
var EMO_CUE = {clap:"applause", gasp:"gasp", laugh:"laugh", boo:"boo", party:"cheer"};
var EMOJIS = ["", "😎", "🦊", "🌟", "🎧", "🍀", "🔥", "🌙", "🎭", "🍓", "🎲", "🦋"];
var ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
var MIXKEY = "tp_nhie_mix";
var $=function(id){return document.getElementById(id)};
var mix = window.PartyAudio ? PartyAudio.load(MIXKEY) : {music:0.7,sfx:0.9,voice:0.85,muteMusic:false,muteSfx:false,muteVoice:false};
var engine=null, parts=[], raf=0;
var uid=null, code=null, meta=null, players={}, who={}, table=null, sayBox=null, cast={};
var lobbyMode="classic", gameLength=15, localQueue="", pendingCast=null, scoring=0, sending=false;
var serverOffset=0, offsetReady=false, offsetStop=null, revealWait=0, lastReactAt=0, announcedSeq=-1, announcedFinal=-1, knownGame="";
var db, authObj, stops=[], connStop=null, hostLock=false, audioOn=false, bootTimer=0, clockTimer=0, lastTick=-1;
var heardAnswer=-1, heardResults=-1, heardOver=false, seenReact=null, deckKey="", deck=[];
var ref, onValue, update, set, remove, onDisconnect, get, serverTimestamp, goOnline;

function saveMix(){try{localStorage.setItem(MIXKEY, JSON.stringify(mix))}catch(e){} if(engine) engine.apply()}
function audioEngine(){
  if(engine||!window.PartyAudio) return engine;
  engine=PartyAudio.create({
    key:MIXKEY, mix:mix, host:isHost,
    hype:function(){return table?Math.min(6, +table.round||0):0},
    bpm:112, hypePer:6,
    pulse:function(){var el=$("lights"); if(!el) return; el.classList.add("on"); setTimeout(function(){el.classList.remove("on")}, 90)}
  });
  return engine;
}
function cue(name){if(!audioOn) return; var eng=audioEngine(); if(eng){try{eng.cue(name)}catch(e){}}}
function say(line){if(!audioOn||!isHost()) return; var eng=audioEngine(); if(eng) eng.say(line)}
function unlock(){
  audioOn=true;
  try{var eng=audioEngine(); if(eng) eng.unlock(); if(window.TPSound) TPSound.unlock()}catch(e){}
}
function maybeMusic(){var eng=audioEngine(); if(audioOn&&eng&&isHost()) eng.startMusic()}
function buzz(){
  var used=false;
  try{if(typeof navigator.vibrate==="function") used=navigator.vibrate(30)===true}catch(e){used=false}
  if(!used) flash();
}
function tapSound(name){unlock(); cue(name||"crack"); buzz()}
function isHost(){return !!(meta&&uid&&meta.hostUid===uid)}
function order(){
  return Object.keys(players).map(function(id){
    var w=who[id]||{};
    return {uid:id, name:players[id].name||"Player", emoji:w.emoji||"", connected:players[id].connected!==false, joinedAt:players[id].joinedAt||0, confessions:+w.confessions||0, seen:+w.seen||0};
  }).sort(function(a,b){return a.joinedAt-b.joinedAt||a.name.localeCompare(b.name)});
}
function labels(){
  var list=order(), count={}, seen={}, map={};
  list.forEach(function(p){count[p.name]=(count[p.name]||0)+1});
  list.forEach(function(p){
    if(count[p.name]<2){map[p.uid]=p.name; return}
    seen[p.name]=(seen[p.name]||0)+1;
    map[p.uid]=seen[p.name]===1?p.name:(p.name+" "+seen[p.name]);
  });
  return map;
}
function shown(id){var map=labels(); return map[id]||(players[id]&&players[id].name)||"Player"}
function serverNow(){return Date.now()+(offsetReady?serverOffset:0)}
function armServerClock(){
  if(!db||!ref||!onValue) return;
  if(offsetStop) offsetStop();
  offsetStop=onValue(ref(db, ".info/serverTimeOffset"), function(s){
    var v=s.val();
    if(typeof v==="number"&&isFinite(v)){serverOffset=v; offsetReady=true}
  }, function(){offsetReady=false; serverOffset=0});
}
function stopServerClock(){if(offsetStop){try{offsetStop()}catch(e){} offsetStop=null}}
function rpath(p){return "rooms/"+code+"/"+p}
function fail(msg){var p=$("perr"); if(p) p.textContent=msg||""}
function friendly(e){
  var c=String((e&&(e.code||e.message))||"");
  if(/permission|denied/i.test(c)) return "That room isn't available.";
  if(/offline|network|fetch/i.test(c)) return "You're offline. Check the connection and try again.";
  return "Something went wrong. Try again.";
}
function normName(v){return String(v||"").replace(/[<>]/g,"").trim().slice(0,20)}
function normCode(v){
  var s=String(v||"");
  var m=s.match(/(?:room|code)=([A-Za-z]{4})/i);
  if(m) return m[1].toUpperCase();
  return s.toUpperCase().replace(/[^ABCDEFGHJKMNPQRSTUVWXYZ]/g,"").slice(0,4);
}
function validCode(c){return /^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(c)}
function makeCode(){var s="",i; for(i=0;i<4;i++) s+=ALPHABET[Math.floor(Math.random()*ALPHABET.length)]; return s}
function queryRoom(){
  var raw="";
  try{
    var q=new URLSearchParams(location.search);
    raw=q.get("room")||q.get("code")||"";
  }catch(e){
    var m=String(location.search||"").match(/[?&](?:room|code)=([A-Za-z]{4})/i);
    if(m) raw=m[1];
  }
  var c=normCode(raw);
  return validCode(c)?c:"";
}
function emuOn(){return /[?&]emulator=1(?:&|$)/.test(location.search)}
function roomUrl(c){
  if(window.TipsyJoinQR) return TipsyJoinQR.pageInvite("/games/never-have-i-ever.html", c, "nhie");
  var base=/localhost|127\.0\.0\.1/.test(location.host)?location.origin+location.pathname:"https://tipsyplay.com/games/never-have-i-ever.html";
  return base+"?room="+c+"&game=nhie";
}
function paintQr(){
  var canvas=$("qr");
  if(!canvas||!code||!window.TipsyJoinQR||canvas.dataset.hidden==="1") return;
  TipsyJoinQR.draw(canvas, roomUrl(code));
  var credit=$("qrcredit");
  if(credit && !credit.textContent) credit.textContent=TipsyJoinQR.credit;
}
function spiceFor(mode){return mode==="spicy"?"spicy":mode==="classic"?"extra":"mild"}
function modeForSpice(spice){return spice==="spicy"?"spicy":spice==="extra"?"classic":"mild"}
function rounds(){
  if((!meta||meta.status==="lobby")&&isHost()&&LENGTHS.indexOf(gameLength)>=0) return gameLength;
  var n=meta&&+meta.rounds;
  if(LENGTHS.indexOf(n)>=0) return n;
  return LENGTHS.indexOf(gameLength)>=0?gameLength:15;
}
function currentMode(){
  if(table&&table.mode&&/^(mild|classic|spicy)$/.test(table.mode)) return table.mode;
  if(meta&&meta.status==="lobby") return isHost()?lobbyMode:modeForSpice(meta.spice);
  return /^(mild|classic|spicy)$/.test(lobbyMode)?lobbyMode:"classic";
}
function modeLabel(mode){return mode==="mild"?"Mild":mode==="spicy"?"Spicy":"Classic"}
function myEmoji(){return sessionStorage.getItem("tp_nhie_emoji")||""}
function screen(id){["home","lobby","table","closed"].forEach(function(s){var n=$(s); if(n) n.classList.toggle("hide", s!==id)})}
function paintRole(){
  document.body.classList.toggle("is-host", isHost());
  document.body.dataset.role=isHost()?"host":(meta?"player":"");
  document.querySelectorAll(".hostonly").forEach(function(n){n.classList.toggle("hide", !isHost())});
}
function flash(){document.body.classList.remove("nh-flash"); void document.body.offsetWidth; document.body.classList.add("nh-flash")}
function burst(n){
  var c=$("fx"); if(!c) return;
  c.width=window.innerWidth; c.height=window.innerHeight;
  var color=document.body.dataset.mode==="mild"?"#38bdf8":document.body.dataset.mode==="spicy"?"#f43f5e":"#f59e0b";
  for(var i=0;i<n;i++) parts.push({x:Math.random()*c.width,y:-20,vx:(Math.random()-0.5)*8,vy:2+Math.random()*5,life:1,color:i%2?color:"#ffe14a"});
  if(!raf) raf=requestAnimationFrame(frame);
}
function frame(){
  var c=$("fx"); if(!c){raf=0; return}
  var ctx=c.getContext("2d"); ctx.clearRect(0,0,c.width,c.height);
  parts=parts.filter(function(p){return p.life>0});
  parts.forEach(function(p){p.x+=p.vx; p.y+=p.vy; p.vy+=0.08; p.life-=0.012; ctx.globalAlpha=Math.max(p.life,0); ctx.fillStyle=p.color; ctx.fillRect(p.x,p.y,8,8)});
  ctx.globalAlpha=1;
  if(parts.length) raf=requestAnimationFrame(frame); else raf=0;
}
function floatIcon(emoji){
  var n=document.createElement("div"); n.className="kc-float"; n.textContent=emoji;
  n.style.left=(window.innerWidth/2)+"px"; n.style.top="40%";
  document.body.appendChild(n); setTimeout(function(){n.remove()},1000);
}
function hashStr(s){
  var h=2166136261, i;
  for(i=0;i<s.length;i++){h^=s.charCodeAt(i); h=Math.imul(h, 16777619)}
  return h>>>0;
}
function xorshift(seed){
  var x=seed>>>0||1;
  return function(){
    x^=x<<13; x>>>=0;
    x^=x>>>17; x>>>=0;
    x^=x<<5; x>>>=0;
    return (x>>>0)/4294967296;
  };
}
function packs(){return window.NHIE_PACKS||{classic:[],mild:[],spicy:[]}}
function currentDeck(){
  var mode=currentMode();
  var key=(code||"room")+"|"+(meta&&meta.gameId||1)+"|"+mode;
  if(key===deckKey&&deck.length) return deck;
  var pool=(packs()[mode]||packs().classic||[]).slice();
  var rnd=xorshift(hashStr(key)), i, j, t;
  for(i=pool.length-1;i>0;i--){j=Math.floor(rnd()*(i+1)); t=pool[i]; pool[i]=pool[j]; pool[j]=t}
  deckKey=key; deck=pool; return deck;
}
function plannedLine(round){
  var list=currentDeck();
  if(!list.length) return "";
  return list[(+round||0)%list.length];
}
function promptsMissing(){fail("The prompts didn't load. Reload the page to try again.")}
function cleanText(raw){
  var t=String(raw||"").replace(/<[^>]*>/g,"").replace(/[<>]/g,"").replace(/\s+/g," ").trim().slice(0,140);
  if(!t) return "";
  if(!/^never have i ever\b/i.test(t)) t=("Never have I ever "+t).slice(0,140);
  return t;
}
function splitPrompt(text){
  var t=String(text||"");
  var m=t.match(/^never have i ever\s+/i);
  if(!m) return {kicker:"Never have I ever", rest:t||"The next secret is on the way."};
  return {kicker:"Never have I ever", rest:t.slice(m[0].length)};
}
function playObj(patch){
  var b=Object.assign({turn:uid||"", step:"answer", text:"", seq:0, mode:currentMode(), kind:"have", round:0, opened:0, order:order().map(function(p){return p.uid}).join(",")||uid||"table"}, table||{}, patch||{});
  var mode=/^(mild|classic|spicy)$/.test(b.mode)?b.mode:"classic";
  return {
    turn:String(b.turn||uid||"host").slice(0,128),
    step:b.step,
    text:String(b.text||"").slice(0,140),
    seq:Math.max(0, Math.min(40, +b.seq||0)),
    mode:mode,
    kind:"have",
    round:Math.max(0, Math.min(20, +b.round||0)),
    opened:Math.max(0, +b.opened||0),
    order:String(b.order||uid||"table").slice(0,1500)
  };
}
function fullMeta(patch){
  var m=Object.assign({}, meta||{}, patch||{});
  var len=LENGTHS.indexOf(+m.rounds)>=0?+m.rounds:15;
  var spice=/^(mild|spicy|extra)$/.test(m.spice)?m.spice:"mild";
  var out={hostUid:m.hostUid, createdAt:m.createdAt, status:m.status, phase:m.phase, spice:spice, rounds:len, na:!!m.na, round:0, gameId:+m.gameId||1, kind:"nhie"};
  if(m.status!=="lobby") out.deck=["Never Have I Ever"];
  if(m.endedAt&&m.status==="over") out.endedAt=m.endedAt;
  return out;
}
function parsedCast(raw){
  var s=String(raw||"");
  var m=s.match(/^(have|never):(\d+)$/);
  if(m) return {v:m[1], seq:+m[2]};
  if(s==="have"||s==="never") return {v:s, seq:null};
  return null;
}
function roundSeq(){return table?+table.seq||0:0}
function castValue(id){
  var info=parsedCast(cast[id]);
  if(!info) return "";
  if(info.seq!==null && info.seq!==roundSeq()) return "";
  return info.v;
}
function answered(id){
  var live=castValue(id);
  if(live) return live;
  if(id===uid && pendingCast && pendingCast.seq===roundSeq()) return pendingCast.v;
  return "";
}
function haveIds(){
  return order().filter(function(p){return answered(p.uid)==="have"}).map(function(p){return p.uid});
}
function allIn(){
  var list=order().filter(function(p){return p.connected});
  if(!list.length) return false;
  return list.every(function(p){var v=castValue(p.uid); return v==="have"||v==="never"});
}
function secondsLeft(){
  if(!table||table.step!=="answer") return null;
  var opened=+table.opened||0;
  if(opened<1700000000000) return null;
  return Math.max(0, Math.ceil((opened+ANSWER_MS-serverNow())/1000));
}
function nextUid(from){
  var list=order().map(function(p){return p.uid});
  if(!list.length) return from||uid;
  var idx=list.indexOf(from); if(idx<0) idx=-1;
  return list[(idx+1)%list.length];
}
function writeWho(emoji, confessions, seen){
  return set(ref(db, rpath("nhie/who/"+uid)), {
    emoji:String(emoji||"").slice(0,8),
    confessions:Math.max(0, Math.min(40, confessions|0)),
    seen:Math.max(0, Math.min(40, seen|0))
  });
}
function paintEmoji(){
  var box=$("emojis"); if(!box) return;
  var cur=myEmoji();
  box.textContent="";
  EMOJIS.forEach(function(emo){
    var b=document.createElement("button"); b.type="button";
    b.textContent=emo||"·";
    b.setAttribute("aria-label", emo?emo:"No emoji");
    b.setAttribute("aria-pressed", emo===cur?"true":"false");
    b.addEventListener("click", function(){
      sessionStorage.setItem("tp_nhie_emoji", emo);
      paintEmoji();
      if(code&&uid) writeWho(emo, (who[uid]&&who[uid].confessions)||0, (who[uid]&&who[uid].seen)||0).catch(function(e){fail(friendly(e))});
    });
    box.appendChild(b);
  });
}
function paintModes(){
  var mode=currentMode();
  document.querySelectorAll("[data-mode]").forEach(function(b){b.setAttribute("aria-pressed", b.dataset.mode===mode?"true":"false")});
}
function paintLengths(){
  var n=rounds();
  document.querySelectorAll("[data-len]").forEach(function(b){b.setAttribute("aria-pressed", +b.dataset.len===n?"true":"false")});
}
function copyText(text){
  if(navigator.clipboard&&navigator.clipboard.writeText){
    return navigator.clipboard.writeText(text).catch(function(){return legacyCopy(text)});
  }
  return legacyCopy(text);
}
function legacyCopy(text){
  return new Promise(function(resolve, reject){
    var ta=document.createElement("textarea");
    ta.value=text; ta.setAttribute("readonly", "");
    ta.style.position="fixed"; ta.style.left="-9999px";
    document.body.appendChild(ta); ta.select();
    var ok=false;
    try{ok=document.execCommand("copy")}catch(e){ok=false}
    ta.remove();
    if(ok) resolve(); else reject(new Error("copy"));
  });
}
function markCopied(btn){
  if(!btn) return;
  var old=btn.getAttribute("data-label")||btn.textContent;
  btn.setAttribute("data-label", old);
  btn.textContent="Copied";
  setTimeout(function(){if(btn.getAttribute("data-label")===old) btn.textContent=old}, 1600);
}
function copyLink(btn){
  if(!code) return;
  unlock();
  copyText(roomUrl(code)).then(function(){cue("clink"); markCopied(btn||$("copylink")); fail("")}).catch(function(){fail("Couldn't copy. Select the link and copy it.")});
}
function shareRoom(){
  if(!code) return;
  var link=roomUrl(code);
  unlock();
  if(navigator.share){
    navigator.share({title:"Never Have I Ever", text:"Join my Never Have I Ever room "+code, url:link}).then(function(){cue("clink")}).catch(function(err){
      if(err&&err.name==="AbortError") return;
      copyLink($("sharebtn"));
    });
    return;
  }
  copyLink($("sharebtn"));
}
function paintLobby(){
  $("codebig").textContent=code||"";
  $("sharelink").textContent=roomUrl(code);
  paintQr();
  var box=$("plist"); box.textContent="";
  order().forEach(function(p){
    var row=document.createElement("div"); row.className="nh-person"+(p.connected?"":" off");
    var s=document.createElement("span");
    s.textContent=(p.emoji?p.emoji+" ":"")+shown(p.uid)+(p.uid===meta.hostUid?" · host":"");
    var tag=document.createElement("span"); tag.textContent=p.connected?"":"away";
    row.appendChild(s); row.appendChild(tag);
    if(isHost()&&meta&&meta.status==="lobby"&&p.uid!==uid){
      var kick=document.createElement("button"); kick.type="button"; kick.className="x"; kick.textContent="Remove";
      kick.setAttribute("aria-label", "Remove "+shown(p.uid));
      kick.addEventListener("click", function(){
        remove(ref(db, rpath("players/"+p.uid))).catch(function(e){fail(friendly(e))});
      });
      row.appendChild(kick);
    }
    box.appendChild(row);
  });
  var n=order().length;
  paintModes(); paintLengths();
  var start=$("start");
  if(start){
    start.textContent="Start · "+rounds()+" rounds";
    start.disabled=!isHost()||!$("optin").checked||n<2||n>12;
  }
  var note=$("lobbynote");
  if(note){
    if(n<2) note.textContent="Need one more player.";
    else if(n>12) note.textContent="12 players max.";
    else if(isHost()&&!$("optin").checked) note.textContent="Tick the opt-in, then start.";
    else note.textContent=isHost()?"Pack's loaded. You're the host.":"You're in. The host starts when the table's ready.";
  }
}
function myCast(){return answered(uid)}
function paintAnswers(){
  var answering=!!(table&&table.step==="answer");
  var box=$("answers"); if(box) box.classList.toggle("hide", !answering);
  var mine=myCast();
  var have=$("ihave"), never=$("never");
  if(have){have.disabled=!answering||!!mine; have.setAttribute("aria-pressed", mine==="have"?"true":"false")}
  if(never){never.disabled=!answering||!!mine; never.setAttribute("aria-pressed", mine==="never"?"true":"false")}
}
function paintHaves(){
  var show=!!(table&&table.step==="results"&&!(meta&&meta.status==="over"));
  var wrap=$("haves"); if(wrap) wrap.classList.toggle("hide", !show);
  var box=$("havelist"); if(!box) return;
  var head=$("drinkhead");
  if(!show){
    if(head) head.textContent="";
    box.textContent="";
    return;
  }
  var ids=haveIds();
  if(head) head.textContent=ids.length?"Sip, water, or pose":"Nobody this round";
  box.classList.toggle("hide", !ids.length);
  box.textContent="";
  ids.forEach(function(id){
    var li=document.createElement("li");
    var emo=document.createElement("span"); emo.className="nh-emo"; emo.setAttribute("aria-hidden", "true"); emo.textContent=(who[id]&&who[id].emoji)||"•";
    var nm=document.createElement("span"); nm.textContent=shown(id);
    li.appendChild(emo); li.appendChild(nm); box.appendChild(li);
  });
}
function awardRows(){
  var list=order();
  if(!list.length) return [];
  var max=0, min=Infinity;
  list.forEach(function(p){if(p.confessions>max) max=p.confessions; if(p.confessions<min) min=p.confessions});
  function names(group){return group.map(function(p){return (p.emoji?p.emoji+" ":"")+shown(p.uid)}).join(", ")}
  var low=list.filter(function(p){return p.confessions===min});
  var high=list.filter(function(p){return p.confessions===max});
  if(max===0) return [{title:"The Saint", names:names(list), line:"A whole table of nevers. The halos stay on."}];
  if(max===min) return [{title:"Even Stevens", names:names(list), line:"Same number of yeses. Suspiciously fair. Not a drink score."}];
  return [
    {title:"The Saint", names:names(low), line:min===0?"Zero yeses. Absolutely unbothered.":"Fewest yeses ("+min+"). Practically glowing."},
    {title:"Most Chaotic", names:names(high), line:"Said yes the most ("+max+"). Chaos award. Not a prize for drinking."}
  ];
}
function paintAwards(){
  var box=$("awards"); if(!box) return;
  box.textContent="";
  awardRows().forEach(function(a){
    var card=document.createElement("article"); card.className="nh-award";
    var t=document.createElement("p"); t.className="nh-award-kicker"; t.textContent=a.title;
    var n=document.createElement("p"); n.className="nh-award-name"; n.textContent=a.names;
    var l=document.createElement("p"); l.textContent=a.line;
    card.appendChild(t); card.appendChild(n); card.appendChild(l); box.appendChild(card);
  });
}
function paintQueue(){
  var note=$("queuednote"); if(!note) return;
  if(localQueue) note.textContent="Queued on this phone for the next round.";
  else if(sayBox&&sayBox.text) note.textContent="A custom line is queued for next round.";
  else if(!note.dataset.sticky) note.textContent="";
}
function paintClock(){
  var wrap=$("clock"); if(!wrap) return;
  var left=secondsLeft();
  var on=left!==null&&!!(table&&table.step==="answer");
  wrap.classList.toggle("hide", !on);
  if(!on){lastTick=-1; return}
  wrap.classList.toggle("hot", left<=3);
  var num=$("clocknum"); if(num) num.textContent=String(left);
  wrap.setAttribute("aria-hidden", "true");
  var live=$("clocklive");
  var seq=table?+table.seq||0:0;
  if(live){
    if(announcedSeq!==seq){
      announcedSeq=seq; announcedFinal=-1;
      live.textContent="Round started. "+left+" seconds to answer.";
    }else if(left===3 && announcedFinal!==seq){
      announcedFinal=seq;
      live.textContent="3 seconds to answer.";
    }
  }
  if(audioOn&&left>0&&left<=3&&left!==lastTick){lastTick=left; cue("tick")}
  if(isHost()&&left<=0) reveal();
}
function paintTable(){
  var over=!!(table&&table.step==="over")||(meta&&meta.status==="over");
  var results=!!(table&&table.step==="results"&&!over);
  var mode=currentMode();
  var total=rounds();
  var num=table?Math.min(total, (+table.round||0)+1):1;
  var round=$("roundlabel");
  if(round) round.textContent=over?(total+" rounds played"):("Round "+num+" of "+total);
  var badge=$("badge");
  if(badge) badge.textContent=modeLabel(mode);
  var face=splitPrompt(table&&table.text);
  var kicker=$("kicker"); if(kicker) kicker.textContent=over?"That's the game":face.kicker;
  var statement=$("statement"); if(statement) statement.textContent=face.rest;
  var card=$("card"); if(card&&table) card.setAttribute("aria-label", table.text||"Never have I ever");
  paintAnswers();
  paintHaves();
  paintQueue();
  var finale=$("finale"); if(finale) finale.classList.toggle("hide", !over);
  if(over) paintAwards();
  var custom=$("custombox");
  if(custom){
    if(custom.classList.contains("hostonly")&&!isHost()) custom.classList.add("hide");
    else custom.classList.toggle("hide", over);
  }
  var next=$("nextround");
  if(next){
    next.classList.toggle("hide", !isHost()||!results);
    next.textContent=(table&&(+table.round||0)+1>=total)?"See the awards":"Next round";
  }
  var hostP=meta&&players[meta.hostUid];
  var away=$("away"); if(away) away.classList.toggle("hide", !hostP||hostP.connected!==false||isHost());
  if(isHost()) maybeMusic();
  paintClock();
}
function render(){
  paintRole();
  var mode=currentMode();
  document.body.dataset.mode=mode;
  document.body.dataset.phase=table?table.step:(meta&&meta.status==="lobby"?"lobby":"");
  if(!meta){screen("home"); return}
  if(meta.status==="lobby"){screen("lobby"); paintLobby(); maybeMusic(); return}
  screen("table");
  paintTable();
  hear();
  maybeScore();
  if(isHost()&&table&&table.step==="answer"&&allIn()) reveal();
}
function hear(){
  if(!table) return;
  if(table.step==="answer"&&heardAnswer!==+table.seq){
    heardAnswer=+table.seq;
    cue("sting");
    var card=$("card");
    if(card){card.classList.remove("nh-slam"); void card.offsetWidth; card.classList.add("nh-slam")}
    if(isHost()) say("Never have I ever.");
  }
  if(table.step==="results"&&heardResults!==+table.seq){
    heardResults=+table.seq;
    var n=haveIds().length, total=order().length;
    if(n===0) cue("crickets");
    else if(n<=2) cue("ooh");
    else {cue("cheer"); if(n>=Math.max(3, total-1)) burst(50)}
  }
  if(table.step==="over"&&!heardOver){heardOver=true; cue("payoff"); burst(70)}
}
function maybeScore(){
  var me=who[uid];
  if(!me||!table||!uid) return;
  var seq=+table.seq||0;
  if(!seq||seq<=(+me.seen||0)||scoring===seq) return;
  var info=parsedCast(cast[uid]);
  if(!info) return;
  if(info.seq!==null && info.seq!==seq) return;
  if(info.v!=="have"&&info.v!=="never") return;
  scoring=seq;
  var add=info.v==="have"?1:0;
  writeWho(me.emoji||myEmoji(), (+me.confessions||0)+add, seq).catch(function(e){
    if(scoring===seq) scoring=0;
    fail(friendly(e));
  });
}
function maybeFreshScores(){
  if(!meta||!uid||!code) return;
  var key=code+"|"+(+meta.gameId||1);
  var stored="";
  try{stored=sessionStorage.getItem("tp_nhie_gid")||""}catch(e){}
  if(!knownGame) knownGame=stored;
  if(knownGame && knownGame.indexOf(code+"|")===0 && knownGame!==key){
    var me=who[uid];
    if(me && ((+me.confessions||0)>0 || (+me.seen||0)>0)){
      writeWho(me.emoji||myEmoji(), 0, 0).catch(function(e){fail(friendly(e))});
    }
  }
  knownGame=key;
  try{sessionStorage.setItem("tp_nhie_gid", key)}catch(e){}
}
function reveal(){
  if(!isHost()||hostLock||!table||table.step!=="answer") return;
  if(!allIn()){
    var left=secondsLeft();
    if(left===null||left>0){revealWait=0; return}
    if(!revealWait){revealWait=serverNow(); return}
    if(serverNow()-revealWait<REVEAL_GRACE) return;
  }
  revealWait=0;
  hostLock=true;
  update(ref(db), {[rpath("nhie/play")]:playObj({step:"results"})}).then(function(){hostLock=false}).catch(function(e){hostLock=false; fail(friendly(e))});
}
function clearCast(payload){
  Object.keys(cast).forEach(function(id){payload[rpath("nhie/cast/"+id)]=null});
  payload[rpath("nhie/say")]=null;
}
function advance(){
  if(!isHost()||hostLock||!table||table.step!=="results") return;
  var round=(+table.round||0)+1;
  var total=rounds();
  var payload={};
  if(round>=total){
    payload[rpath("nhie/play")]=playObj({step:"over", text:table.text||"Never have I ever finished the set"});
    payload[rpath("meta")]=fullMeta({status:"over", phase:"over", endedAt:serverNow(), spice:spiceFor(table.mode||currentMode()), rounds:total});
  }else{
    var custom="";
    if(localQueue){custom=localQueue; localQueue=""}
    else if(sayBox&&sayBox.text) custom=cleanText(sayBox.text);
    var text=custom||plannedLine(round);
    if(!text){promptsMissing(); return}
    payload[rpath("nhie/play")]=playObj({turn:nextUid(table.turn), step:"answer", text:text, seq:(+table.seq||0)+1, round:round, opened:serverNow(), mode:table.mode||currentMode()});
  }
  clearCast(payload);
  hostLock=true;
  pendingCast=null;
  revealWait=0;
  update(ref(db), payload).then(function(){hostLock=false; var note=$("queuednote"); if(note){note.textContent=""; delete note.dataset.sticky}}).catch(function(e){hostLock=false; fail(friendly(e))});
}
function sendCast(value){
  if(!table||table.step!=="answer"||sending) return;
  var seq=+table.seq||0;
  if(castValue(uid)) return;
  if(pendingCast&&pendingCast.seq===seq) return;
  if(value!=="have"&&value!=="never") return;
  pendingCast={v:value, seq:seq};
  sending=true;
  paintAnswers();
  tapSound(value==="have"?"crack":"whoosh");
  var btn=$(value==="have"?"ihave":"never");
  if(btn){btn.classList.remove("nh-hit"); void btn.offsetWidth; btn.classList.add("nh-hit")}
  var wait=window.__tpNhie&&+window.__tpNhie.delayCast||0;
  var write=function(){
    update(ref(db), {[rpath("nhie/cast/"+uid)]:value+":"+seq}).then(function(){sending=false; maybeScore()}).catch(function(e){
      sending=false; if(pendingCast&&pendingCast.seq===seq) pendingCast=null; paintAnswers(); fail(friendly(e));
    });
  };
  if(wait>0) setTimeout(write, wait); else write();
}
function queueCustom(){
  if(!table||(table.step!=="answer"&&table.step!=="results")){fail("Wait for a round, then queue the next line."); return}
  var text=cleanText($("custom")&&$("custom").value);
  if(!text){fail("Type a line first."); return}
  fail("");
  unlock();
  cue("flip");
  update(ref(db), {[rpath("nhie/say")]:{text:text}}).then(function(){
    if($("custom")) $("custom").value="";
    if($("queuednote")){ $("queuednote").textContent="Queued for the next round."; $("queuednote").dataset.sticky="1" }
  }).catch(function(e){
    var denied=/permission|denied/i.test(String((e&&(e.code||e.message))||""));
    if(isHost()){
      localQueue=text;
      if($("custom")) $("custom").value="";
      if($("queuednote")){ $("queuednote").textContent="Queued on this phone for the next round."; $("queuednote").dataset.sticky="1" }
      return;
    }
    if(denied) fail("The host can type that one for now.");
    else fail(friendly(e));
  });
}
function setMode(mode){
  if(!/^(mild|classic|spicy)$/.test(mode)) return;
  if(meta&&!isHost()) return;
  lobbyMode=mode;
  try{sessionStorage.setItem("tp_nhie_mode", mode)}catch(e){}
  document.body.dataset.mode=currentMode();
  paintModes();
  if(isHost()&&meta&&meta.status==="lobby"&&meta.createdAt){
    update(ref(db), {[rpath("meta")]:fullMeta({spice:spiceFor(mode), rounds:rounds(), status:"lobby", phase:"lobby"})}).catch(function(e){fail(friendly(e))});
  }
}
function setLength(n){
  n=+n;
  if(LENGTHS.indexOf(n)<0) return;
  if(meta&&!isHost()) return;
  gameLength=n;
  try{sessionStorage.setItem("tp_nhie_len", String(n))}catch(e){}
  paintLengths();
  var start=$("start"); if(start&&meta&&meta.status==="lobby") start.textContent="Start · "+n+" rounds";
  if(isHost()&&meta&&meta.status==="lobby"&&meta.createdAt){
    update(ref(db), {[rpath("meta")]:fullMeta({rounds:n, spice:spiceFor(currentMode()), status:"lobby", phase:"lobby"})}).catch(function(e){fail(friendly(e))});
  }
}
async function begin(){
  if(!isHost()||!meta||sending) return;
  var list=order();
  if(list.length<2||list.length>12){fail("Need 2 to 12 players."); return}
  if(!$("optin").checked){fail("Tick the opt-in first. Sips stay optional."); return}
  fail("");
  sending=true;
  var mode=currentMode();
  var len=rounds();
  var payload={};
  payload[rpath("meta")]=fullMeta({status:"play", phase:"answer", spice:spiceFor(mode), rounds:len});
  var opening=plannedLine(0);
  if(!opening){promptsMissing(); sending=false; return}
  payload[rpath("nhie/play")]=playObj({turn:list[0].uid, step:"answer", text:opening, seq:1, mode:mode, kind:"have", round:0, opened:serverNow(), order:list.map(function(p){return p.uid}).join(",")});
  payload[rpath("nhie/say")]=null;
  try{await update(ref(db), payload); cue("whoosh")}catch(e){fail(friendly(e))}
  sending=false;
}
function stopAll(){stops.forEach(function(fn){try{fn()}catch(e){}}); stops=[]; if(connStop){connStop(); connStop=null}}
function listen(){
  stopAll();
  heardAnswer=-1; heardResults=-1; heardOver=false; seenReact=null; scoring=0; pendingCast=null; revealWait=0; announcedSeq=-1; announcedFinal=-1;
  stops.push(onValue(ref(db, rpath("meta")), function(s){
    if(!s.exists()){
      stopAll(); meta=null; table=null; code=null;
      try{sessionStorage.removeItem("tp_nhie_room")}catch(e){}
      screen("closed"); return;
    }
    meta=s.val()||null; maybeFreshScores(); render();
  }, function(){fail("That room isn't available. Check the code and try again.")}));
  stops.push(onValue(ref(db, rpath("players")), function(s){players=s.val()||{}; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("nhie/who")), function(s){who=s.val()||{}; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("nhie/play")), function(s){
    var prevSeq=table?+table.seq||0:0;
    table=s.val()||null;
    hostLock=false;
    if(table&&(+table.seq||0)!==prevSeq){revealWait=0; if(pendingCast&&pendingCast.seq!==(+table.seq||0)) pendingCast=null}
    render();
  }, function(){}));
  stops.push(onValue(ref(db, rpath("nhie/say")), function(s){sayBox=s.val()||null; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("nhie/cast")), function(s){
    cast=s.val()||{};
    var info=parsedCast(cast[uid]);
    if(info&&(info.seq===null||!table||info.seq===(+table.seq||0))) pendingCast=null;
    maybeScore();
    render();
  }, function(){}));
  stops.push(onValue(ref(db, rpath("nhie/react")), function(s){
    var v=s.val()||{}, first=seenReact===null; if(first) seenReact={};
    Object.keys(v).forEach(function(id){
      if(seenReact[id]) return; seenReact[id]=1;
      if(first) return;
      var emo=v[id]&&v[id].e; floatIcon(EMOS[emo]||"👏"); cue(EMO_CUE[emo]||"clink");
    });
  }, function(){}));
}
function armPresence(){
  if(connStop) connStop();
  var drop=null;
  connStop=onValue(ref(db, ".info/connected"), function(s){
    if(drop){try{drop.cancel()}catch(e){} drop=null}
    if(!s.val()||!code||!uid) return;
    var p=ref(db, rpath("players/"+uid));
    drop=onDisconnect(p);
    drop.update({connected:false}).catch(function(){});
    update(p, {connected:true}).catch(function(){});
  });
}
async function hostRoom(name){
  var i, claimed=null, len=LENGTHS.indexOf(gameLength)>=0?gameLength:15;
  for(i=0;i<6;i++){
    var c=makeCode();
    var snap=await get(ref(db, "rooms/"+c+"/meta"));
    if(snap.exists()) continue;
    try{
      await update(ref(db), {["rooms/"+c+"/meta"]:{hostUid:uid, createdAt:serverTimestamp(), status:"lobby", phase:"lobby", spice:spiceFor(lobbyMode), rounds:len, na:false, round:0, gameId:1, kind:"nhie"}});
      claimed=c; break;
    }catch(e){if(!/permission/i.test(String(e.code||e.message||""))) throw e}
  }
  if(!claimed) throw new Error("room");
  await set(ref(db, "rooms/"+claimed+"/players/"+uid), {name:name, connected:true, joinedAt:serverNow()});
  await set(ref(db, "rooms/"+claimed+"/nhie/who/"+uid), {emoji:myEmoji(), confessions:0, seen:0});
  code=claimed;
  try{sessionStorage.setItem("tp_nhie_room", code)}catch(e){}
  listen(); armPresence();
}
async function joinRoom(c, name){
  var snap=await get(ref(db, "rooms/"+c+"/meta"));
  if(!snap.exists()) throw new Error("missing");
  var m=snap.val()||{};
  if(m.kind&&m.kind!=="nhie") throw new Error("kind");
  var mine=await get(ref(db, "rooms/"+c+"/players/"+uid));
  if(m.status!=="lobby"&&!mine.exists()) throw new Error("closed");
  var prev=mine.val()||{};
  await set(ref(db, "rooms/"+c+"/players/"+uid), {name:name||prev.name||"Player", connected:true, joinedAt:prev.joinedAt||serverNow()});
  var w=await get(ref(db, "rooms/"+c+"/nhie/who/"+uid));
  var cur=w.val()||{confessions:0, seen:0};
  await set(ref(db, "rooms/"+c+"/nhie/who/"+uid), {emoji:myEmoji()||cur.emoji||"", confessions:+cur.confessions||0, seen:+cur.seen||0});
  code=c;
  try{sessionStorage.setItem("tp_nhie_room", code)}catch(e){}
  listen(); armPresence();
}
var closeArmed=0;
function askClose(){
  if(!isHost()||!code) return;
  if(Date.now()-closeArmed>2500){closeArmed=Date.now(); fail("Tap close again to end the room for everyone."); return}
  fail("");
  remove(ref(db, "rooms/"+code)).catch(function(e){fail(friendly(e))});
  try{sessionStorage.removeItem("tp_nhie_room")}catch(e){}
}
function sendReact(emo){
  var now=serverNow();
  if(now-lastReactAt<1500) return;
  lastReactAt=now;
  var id=(now.toString(36)+Math.random().toString(36).slice(2,8)).replace(/[^A-Za-z0-9]/g,"").slice(0,24);
  if(id.length<6) id=("react"+id+"xxxxxx").slice(0,12);
  update(ref(db), {[rpath("nhie/react/"+id)]:{e:emo, u:uid}}).catch(function(e){fail(friendly(e))});
}
function playAgain(){
  if(!isHost()||!meta||meta.status!=="over"||hostLock) return;
  var next=Math.min(100,(+meta.gameId||1)+1);
  if(next===(+meta.gameId||1)){fail("This room has used its rematches."); return}
  hostLock=true;
  update(ref(db), {[rpath("meta")]:fullMeta({status:"lobby", phase:"lobby", gameId:next, spice:meta.spice, rounds:rounds()})}).then(function(){hostLock=false}).catch(function(e){hostLock=false; fail(friendly(e))});
}
function focusName(){
  var el=$("pname"); if(!el) return;
  try{el.focus({preventScroll:false})}catch(e){try{el.focus()}catch(err){}}
}
function wire(){
  var saved=""; try{saved=localStorage.getItem("tp_name")||""}catch(e){}
  if(saved&&$("pname")&&!$("pname").value) $("pname").value=saved;
  try{
    var mode=sessionStorage.getItem("tp_nhie_mode"); if(mode&&/^(mild|classic|spicy)$/.test(mode)) lobbyMode=mode;
    var len=+sessionStorage.getItem("tp_nhie_len"); if(LENGTHS.indexOf(len)>=0) gameLength=len;
  }catch(e){}
  paintEmoji(); paintModes(); paintLengths();
  document.body.dataset.mode=lobbyMode;
  var linked=queryRoom();
  if(linked&&$("roomcode")) $("roomcode").value=linked;
  $("hostbtn").addEventListener("click", function(){
    var name=normName($("pname").value);
    if(!name){fail("Add your name first."); focusName(); return}
    if(sending) return;
    sending=true;
    try{localStorage.setItem("tp_name", name)}catch(e){}
    fail(""); tapSound("whoosh");
    hostRoom(name).catch(function(e){fail(e&&e.message==="room"?"Couldn't open a room. Try again.":friendly(e))}).then(function(){sending=false});
  });
  $("joinform").addEventListener("submit", function(e){e.preventDefault(); $("joinbtn").click()});
  $("joinbtn").addEventListener("click", function(){
    var name=normName($("pname").value), c=normCode($("roomcode").value);
    if(!name){fail("Add your name first."); focusName(); return}
    if(!validCode(c)){fail("Enter the 4-letter code."); $("roomcode").focus(); return}
    if(sending) return;
    sending=true;
    try{localStorage.setItem("tp_name", name)}catch(e){}
    fail(""); tapSound("whoosh");
    joinRoom(c, name).catch(function(e){
      var msg=String((e&&e.message)||"");
      if(msg==="kind") fail("That code is for a different game.");
      else if(msg==="missing") fail("No room with that code.");
      else if(msg==="closed") fail("That game has already started.");
      else fail(friendly(e));
    }).then(function(){sending=false});
  });
  if($("optin")) $("optin").addEventListener("change", render);
  $("start").addEventListener("click", function(){unlock(); begin()});
  $("ihave").addEventListener("click", function(){sendCast("have")});
  $("never").addEventListener("click", function(){sendCast("never")});
  $("nextround").addEventListener("click", function(){unlock(); advance()});
  if($("again")) $("again").addEventListener("click", function(){unlock(); playAgain()});
  $("close").addEventListener("click", askClose);
  $("closestage").addEventListener("click", askClose);
  $("copylink").addEventListener("click", function(){copyLink($("copylink"))});
  $("sharebtn").addEventListener("click", shareRoom);
  if($("copycode")) $("copycode").addEventListener("click", function(){
    if(!code) return;
    unlock();
    copyText(code).then(function(){cue("clink"); fail("")}).catch(function(){fail(code)});
  });
  if($("qrhide")) $("qrhide").addEventListener("click", function(){
    var canvas=$("qr"); if(!canvas) return;
    var hidden=canvas.dataset.hidden==="1";
    canvas.dataset.hidden=hidden?"0":"1";
    canvas.classList.toggle("hide", !hidden);
    $("qrhide").textContent=hidden?"Hide QR":"Show QR";
    if(hidden) paintQr();
  });
  $("queue").addEventListener("click", queueCustom);
  $("custom").addEventListener("keydown", function(e){if(e.key==="Enter"){e.preventDefault(); queueCustom()}});
  document.querySelectorAll("[data-mode]").forEach(function(b){b.addEventListener("click", function(){if(!meta||isHost()) setMode(b.dataset.mode)})});
  document.querySelectorAll("[data-len]").forEach(function(b){b.addEventListener("click", function(){if(!meta||isHost()) setLength(b.dataset.len)})});
  $("mixbtn").addEventListener("click", function(){$("mixer").classList.toggle("hide"); unlock()});
  ["mixmusic","mixsfx","mixvoice"].forEach(function(id){
    $(id).addEventListener("input", function(){
      var v=$(id).value/100;
      if(id==="mixmusic") mix.music=v; else if(id==="mixsfx") mix.sfx=v; else mix.voice=v;
      saveMix();
    });
  });
  $("mutemusic").addEventListener("change", function(){mix.muteMusic=$("mutemusic").checked; saveMix()});
  $("mutesfx").addEventListener("change", function(){mix.muteSfx=$("mutesfx").checked; saveMix()});
  $("mutevoice").addEventListener("change", function(){mix.muteVoice=$("mutevoice").checked; saveMix(); if(mix.muteVoice&&window.speechSynthesis){try{window.speechSynthesis.cancel()}catch(e){}}});
  document.querySelectorAll("[data-emo]").forEach(function(b){
    b.addEventListener("click", function(){unlock(); if(code) sendReact(b.dataset.emo); else cue(EMO_CUE[b.dataset.emo]||"clink")});
  });
  $("mixmusic").value=Math.round(mix.music*100);
  $("mixsfx").value=Math.round(mix.sfx*100);
  $("mixvoice").value=Math.round(mix.voice*100);
  $("mutemusic").checked=!!mix.muteMusic;
  $("mutesfx").checked=!!mix.muteSfx;
  $("mutevoice").checked=!!mix.muteVoice;
  var mute=$("mute"); if(window.TPSound&&mute) TPSound.bindMute(mute);
  if(!clockTimer) clockTimer=setInterval(paintClock, 200);
  window.addEventListener("offline", function(){fail("You're offline. We'll keep trying when you're back.")});
  window.addEventListener("online", function(){fail(""); if(goOnline&&db){try{goOnline(db)}catch(e){}} armServerClock()});
  window.addEventListener("pagehide", function(){stopServerClock()});
  var back=""; try{back=sessionStorage.getItem("tp_nhie_room")||""}catch(e){}
  var same=linked&&back&&linked===back;
  if(linked&&!same){
    focusName();
    var yes=document.getElementById("gyes");
    if(yes) yes.addEventListener("click", function(){setTimeout(focusName, 60)}, {once:true});
  }
  var nm=normName($("pname").value);
  if(!linked&&back&&validCode(back)&&nm) joinRoom(back, nm).catch(function(){try{sessionStorage.removeItem("tp_nhie_room")}catch(e){}});
  else if(same&&nm) joinRoom(back, nm).catch(function(){focusName()});
}
function showReady(){
  if(bootTimer){clearTimeout(bootTimer); bootTimer=0}
  var boot=$("boot"); if(boot) boot.classList.add("hide");
  var app=$("app"); if(app) app.classList.remove("hide");
}
function showBootError(msg){
  if(bootTimer){clearTimeout(bootTimer); bootTimer=0}
  var boot=$("boot"); if(boot) boot.classList.remove("hide");
  var app=$("app"); if(app) app.classList.add("hide");
  if($("bootmsg")) $("bootmsg").textContent="Couldn't open the game.";
  if($("booterr")){$("booterr").textContent=msg||"Check your connection and try again."; $("booterr").classList.remove("hide")}
  if($("retry")) $("retry").classList.remove("hide");
}
async function boot(){
  bootTimer=setTimeout(function(){
    if($("app")&&$("app").classList.contains("hide")) showBootError("This is taking too long. Check your connection and try again.");
  }, 12000);
  if(!navigator.onLine&&!emuOn()){showBootError("You're offline. Reconnect, then try again."); return}
  var base="https://www.gstatic.com/firebasejs/12.4.0/";
  var appMod=await import(base+"firebase-app.js");
  var authMod=await import(base+"firebase-auth.js");
  var dbMod=await import(base+"firebase-database.js");
  var cfg=await import("../firebase-config.js?v=17");
  var app=appMod.initializeApp(cfg.firebaseConfig);
  authObj=authMod.getAuth(app);
  db=dbMod.getDatabase(app);
  ref=dbMod.ref; onValue=dbMod.onValue; update=dbMod.update; set=dbMod.set; remove=dbMod.remove; onDisconnect=dbMod.onDisconnect; get=dbMod.get; serverTimestamp=dbMod.serverTimestamp; goOnline=dbMod.goOnline;
  if(emuOn()){
    authMod.connectAuthEmulator(authObj, "http://127.0.0.1:9099", {disableWarnings:true});
    dbMod.connectDatabaseEmulator(db, "127.0.0.1", 9000);
  }
  if(authMod.setPersistence && authMod.browserLocalPersistence){
    try{await authMod.setPersistence(authObj, authMod.browserLocalPersistence)}catch(e){}
  }
  if(authObj.authStateReady) await authObj.authStateReady();
  var cred=authObj.currentUser?{user:authObj.currentUser}:await authMod.signInAnonymously(authObj);
  await cred.user.getIdToken();
  uid=cred.user.uid;
  document.body.dataset.uid=uid;
  goOnline(db);
  armServerClock();
  if(emuOn()){
    window.__tpNhie={
      delayCast:0,
      uid:function(){return uid},
      code:function(){return code},
      seen:function(){return who[uid]&&who[uid].seen},
      confessions:function(){return who[uid]&&who[uid].confessions},
      cast:function(){return cast[uid]||""},
      step:function(){return table&&table.step},
      clean:function(s){return cleanText(s)}
    };
  }
  showReady();
  try{wire()}catch(err){console.error(err); fail("The table glitched. Reload and try again.")}
}
if($("retry")) $("retry").addEventListener("click", function(){location.reload()});
boot().catch(function(err){console.error(err); showBootError("The game didn't open. Check your connection and try again.")});
})();
