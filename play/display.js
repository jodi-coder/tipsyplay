(function(){
"use strict";
/* The shared screen for a TV or laptop. It is not a player: it signs in, reads the room's public state, and marks
   itself as connected at {game}/screen so the host's phone hands the shared screen over to it.
   Shared-screen sounds play here (and not on the phones) while it is connected. */
var EMU=/[?&]emulator=1(?:&|$)/.test(location.search);
var FAST=EMU&&/[?&]fast=1(?:&|$)/.test(location.search);
if(FAST&&window.CourtLogic) window.CourtLogic.fast();
if(FAST&&window.CountdownLogic&&window.CountdownLogic.fast) window.CountdownLogic.fast();
var FX=window.PartyFX;
var GAMES={
  hc:{name:"Hot Take Court", path:"/play/hot-take-court.html", screen:function(){return window.CourtScreen}},
  cc:{name:"Category Countdown", path:"/play/category-countdown.html", screen:function(){return window.CountdownScreen}}
};
var PACK={mild:"Mild", spicy:"Spicy", extra:"Absurd"};
var $=function(id){return document.getElementById(id)};
var db, ref, onValue, set, onDisconnect, serverTimestamp, code="", meta=null, players={}, pub=null, D=null, kind="", stops=[], beatTimer=0, tickTimer=0;
var serverOffset=0, offsetReady=false, wasLobby=true;
function serverNow(){return Date.now()+(offsetReady?serverOffset:0)}
function el(tag, cls, text){var n=document.createElement(tag); if(cls) n.className=cls; if(text!=null) n.textContent=text; return n}
function show(id, on){var n=$(id); if(n) n.classList.toggle("hide", !on)}
function normCode(v){var s=String(v||""), m=s.match(/(?:room|code)=([A-Za-z]{4})/i); if(m) return m[1].toUpperCase(); return s.toUpperCase().replace(/[^ABCDEFGHJKMNPQRSTUVWXYZ]/g,"").slice(0,4)}
function validCode(c){return /^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(c)}
function joinUrl(){var g=GAMES[kind]; if(!g) return ""; if(window.TipsyJoinQR) return TipsyJoinQR.pageInvite(g.path, code, kind); return "https://tipsyplay.com"+g.path+"?room="+code+"&game="+kind}

function stop(){stops.forEach(function(fn){try{fn()}catch(e){}}); stops=[]; if(beatTimer){clearInterval(beatTimer); beatTimer=0}}
function watch(c){
  stop(); code=c; kind=""; meta=null; pub=null; D=null; players={};
  try{history.replaceState(null, "", location.pathname+"?room="+c+(EMU?"&emulator=1"+(FAST?"&fast=1":""):""))}catch(e){}
  stops.push(onValue(ref(db, "rooms/"+c+"/meta"), function(s){
    if(!s.exists()){$("tverr").textContent="No room with that code, or it has closed."; show("pickroom", true); show("lobbyview", false); show("gameview", false); show("joinbox", false); return}
    meta=s.val()||{};
    if(!GAMES[meta.kind]){$("tverr").textContent="That room's game doesn't have a TV screen yet."; return}
    if(kind!==meta.kind){kind=meta.kind; listenGame()}
    paint();
  }, function(){$("tverr").textContent="That room isn't available."}));
  stops.push(onValue(ref(db, "rooms/"+c+"/players"), function(s){players=s.val()||{}; paint()}, function(){}));
}
function listenGame(){
  stops.push(onValue(ref(db, "rooms/"+code+"/"+kind+"/pub"), function(s){
    pub=s.val()||null; try{D=pub?JSON.parse(pub.data):null}catch(e){D=null}
    paint();
  }, function(){}));
  /* tell the host's phone a display is here; the mark disappears by itself if this screen goes away */
  var mark=ref(db, "rooms/"+code+"/"+kind+"/screen");
  function beat(){set(mark, serverTimestamp()).catch(function(){})}
  try{onDisconnect(mark).remove()}catch(e){}
  beat(); beatTimer=setInterval(beat, 10000);
}
function paint(){
  var g=GAMES[kind]; if(!meta||!g) return;
  show("pickroom", false);
  var lobby=meta.status==="lobby"||!pub||!D;
  show("lobbyview", lobby); show("gameview", !lobby); show("joinbox", !lobby);
  $("joincode").textContent=code;
  if(lobby){
    $("gamename").textContent=g.name+" · "+(PACK[meta.spice]||"Mild")+" pack";
    $("bigcode").textContent=code;
    var url=joinUrl(); $("joinurl").textContent=url.replace(/^https?:\/\//, "");
    var qr=$("bigqr"); if(window.TipsyJoinQR&&qr.dataset.for!==code+kind){qr.dataset.for=code+kind; TipsyJoinQR.draw(qr, url)}
    var ul=$("tvplayers"), names=Object.keys(players).map(function(k){return players[k]}).sort(function(a,b){return (a.joinedAt||0)-(b.joinedAt||0)}).map(function(p){return p.name||"Player"});
    if(ul.dataset.key!==names.join("|")){ul.dataset.key=names.join("|"); ul.textContent=""; names.forEach(function(n){ul.appendChild(el("li", null, n))})}
    $("lobbyline").textContent=names.length?names.length+" player"+(names.length===1?"":"s")+" in. The host starts the game.":"Waiting for players.";
    wasLobby=true;
  }else{
    var small=$("joinqr"); if(window.TipsyJoinQR&&small.dataset.for!==code+kind){small.dataset.for=code+kind; TipsyJoinQR.draw(small, joinUrl())}
    if(wasLobby&&FX&&FX.tuneOn()){FX.stopTune(); paintTune()}
    wasLobby=false;
    var scr=g.screen(); if(scr) scr.render($("gameview"), {pub:pub, D:D, now:serverNow(), compact:false, sounds:true});
  }
}
function paintTune(){var on=!!(FX&&FX.tuneOn()); $("tunebtn").setAttribute("aria-pressed", on?"true":"false"); $("tunebtn").textContent="Lobby music: "+(on?"on":"off")}

async function boot(){
  var mute=$("mute"); if(window.TPSound&&mute) TPSound.bindMute(mute);
  $("tunebtn").addEventListener("click", function(){
    if(!FX) return;
    if(FX.tuneOn()) FX.stopTune(); else if(wasLobby) FX.startTune();
    paintTune();
  });
  show("soundhint", !(window.TPSound&&TPSound.tapped()));
  window.addEventListener("pointerdown", function(){show("soundhint", false)}, {once:true});
  var base="https://www.gstatic.com/firebasejs/12.4.0/";
  var appMod=await import(base+"firebase-app.js");
  var authMod=await import(base+"firebase-auth.js");
  var dbMod=await import(base+"firebase-database.js");
  var cfg=await import("../firebase-config.js?v=17");
  var app=appMod.initializeApp(cfg.firebaseConfig);
  var authObj=authMod.getAuth(app);
  db=dbMod.getDatabase(app); ref=dbMod.ref; onValue=dbMod.onValue; set=dbMod.set; onDisconnect=dbMod.onDisconnect; serverTimestamp=dbMod.serverTimestamp;
  if(EMU){authMod.connectAuthEmulator(authObj, "http://127.0.0.1:9099", {disableWarnings:true}); dbMod.connectDatabaseEmulator(db, "127.0.0.1", 9000)}
  if(authObj.authStateReady) await authObj.authStateReady();
  if(!authObj.currentUser) await authMod.signInAnonymously(authObj);
  onValue(ref(db, ".info/serverTimeOffset"), function(s){var v=s.val(); if(typeof v==="number"&&isFinite(v)){serverOffset=v; offsetReady=true}});
  $("roomform").addEventListener("submit", function(e){e.preventDefault(); var c=normCode($("roomin").value); if(validCode(c)){$("tverr").textContent=""; watch(c)} else $("tverr").textContent="Enter the 4-letter code."});
  var m=String(location.search).match(/[?&](?:room|code)=([A-Za-z]{4})/i);
  if(m&&validCode(normCode(m[1]))) watch(normCode(m[1]));
  tickTimer=setInterval(function(){if(pub&&D&&meta&&meta.status!=="lobby") paint()}, 200);
  if(EMU) window.__tpDisplay={code:function(){return code}, kind:function(){return kind}, phase:function(){return pub&&pub.phase}};
}
boot().catch(function(err){console.error(err); $("tverr").textContent="The display couldn't connect. Check the connection and reload."});
})();
