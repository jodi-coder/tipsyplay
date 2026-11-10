(function(){
"use strict";
/* Multiplayer Who's Most Likely.
   Votes are for people. They stay hidden until reveal.
   The countdown is only for voting. Sips are never timed.
   mlt/$pin */
var FAST=/[?&]emulator=1(?:&|$)/.test(location.search)&&/[?&]fast=1(?:&|$)/.test(location.search);
var ANSWER_MS=FAST?1600:12000;
var REVEAL_GRACE=FAST?800:1200;
var LENGTHS=[5,10,15];
var EMOJIS=["","😎","🦊","🌟","🎧","🍀","🔥","🌙","🎭","🍓","🎲","🦋"];
var ALPHABET="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var MIXKEY="tp_mlt_mix";
var $=function(id){return document.getElementById(id)};
var mix=window.PartyAudio?PartyAudio.load(MIXKEY):{music:0.7,sfx:0.9,voice:0.85,muteMusic:false,muteSfx:false,muteVoice:false};
var engine=null, parts=[], raf=0;
var uid=null, code=null, meta=null, players={}, table=null, casts={}, reveal={}, customs=[], mine=null;
var lobbyPack="classic", gameLength=10, lobbyDirty=false, usedCustom={}, pendingVote="", sending=false;
var serverOffset=0, offsetReady=false, offsetStop=null, revealWait=0, announcedSeq=-1, announcedFinal=-1, knownRematch="";
var db, authObj, stops=[], connStop=null, castStop=null, busy=false, audioOn=false, musicWanted=false;
var bootTimer=0, clockTimer=0, hostTimer=0, suspenseTimer=0, lightTimer=0, lastTick=-1;
var heardRound=-1, suspenseFor=-1, stingFor=-1, heardTwist=-1, heardOver=false, showRevealNow=-1;
var revealSent="", autoSent="", deck=[], builtPack="", scoring=0, closeArmed=0;
var ref, onValue, update, set, remove, onDisconnect, get, serverTimestamp, goOnline;

function saveMix(){try{localStorage.setItem(MIXKEY, JSON.stringify(mix))}catch(e){} pushMix()}
function audioEngine(){
  if(engine||!window.PartyAudio) return engine;
  engine=PartyAudio.create({
    key:MIXKEY, mix:mix, host:isHost,
    hype:function(){return table?Math.min(6,+table.round||0):0},
    bpm:104, hypePer:4
  });
  return engine;
}
function headerMuted(){return !!(window.TPSound&&!TPSound.enabled())}
function sfxOn(){return !mix.muteSfx&&!headerMuted()}
function voiceOn(){return !mix.muteVoice&&!headerMuted()}
function pushMix(){
  if(!engine) return;
  var ps=mix.muteSfx, pv=mix.muteVoice, pm=mix.muteMusic;
  if(headerMuted()){mix.muteSfx=true; mix.muteVoice=true; mix.muteMusic=true}
  try{engine.apply()}catch(e){}
  mix.muteSfx=ps; mix.muteVoice=pv; mix.muteMusic=pm;
  if(headerMuted()){
    if(engine.stopMusic) engine.stopMusic();
    if(window.speechSynthesis){try{window.speechSynthesis.cancel()}catch(e){}}
  }
}
function cue(name){
  if(!audioOn||!sfxOn()) return;
  var eng=audioEngine();
  if(eng){try{eng.cue(name)}catch(e){}}
}
function say(line){
  if(!audioOn||!voiceOn()||!isHost()||!line) return;
  var eng=audioEngine();
  if(eng){try{eng.say(line)}catch(e){}}
}
function unlock(){
  audioOn=true;
  try{var eng=audioEngine(); if(eng) eng.unlock(); if(window.TPSound) TPSound.unlock()}catch(e){}
}
function maybeMusic(){
  if(!audioOn||!isHost()||headerMuted()||mix.muteMusic||!(mix.music>0)||!musicWanted){
    if(engine&&engine.stopMusic&&(!musicWanted||mix.muteMusic||headerMuted())) engine.stopMusic();
    return;
  }
  var eng=audioEngine();
  if(eng) eng.startMusic();
}
function buzz(){
  try{if(typeof navigator.vibrate==="function") navigator.vibrate(20)}catch(e){}
}
function tapSound(name){unlock(); cue(name); buzz()}
function isHost(){return !!(meta&&uid&&meta.hostUid===uid)}
function order(){
  return Object.keys(players).map(function(id){
    var p=players[id]||{};
    return {uid:id, name:p.name||"Player", emoji:p.emoji||"", connected:p.connected!==false, joinedAt:p.joinedAt||0, votes:+p.votes||0, seen:+p.seen||0};
  }).sort(function(a,b){return a.joinedAt-b.joinedAt||a.name.localeCompare(b.name)});
}
function active(){return order().filter(function(p){return p.connected})}
function plainName(id){
  var list=order(), count={}, seen={}, map={};
  list.forEach(function(p){count[p.name]=(count[p.name]||0)+1});
  list.forEach(function(p){
    if(count[p.name]<2){map[p.uid]=p.name; return}
    seen[p.name]=(seen[p.name]||0)+1;
    map[p.uid]=seen[p.name]===1?p.name:(p.name+" "+seen[p.name]);
  });
  return map[id]||(players[id]&&players[id].name)||"Player";
}
function labelOf(p){return (p.emoji?p.emoji+" ":"")+plainName(p.uid)}
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
function voteTarget(raw, seq){
  var s=String(raw||"");
  var at=s.lastIndexOf("@");
  if(at>0&&/^\d+$/.test(s.slice(at+1))){
    if(+s.slice(at+1)!==seq) return "";
    return s.slice(0, at);
  }
  return s;
}
function rpath(p){return "mlt/"+code+"/"+p}
function fail(msg){var p=$("perr"); if(p) p.textContent=msg||""}
function friendly(e){
  var c=String((e&&(e.code||e.message))||"");
  if(/permission|denied/i.test(c)) return "That room isn't available.";
  if(/offline|network|fetch/i.test(c)) return "You're offline. Check the connection and try again.";
  return "Something went wrong. Try again.";
}
function normName(v){return String(v||"").replace(/<[^>]*>/g,"").replace(/[<>]/g,"").trim().slice(0,20)}
function normPin(v){
  var s=String(v||"");
  var q=s.toUpperCase().match(/[?&]PIN=([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6})/);
  if(q) return q[1];
  return s.toUpperCase().replace(/[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]/g,"").slice(0,6);
}
function validPin(c){return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(c)}
function makePin(){var s="",i; for(i=0;i<6;i++) s+=ALPHABET[Math.floor(Math.random()*ALPHABET.length)]; return s}
function queryPin(){
  var raw="";
  try{var q=new URLSearchParams(location.search); raw=q.get("pin")||""}catch(e){raw=location.search||""}
  var c=normPin(raw||location.search||"");
  return validPin(c)?c:"";
}
function emuOn(){return /[?&]emulator=1(?:&|$)/.test(location.search)}
function roomUrl(pin){
  var base=/localhost|127\.0\.0\.1/.test(location.host)?location.origin+location.pathname:"https://tipsyplay.com/games/whos-most-likely.html";
  return base+"?pin="+pin;
}
function rounds(){
  if(isHost()&&(!meta||meta.status==="lobby")&&LENGTHS.indexOf(gameLength)>=0) return gameLength;
  var n=meta&&+meta.rounds;
  if(LENGTHS.indexOf(n)>=0) return n;
  return 10;
}
function currentPack(){
  if(isHost()&&(!meta||meta.status==="lobby")&&/^(classic|spicy|couples)$/.test(lobbyPack)) return lobbyPack;
  if(meta&&/^(classic|spicy|couples)$/.test(meta.pack)) return meta.pack;
  return "classic";
}
function packLabel(p){return p==="spicy"?"Spicy":p==="couples"?"Couples":"Classic"}
function myEmoji(){try{return sessionStorage.getItem("tp_mlt_emoji")||""}catch(e){return ""}}
function myVote(){
  if(pendingVote) return pendingVote;
  if(!mine||!table) return "";
  return voteTarget(mine, +table.seq||0);
}
function screen(id){["home","lobby","table","closed"].forEach(function(s){var n=$(s); if(n) n.classList.toggle("hide", s!==id)})}
function paintRole(){
  document.body.classList.toggle("is-host", isHost());
  document.querySelectorAll(".hostonly").forEach(function(n){n.classList.toggle("hide", !isHost())});
}
function reduceMotion(){
  try{return window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches}catch(e){return false}
}
function flash(){document.body.classList.remove("mlt-flash"); void document.body.offsetWidth; document.body.classList.add("mlt-flash")}
function flashLights(){
  var el=$("lights"); if(!el) return;
  el.classList.add("on");
  if(lightTimer) clearTimeout(lightTimer);
  lightTimer=setTimeout(function(){el.classList.remove("on"); lightTimer=0}, 160);
}
function burst(n){
  var c=$("fx"); if(!c) return;
  c.width=window.innerWidth; c.height=window.innerHeight;
  var color=document.body.dataset.pack==="spicy"?"#f43f5e":document.body.dataset.pack==="couples"?"#c084fc":"#f59e0b";
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
function packs(){return (window.MLT_PACKS&&MLT_PACKS[currentPack()])||(window.MLT_PACKS&&MLT_PACKS.classic)||[]}
function buildDeck(){
  var pool=packs().slice(), i, j, t;
  for(i=pool.length-1;i>0;i--){j=Math.floor(Math.random()*(i+1)); t=pool[i]; pool[i]=pool[j]; pool[j]=t}
  deck=pool; builtPack=currentPack();
}
function takeLine(){
  var i;
  for(i=0;i<customs.length;i++){
    var line=customs[i];
    if(line&&!usedCustom[line]){usedCustom[line]=1; return line}
  }
  if(!deck.length||builtPack!==currentPack()) buildDeck();
  return deck.shift()||"";
}
function promptsMissing(){fail("The prompts didn't load. Reload the page to try again.")}
function cleanQ(raw){
  var t=String(raw||"").replace(/<[^>]*>/g,"").replace(/[<>]/g,"").replace(/\s+/g," ").trim().slice(0,80);
  if(!t) return "";
  if(!/^who/i.test(t)) t=("Who's most likely to "+t).slice(0,80);
  return t;
}
function splitPrompt(text){
  var t=String(text||"");
  var m=t.match(/^who(?:'|’)s most likely(?:\s+to)?\s*/i);
  if(!m) return {kicker:"Who's most likely", rest:t||"The question didn't load."};
  var rest=t.slice(m[0].length).replace(/^to\s+/i,"");
  return {kicker:"Who's most likely", rest:rest||"The question didn't load."};
}
function playObj(patch){
  var base={step:"vote", text:"", seq:0, round:0, opened:0, order:order().map(function(p){return p.uid}).join(",")||uid||"table", got:0, who:""};
  var b=Object.assign(base, table||{}, patch||{});
  var step=/^(vote|reveal|twist|over)$/.test(b.step)?b.step:"vote";
  var text=String(b.text||"").replace(/[<>]/g,"").trim().slice(0,120);
  if(!text) return null;
  return {
    step:step,
    text:text,
    seq:Math.max(0, Math.min(80, +b.seq||0)),
    round:Math.max(0, Math.min(40, +b.round||0)),
    opened:Math.max(0, +b.opened||0),
    order:String(b.order||uid||"table").slice(0,2000),
    got:Math.max(0, Math.min(12, +b.got||0)),
    who:String(b.who||"").slice(0,128)
  };
}
function fullMeta(patch){
  var m=Object.assign({}, meta||{}, patch||{});
  var pack=/^(classic|spicy|couples)$/.test(m.pack)?m.pack:"classic";
  var len=LENGTHS.indexOf(+m.rounds)>=0?+m.rounds:(LENGTHS.indexOf(gameLength)>=0?gameLength:10);
  var status=/^(lobby|play|over)$/.test(m.status)?m.status:"lobby";
  var out={
    hostUid:m.hostUid,
    createdAt:m.createdAt,
    status:status,
    pack:pack,
    twist:!!m.twist,
    nohost:!!m.nohost,
    round:Math.max(0, Math.min(40, +m.round||0)),
    rounds:len
  };
  if(+m.rematch>0) out.rematch=Math.max(1, Math.min(100, +m.rematch||0));
  return out;
}
function tally(){
  var counts={}, best=0, wins=[], n=0;
  Object.keys(reveal).forEach(function(voter){
    var t=reveal[voter];
    if(!t||!players[t]) return;
    counts[t]=(counts[t]||0)+1; n++;
    if(counts[t]>best){best=counts[t]; wins=[t]}
    else if(counts[t]===best&&wins.indexOf(t)<0) wins.push(t);
  });
  return {counts:counts, best:best, wins:wins, n:n};
}
function allIn(){
  var list=active();
  if(!list.length) return false;
  var seq=table?+table.seq||0:0;
  return list.every(function(p){return !!voteTarget(casts[p.uid], seq)});
}
function secondsLeft(){
  if(!table||table.step!=="vote") return null;
  var opened=+table.opened||0;
  if(opened<1700000000000) return null;
  return Math.max(0, Math.ceil((opened+ANSWER_MS-serverNow())/1000));
}
function resultsVisible(){
  if(!table) return false;
  var seq=+table.seq||0;
  if(table.step==="twist"||table.step==="over") return true;
  return table.step==="reveal"&&showRevealNow===seq;
}
function isFinalRound(){
  if(!table) return false;
  return (+table.round||0)+1>=rounds();
}
function stopAudioTimers(){
  if(suspenseTimer){clearTimeout(suspenseTimer); suspenseTimer=0}
  if(lightTimer){clearTimeout(lightTimer); lightTimer=0}
}
function paintEmoji(){
  var box=$("emojis"); if(!box) return;
  var cur=myEmoji();
  box.textContent="";
  EMOJIS.forEach(function(emo){
    var b=document.createElement("button");
    b.type="button";
    b.dataset.cue="1";
    b.textContent=emo||"·";
    b.setAttribute("aria-label", emo?emo:"No emoji");
    b.setAttribute("aria-pressed", emo===cur?"true":"false");
    b.addEventListener("click", function(){
      try{sessionStorage.setItem("tp_mlt_emoji", emo)}catch(e){}
      paintEmoji();
      if(code&&uid&&players[uid]){
        var me=players[uid];
        set(ref(db, rpath("players/"+uid)), playerRec(me.name, me)).catch(function(err){fail(friendly(err))});
      }
    });
    box.appendChild(b);
  });
}
function paintPacks(){
  var pack=currentPack();
  document.querySelectorAll("#packs [data-pack]").forEach(function(b){b.setAttribute("aria-pressed", b.dataset.pack===pack?"true":"false")});
}
function paintLengths(){
  var n=rounds();
  document.querySelectorAll("[data-len]").forEach(function(b){b.setAttribute("aria-pressed", +b.dataset.len===n?"true":"false")});
}
function drawQR(){
  var canvas=$("qr");
  if(!canvas||!code||!window.TipsyQR) return;
  TipsyQR.draw(canvas, roomUrl(code), 148);
}
function copyText(text){
  if(navigator.clipboard&&navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(function(){return legacyCopy(text)});
  return legacyCopy(text);
}
function legacyCopy(text){
  return new Promise(function(resolve, reject){
    var ta=document.createElement("textarea");
    ta.value=text; ta.setAttribute("readonly","");
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
    navigator.share({title:"Who's Most Likely", text:"Join my Who's Most Likely room "+code, url:link}).then(function(){cue("clink")}).catch(function(err){
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
  drawQR();
  var box=$("plist"); if(box){box.textContent="";
    order().forEach(function(p){
      var row=document.createElement("div"); row.className="mlt-person"+(p.connected?"":" off");
      var s=document.createElement("span");
      s.textContent=labelOf(p)+(p.uid===meta.hostUid?" · host":"");
      var tag=document.createElement("span"); tag.textContent=p.connected?"":"away";
      row.appendChild(s); row.appendChild(tag);
      if(isHost()&&p.uid!==uid){
        var kick=document.createElement("button"); kick.type="button"; kick.className="x"; kick.textContent="Remove";
        kick.setAttribute("aria-label", "Remove "+plainName(p.uid));
        kick.addEventListener("click", function(){remove(ref(db, rpath("players/"+p.uid))).catch(function(e){fail(friendly(e))})});
        row.appendChild(kick);
      }
      box.appendChild(row);
    });
  }
  paintPacks(); paintLengths();
  if($("twist")) $("twist").checked=!!meta.twist;
  if($("nohost")) $("nohost").checked=!!meta.nohost;
  var n=order().length;
  var start=$("start");
  if(start){
    start.textContent="Start · "+rounds()+" rounds";
    start.disabled=!isHost()||!$("optin").checked||n<3||n>12;
  }
  var note=$("lobbynote");
  if(note){
    if(n<3) note.textContent="Need "+(3-n)+" more player"+(3-n===1?"":"s")+".";
    else if(n>12) note.textContent="12 players max.";
    else if(isHost()&&!$("optin").checked) note.textContent="Tick the opt-in, then start.";
    else note.textContent=isHost()?"Pack's loaded. You're the host.":"You're in. The host starts when the table's ready.";
  }
}
function paintVotes(){
  var box=$("votes"); if(!box) return;
  var voting=!!(table&&table.step==="vote");
  box.classList.toggle("hide", !voting);
  var locked=$("locked");
  if(locked) locked.classList.toggle("hide", !voting||!myVote());
  if(!voting){box.textContent=""; return}
  var pick=myVote();
  box.textContent="";
  order().forEach(function(p){
    var b=document.createElement("button");
    b.type="button";
    b.dataset.cue="1";
    b.setAttribute("data-vote", p.uid);
    b.setAttribute("aria-pressed", pick===p.uid?"true":"false");
    b.disabled=!!pick;
    if(p.emoji){
      var emo=document.createElement("span"); emo.className="emo"; emo.setAttribute("aria-hidden","true"); emo.textContent=p.emoji;
      b.appendChild(emo);
    }
    var nm=document.createElement("span"); nm.textContent=p.name;
    b.appendChild(nm);
    b.addEventListener("click", function(){sendVote(p.uid, b)});
    box.appendChild(b);
  });
  var pass=document.createElement("button");
  pass.type="button";
  pass.className="btn alt";
  pass.textContent="Pass";
  pass.setAttribute("aria-pressed", pick==="pass"?"true":"false");
  pass.disabled=!!pick;
  pass.addEventListener("click", function(){sendPassVote(pass)});
  box.appendChild(pass);
}
function paintResults(){
  var show=!!(table&&resultsVisible()&&(table.step==="reveal"||table.step==="twist"));
  var wrap=$("results"); if(wrap) wrap.classList.toggle("hide", !show);
  var hold=$("hold");
  var holding=!!(table&&table.step==="reveal"&&!resultsVisible());
  if(hold) hold.classList.toggle("hide", !holding);
  var head=$("drinkhead"), list=$("winners"), tie=$("tie");
  if(!show){
    if(head) head.textContent="";
    if(list) list.textContent="";
    if(tie){tie.textContent=""; tie.classList.add("hide")}
    return;
  }
  var result=tally();
  if(head) head.textContent=result.n?"Sip, water, or pose":"Nobody this round";
  if(list){
    list.textContent="";
    result.wins.forEach(function(id){
      var li=document.createElement("li");
      if(players[id]&&players[id].emoji){
        var emo=document.createElement("span"); emo.className="emo"; emo.setAttribute("aria-hidden","true"); emo.textContent=players[id].emoji;
        li.appendChild(emo);
      }
      var nm=document.createElement("span"); nm.textContent=plainName(id);
      li.appendChild(nm); list.appendChild(li);
    });
  }
  if(tie){
    if(!result.n){tie.textContent="Nothing is owed."; tie.classList.remove("hide")}
    else if(result.wins.length>1){tie.textContent="It's a tie. Nothing stacks."; tie.classList.remove("hide")}
    else {tie.textContent=""; tie.classList.add("hide")}
  }
}
function paintTwist(){
  var on=!!(table&&table.step==="twist");
  var box=$("twistbox"); if(box) box.classList.toggle("hide", !on);
  if(!on||!table) return;
  if($("twistwho")) $("twistwho").textContent=plainName(table.who);
  if($("twistcopy")) $("twistcopy").textContent=plainName(table.who)+", explain that vote. One turn, then it is over.";
}
function paintAwards(){
  var box=$("awards"); if(!box) return;
  box.textContent="";
  var list=order();
  if(!list.length) return;
  var max=0, min=Infinity;
  list.forEach(function(p){if(p.votes>max) max=p.votes; if(p.votes<min) min=p.votes});
  function names(group){return group.map(labelOf).join(", ")}
  var rows;
  if(max===0) rows=[{title:"A quiet table", names:names(list), line:"No mentions. Nothing is owed."}];
  else if(max===min) rows=[{title:"Even mentions", names:names(list), line:"Same number of mentions. Not a drink score."}];
  else rows=[
    {title:"Quiet one", names:names(list.filter(function(p){return p.votes===min})), line:min===0?"No mentions. Nothing extra is owed.":"Fewest mentions ("+min+"). Not a drink score."},
    {title:"Main character", names:names(list.filter(function(p){return p.votes===max})), line:"Mentioned the most ("+max+"). Bragging rights only. Nothing stacks."}
  ];
  rows.forEach(function(a){
    var card=document.createElement("article"); card.className="mlt-award";
    var t=document.createElement("p"); t.className="mlt-award-kicker"; t.textContent=a.title;
    var n=document.createElement("p"); n.className="mlt-award-name"; n.textContent=a.names;
    var l=document.createElement("p"); l.textContent=a.line;
    card.appendChild(t); card.appendChild(n); card.appendChild(l); box.appendChild(card);
  });
}
function paintQueue(){
  var note=$("queuednote"); if(!note) return;
  if(!note.dataset.sticky) note.textContent="";
}
function paintClock(){
  var wrap=$("clock"); if(!wrap) return;
  var left=secondsLeft();
  var on=left!==null&&!!(table&&table.step==="vote");
  wrap.classList.toggle("hide", !on);
  if(!on){lastTick=-1; return}
  wrap.classList.toggle("hot", left<=3);
  var num=$("clocknum"); if(num) num.textContent=String(left);
  wrap.setAttribute("aria-hidden", "true");
  var live=$("clocklive");
  var seq=table?+table.seq||0:0;
  if(live){
    if(announcedSeq!==seq){announcedSeq=seq; announcedFinal=-1; live.textContent="Round started. "+left+" seconds to vote."}
    else if(left===3&&announcedFinal!==seq){announcedFinal=seq; live.textContent="3 seconds to vote."}
  }
  if(audioOn&&sfxOn()&&left>0&&left<=3&&left!==lastTick){lastTick=left; cue("tick")}
  if(isHost()&&left<=0) publish();
}
function paintTable(){
  var over=!!(table&&table.step==="over")||(meta&&meta.status==="over");
  var pack=currentPack();
  var total=rounds();
  var num=table?Math.min(total, (+table.round||0)+1):1;
  var round=$("roundlabel");
  if(round) round.textContent=over?(total+" rounds played"):("Round "+num+" of "+total);
  var badge=$("badge"); if(badge) badge.textContent=packLabel(pack);
  var face=splitPrompt(table&&table.text);
  var kicker=$("kicker"); if(kicker) kicker.textContent=over?"That's the night":face.kicker;
  var statement=$("statement"); if(statement) statement.textContent=face.rest;
  var card=$("card"); if(card&&table) card.setAttribute("aria-label", table.text||"Who's most likely");
  paintVotes();
  paintResults();
  paintTwist();
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
    var showNext=isHost()&&!meta.nohost&&table&&(table.step==="twist"||(table.step==="reveal"&&resultsVisible()));
    next.classList.toggle("hide", !showNext);
    if(table&&table.step==="reveal"&&table.who) next.textContent="Plot twist";
    else next.textContent=isFinalRound()?"That's the night":"Next round";
  }
  var hostP=meta&&players[meta.hostUid];
  var away=$("away"); if(away) away.classList.toggle("hide", !hostP||hostP.connected!==false||isHost()||over);
  paintClock();
  placePlay();
}
function placePlay(){
  if(!table) return;
  var key=table.step+":"+table.seq+":"+(resultsVisible()?"1":"0");
  if(placePlay.key===key) return;
  placePlay.key=key;
  try{window.scrollTo(0,0)}catch(e){}
}
function render(){
  paintRole();
  document.body.dataset.pack=currentPack();
  document.body.dataset.phase=table?table.step:(meta&&meta.status==="lobby"?"lobby":"");
  if(!meta){screen("home"); return}
  if(meta.status==="lobby"){
    if(!lobbyDirty){
      if(/^(classic|spicy|couples)$/.test(meta.pack)) lobbyPack=meta.pack;
      if(LENGTHS.indexOf(+meta.rounds)>=0) gameLength=+meta.rounds;
    }
    screen("lobby");
    paintLobby();
    return;
  }
  screen("table");
  hear();
  paintTable();
  maybeScore();
  if(isHost()&&table&&table.step==="vote"&&allIn()) publish();
}
function hear(){
  if(!table) return;
  var seq=+table.seq||0;
  if(table.step==="vote"&&heardRound!==seq){
    heardRound=seq;
    var fresh=!table.opened||Date.now()-(+table.opened||0)<4000;
    if(fresh){
      cue("mltRound");
      flashLights();
      var card=$("card");
      if(card){card.classList.remove("mlt-slam"); void card.offsetWidth; card.classList.add("mlt-slam")}
    }
  }
  if(table.step==="reveal") armReveal();
  if(table.step==="twist"&&heardTwist!==seq){
    heardTwist=seq;
    if(!table.opened||Date.now()-(+table.opened||0)<4000) cue("mltTwist");
  }
  if((table.step==="over"||(meta&&meta.status==="over"))&&!heardOver){
    heardOver=true;
    var age=Date.now()-(+table.opened||0);
    if(age<8000){cue("mltFinale"); burst(56); flash()}
  }
}
function armReveal(){
  if(!table||table.step!=="reveal") return;
  var seq=+table.seq||0;
  if(suspenseFor===seq) return;
  suspenseFor=seq;
  var age=Date.now()-(+table.opened||0);
  if(age>4000){showRevealNow=seq; stingFor=seq; return}
  if(reduceMotion()){finishReveal(seq, false); return}
  if(suspenseTimer) clearTimeout(suspenseTimer);
  cue("mltSuspense");
  suspenseTimer=setTimeout(function(){finishReveal(seq, true)}, 1050);
}
function finishReveal(seq, paint){
  suspenseTimer=0;
  if(!table||(+table.seq||0)!==seq) return;
  if(table.step!=="reveal"&&table.step!=="twist") return;
  showRevealNow=seq;
  if(stingFor===seq){if(paint) render(); return}
  stingFor=seq;
  var result=tally();
  if(!result.n) cue("mltNone");
  else if(result.wins.length>1) cue("mltTie");
  else cue("mltWin");
  if(!result.n) say("Nobody this round.");
  else if(result.wins.length>1) say("It's a tie.");
  else say("Sip, water, or pose.");
  flash();
  buzz();
  if(result.n&&result.wins.length===1) burst(40);
  else if(result.wins.length>1) burst(22);
  if(paint) render();
}
function maybeScore(){
  if(!table||!uid||!players[uid]) return;
  if(table.step!=="reveal"&&table.step!=="twist"&&table.step!=="over") return;
  var seq=+table.seq||0;
  if(seq<=(+players[uid].seen||0)||scoring===seq) return;
  scoring=seq;
  var n=0;
  Object.keys(reveal).forEach(function(voter){if(reveal[voter]===uid) n++});
  var me=players[uid];
  set(ref(db, rpath("players/"+uid)), {
    name:me.name, emoji:me.emoji||"", connected:me.connected!==false, joinedAt:me.joinedAt||serverNow(),
    votes:Math.min(80,(+me.votes||0)+n), seen:seq
  }).catch(function(e){if(scoring===seq) scoring=0; fail(friendly(e))});
}
function clearBallots(payload){
  Object.keys(reveal).forEach(function(id){payload[rpath("reveal/"+id)]=null});
  Object.keys(casts).forEach(function(id){payload[rpath("cast/"+id)]=null});
}
function publish(){
  if(busy||!isHost()||!table||table.step!=="vote") return;
  if(!allIn()){
    var left=secondsLeft();
    if(left===null||left>0){revealWait=0; return}
    if(!revealWait){revealWait=serverNow(); return}
    if(serverNow()-revealWait<REVEAL_GRACE) return;
  }
  if(revealSent===table.seq) return;
  revealSent=table.seq;
  revealWait=0;
  busy=true;
  var seq=+table.seq||0;
  var snap={};
  Object.keys(casts).forEach(function(id){
    var target=voteTarget(casts[id], seq);
    if(target&&players[target]) snap[id]=target;
  });
  var whoId="";
  if(meta.twist&&((+table.round||0)%2===1)){
    var ids=Object.keys(snap);
    if(ids.length) whoId=ids[Math.floor(Math.random()*ids.length)];
  }
  var next=playObj({step:"reveal", got:Math.min(12, Object.keys(snap).length), who:whoId, opened:serverNow()});
  if(!next){busy=false; revealSent=""; promptsMissing(); return}
  var payload={};
  payload[rpath("play")]=next;
  Object.keys(snap).forEach(function(id){payload[rpath("reveal/"+id)]=snap[id]; payload[rpath("cast/"+id)]=null});
  update(ref(db), payload).then(function(){busy=false}).catch(function(e){busy=false; revealSent=""; fail(friendly(e))});
}
function toTwist(){
  if(busy||!isHost()||!table||table.step!=="reveal"||!table.who) return;
  busy=true;
  var twist=playObj({step:"twist", opened:serverNow()});
  if(!twist){busy=false; promptsMissing(); return}
  update(ref(db), {[rpath("play")]:twist}).then(function(){busy=false}).catch(function(e){busy=false; fail(friendly(e))});
}
function advance(){
  if(busy||!isHost()||!table||(table.step!=="reveal"&&table.step!=="twist")) return;
  busy=true;
  var round=(+table.round||0)+1;
  var total=rounds();
  var payload={};
  if(round>=total){
    var overPlay=playObj({step:"over", text:table.text, seq:+table.seq||0, round:+table.round||0, opened:serverNow(), got:+table.got||0, who:""});
    if(!overPlay){busy=false; promptsMissing(); return}
    payload[rpath("play")]=overPlay;
    payload[rpath("meta")]=fullMeta({status:"over", round:+table.round||0, pack:meta.pack, rounds:total});
  }else{
    var text=takeLine();
    if(!text){busy=false; promptsMissing(); return}
    var seq=(+table.seq||0)+1;
    var nextPlay=playObj({step:"vote", text:text, seq:seq, round:round, opened:serverNow(), got:0, who:"", order:order().map(function(p){return p.uid}).join(",")});
    if(!nextPlay){busy=false; promptsMissing(); return}
    payload[rpath("play")]=nextPlay;
    payload[rpath("meta")]=fullMeta({status:"play", round:round, pack:meta.pack, rounds:total});
  }
  clearBallots(payload);
  pendingVote="";
  update(ref(db), payload).then(function(){
    busy=false;
    var note=$("queuednote"); if(note){note.textContent=""; delete note.dataset.sticky}
  }).catch(function(e){busy=false; fail(friendly(e))});
}
function hostTick(){
  if(!isHost()||!meta||meta.status==="lobby"||!table||busy) return;
  if(table.step==="vote"){
    var opened=+table.opened||0;
    var timed=opened>1700000000000&&serverNow()>=opened+ANSWER_MS;
    if(allIn()||timed) publish();
    return;
  }
  if(!meta.nohost||!table.opened) return;
  var age=Date.now()-(+table.opened||0);
  var key=table.step+":"+table.seq;
  if(autoSent===key) return;
  if(table.step==="reveal"&&!resultsVisible()) return;
  if(table.step==="reveal"&&table.who&&age>6500){autoSent=key; toTwist()}
  else if(table.step==="reveal"&&!table.who&&age>7500){autoSent=key; advance()}
  else if(table.step==="twist"&&age>7500){autoSent=key; advance()}
}
function sendPassVote(btn){
  if(!table||table.step!=="vote"||sending) return;
  var seq=+table.seq||0;
  if(voteTarget(mine, seq)||pendingVote) return;
  pendingVote="pass";
  sending=true;
  if(btn){btn.setAttribute("aria-pressed","true")}
  tapSound("whoosh");
  paintVotes();
  set(ref(db, rpath("cast/"+uid)), "pass@"+seq).then(function(){sending=false}).catch(function(e){
    sending=false; pendingVote=""; paintVotes(); fail(friendly(e));
  });
}
function sendVote(id, btn){
  if(!table||table.step!=="vote"||sending||!id||!players[id]) return;
  var seq=+table.seq||0;
  if(voteTarget(mine, seq)||pendingVote) return;
  pendingVote=id;
  sending=true;
  if(btn){btn.classList.remove("mlt-hit"); void btn.offsetWidth; btn.classList.add("mlt-hit"); btn.setAttribute("aria-pressed","true")}
  tapSound("mltVote");
  paintVotes();
  set(ref(db, rpath("cast/"+uid)), id+"@"+seq).then(function(){sending=false}).catch(function(e){
    sending=false; pendingVote=""; paintVotes(); fail(friendly(e));
  });
}
function sendCustom(input){
  var text=cleanQ(input&&input.value);
  if(!text){fail("Add a question first."); return}
  if(!code){fail("Join a room first."); return}
  fail("");
  unlock();
  cue("clink");
  var id=(Date.now().toString(36)+Math.random().toString(36).slice(2,6)).replace(/[^A-Za-z0-9]/g,"").slice(0,16);
  set(ref(db, rpath("custom/"+id)), text).then(function(){
    input.value="";
    var note=$("queuednote");
    if(note&&input.id==="customplay"){note.textContent="Queued for a later round."; note.dataset.sticky="1"}
    else fail("");
  }).catch(function(e){fail(friendly(e))});
}
function setPack(pack){
  if(!/^(classic|spicy|couples)$/.test(pack)) return;
  if(meta&&(!isHost()||meta.status!=="lobby")) return;
  lobbyDirty=true; lobbyPack=pack;
  try{sessionStorage.setItem("tp_mlt_pack", pack)}catch(e){}
  document.body.dataset.pack=pack;
  paintPacks();
  if(!(isHost()&&meta&&meta.createdAt)) return;
  update(ref(db), {[rpath("meta")]:fullMeta({pack:pack, status:"lobby", round:0, rounds:rounds()})}).catch(function(e){fail(friendly(e))});
}
function setLength(n){
  n=+n;
  if(LENGTHS.indexOf(n)<0) return;
  if(meta&&(!isHost()||meta.status!=="lobby")) return;
  lobbyDirty=true; gameLength=n;
  try{sessionStorage.setItem("tp_mlt_len", String(n))}catch(e){}
  paintLengths();
  var start=$("start"); if(start) start.textContent="Start · "+n+" rounds";
  if(!(isHost()&&meta&&meta.createdAt)) return;
  update(ref(db), {[rpath("meta")]:fullMeta({rounds:n, status:"lobby", round:0, pack:currentPack()})}).catch(function(e){fail(friendly(e))});
}
function setFlag(key, on){
  if(!isHost()||!meta||meta.status!=="lobby") return;
  var patch={status:"lobby", round:0, pack:currentPack(), rounds:rounds()};
  patch[key]=!!on;
  update(ref(db), {[rpath("meta")]:fullMeta(patch)}).catch(function(e){fail(friendly(e))});
}
async function begin(){
  if(!isHost()||!meta||sending) return;
  var list=order();
  if(list.length<3||list.length>12){fail("Need 3 to 12 players."); return}
  if(!$("optin").checked){fail("Tick the opt-in first. Sips stay optional."); return}
  fail("");
  sending=true;
  usedCustom={}; deck=[];
  var text=takeLine();
  if(!text){promptsMissing(); sending=false; return}
  var len=rounds();
  var opening=playObj({step:"vote", text:text, seq:1, round:0, opened:serverNow(), got:0, who:"", order:list.map(function(p){return p.uid}).join(",")});
  if(!opening){promptsMissing(); sending=false; return}
  var payload={};
  payload[rpath("meta")]=fullMeta({status:"play", pack:currentPack(), rounds:len, round:0, twist:!!meta.twist, nohost:!!meta.nohost});
  payload[rpath("play")]=opening;
  try{await update(ref(db), payload); unlock()}catch(e){fail(friendly(e))}
  sending=false;
}
function watchCasts(){
  if(castStop||!isHost()||!code) return;
  castStop=onValue(ref(db, rpath("cast")), function(s){casts=s.val()||{}; render()}, function(){});
  stops.push(castStop);
}
function stopAll(){
  stops.forEach(function(fn){try{fn()}catch(e){}});
  stops=[]; castStop=null;
  if(connStop){connStop(); connStop=null}
  stopAudioTimers();
}
function listen(){
  stopAll();
  heardRound=-1; suspenseFor=-1; stingFor=-1; heardTwist=-1; heardOver=false; showRevealNow=-1;
  scoring=0; pendingVote=""; revealSent=""; autoSent=""; casts={}; reveal={};
  stops.push(onValue(ref(db, rpath("meta")), function(s){
    if(!s.exists()){
      stopAll(); meta=null; table=null; code=null;
      try{sessionStorage.removeItem("tp_mlt_pin")}catch(e){}
      screen("closed"); return;
    }
    meta=s.val()||null;
    maybeFreshScores();
    watchCasts();
    render();
  }, function(){fail("That room isn't available. Check the PIN and try again.")}));
  stops.push(onValue(ref(db, rpath("players")), function(s){players=s.val()||{}; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("play")), function(s){
    var next=s.val()||null;
    if(next&&next.step==="vote"&&(!table||table.seq!==next.seq)){pendingVote=""; showRevealNow=-1}
    table=next;
    if(table&&table.step==="vote") revealSent="";
    busy=false;
    render();
  }, function(){}));
  stops.push(onValue(ref(db, rpath("reveal")), function(s){reveal=s.val()||{}; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("custom")), function(s){
    var v=s.val()||{};
    customs=Object.keys(v).map(function(k){return v[k]}).filter(Boolean);
  }, function(){}));
  stops.push(onValue(ref(db, rpath("cast/"+uid)), function(s){
    mine=s.val()||null;
    if(mine) pendingVote="";
    render();
  }, function(){}));
  watchCasts();
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
function playerRec(name, prev){
  prev=prev||{};
  return {name:name||prev.name||"Player", emoji:myEmoji()||prev.emoji||"", connected:true, joinedAt:prev.joinedAt||serverNow(), votes:+prev.votes||0, seen:+prev.seen||0};
}
function maybeFreshScores(){
  if(!meta||!uid||!players[uid]) return;
  var key=code+"|"+(+meta.rematch||0);
  if(!knownRematch){
    try{knownRematch=sessionStorage.getItem("tp_mlt_rematch")||""}catch(e){}
  }
  if(knownRematch&&knownRematch.indexOf(code+"|")===0&&knownRematch!==key&&meta.status==="lobby"){
    var me=players[uid];
    if((+me.votes||0)>0||(+me.seen||0)>0){
      set(ref(db, rpath("players/"+uid)), {name:me.name, emoji:me.emoji||"", connected:me.connected!==false, joinedAt:me.joinedAt||serverNow(), votes:0, seen:0}).catch(function(e){fail(friendly(e))});
    }
  }
  knownRematch=key;
  try{sessionStorage.setItem("tp_mlt_rematch", key)}catch(e){}
}
function playAgain(){
  if(!isHost()||!meta||meta.status!=="over"||busy) return;
  var n=Math.min(100,(+meta.rematch||0)+1);
  busy=true;
  var patch=fullMeta({status:"lobby", round:0, pack:meta.pack, rounds:rounds(), twist:!!meta.twist, nohost:!!meta.nohost});
  patch.rematch=n;
  update(ref(db), {[rpath("meta")]:patch}).then(function(){busy=false}).catch(function(e){busy=false; fail(friendly(e))});
}
async function hostRoom(name){
  var i, claimed=null, len=LENGTHS.indexOf(gameLength)>=0?gameLength:10;
  for(i=0;i<6;i++){
    var pin=makePin();
    var snap=await get(ref(db, "mlt/"+pin+"/meta"));
    if(snap.exists()) continue;
    try{
      await set(ref(db, "mlt/"+pin+"/meta"), {hostUid:uid, createdAt:serverTimestamp(), status:"lobby", pack:currentPack(), twist:false, nohost:false, round:0, rounds:len});
      claimed=pin; break;
    }catch(e){if(!/permission/i.test(String(e.code||e.message||""))) throw e}
  }
  if(!claimed) throw new Error("room");
  await set(ref(db, "mlt/"+claimed+"/players/"+uid), playerRec(name));
  code=claimed;
  try{sessionStorage.setItem("tp_mlt_pin", code)}catch(e){}
  listen(); armPresence();
}
async function joinRoom(pin, name){
  var snap=await get(ref(db, "mlt/"+pin+"/meta"));
  if(!snap.exists()) throw new Error("missing");
  var m=snap.val()||{};
  var mineSnap=await get(ref(db, "mlt/"+pin+"/players/"+uid));
  if(m.status!=="lobby"&&!mineSnap.exists()) throw new Error("closed");
  if(!mineSnap.exists()){
    var all=await get(ref(db, "mlt/"+pin+"/players"));
    var n=all.exists()?Object.keys(all.val()).length:0;
    if(m.status==="lobby"&&n>=12) throw new Error("full");
  }
  await set(ref(db, "mlt/"+pin+"/players/"+uid), playerRec(name, mineSnap.val()||{}));
  code=pin;
  try{sessionStorage.setItem("tp_mlt_pin", code)}catch(e){}
  listen(); armPresence();
}
function askClose(){
  if(!isHost()||!code) return;
  if(Date.now()-closeArmed>2500){closeArmed=Date.now(); fail("Tap close again to end the room for everyone."); return}
  fail("");
  remove(ref(db, "mlt/"+code)).catch(function(e){fail(friendly(e))});
  try{sessionStorage.removeItem("tp_mlt_pin")}catch(e){}
}
function focusName(){
  var el=$("pname"); if(!el) return;
  try{el.focus({preventScroll:false})}catch(e){try{el.focus()}catch(err){}}
}
function wire(){
  var saved=""; try{saved=localStorage.getItem("tp_name")||""}catch(e){}
  if(saved&&$("pname")&&!$("pname").value) $("pname").value=saved;
  try{
    var pack=sessionStorage.getItem("tp_mlt_pack"); if(pack&&/^(classic|spicy|couples)$/.test(pack)) lobbyPack=pack;
    var len=+sessionStorage.getItem("tp_mlt_len"); if(LENGTHS.indexOf(len)>=0) gameLength=len;
  }catch(e){}
  paintEmoji(); paintPacks(); paintLengths();
  document.body.dataset.pack=lobbyPack;
  var linked=queryPin();
  if(linked&&$("pin")) $("pin").value=linked;
  $("hostbtn").addEventListener("click", function(){
    var name=normName($("pname").value);
    if(!name){fail("Add your name first."); focusName(); return}
    if(sending) return;
    sending=true;
    try{localStorage.setItem("tp_name", name)}catch(e){}
    fail("");
    tapSound("mltJoin");
    hostRoom(name).catch(function(e){console.error(e); fail(e&&e.message==="room"?"Couldn't open a room. Try again.":friendly(e))}).then(function(){sending=false});
  });
  $("joinform").addEventListener("submit", function(e){e.preventDefault(); $("joinbtn").click()});
  $("joinbtn").addEventListener("click", function(){
    var name=normName($("pname").value), pin=normPin($("pin").value);
    if(!name){fail("Add your name first."); focusName(); return}
    if(!validPin(pin)){fail("Enter the 6-character PIN."); $("pin").focus(); return}
    if(sending) return;
    sending=true;
    try{localStorage.setItem("tp_name", name)}catch(e){}
    fail("");
    tapSound("mltJoin");
    joinRoom(pin, name).catch(function(e){
      var msg=String((e&&e.message)||"");
      if(msg==="missing") fail("No room with that PIN.");
      else if(msg==="closed") fail("That game has already started.");
      else if(msg==="full") fail("That room is full.");
      else fail(friendly(e));
    }).then(function(){sending=false});
  });
  if($("optin")) $("optin").addEventListener("change", render);
  $("start").addEventListener("click", function(){unlock(); begin()});
  $("addcustom").addEventListener("click", function(){sendCustom($("custom"))});
  $("customform").addEventListener("submit", function(e){e.preventDefault(); sendCustom($("custom"))});
  $("queue").addEventListener("click", function(){sendCustom($("customplay"))});
  $("customplay").addEventListener("keydown", function(e){if(e.key==="Enter"){e.preventDefault(); sendCustom($("customplay"))}});
  $("twist").addEventListener("change", function(){setFlag("twist", $("twist").checked)});
  $("nohost").addEventListener("change", function(){setFlag("nohost", $("nohost").checked)});
  $("nextround").addEventListener("click", function(){
    unlock();
    if(table&&table.step==="reveal"&&table.who) toTwist();
    else advance();
  });
  if($("again")) $("again").addEventListener("click", function(){unlock(); playAgain()});
  $("close").addEventListener("click", askClose);
  $("closestage").addEventListener("click", askClose);
  $("copylink").addEventListener("click", function(){copyLink($("copylink"))});
  $("sharebtn").addEventListener("click", shareRoom);
  document.querySelectorAll("#packs [data-pack]").forEach(function(b){b.addEventListener("click", function(){setPack(b.dataset.pack)})});
  document.querySelectorAll("[data-len]").forEach(function(b){b.addEventListener("click", function(){if(!meta||isHost()) setLength(+b.dataset.len)})});
  $("mixbtn").addEventListener("click", function(){var box=$("mixer"); if(box) box.classList.toggle("hide"); unlock()});
  ["mixmusic","mixsfx","mixvoice"].forEach(function(id){
    $(id).addEventListener("input", function(){
      var v=$(id).value/100;
      if(id==="mixmusic"){mix.music=v; musicWanted=v>0&&!$("mutemusic").checked} else if(id==="mixsfx") mix.sfx=v; else mix.voice=v;
      saveMix(); maybeMusic();
    });
  });
  $("mutemusic").addEventListener("change", function(){mix.muteMusic=$("mutemusic").checked; if(!mix.muteMusic) musicWanted=mix.music>0; saveMix(); maybeMusic()});
  $("mutesfx").addEventListener("change", function(){mix.muteSfx=$("mutesfx").checked; saveMix()});
  $("mutevoice").addEventListener("change", function(){
    mix.muteVoice=$("mutevoice").checked; saveMix();
    if(mix.muteVoice&&window.speechSynthesis){try{window.speechSynthesis.cancel()}catch(e){}}
  });
  $("mixmusic").value=Math.round(mix.music*100);
  $("mixsfx").value=Math.round(mix.sfx*100);
  $("mixvoice").value=Math.round(mix.voice*100);
  $("mutemusic").checked=!!mix.muteMusic;
  $("mutesfx").checked=!!mix.muteSfx;
  $("mutevoice").checked=!!mix.muteVoice;
  var mute=$("mute");
  if(window.TPSound&&mute){
    TPSound.bindMute(mute);
    mute.addEventListener("click", function(){pushMix()});
  }
  if(!clockTimer) clockTimer=setInterval(paintClock, 200);
  if(!hostTimer) hostTimer=setInterval(hostTick, 400);
  window.addEventListener("offline", function(){fail("You're offline. We'll keep trying when you're back.")});
  window.addEventListener("online", function(){fail(""); if(goOnline&&db){try{goOnline(db)}catch(e){}} armServerClock()});
  window.addEventListener("pagehide", function(){
    stopServerClock();
    stopAudioTimers();
    if(clockTimer){clearInterval(clockTimer); clockTimer=0}
    if(hostTimer){clearInterval(hostTimer); hostTimer=0}
    if(engine&&engine.stopMusic) engine.stopMusic();
    if(window.speechSynthesis){try{window.speechSynthesis.cancel()}catch(e){}}
  });
  var back=""; try{back=sessionStorage.getItem("tp_mlt_pin")||""}catch(e){}
  var same=linked&&back&&linked===back;
  if(linked&&!same){
    focusName();
    var yes=document.getElementById("gyes");
    if(yes) yes.addEventListener("click", function(){setTimeout(focusName, 60)}, {once:true});
  }
  var nm=normName($("pname").value);
  if(!linked&&back&&validPin(back)&&nm) joinRoom(back, nm).catch(function(){try{sessionStorage.removeItem("tp_mlt_pin")}catch(e){}});
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
  if(authObj.authStateReady) await authObj.authStateReady();
  var cred=await authMod.signInAnonymously(authObj);
  await cred.user.getIdToken();
  uid=cred.user.uid;
  goOnline(db);
  armServerClock();
  showReady();
  try{wire()}catch(err){console.error(err); fail("The table glitched. Reload and try again.")}
}
if($("retry")) $("retry").addEventListener("click", function(){location.reload()});
boot().catch(function(err){console.error(err); showBootError("The game didn't open. Check your connection and try again.")});
})();
