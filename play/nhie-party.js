(function(){
"use strict";
/* Moments map to the shared synth. Music and the announcer stay on the host.
   Sip cues play on the phones of people who have, and on the host panned by seat. */
var SOUNDS = { buses:{music:0.7,sfx:0.9,voice:0.85}, music:{bpm:112, hypePerRound:6} };
var TRIGGERS = {
  slam:["whoosh","sting"],
  crickets:["crickets","awkward"],
  few:["laugh","applause"],
  some:["ooh","gasp"],
  many:["cheer","sting"],
  reaction:["clink"]
};
var SIPS = ["gulp","clink","can","pour","ice","cheers"];
var EMOS = {clap:"👏", gasp:"😮", laugh:"😂", boo:"👎", party:"🎉"};
var EMO_CUE = {clap:"applause", gasp:"gasp", laugh:"laugh", boo:"boo", party:"cheer"};
var EMOJIS = ["","😎","🦊","🌟","🎧","🍀","🔥","🌙","🎭","🍓","🎲","🦋"];
var ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
var MIXKEY = "tp_nhie_mix";
var HAVE_LINE = "One small sip or fold a finger.";
var VOTE_LINE = "One small sip or take a ten-second bow.";
var $=function(id){return document.getElementById(id)};
var mix = window.PartyAudio ? PartyAudio.load(MIXKEY) : {music:0.7,sfx:0.9,voice:0.85,muteMusic:false,muteSfx:false,muteVoice:false};
var engine=null, parts=[], raf=0;
var uid=null, code=null, meta=null, players={}, who={}, table=null, sayBox=null, cast={}, lobbyMode="classic";
var db, authObj, stops=[], heard=-1, slamHeard=-1, turnHeard="", seenReact=null, hostLock=false, connStop=null, openTimer=0, scoring=0;
var ref, onValue, update, set, remove, onDisconnect, get, serverTimestamp, goOnline;

function saveMix(){try{localStorage.setItem(MIXKEY, JSON.stringify(mix))}catch(e){} if(engine) engine.apply()}
function audioEngine(){
  if(engine||!window.PartyAudio) return engine;
  engine=PartyAudio.create({
    key:MIXKEY, mix:mix, host:isHost,
    hype:function(){return table?+table.round||0:0},
    bpm:SOUNDS.music.bpm, hypePer:SOUNDS.music.hypePerRound,
    pulse:function(){var el=$("lights"); if(!el) return; el.classList.add("on"); setTimeout(function(){el.classList.remove("on")}, 90)}
  });
  return engine;
}
function fire(moment){
  var eng=audioEngine(); if(!eng) return;
  (TRIGGERS[moment]||[]).forEach(function(name){try{eng.cue(name)}catch(e){}});
}
function cueAt(name, pan){var eng=audioEngine(); if(eng) eng.cue(name, null, pan)}
function say(line){var eng=audioEngine(); if(eng) eng.say(line)}
function startMusic(){var eng=audioEngine(); if(eng&&isHost()) eng.startMusic()}
function unlock(){try{var eng=audioEngine(); if(eng){eng.unlock(); if(isHost()) eng.startMusic()} if(window.TPSound) TPSound.unlock()}catch(e){}}
function isHost(){return !!(meta&&uid&&meta.hostUid===uid)}
function order(){
  return Object.keys(players).map(function(id){
    var w=who[id]||{};
    return {uid:id, name:players[id].name||"Player", emoji:w.emoji||"", connected:players[id].connected!==false, joinedAt:players[id].joinedAt||0, confessions:+w.confessions||0, seen:+w.seen||0};
  }).sort(function(a,b){return a.joinedAt-b.joinedAt||a.name.localeCompare(b.name)});
}
function nameOf(id){var p=players[id]; return ((who[id]&&who[id].emoji)?who[id].emoji+" ":"")+((p&&p.name)||"Player")}
function orderStr(){return (table&&table.order)||order().map(function(p){return p.uid}).join(",")||uid||"table"}
function rpath(p){return "rooms/"+code+"/"+p}
function fail(msg){var p=$("perr"); if(p) p.textContent=msg||""}
function friendly(e){
  var c=String((e&&(e.code||e.message))||"");
  if(/permission|denied/i.test(c)) return "That room isn't available.";
  if(/offline|network|fetch/i.test(c)) return "You're offline.";
  return "Something went wrong. Try again.";
}
function normName(v){return String(v||"").replace(/[<>]/g,"").trim().slice(0,20)}
function normCode(v){
  var up=String(v||"").toUpperCase();
  var q=up.match(/[?&]CODE=([ABCDEFGHJKMNPQRSTUVWXYZ]{4})/);
  if(q) return q[1];
  return up.replace(/[^ABCDEFGHJKMNPQRSTUVWXYZ]/g,"").slice(-4);
}
function validCode(c){return /^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(c)}
function makeCode(){var s="",i; for(i=0;i<4;i++) s+=ALPHABET[Math.floor(Math.random()*ALPHABET.length)]; return s}
function emuOn(){return /[?&]emulator=1(?:&|$)/.test(location.search)}
function roomUrl(c){
  var base=/localhost|127\.0\.0\.1/.test(location.host)?location.origin+location.pathname:"https://tipsyplay.com/games/never-have-i-ever.html";
  return base+"?code="+c;
}
function screen(id){["home","lobby","table","closed"].forEach(function(s){var n=$(s); if(n) n.classList.toggle("hide", s!==id)})}
function paintRole(){
  document.body.classList.toggle("is-host", isHost());
  document.querySelectorAll(".hostonly").forEach(function(n){n.classList.toggle("hide", !isHost())});
  document.querySelectorAll(".guestonly").forEach(function(n){n.classList.toggle("hide", isHost())});
}
function kindFor(mode, round){
  if(mode==="likely") return "vote";
  if((+round)%5===4) return "vote";
  return "have";
}
function lineFor(kind){return kind==="vote"?VOTE_LINE:HAVE_LINE}
function packs(){return window.NHIE_PACKS||{classic:[],mild:[],spicy:[],likely:[]}}
function packFor(mode, kind){
  var all=packs();
  if(kind==="vote") return all.likely||[];
  return all[mode]||all.classic||[];
}
function suggestions(){
  var pack=packFor(table.mode, table.kind), out=[], i, n=pack.length||1;
  var start=((+table.round||0)*3)%n;
  for(i=0;i<3&&pack.length;i++) out.push(pack[(start+i)%n]);
  return out;
}
function cleanText(raw, kind){
  var t=String(raw||"").replace(/<[^>]*>/g,"").replace(/[<>]/g,"").replace(/\s+/g," ").trim().slice(0,140);
  if(!t) return "";
  if(kind==="vote"){
    if(!/^who/i.test(t)) t=("Who's most likely to "+t).slice(0,140);
    return t;
  }
  if(!/^never have i ever/i.test(t)) t=("Never have I ever "+t.replace(/^i\s+/i,"")).slice(0,140);
  return t;
}
function playObj(patch){
  var b=Object.assign({turn:"",step:"prompt",text:"",seq:0,mode:lobbyMode||"classic",kind:"have",round:0,opened:0,order:orderStr()}, table||{}, patch||{});
  return {turn:String(b.turn||""), step:b.step, text:String(b.text||"").slice(0,140), seq:+b.seq||0, mode:b.mode, kind:b.kind, round:+b.round||0, opened:+b.opened||0, order:b.order||orderStr()};
}
function fullMeta(patch){
  var m=Object.assign({}, meta||{}, patch||{});
  var out={hostUid:m.hostUid, createdAt:m.createdAt, status:m.status, phase:m.phase, spice:"mild", rounds:+m.rounds||20, na:!!m.na, round:+m.round||0, gameId:+m.gameId||1, kind:"nhie"};
  if(m.status!=="lobby") out.deck=["Never Have I Ever"];
  if(m.endedAt&&m.status==="over") out.endedAt=m.endedAt;
  return out;
}
function myEmoji(){return sessionStorage.getItem("tp_nhie_emoji")||""}
function seatIndex(id){var list=order(), i; for(i=0;i<list.length;i++) if(list[i].uid===id) return i; return 0}
function panFor(id){var n=order().length; if(n<=1) return 0; return (seatIndex(id)/(n-1))*2-1}
function haveIds(){
  return order().filter(function(p){return cast[p.uid]==="have"}).map(function(p){return p.uid});
}
function voteCounts(){
  var counts={};
  order().forEach(function(p){
    var v=cast[p.uid];
    if(v&&v!=="pass"&&v!=="have"&&v!=="havent"&&players[v]) counts[v]=(counts[v]||0)+1;
  });
  return counts;
}
function winnerId(){
  var counts=voteCounts(), best=0, wins=[];
  Object.keys(counts).forEach(function(id){if(counts[id]>best){best=counts[id]; wins=[id]}else if(counts[id]===best) wins.push(id)});
  return wins.length===1?wins[0]:"";
}
function burst(n){
  var c=$("fx"); if(!c) return;
  c.width=window.innerWidth; c.height=window.innerHeight;
  for(var i=0;i<n;i++) parts.push({x:Math.random()*c.width,y:-20,vx:(Math.random()-0.5)*8,vy:2+Math.random()*5,life:1,color:i%2?"#ff2d87":"#ffe14a"});
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
function shake(){document.body.classList.remove("kc-shake"); void document.body.offsetWidth; document.body.classList.add("kc-shake")}
function flash(){document.body.classList.remove("kc-flash"); void document.body.offsetWidth; document.body.classList.add("kc-flash")}
function floatIcon(emoji, x){
  var n=document.createElement("div"); n.className="kc-float"; n.textContent=emoji;
  n.style.left=(x==null?window.innerWidth/2:x)+"px"; n.style.top="40%";
  document.body.appendChild(n); setTimeout(function(){n.remove()},1000);
}
function paintEmoji(){
  var box=$("emojis"); if(!box) return;
  box.textContent="";
  EMOJIS.forEach(function(emo){
    var b=document.createElement("button"); b.type="button"; b.className="btn alt"; b.setAttribute("data-emoji", emo||"none");
    b.textContent=emo||"None"; b.setAttribute("aria-pressed", (emo===myEmoji())?"true":"false");
    box.appendChild(b);
  });
}
function paintModes(sel){
  document.querySelectorAll("[data-mode]").forEach(function(b){b.setAttribute("aria-pressed", b.dataset.mode===sel?"true":"false")});
}
function paintLobby(){
  $("codebig").textContent=code||"";
  $("sharelink").textContent=roomUrl(code);
  var box=$("plist"); box.textContent="";
  order().forEach(function(p){
    var row=document.createElement("div"); row.className="prow";
    var s=document.createElement("span"); s.textContent=(p.emoji?p.emoji+" ":"")+p.name+(p.uid===meta.hostUid?" · host":"")+(p.connected?"":" · away");
    row.appendChild(s); box.appendChild(row);
  });
  var n=order().length;
  $("start").disabled=!isHost()||!$("optin").checked||n<2||n>12;
  paintModes(lobbyMode);
}
function paintScores(){
  var box=$("scores"); box.textContent="";
  order().forEach(function(p){
    var row=document.createElement("div"); row.className="prow"; row.id="seat-"+p.uid;
    if(table&&table.step==="results"&&table.kind!=="vote"&&cast[p.uid]==="have") row.classList.add("nh-hot");
    if(table&&table.step==="results"&&winnerId()===p.uid) row.classList.add("nh-hot");
    var s=document.createElement("span"); s.textContent=(p.emoji?p.emoji+" ":"")+p.name;
    var b=document.createElement("b"); b.textContent=p.confessions+" confession"+(p.confessions===1?"":"s");
    row.appendChild(s); row.appendChild(b); box.appendChild(row);
  });
}
function render(){
  paintRole();
  if(!meta){screen("home"); return}
  var step=table?table.step:"lobby";
  document.body.dataset.phase=step;
  document.body.dataset.mode=table?table.mode:lobbyMode;
  document.body.dataset.kind=table?table.kind:"";
  document.body.dataset.round=table?String(table.round):"";
  document.body.dataset.seq=table?String(table.seq):"";
  document.body.dataset.turn=table?table.turn||"":"";
  document.body.dataset.actor=table&&table.turn===uid?"1":"0";
  if(meta.status==="lobby"){screen("lobby"); paintLobby(); return}
  screen("table");
  var hostP=players[meta.hostUid];
  $("away").classList.toggle("hide", !hostP||hostP.connected!==false);
  paintScores();
  paintModes(table?table.mode:lobbyMode);
  var list=order();
  var turnName=table?nameOf(table.turn):"";
  $("turn").textContent=table&&table.step==="prompt"?turnName+" picks the line":turnName;
  $("audioline").textContent=isHost()?"Music, room tone, and the announcer play on this phone.":"Short sounds on this phone. Music stays with the host.";
  var showText=table&&table.text&&table.step!=="prompt"&&table.step!=="over";
  var face=$("statement");
  face.textContent=showText?table.text:(table&&table.step==="prompt"?"Waiting for the line.":"That's the set.");
  if(showText&&slamHeard===table.seq) face.classList.add("nh-slam");
  $("count").textContent=table&&table.step==="slam"?"Hands down for a beat.":"";
  var mine=table&&table.turn===uid;
  var asking=table&&table.step==="prompt"&&mine;
  if(asking && $("line") && $("line").dataset.round!==String(table.round) && document.activeElement!==$("line")){
    $("line").value="";
    $("line").dataset.round=String(table.round);
  }
  $("composer").classList.toggle("hide", !asking);
  $("wait").classList.toggle("hide", !(table&&table.step==="prompt"&&!mine));
  $("wait").textContent="Waiting for "+turnName+" to pick a line.";
  var extra=$("suggests");
  if(asking){
    extra.textContent="";
    suggestions().forEach(function(line){
      var b=document.createElement("button"); b.type="button"; b.className="btn alt"; b.setAttribute("data-suggest", line); b.textContent=line;
      b.addEventListener("click", function(){sendSay(line)});
      extra.appendChild(b);
    });
    var hint=table.kind==="vote"?"This round is a vote. Tap a prompt or type one.":"Type a Never have I ever, or tap a prompt.";
    $("hint").textContent=hint+(table.kind==="vote"&&table.mode!=="likely"?" Hybrid round.":"");
  }
  var answering=table&&(table.step==="answer"||table.step==="vote");
  var buttons=$("answers");
  buttons.classList.toggle("hide", !answering);
  buttons.textContent="";
  if(answering&&table.kind!=="vote"){
    var have=document.createElement("button"); have.type="button"; have.id="ihave"; have.className="btn"; have.textContent="I have";
    var not=document.createElement("button"); not.type="button"; not.id="ihavent"; not.className="btn alt"; not.textContent="I haven't";
    have.addEventListener("click", function(){sendCast("have")});
    not.addEventListener("click", function(){sendCast("havent")});
    if(cast[uid]){have.disabled=true; not.disabled=true}
    buttons.appendChild(have); buttons.appendChild(not);
    var note=document.createElement("p"); note.className="na"; note.textContent=HAVE_LINE+" Nothing stacks.";
    buttons.appendChild(note);
  }
  if(answering&&table.kind==="vote"){
    list.forEach(function(p){
      if(p.uid===uid) return;
      var b=document.createElement("button"); b.type="button"; b.className="btn alt"; b.setAttribute("data-vote", p.uid);
      b.textContent=(p.emoji?p.emoji+" ":"")+p.name; if(cast[uid]) b.disabled=true;
      b.addEventListener("click", function(){sendCast(p.uid)});
      buttons.appendChild(b);
    });
    var note2=document.createElement("p"); note2.className="na"; note2.textContent=VOTE_LINE+" A tie means nobody does either. Nothing stacks.";
    buttons.appendChild(note2);
  }
  var marks=$("marks"); marks.textContent="";
  if(isHost()&&answering){
    list.forEach(function(p){
      if(cast[p.uid]) return;
      var row=document.createElement("div"); row.className="prow";
      var s=document.createElement("span"); s.textContent="Mark "+p.name;
      row.appendChild(s);
      if(table.kind!=="vote"){
        var y=document.createElement("button"); y.type="button"; y.className="btn alt"; y.setAttribute("data-mark","have"); y.setAttribute("data-who", p.uid); y.textContent="Has";
        var n=document.createElement("button"); n.type="button"; n.className="btn alt"; n.setAttribute("data-mark","havent"); n.setAttribute("data-who", p.uid); n.textContent="Hasn't";
        y.addEventListener("click", function(){hostMark(p.uid, "have")});
        n.addEventListener("click", function(){hostMark(p.uid, "havent")});
        row.appendChild(y); row.appendChild(n);
      }else{
        var pass=document.createElement("button"); pass.type="button"; pass.className="btn alt"; pass.setAttribute("data-mark","pass"); pass.setAttribute("data-who", p.uid); pass.textContent="Pass";
        pass.addEventListener("click", function(){hostMark(p.uid, "pass")});
        row.appendChild(pass);
      }
      marks.appendChild(row);
    });
  }
  var results=table&&table.step==="results";
  var box=$("results"); box.classList.toggle("hide", !results);
  box.textContent="";
  if(results){
    var h=document.createElement("h2"); h.textContent=table.kind==="vote"?"Votes":"Who has";
    box.appendChild(h);
    if(table.kind==="vote"){
      var counts=voteCounts(), win=winnerId();
      var p=document.createElement("p");
      p.textContent=win?(nameOf(win)+" got the most. "+VOTE_LINE):"A tie. Nobody sips. Nothing stacks.";
      box.appendChild(p);
      Object.keys(counts).forEach(function(id){
        var line=document.createElement("p"); line.textContent=nameOf(id)+" · "+counts[id]; box.appendChild(line);
      });
    }else{
      var ids=haveIds();
      var p2=document.createElement("p");
      p2.textContent=ids.length?ids.map(nameOf).join(", ")+" — "+HAVE_LINE+" Nothing stacks.":"Nobody has. Nothing is owed.";
      box.appendChild(p2);
      ids.forEach(function(id){var row=document.getElementById("seat-"+id); if(row){var icon=document.createElement("span"); icon.className="nh-pop"; icon.textContent="✦"; row.appendChild(icon)}});
    }
    var fill=$("pourfill"); if(fill){
      var ratio=table.kind==="vote"?(winnerId()?1:0):(list.length?haveIds().length/list.length:0);
      fill.style.height=Math.round(ratio*100)+"%";
    }
  }else{var fill0=$("pourfill"); if(fill0) fill0.style.height="0%"}
  $("finale").classList.toggle("hide", !(table&&table.step==="over"));
  if(isHost()&&meta.status==="play") startMusic();
  hear();
  maybeScore();
  if(isHost()&&sayBox&&table&&table.step==="prompt") consumeSay(sayBox);
  if(isHost()) maybeReveal();
}
function hear(){
  if(!table) return;
  unlock();
  if(table.step==="prompt"&&turnHeard!==(table.round+":"+table.turn)){
    turnHeard=table.round+":"+table.turn;
    if(isHost()) say("Your turn, "+(players[table.turn]?players[table.turn].name:"friend")+".");
  }
  if(table.step==="slam"&&slamHeard!==table.seq){
    slamHeard=table.seq;
    fire("slam");
    flash();
    if(isHost()) say(table.kind==="vote"?"Most likely...":"Never have I ever...");
    var face=$("statement"); if(face){face.classList.remove("nh-slam"); void face.offsetWidth; face.classList.add("nh-slam")}
  }
  if(table.step==="results"&&heard!==table.seq){
    heard=table.seq;
    var total=order().length, n=haveIds().length;
    if(table.kind==="vote"){
      if(winnerId()){fire("some"); if(isHost()) say(((players[winnerId()]&&players[winnerId()].name)||"They")+" takes it.");}
      else fire("crickets");
    }else if(n===0){fire("crickets")}
    else if(n<=2){fire("few"); if(n===1&&isHost()) say("Only one person...")}
    else if(total>=3&&n>=total-1){fire("many"); shake(); burst(80); if(n===total&&isHost()) say("Everyone's done that!")}
    else {fire("some"); if(n>=3) shake()}
    if(table.mode==="spicy"||n>=Math.max(3, Math.ceil(total*0.6))) burst(60);
    var targets=table.kind==="vote"?(winnerId()?[winnerId()]:[]):haveIds();
    targets.forEach(function(id, i){
      var sound=SIPS[i%SIPS.length];
      if(isHost()) cueAt(sound, panFor(id));
      else if(id===uid) cueAt(sound);
      floatIcon("✦", 40+seatIndex(id)*28);
    });
  }
}
function maybeScore(){
  var me=who[uid]; if(!me||!table||table.step!=="results") return;
  if((+table.seq||0)<=(+me.seen||0)||scoring===+table.seq) return;
  scoring=+table.seq;
  var add=0;
  if(table.kind==="vote"){if(winnerId()===uid) add=1}
  else if(cast[uid]==="have") add=1;
  writeWho(me.emoji||myEmoji(), (+me.confessions||0)+add, +table.seq);
}
function writeWho(emoji, confessions, seen){
  set(ref(db, rpath("nhie/who/"+uid)), {emoji:String(emoji||"").slice(0,8), confessions:confessions, seen:seen}).catch(function(e){fail(friendly(e))});
}
function nextUid(from){
  var list=order().map(function(p){return p.uid});
  if(!list.length) return from;
  var idx=list.indexOf(from); if(idx<0) idx=list.length-1;
  return list[(idx+1)%list.length];
}
function consumeSay(val){
  if(!isHost()||!val||!val.text||hostLock) return;
  if(!table||table.step!=="prompt"){update(ref(db),{[rpath("nhie/say")]:null}).catch(function(){}); return}
  var text=cleanText(val.text, table.kind);
  if(!text){update(ref(db),{[rpath("nhie/say")]:null}).catch(function(){}); return}
  hostLock=true;
  var seq=(+table.seq||0)+1, opened=Date.now();
  update(ref(db), {
    [rpath("nhie/play")]:playObj({step:"slam", text:text, seq:seq, opened:opened}),
    [rpath("nhie/say")]:null
  }).then(function(){hostLock=false; armOpen(seq, opened)}).catch(function(e){hostLock=false; fail(friendly(e))});
}
function armOpen(seq, opened){
  if(openTimer) clearTimeout(openTimer);
  var wait=Math.max(0, (opened||0)+3000-Date.now());
  openTimer=setTimeout(function(){
    if(!isHost()||!table||+table.seq!==seq||table.step!=="slam") return;
    update(ref(db), {[rpath("nhie/play")]:playObj({step:table.kind==="vote"?"vote":"answer"})}).catch(function(e){fail(friendly(e))});
  }, wait);
}
function maybeReveal(){
  if(!isHost()||hostLock||!table) return;
  if(table.step!=="answer"&&table.step!=="vote") return;
  var list=order(); if(list.length<2) return;
  if(!list.every(function(p){return !!cast[p.uid]})) return;
  hostLock=true;
  update(ref(db), {[rpath("nhie/play")]:playObj({step:"results"})}).then(function(){hostLock=false}).catch(function(e){hostLock=false; fail(friendly(e))});
}
function advance(){
  if(!isHost()||!table||hostLock) return;
  var round=(+table.round||0)+1;
  var nxt=nextUid(table.turn);
  var payload={};
  if(round>=20){
    payload[rpath("nhie/play")]=playObj({step:"over", round:round, text:table.text});
    payload[rpath("meta")]=fullMeta({status:"over", phase:"over", endedAt:Date.now()});
  }else{
    var mode=table.mode||"classic";
    payload[rpath("nhie/play")]=playObj({turn:nxt, step:"prompt", text:"", mode:mode, kind:kindFor(mode, round), round:round, opened:0});
  }
  Object.keys(cast).forEach(function(id){payload[rpath("nhie/cast/"+id)]=null});
  payload[rpath("nhie/say")]=null;
  hostLock=true;
  update(ref(db), payload).then(function(){hostLock=false}).catch(function(e){hostLock=false; fail(friendly(e))});
}
function sendSay(raw){
  if(!table||table.step!=="prompt"||table.turn!==uid) return;
  var text=cleanText(raw, table.kind);
  if(!text){fail("Add a line first."); return}
  fail(""); unlock();
  update(ref(db), {[rpath("nhie/say")]:{text:text}}).catch(function(e){fail(friendly(e))});
}
function sendCast(value){
  if(!table||(table.step!=="answer"&&table.step!=="vote")||cast[uid]) return;
  unlock();
  update(ref(db), {[rpath("nhie/cast/"+uid)]:String(value).slice(0,128)}).catch(function(e){fail(friendly(e))});
}
function hostMark(id, value){
  if(!isHost()||!id) return;
  update(ref(db), {[rpath("nhie/cast/"+id)]:String(value).slice(0,128)}).catch(function(e){fail(friendly(e))});
}
function setMode(mode){
  lobbyMode=mode; sessionStorage.setItem("tp_nhie_mode", mode); paintModes(mode);
  if(isHost()&&table&&table.step==="prompt"){
    update(ref(db), {[rpath("nhie/play")]:playObj({mode:mode, kind:kindFor(mode, table.round)})}).catch(function(e){fail(friendly(e))});
  }
}
function sendReact(emo){
  var id=(Date.now().toString(36)+Math.random().toString(36).slice(2,8)).replace(/[^A-Za-z0-9]/g,"").slice(0,24);
  if(id.length<6) id=("react"+id+"xxxxxx").slice(0,12);
  update(ref(db), {[rpath("nhie/react/"+id)]:{e:emo, u:uid}}).catch(function(e){fail(friendly(e))});
}
async function begin(){
  if(!isHost()||!meta) return;
  var list=order(); if(list.length<2||list.length>12){fail("Need 2 to 12 players."); return}
  fail("");
  var mode=lobbyMode||"classic";
  var payload={};
  payload[rpath("meta")]=fullMeta({status:"play", phase:"answer", round:0});
  payload[rpath("nhie/play")]=playObj({turn:list[0].uid, step:"prompt", text:"", seq:0, mode:mode, kind:kindFor(mode, 0), round:0, opened:0, order:list.map(function(p){return p.uid}).join(",")});
  payload[rpath("nhie/say")]=null;
  try{await update(ref(db), payload); unlock(); say("Never have I ever...")}catch(e){fail(friendly(e))}
}
function stopAll(){stops.forEach(function(fn){fn()}); stops=[]; if(connStop){connStop(); connStop=null}}
function listen(){
  stopAll(); heard=-1; slamHeard=-1; turnHeard=""; seenReact=null;
  stops.push(onValue(ref(db, rpath("meta")), function(s){
    if(!s.exists()){stopAll(); meta=null; screen("closed"); return}
    meta=s.val(); render();
  }, function(){fail("That room isn't available.")}));
  stops.push(onValue(ref(db, rpath("players")), function(s){players=s.val()||{}; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("nhie/who")), function(s){who=s.val()||{}; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("nhie/play")), function(s){
    table=s.val()||null;
    if(isHost()&&table&&table.step==="slam") armOpen(+table.seq, +table.opened||0);
    render();
  }, function(){}));
  stops.push(onValue(ref(db, rpath("nhie/say")), function(s){sayBox=s.val()||null; if(isHost()&&sayBox) consumeSay(sayBox); render()}, function(){}));
  stops.push(onValue(ref(db, rpath("nhie/cast")), function(s){cast=s.val()||{}; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("nhie/react")), function(s){
    var v=s.val()||{}, first=seenReact===null; if(first) seenReact={};
    Object.keys(v).forEach(function(id){
      if(seenReact[id]) return; seenReact[id]=1;
      if(first) return;
      var emo=v[id].e; floatIcon(EMOS[emo]||"👏"); var eng=audioEngine(); if(eng) eng.cue(EMO_CUE[emo]||"clink");
    });
  }, function(){}));
}
function armPresence(){
  if(connStop) connStop();
  connStop=onValue(ref(db, ".info/connected"), function(s){
    if(!s.val()||!code||!uid) return;
    var p=ref(db, rpath("players/"+uid));
    onDisconnect(p).update({connected:false}).catch(function(){});
    update(p, {connected:true}).catch(function(){});
  });
}
async function hostRoom(name){
  var i, claimed=null;
  for(i=0;i<6;i++){
    var c=makeCode();
    var snap=await get(ref(db, "rooms/"+c+"/meta"));
    if(snap.exists()) continue;
    try{
      await update(ref(db), {["rooms/"+c+"/meta"]:{hostUid:uid, createdAt:serverTimestamp(), status:"lobby", phase:"lobby", spice:"mild", rounds:20, na:false, round:0, gameId:1, kind:"nhie"}});
      claimed=c; break;
    }catch(e){if(!/permission/i.test(String(e.code||e.message||""))) throw e}
  }
  if(!claimed) throw new Error("room");
  await set(ref(db, "rooms/"+claimed+"/players/"+uid), {name:name, connected:true, joinedAt:Date.now()});
  await set(ref(db, "rooms/"+claimed+"/nhie/who/"+uid), {emoji:myEmoji(), confessions:0, seen:0});
  code=claimed; sessionStorage.setItem("tp_nhie_room", code);
  listen(); armPresence();
}
async function joinRoom(c, name){
  var snap=await get(ref(db, "rooms/"+c+"/meta"));
  if(!snap.exists()) throw new Error("missing");
  var m=snap.val();
  if(m.kind&&m.kind!=="nhie") throw new Error("kind");
  var mine=await get(ref(db, "rooms/"+c+"/players/"+uid));
  if(m.status!=="lobby"&&!mine.exists()) throw new Error("closed");
  var prev=mine.val()||{};
  await set(ref(db, "rooms/"+c+"/players/"+uid), {name:name||prev.name||"Player", connected:true, joinedAt:prev.joinedAt||Date.now()});
  var w=await get(ref(db, "rooms/"+c+"/nhie/who/"+uid));
  var cur=w.val()||{confessions:0, seen:0};
  await set(ref(db, "rooms/"+c+"/nhie/who/"+uid), {emoji:myEmoji()||cur.emoji||"", confessions:+cur.confessions||0, seen:+cur.seen||0});
  code=c; sessionStorage.setItem("tp_nhie_room", code);
  listen(); armPresence();
}
function closeRoom(){
  if(!isHost()||!code) return;
  remove(ref(db, "rooms/"+code)).catch(function(e){fail(friendly(e))});
  sessionStorage.removeItem("tp_nhie_room");
}
function wire(){
  var saved=localStorage.getItem("tp_name"); if(saved&&!$("pname").value) $("pname").value=saved;
  var mode=sessionStorage.getItem("tp_nhie_mode"); if(mode) lobbyMode=mode;
  paintEmoji(); paintModes(lobbyMode);
  var q=normCode(location.search); if(q) $("roomcode").value=q;
  $("hostbtn").addEventListener("click", function(){
    var name=normName($("pname").value); if(!name){fail("Add your name first."); return}
    localStorage.setItem("tp_name", name); fail(""); unlock();
    hostRoom(name).catch(function(e){fail(friendly(e))});
  });
  $("joinform").addEventListener("submit", function(e){e.preventDefault(); $("joinbtn").click()});
  $("joinbtn").addEventListener("click", function(){
    var name=normName($("pname").value), c=normCode($("roomcode").value);
    if(!name){fail("Add your name first."); return}
    if(!validCode(c)){fail("Enter the 4-letter code."); return}
    localStorage.setItem("tp_name", name); fail(""); unlock();
    joinRoom(c, name).catch(function(e){
      var msg=String((e&&e.message)||"");
      if(msg==="kind") fail("That code is for a different game.");
      else if(msg==="missing"||msg==="closed") fail("That room isn't available.");
      else fail(friendly(e));
    });
  });
  $("optin").addEventListener("change", render);
  $("start").addEventListener("click", function(){unlock(); begin()});
  $("send").addEventListener("click", function(){sendSay($("line").value)});
  $("skip").addEventListener("click", advance);
  $("nextround").addEventListener("click", advance);
  $("close").addEventListener("click", closeRoom);
  $("closestage").addEventListener("click", closeRoom);
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
  document.addEventListener("click", function(e){
    var t=e.target; if(t&&t.nodeType!==1) t=t.parentElement;
    if(!t||!t.closest) return;
    unlock();
    var emoBtn=t.closest("[data-emoji]");
    if(emoBtn){
      var emo=emoBtn.getAttribute("data-emoji");
      sessionStorage.setItem("tp_nhie_emoji", emo==="none"?"":emo);
      paintEmoji();
      if(code&&uid) writeWho(myEmoji(), (who[uid]&&who[uid].confessions)||0, (who[uid]&&who[uid].seen)||0);
      return;
    }
    var modeBtn=t.closest("[data-mode]");
    if(modeBtn&&(meta?isHost():true)){setMode(modeBtn.dataset.mode); return}
    var sug=t.closest("[data-suggest]");
    if(sug){sendSay(sug.getAttribute("data-suggest")); return}
    if(t.closest("#ihave")){sendCast("have"); return}
    if(t.closest("#ihavent")){sendCast("havent"); return}
    var vote=t.closest("[data-vote]");
    if(vote){sendCast(vote.getAttribute("data-vote")); return}
    var mark=t.closest("[data-mark]");
    if(mark&&isHost()){hostMark(mark.getAttribute("data-who"), mark.getAttribute("data-mark")); return}
    var react=t.closest("[data-emo]");
    if(react){sendReact(react.dataset.emo); return}
  });
  $("mixmusic").value=Math.round(mix.music*100);
  $("mixsfx").value=Math.round(mix.sfx*100);
  $("mixvoice").value=Math.round(mix.voice*100);
  $("mutemusic").checked=!!mix.muteMusic;
  $("mutesfx").checked=!!mix.muteSfx;
  $("mutevoice").checked=!!mix.muteVoice;
  var mute=$("mute"); if(window.TPSound&&mute) TPSound.bindMute(mute);
  window.addEventListener("pointerdown", unlock, {passive:true});
}
async function boot(){
  if(!navigator.onLine&&!emuOn()){$("connecting").classList.add("hide"); $("offline").classList.remove("hide"); return}
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
  document.body.dataset.uid=uid;
  goOnline(db);
  $("connecting").classList.add("hide");
  $("app").classList.remove("hide");
  wire();
  var back=sessionStorage.getItem("tp_nhie_room");
  var nm=normName($("pname").value);
  if(back&&validCode(back)&&nm) joinRoom(back, nm).catch(function(){sessionStorage.removeItem("tp_nhie_room")});
}
boot().catch(function(){
  $("connecting").classList.add("hide");
  $("offline").classList.remove("hide");
  $("offdetail").textContent="Sign-in didn't start. Check the connection and try again.";
});
})();
