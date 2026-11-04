(function(){
"use strict";
var ALPHABET="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var CHALLENGES=["take a dramatic bow","invent a three-word theme song","hold a statue pose for three seconds","give a tiny acceptance speech","do your best slow clap","name the group's next snack"];
var EMOJIS=["","😎","🦊","🌟","🎧","🍀","🌙","🎭"];
var $=function(id){return document.getElementById(id)};
var mix=window.PartyAudio?PartyAudio.load("tp_mlt_mix"):{music:0.7,sfx:0.9,voice:0.85,muteMusic:false,muteSfx:false,muteVoice:false};
var engine=null, tickTimer=0, clock=0, heard=-1, scoring=0;
var uid=null, code=null, meta=null, players={}, table=null, casts={}, reveal={}, customs=[], mine=null;
var db, authObj, stops=[], connStop=null, castStop=null;
var ref, onValue, update, set, remove, onDisconnect, get, serverTimestamp, goOnline;
var deck=[], builtPack="", busy=false;

function audioEngine(){
  if(engine||!window.PartyAudio) return engine;
  engine=PartyAudio.create({
    key:"tp_mlt_mix", mix:mix, host:isHost,
    hype:function(){return meta?Math.min(6,+meta.round||0):0},
    bpm:100, hypePer:4,
    pulse:function(){}
  });
  return engine;
}
function cue(name){var eng=audioEngine(); if(eng) eng.cue(name)}
function say(line){var eng=audioEngine(); if(eng) eng.say(line)}
function unlock(){try{var eng=audioEngine(); if(eng){eng.unlock(); if(isHost()) eng.startMusic()} if(window.TPSound) TPSound.unlock()}catch(e){}}
function saveMix(){try{localStorage.setItem("tp_mlt_mix", JSON.stringify(mix))}catch(e){} if(engine) engine.apply()}
function isHost(){return !!(meta&&uid&&meta.hostUid===uid)}
function order(){
  return Object.keys(players).map(function(id){
    var p=players[id]||{};
    return {uid:id, name:p.name||"Player", emoji:p.emoji||"", connected:p.connected!==false, joinedAt:p.joinedAt||0, votes:+p.votes||0, seen:+p.seen||0};
  }).sort(function(a,b){return a.joinedAt-b.joinedAt||a.name.localeCompare(b.name)});
}
function nameOf(id){var p=players[id]; return p?((p.emoji?p.emoji+" ":"")+p.name):"Player"}
function plainName(id){return (players[id]&&players[id].name)||"Player"}
function rpath(p){return "mlt/"+code+"/"+p}
function fail(msg){var p=$("perr"); if(p) p.textContent=msg||""}
function friendly(e){
  var c=String((e&&(e.code||e.message))||"");
  if(/permission|denied/i.test(c)) return "That room isn't available.";
  if(/offline|network|fetch/i.test(c)) return "You're offline.";
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
function emuOn(){return /[?&]emulator=1(?:&|$)/.test(location.search)}
function roomUrl(pin){
  var base=/localhost|127\.0\.0\.1/.test(location.host)?location.origin+location.pathname:"https://tipsyplay.com/games/whos-most-likely.html";
  return base+"?pin="+pin;
}
function cleanQ(raw){
  var t=String(raw||"").replace(/<[^>]*>/g,"").replace(/[<>]/g,"").replace(/\s+/g," ").trim().slice(0,80);
  if(!t) return "";
  if(!/^who/i.test(t)) t=("Who's most likely to "+t).slice(0,80);
  return t;
}
function sipLine(){return "One small sip or "+CHALLENGES[(table&&table.seq||0)%CHALLENGES.length]+"."}
function shownVotes(p){
  var extra=0;
  if(table&&(table.step==="reveal"||table.step==="twist")&&(+p.seen<(+table.seq||0))){
    Object.keys(reveal).forEach(function(voter){if(reveal[voter]===p.uid) extra++});
  }
  return (+p.votes||0)+extra;
}
function titleFor(n){
  if(n<=0) return "Fresh";
  if(n===1) return "Mentioned";
  if(n===2) return "Suspicious";
  if(n===3) return "The rumor";
  if(n===4) return "Main character";
  if(n>=6) return "Legend";
  return "Certified";
}
function tally(){
  var counts={}, best=0, wins=[], n=0;
  Object.keys(reveal).forEach(function(voter){
    var t=reveal[voter]; if(!t||!players[t]) return;
    counts[t]=(counts[t]||0)+1; n++;
    if(counts[t]>best){best=counts[t]; wins=[t]}
    else if(counts[t]===best) wins.push(t);
  });
  return {counts:counts, best:best, wins:wins, n:n};
}
function screen(id){["home","lobby","play","closed"].forEach(function(s){var n=$(s); if(n) n.classList.toggle("hide", s!==id)})}
function paintEmoji(){
  var box=$("emojis"); if(!box) return;
  box.textContent="";
  var cur=sessionStorage.getItem("tp_mlt_emoji")||"";
  EMOJIS.forEach(function(emo){
    var b=document.createElement("button"); b.type="button"; b.setAttribute("data-emoji", emo||"none");
    b.textContent=emo||"·"; b.setAttribute("aria-pressed", emo===cur?"true":"false");
    box.appendChild(b);
  });
}
function myEmoji(){return sessionStorage.getItem("tp_mlt_emoji")||""}
function drawQR(){
  var canvas=$("qr"); if(!canvas||!code||!window.TipsyQR) return;
  TipsyQR.draw(canvas, roomUrl(code), 168);
}
function packs(){return (window.MLT_PACKS&&MLT_PACKS[meta&&meta.pack||"classic"])||(window.MLT_PACKS&&MLT_PACKS.classic)||[]}
function buildDeck(includeCustom){
  var list=includeCustom?customs.slice():[];
  var pool=(packs()).slice(), i, j, t;
  for(i=pool.length-1;i>0;i--){j=Math.floor(Math.random()*(i+1)); t=pool[i]; pool[i]=pool[j]; pool[j]=t}
  deck=list.concat(pool);
  builtPack=meta&&meta.pack||"classic";
}
function playObj(patch){
  var b=Object.assign({step:"vote", text:"", seq:0, round:0, opened:0, order:order().map(function(p){return p.uid}).join(","), got:0, who:""}, table||{}, patch||{});
  return {step:b.step, text:String(b.text||"").slice(0,120), seq:+b.seq||0, round:+b.round||0, opened:+b.opened||0, order:b.order||uid, got:+b.got||0, who:String(b.who||"")};
}
function render(){
  document.body.classList.toggle("is-host", isHost());
  document.querySelectorAll(".hostonly").forEach(function(n){n.classList.toggle("hide", !isHost())});
  if(!meta){screen("home"); return}
  document.body.dataset.phase=table?table.step:(meta.status==="lobby"?"lobby":"");
  document.body.dataset.pack=meta.pack||"classic";
  document.body.dataset.got=table?String(table.got||0):"0";
  document.body.dataset.nohost=meta.nohost?"1":"0";
  document.body.dataset.twist=meta.twist?"1":"0";
  if(meta.status==="lobby"){screen("lobby"); paintLobby(); return}
  if(meta.status==="over"||(table&&table.step==="over")){screen("closed"); return}
  screen("play");
  var list=order();
  var step=table?table.step:"vote";
  var voted=!!mine;
  $("question").textContent=table&&table.text?table.text:"Who's most likely…";
  $("wait").classList.toggle("hide", !(step==="vote"&&voted));
  $("waitcount").textContent=(table?table.got||0:0)+"/"+list.length;
  $("grid").classList.toggle("hide", step!=="vote"||voted);
  $("reveal").classList.toggle("hide", step!=="reveal");
  $("twistbox").classList.toggle("hide", step!=="twist");
  $("next").classList.toggle("hide", !isHost()||!!meta.nohost||(step!=="reveal"&&step!=="twist"));
  $("packbtn").textContent=(meta.pack||"classic");
  var cols=list.length<=4?"cols-1":"cols-2";
  var grid=$("grid");
  grid.className="mlt-grid "+cols+(grid.classList.contains("hide")?" hide":"");
  if(step==="vote"&&!voted){
    grid.textContent="";
    list.forEach(function(p){
      var b=document.createElement("button"); b.type="button"; b.setAttribute("data-vote", p.uid);
      b.textContent=(p.emoji?p.emoji+" ":"")+p.name;
      b.addEventListener("click", function(){sendVote(p.uid)});
      grid.appendChild(b);
    });
  }
  if(step==="reveal"||step==="twist"){
    var result=tally();
    var huge=$("winner");
    huge.textContent=result.wins.length?result.wins.map(plainName).join(" & "):"Nobody";
    $("sipline").textContent=result.wins.length?sipLine():"A tie with nobody. Nothing is owed.";
    if(result.wins.length>1) $("tie").textContent="It's a tie. You share it. Nothing stacks.";
    else $("tie").textContent=result.wins.length?"Nothing stacks.":"";
    var board=$("board"); board.textContent=""; board.className="mlt-grid "+cols;
    list.forEach(function(p){
      var cell=document.createElement("div");
      cell.className="mlt-cell"+(result.wins.indexOf(p.uid)>=0?" hot":"");
      var nm=document.createElement("b"); nm.textContent=(p.emoji?p.emoji+" ":"")+p.name;
      var sub=document.createElement("span"); sub.textContent=titleFor(shownVotes(p));
      cell.appendChild(nm); cell.appendChild(sub); board.appendChild(cell);
    });
  }
  if(step==="twist"){
    $("twistwho").textContent=plainName(table.who);
    $("twistcopy").textContent=plainName(table.who)+", explain that vote.";
  }
  hear();
  maybeScore();
  if(isHost()) hostTick();
}
function paintLobby(){
  $("pinbig").textContent=code||"";
  drawQR();
  var box=$("plist"); box.textContent="";
  order().forEach(function(p){
    var row=document.createElement("div"); row.className="mlt-name";
    row.textContent=(p.emoji?p.emoji+" ":"")+p.name+(p.uid===meta.hostUid?" · host":"");
    box.appendChild(row);
  });
  document.querySelectorAll("[data-pack]").forEach(function(b){b.setAttribute("aria-pressed", b.dataset.pack===meta.pack?"true":"false")});
  $("twist").checked=!!meta.twist;
  $("nohost").checked=!!meta.nohost;
  var n=order().length;
  $("start").disabled=!isHost()||!$("optin").checked||n<3||n>12;
}
function hear(){
  if(!table) return;
  unlock();
  if(table.step==="vote"){if(!tickTimer) tickTimer=setInterval(function(){if(table&&table.step==="vote") cue("tick")}, 900)}
  else if(tickTimer){clearInterval(tickTimer); tickTimer=0}
  if((table.step==="reveal"||table.step==="twist")&&heard!==table.seq+(table.step==="twist"?0.5:0)){
    if(table.step==="reveal"&&heard!==table.seq){
      heard=table.seq;
      var result=tally();
      cue("sting"); cue("payoff");
      if(isHost()) say("Take a sip!");
      if(result.wins.length>1) cue("crickets");
      else if(result.n>=3&&result.best===result.n) cue("cheer");
      else cue("laugh");
    }
    if(table.step==="twist"&&heard!==table.seq+0.5){
      heard=table.seq+0.5;
      cue("sting");
      if(isHost()) say(plainName(table.who)+", explain that vote.");
    }
  }
}
function maybeScore(){
  if(!table||(table.step!=="reveal"&&table.step!=="twist")||!players[uid]) return;
  if((+players[uid].seen||0)>=(+table.seq||0)||scoring===+table.seq) return;
  scoring=+table.seq;
  var n=0;
  Object.keys(reveal).forEach(function(voter){if(reveal[voter]===uid) n++});
  var me=players[uid];
  set(ref(db, rpath("players/"+uid)), {
    name:me.name, emoji:me.emoji||"", connected:me.connected!==false, joinedAt:me.joinedAt||Date.now(),
    votes:(+me.votes||0)+n, seen:+table.seq||0
  }).catch(function(e){fail(friendly(e))});
}
function hostTick(){
  if(!isHost()||!table||meta.status!=="play"||busy) return;
  var list=order();
  var got=Object.keys(casts).length;
  if(table.step==="vote"&&got!==(+table.got||0)){
    update(ref(db), {[rpath("play/got")]:got}).catch(function(){});
  }
  var forced=!!meta.nohost&&table.opened&&Date.now()>table.opened+20000&&got>0;
  if(table.step==="vote"&&(got>=list.length&&list.length>=3||forced)&&hostTick.sent!==table.seq){
    hostTick.sent=table.seq;
    publish(got);
    return;
  }
  if(!meta.nohost||!table.opened) return;
  var age=Date.now()-table.opened;
  if(table.step==="reveal"&&table.who&&age>4000) toTwist();
  else if(table.step==="reveal"&&!table.who&&age>8000) advance();
  else if(table.step==="twist"&&age>8000) advance();
}
function publish(got){
  if(busy) return;
  busy=true;
  var snap=Object.assign({}, casts);
  casts={};
  var who="";
  if(meta.twist&&((+table.round||0)%2===1)){
    var ids=Object.keys(snap);
    if(ids.length) who=ids[Math.floor(Math.random()*ids.length)];
  }
  var payload={};
  payload[rpath("play")]=playObj({step:"reveal", got:got||Object.keys(snap).length, who:who, opened:Date.now()});
  Object.keys(snap).forEach(function(id){payload[rpath("reveal/"+id)]=snap[id]; payload[rpath("cast/"+id)]=null});
  update(ref(db), payload).then(function(){busy=false}).catch(function(e){busy=false; hostTick.sent=""; fail(friendly(e))});
}
function toTwist(){
  if(busy||!isHost()||!table||table.step!=="reveal"||!table.who) return;
  busy=true;
  update(ref(db), {[rpath("play")]:playObj({step:"twist", opened:Date.now()})}).then(function(){busy=false}).catch(function(e){busy=false; fail(friendly(e))});
}
function advance(){
  if(busy||!isHost()||!table||table.step==="vote") return;
  busy=true;
  casts={};
  if(!deck.length) buildDeck(false);
  var text=deck.shift()||"Who's most likely to keep the night kind";
  var round=(+meta.round||0)+1;
  var seq=(+table.seq||0)+1;
  var payload={};
  payload[rpath("play")]=playObj({step:"vote", text:text, seq:seq, round:round, opened:Date.now(), got:0, who:"", order:order().map(function(p){return p.uid}).join(",")});
  payload[rpath("meta/round")]=round;
  Object.keys(reveal).forEach(function(id){payload[rpath("reveal/"+id)]=null});
  Object.keys(casts).forEach(function(id){payload[rpath("cast/"+id)]=null});
  update(ref(db), payload).then(function(){busy=false}).catch(function(e){busy=false; fail(friendly(e))});
}
function sendVote(id){
  if(!table||table.step!=="vote"||mine||!id) return;
  unlock();
  set(ref(db, rpath("cast/"+uid)), id).catch(function(e){fail(friendly(e))});
}
function sendCustom(){
  var text=cleanQ($("custom").value);
  if(!text){fail("Add a question first."); return}
  fail("");
  var id=(Date.now().toString(36)+Math.random().toString(36).slice(2,6)).replace(/[^A-Za-z0-9]/g,"").slice(0,16);
  set(ref(db, rpath("custom/"+id)), text).then(function(){$("custom").value=""}).catch(function(e){fail(friendly(e))});
}
function setPack(pack){
  if(!isHost()) return;
  update(ref(db), {[rpath("meta/pack")]:pack}).catch(function(e){fail(friendly(e))});
}
function setFlag(key, on){
  if(!isHost()) return;
  update(ref(db), {[rpath("meta/"+key)]:!!on}).catch(function(e){fail(friendly(e))});
}
async function begin(){
  if(!isHost()||!meta) return;
  var list=order();
  if(list.length<3||list.length>12){fail("Need 3 to 12 players."); return}
  fail("");
  buildDeck(true);
  var text=deck.shift()||"Who's most likely to keep the night kind";
  var payload={};
  payload[rpath("meta")]={hostUid:meta.hostUid, createdAt:meta.createdAt, status:"play", pack:meta.pack||"classic", twist:!!meta.twist, nohost:!!meta.nohost, round:0};
  payload[rpath("play")]=playObj({step:"vote", text:text, seq:1, round:0, opened:Date.now(), got:0, who:"", order:list.map(function(p){return p.uid}).join(",")});
  try{await update(ref(db), payload); unlock()}catch(e){fail(friendly(e))}
}
function watchCasts(){
  if(castStop||!isHost()||!code) return;
  castStop=onValue(ref(db, rpath("cast")), function(s){casts=s.val()||{}; render()}, function(){});
  stops.push(castStop);
}
function stopAll(){stops.forEach(function(fn){fn()}); stops=[]; castStop=null; if(connStop){connStop(); connStop=null} if(clock){clearInterval(clock); clock=0}}
function listen(){
  stopAll(); heard=-1; scoring=0;
  stops.push(onValue(ref(db, rpath("meta")), function(s){
    if(!s.exists()){stopAll(); meta=null; code=null; screen("closed"); return}
    meta=s.val();
    if(isHost()&&meta.status==="play"&&meta.pack!==builtPack) buildDeck(false);
    watchCasts();
    render();
  }, function(){fail("That room isn't available.")}));
  stops.push(onValue(ref(db, rpath("players")), function(s){players=s.val()||{}; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("play")), function(s){table=s.val()||null; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("reveal")), function(s){reveal=s.val()||{}; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("custom")), function(s){
    var v=s.val()||{};
    customs=Object.keys(v).map(function(k){return v[k]}).filter(Boolean);
  }, function(){}));
  stops.push(onValue(ref(db, rpath("cast/"+uid)), function(s){mine=s.val()||null; render()}, function(){}));
  watchCasts();
  if(!clock) clock=setInterval(function(){if(isHost()) hostTick()}, 400);
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
function playerRec(name, prev){
  prev=prev||{};
  return {name:name||prev.name||"Player", emoji:myEmoji()||prev.emoji||"", connected:true, joinedAt:prev.joinedAt||Date.now(), votes:+prev.votes||0, seen:+prev.seen||0};
}
async function hostRoom(name){
  var i, claimed=null;
  for(i=0;i<6;i++){
    var pin=makePin();
    var snap=await get(ref(db, "mlt/"+pin+"/meta"));
    if(snap.exists()) continue;
    try{
      await set(ref(db, "mlt/"+pin+"/meta"), {hostUid:uid, createdAt:serverTimestamp(), status:"lobby", pack:"classic", twist:false, nohost:false, round:0});
      claimed=pin; break;
    }catch(e){if(!/permission/i.test(String(e.code||e.message||""))) throw e}
  }
  if(!claimed) throw new Error("room");
  await set(ref(db, "mlt/"+claimed+"/players/"+uid), playerRec(name));
  code=claimed; sessionStorage.setItem("tp_mlt_pin", code);
  listen(); armPresence();
}
async function joinRoom(pin, name){
  var snap=await get(ref(db, "mlt/"+pin+"/meta"));
  if(!snap.exists()) throw new Error("missing");
  var m=snap.val();
  var mineSnap=await get(ref(db, "mlt/"+pin+"/players/"+uid));
  if(m.status!=="lobby"&&!mineSnap.exists()) throw new Error("closed");
  var n=0;
  if(!mineSnap.exists()){
    var all=await get(ref(db, "mlt/"+pin+"/players"));
    n=all.exists()?Object.keys(all.val()).length:0;
    if(m.status==="lobby"&&n>=12) throw new Error("full");
  }
  await set(ref(db, "mlt/"+pin+"/players/"+uid), playerRec(name, mineSnap.val()||{}));
  code=pin; sessionStorage.setItem("tp_mlt_pin", code);
  listen(); armPresence();
}
function closeRoom(){
  if(!isHost()||!code) return;
  remove(ref(db, "mlt/"+code)).catch(function(e){fail(friendly(e))});
  sessionStorage.removeItem("tp_mlt_pin");
}
function wire(){
  var saved=localStorage.getItem("tp_name"); if(saved&&!$("pname").value) $("pname").value=saved;
  paintEmoji();
  var q=normPin(location.search+" "+($("pin")&&$("pin").value||"")); if(q) $("pin").value=q;
  $("hostbtn").addEventListener("click", function(){
    var name=normName($("pname").value); if(!name){fail("Add your name first."); return}
    localStorage.setItem("tp_name", name); fail(""); unlock();
    hostRoom(name).catch(function(e){fail(friendly(e))});
  });
  $("joinform").addEventListener("submit", function(e){e.preventDefault(); $("joinbtn").click()});
  $("joinbtn").addEventListener("click", function(){
    var name=normName($("pname").value), pin=normPin($("pin").value);
    if(!name){fail("Add your name first."); return}
    if(!validPin(pin)){fail("Enter the 6-character PIN."); return}
    localStorage.setItem("tp_name", name); fail(""); unlock();
    joinRoom(pin, name).catch(function(e){
      var msg=String((e&&e.message)||"");
      if(msg==="missing"||msg==="closed") fail("That room isn't available.");
      else if(msg==="full") fail("That room is full.");
      else fail(friendly(e));
    });
  });
  $("optin").addEventListener("change", render);
  $("start").addEventListener("click", function(){unlock(); begin()});
  $("addcustom").addEventListener("click", sendCustom);
  $("twist").addEventListener("change", function(){setFlag("twist", $("twist").checked)});
  $("nohost").addEventListener("change", function(){setFlag("nohost", $("nohost").checked)});
  $("next").addEventListener("click", function(){if(table&&table.step==="reveal"&&table.who) toTwist(); else advance()});
  $("packbtn").addEventListener("click", function(){
    var orderP=["classic","spicy","couples"], i=orderP.indexOf(meta&&meta.pack||"classic");
    setPack(orderP[(i+1)%orderP.length]);
  });
  $("close").addEventListener("click", closeRoom);
  $("mixbtn").addEventListener("click", function(){$("mixer").classList.toggle("hide"); unlock()});
  $("mixbtn2").addEventListener("click", function(){$("mixer").classList.add("hide")});
  ["mixmusic","mixsfx","mixvoice"].forEach(function(id){
    $(id).addEventListener("input", function(){
      var v=$(id).value/100;
      if(id==="mixmusic") mix.music=v; else if(id==="mixsfx") mix.sfx=v; else mix.voice=v;
      saveMix();
    });
  });
  document.addEventListener("click", function(e){
    var t=e.target; if(t&&t.nodeType!==1) t=t.parentElement;
    if(!t||!t.closest) return;
    unlock();
    var emo=t.closest("[data-emoji]");
    if(emo){
      var v=emo.getAttribute("data-emoji");
      sessionStorage.setItem("tp_mlt_emoji", v==="none"?"":v);
      paintEmoji();
      if(code&&uid&&players[uid]){
        var me=players[uid];
        set(ref(db, rpath("players/"+uid)), playerRec(me.name, me)).catch(function(err){fail(friendly(err))});
      }
      return;
    }
    var pack=t.closest("[data-pack]");
    if(pack&&isHost()) setPack(pack.dataset.pack);
  });
  $("mixmusic").value=Math.round(mix.music*100);
  $("mixsfx").value=Math.round(mix.sfx*100);
  $("mixvoice").value=Math.round(mix.voice*100);
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
  goOnline(db);
  $("connecting").classList.add("hide");
  $("app").classList.remove("hide");
  wire();
  var back=sessionStorage.getItem("tp_mlt_pin");
  var nm=normName($("pname").value);
  if(back&&validPin(back)&&nm) joinRoom(back, nm).catch(function(){sessionStorage.removeItem("tp_mlt_pin")});
}
boot().catch(function(){
  $("connecting").classList.add("hide");
  $("offline").classList.remove("hide");
  $("offdetail").textContent="Sign-in didn't start. Check the connection and try again.";
});
})();
