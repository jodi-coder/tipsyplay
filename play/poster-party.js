/* Shared room shell for Split Decision.
   Uses the published rooms/$code schema only: meta, players, nhie/play,
   nhie/who, tally, sealed, revealed. Secrets go in sealed, which other
   players cannot read until the host sets revealed for that round.
   tally is public on purpose and stores only a progress code, never the pick.
   nhie/cast is readable by the whole room, so it is not used for answers. */
(function(){
"use strict";
var L=window.PosterLogic;
var GAME=document.body.dataset.game||"split";
var PATHS={split:"/games/split-decision.html"};
var TITLES={split:"Split Decision"};
var ALPHABET="ABCDEFGHJKMNPQRSTUVWXYZ";
var EMOJIS=["","😎","🦊","🌟","🎧","🍀","🔥","🌙","🎭","🍓","🎲","🦋"];
var TTL=8*60*60*1000;
var $=function(id){return document.getElementById(id)};
var uid=null, code=null, meta=null, players={}, who={}, table=null, tally={}, secrets={}, secretsLoaded=false;
var db, authObj, stops=[], secretUnsub=null, connStop=null, hostLock=false, hostSig="", sending=false;
var engine=null, mix={sfx:0.7,muteSfx:false};
var snapKey="", snapSecrets=null, applied="", resetFor=0, passArm=0, closeArm=0, bootTimer=0, heard=-1, tallyUnsub=null, watchKey="", tallyKey="";
var serverOffset=0, offsetReady=false, offsetStop=null;
var ref, onValue, update, set, get, remove, onDisconnect, serverTimestamp, goOnline;

function pack(){return window.SPLIT_DECK||[]}
function cardById(id){var list=pack(), i; for(i=0;i<list.length;i++) if(list[i].id===id) return list[i]; return null}
function asDeck(d){if(!d)return []; if(Array.isArray(d))return d; return Object.keys(d).sort(function(a,b){return (+a)-(+b)}).map(function(k){return d[k]})}
function rpath(p){return "rooms/"+code+"/"+p}
function isHost(){return !!(meta&&uid&&meta.hostUid===uid)}
function emuOn(){return /[?&]emulator=1(?:&|$)/.test(location.search)}
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
  try{var q=new URLSearchParams(location.search); raw=q.get("room")||q.get("code")||""}catch(e){raw=location.search||""}
  var c=normCode(raw);
  return validCode(c)?c:"";
}
function roomStore(){return "tp_"+GAME+"_room"}
function myEmoji(){try{return sessionStorage.getItem("tp_"+GAME+"_emoji")||""}catch(e){return ""}}
function unlock(){
  try{if(window.TPSound) TPSound.unlock()}catch(e){}
  try{
    if(window.PartyAudio){
      if(!engine) engine=PartyAudio.create({key:"tp_"+GAME+"_mix", mix:mix, host:function(){return isHost()}, hype:function(){return 0}});
      engine.unlock();
    }
  }catch(e){}
}
function cue(name){
  if(window.TPSound && !TPSound.enabled()) return;
  try{if(engine) engine.cue(name)}catch(e){}
}
function blip(kind){
  unlock();
  if(window.TPSound && TPSound.enabled()){
    if(kind==="yes" && TPSound.yes) TPSound.yes();
    else if(kind==="no" && TPSound.no) TPSound.no();
    else if(kind==="roll" && TPSound.roll) TPSound.roll();
    else if(kind==="win" && TPSound.celebrate) TPSound.celebrate();
    else if(TPSound.click) TPSound.click();
  }
}
function screen(id){["home","lobby","table","closed"].forEach(function(s){var n=$(s); if(n) n.classList.toggle("hide", s!==id)})}
function savedName(){
  var el=$("pname")||$("playername");
  var name=el?normName(el.value):"";
  if(!name){try{name=normName(localStorage.getItem("tp_name")||"")}catch(e){}}
  if(name&&el&&!normName(el.value)) el.value=name;
  return name;
}
function releaseRoom(){
  var c=code, me=uid;
  if(connStop){connStop(); connStop=null}
  if(c&&me){try{onDisconnect(ref(db, rpath("players/"+me))).cancel()}catch(e){}}
  stopAll();
  code=null; meta=null; table=null; players={};
  try{sessionStorage.removeItem(roomStore())}catch(e){}
}
function openHostFlow(){
  screen("home");
  var name=savedName();
  if(!name){var el=$("pname"); if(el) el.focus(); return}
  if($("hostbtn")) $("hostbtn").click();
}
var dropping=false;
function clearOptIns(){
  var box=$("optin"); if(box) box.checked=false;
  var na=$("ona"); if(na) na.checked=false;
}
function showRoomEnded(){
  stopAll();
  code=null; meta=null; table=null; players={};
  try{sessionStorage.removeItem(roomStore())}catch(e){}
  fail("This room has closed.");
  screen("home");
  var input=$("roomcode"); if(input) input.focus();
}
function restartSame(){
  var name=savedName();
  if(!name){openHostFlow(); return}
  var old=code;
  if(!old){clearOptIns(); screen("home"); hostRoom(name).catch(function(e){fail(friendly(e))}); return}
  var optinWas=$("optin")&&$("optin").checked, onaWas=$("ona")&&$("ona").checked;
  clearOptIns();
  dropping=old;
  hostRoom(name).then(function(){
    var cancel=Promise.resolve();
    if(uid){try{cancel=onDisconnect(ref(db, "rooms/"+old+"/players/"+uid)).cancel()}catch(e){}}
    return Promise.resolve(cancel).catch(function(){}).then(function(){return remove(ref(db, "rooms/"+old))});
  }).then(function(){
    if(dropping===old) dropping=false;
  }).catch(function(e){
    var still=code===old;
    if(dropping===old) dropping=false;
    if(still){
      if($("optin")) $("optin").checked=!!optinWas;
      if($("ona")) $("ona").checked=!!onaWas;
      try{render()}catch(err){}
      fail("Couldn't start a new room. Your current room is still open.");
      return;
    }
    fail(friendly(e));
  });
}
function showClosedChoice(role){
  var msg=$("closedmsg"); if(msg) msg.textContent="This room is closed to new players.";
  var b=$("hostnew");
  if(b){
    b.dataset.role=role==="host"?"host":"join";
    b.textContent=role==="host"?"Restart with same game":"Host a new room";
  }
  fail("This room is closed to new players.");
  screen("closed");
}
function mountRestart(){
  if(!isHost()||!meta||meta.status==="lobby") return;
  var sec=$("table");
  if(!sec||sec.classList.contains("hide")||sec.querySelector("[data-restart]")) return;
  var row=document.createElement("div"); row.className="card"; row.setAttribute("data-restart","1");
  var p=document.createElement("p"); p.textContent="This room is closed to new players.";
  var b=document.createElement("button"); b.type="button"; b.className="btn alt"; b.textContent="Restart with same game";
  b.addEventListener("click", function(){restartSame()});
  row.appendChild(p); row.appendChild(b); sec.appendChild(row);
}
function paintRole(){
  document.body.classList.toggle("is-host", isHost());
  document.querySelectorAll(".hostonly").forEach(function(n){n.classList.toggle("hide", !isHost())});
  document.querySelectorAll(".guestonly").forEach(function(n){n.classList.toggle("hide", isHost())});
}
function orderPlayers(){
  return Object.keys(players).map(function(id){
    var w=who[id]||{};
    return {uid:id, name:players[id].name||"Player", emoji:w.emoji||"", connected:players[id].connected!==false, joinedAt:players[id].joinedAt||0, points:+w.confessions||0, seen:+w.seen||0};
  }).sort(function(a,b){return a.joinedAt-b.joinedAt||a.name.localeCompare(b.name)});
}
function connectedIds(){return orderPlayers().filter(function(p){return p.connected}).map(function(p){return p.uid})}
function shownName(id){
  var list=orderPlayers(), count={}, seen={}, map={};
  list.forEach(function(p){count[p.name]=(count[p.name]||0)+1});
  list.forEach(function(p){
    if(count[p.name]<2){map[p.uid]=p.name; return}
    seen[p.name]=(seen[p.name]||0)+1;
    map[p.uid]=seen[p.name]===1?p.name:(p.name+" "+seen[p.name]);
  });
  return map[id]||(players[id]&&players[id].name)||"Player";
}
function pname(id){var w=who[id]||{}; return ((w.emoji?w.emoji+" ":"")+shownName(id))}
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
function fullMeta(patch){
  var m=Object.assign({}, meta||{}, patch||{});
  var status=/^(lobby|play|over)$/.test(m.status)?m.status:"lobby";
  var phase=/^(lobby|answer|reveal|over)$/.test(m.phase)?m.phase:"lobby";
  if(status==="lobby") phase="lobby";
  if(status==="over") phase="over";
  var out={hostUid:m.hostUid, createdAt:m.createdAt, status:status, phase:phase, spice:"mild", rounds:20, na:true, round:0, gameId:+m.gameId||1, kind:GAME};
  if(status!=="lobby"){
    var deck=asDeck(m.deck);
    out.deck=deck.length?deck:["ready"];
  }
  if(status==="over" && m.endedAt) out.endedAt=m.endedAt;
  return out;
}
function playObj(patch){
  var b=Object.assign({turn:uid||"host", step:"answer", text:GAME, seq:1, mode:"mild", kind:"have", round:0, opened:serverNow(), order:uid||"table"}, table||{}, patch||{});
  var step=/^(prompt|slam|answer|vote|results|over)$/.test(b.step)?b.step:"answer";
  var text=String(b.text||GAME).slice(0,140);
  if((step!=="prompt" && step!=="over") && !text) text=GAME;
  return {
    turn:String(b.turn||uid||"host").slice(0,128),
    step:step,
    text:text,
    seq:Math.max(0, Math.min(40, +b.seq||0)),
    mode:"mild",
    kind:/^(have|vote)$/.test(b.kind)?b.kind:"have",
    round:Math.max(0, Math.min(19, +b.round||0)),
    opened:Math.max(0, +b.opened||serverNow()),
    order:String(b.order||uid||"table").slice(0,1500)
  };
}
function writeWho(emoji, points, seen){
  return set(ref(db, rpath("nhie/who/"+uid)), {
    emoji:String(emoji||"").slice(0,8),
    confessions:Math.max(0, Math.min(40, points|0)),
    seen:Math.max(0, Math.min(40, seen|0))
  });
}
function csv(list){return (list||[]).filter(Boolean).join(",")}
function parseCsv(s){return String(s||"").split(",").map(function(x){return x.trim()}).filter(Boolean)}
function currentCard(){
  if(!meta||!table) return null;
  var deck=asDeck(meta.deck), idx=+table.round||0;
  return cardById(deck[idx]);
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
function invite(){return window.TipsyJoinQR?TipsyJoinQR.pageInvite(PATHS[GAME], code, GAME):("https://tipsyplay.com"+PATHS[GAME]+"?room="+code+"&game="+GAME)}
function paintQr(){
  if(!code||!window.TipsyJoinQR) return;
  var canvas=$("qr");
  if(!canvas||canvas.dataset.hidden==="1") return;
  TipsyJoinQR.draw(canvas, invite());
  var credit=$("qrcredit"); if(credit) credit.textContent=TipsyJoinQR.credit;
}
function paintLobby(){
  $("codebig").textContent=code||"";
  $("sharelink").textContent=invite();
  paintQr();
  var box=$("plist"); if(box){box.textContent="";
    orderPlayers().forEach(function(p){
      var row=document.createElement("div"); row.className="nh-person"+(p.connected?"":" off");
      var s=document.createElement("span"); s.textContent=(p.emoji?p.emoji+" ":"")+shownName(p.uid)+(p.uid===meta.hostUid?" · host":"");
      var tag=document.createElement("span"); tag.textContent=p.connected?"in":"away";
      row.appendChild(s); row.appendChild(tag);
      if(isHost()&&p.uid!==uid){
        var kick=el("button","x","Remove"); kick.type="button"; kick.setAttribute("aria-label","Remove "+shownName(p.uid));
        kick.addEventListener("click", function(){remove(ref(db, rpath("players/"+p.uid))).catch(function(e){fail(friendly(e))})});
        row.appendChild(kick);
      }
      box.appendChild(row);
    });
  }
  var n=orderPlayers().length;
  var start=$("start");
  if(start){
    start.disabled=!isHost()||!$("optin").checked||n<L.MIN_PLAYERS||n>L.MAX_PLAYERS;
    start.textContent="Start";
  }
  var note=$("lobbynote");
  if(note){
    if(n<2) note.textContent="Need one more player.";
    else if(n>10) note.textContent="10 players max.";
    else if(isHost()&&!$("optin").checked) note.textContent="Tick the opt-in, then start.";
    else note.textContent=isHost()?"You're the host. Share the code or the QR.":"You're in. The host starts when the table's ready.";
  }
}
function countProgress(ids, pred){
  var done=0, i;
  for(i=0;i<ids.length;i++) if(pred(ids[i])) done++;
  return {done:done, total:ids.length};
}
function mineTally(){return tally[uid]}
function choiceLocked(kind){
  var v=mineTally();
  if(GAME==="split" && kind==="pref") return v===1||v===2;
  if(GAME==="split" && kind==="pred") return v===3||v===4;
  return false;
}
function el(tag, cls, text){var n=document.createElement(tag); if(cls) n.className=cls; if(text!=null) n.textContent=text; return n}
function addChoice(parent, label, value, pressed, nums){
  var b=el("button", "poster-choice", label);
  b.type="button";
  b.dataset.value=value;
  b.setAttribute("aria-pressed", pressed?"true":"false");
  if(nums) parent.classList.add("poster-nums");
  b.addEventListener("click", function(){submitValue(value, false)});
  parent.appendChild(b);
}
function shownSecrets(){
  if(!table) return {};
  if(table.step==="results" || table.step==="over"){
    var k=(meta?meta.gameId:"")+"/"+(table.round);
    if(secretsLoaded && snapKey!==k){snapKey=k; snapSecrets=Object.assign({}, secrets)}
    return snapSecrets||{};
  }
  return {};
}
function paintChoices(){
  var box=$("choices"); if(!box) return;
  box.textContent=""; box.classList.remove("poster-nums");
  var pass=$("passbtn"), note=$("passnote"), status=$("statusline");
  if(pass) pass.classList.remove("hide");
  if(note) note.textContent="";
  if(status) status.textContent="";
  if(!table || table.step==="results" || table.step==="over"){
    if(pass) pass.classList.add("hide");
    return;
  }
  var card=currentCard();
  if(GAME==="split" && table.step==="answer"){
    if(note) note.textContent="Passing sits you out of this whole round.";
    if(card){addChoice(box, "A · "+card.a, "A", secrets[uid]==="A", false); addChoice(box, "B · "+card.b, "B", secrets[uid]==="B", false)}
    if(status) status.textContent=choiceLocked("pref")?(secrets[uid]==="pass"?"You passed.":"Locked in. Hidden until reveal."):"Pick one. Nobody sees it yet.";
    return;
  }
  if(GAME==="split" && table.step==="vote"){
    var eligible=parseCsv(table.order);
    var inRound=eligible.indexOf(uid)>=0;
    if(!inRound){
      if(pass) pass.classList.add("hide");
      if(status) status.textContent="You passed the first pick, so this forecast isn't yours.";
      return;
    }
    var denom=Math.max(0, eligible.length-1);
    if(note) note.textContent="Passing scores 0 for the forecast. Your A/B pick still counts. You're guessing how many of the other "+denom+" picked A.";
    var mine=L.parseSplitSeal(secrets[uid]);
    var n;
    for(n=0;n<=denom;n++) addChoice(box, String(n), String(n), mine.pred===n, true);
    if(status) status.textContent=choiceLocked("pred")?"Forecast locked.":"How many of the other "+denom+" picked A?";
    return;
  }
}
function paintReveal(){
  var box=$("reveallist"); if(!box) return;
  box.textContent="";
  var head=$("revealhead");
  var toast=$("toastline");
  var show=table&&(table.step==="results"||table.step==="over");
  var wrap=$("revealbox"); if(wrap) wrap.classList.toggle("hide", !show);
  if(!show){if(head) head.textContent=""; if(toast) toast.textContent=""; return}
  if(toast) toast.textContent="Optional: a small drink, or skip it. Whoever picked the minority side takes a bow instead.";
  var bag=shownSecrets();
  if(GAME==="split") paintSplitReveal(box, head, bag);
}
function row(parent, left, right){
  var line=el("div","reveal-row");
  line.appendChild(el("span","",left));
  line.appendChild(el("span","",right));
  parent.appendChild(line);
}
function reasonWord(reason, points){
  if(reason==="exact") return "Exact · "+points;
  if(reason==="adjacent") return "One away · "+points;
  if(reason==="pass") return "Pass · 0";
  if(reason==="need-two") return "Not scored";
  if(reason==="miss") return "Miss · 0";
  return String(points||0);
}
function paintSplitReveal(box, head, bag){
  var eligible=parseCsv(table.order);
  if(String(table.text||"").indexOf("pref")>=0) eligible=L.eligibleFromPref(parseCsv(table.order), tally);
  var scored=L.scoreSplitRound(eligible, bag);
  if(head) head.textContent=scored.unscored?"Not enough picks to score":("A "+scored.aCount+" · B "+scored.bCount);
  if(!scored.rows.length){box.appendChild(el("p","","No locked picks.")); return}
  scored.rows.forEach(function(r){
    var pref=r.pref==="A"||r.pref==="B"?r.pref:"Pass";
    var forecast=r.pred==null?"—":r.pred==="pass"?"Pass":String(r.pred);
    row(box, pname(r.uid)+" · "+pref, "Said "+forecast+" / "+r.denom+" · "+reasonWord(r.reason, r.points));
  });
}
function paintAwards(){
  var box=$("awards"); if(!box) return;
  box.textContent="";
  var over=table&&table.step==="over";
  var finale=$("finale"); if(finale) finale.classList.toggle("hide", !over);
  if(!over) return;
  var n=meta&&meta.deck?(Array.isArray(meta.deck)?meta.deck.length:Object.keys(meta.deck).length):8;
  var line=$("recapline"); if(line) line.textContent=(TITLES[GAME]||"This game")+", "+n+" rounds";
  var list=orderPlayers();
  if(!list.length){box.appendChild(el("p","","No players left.")); return}
  var max=0, i;
  for(i=0;i<list.length;i++) if(list[i].points>max) max=list[i].points;
  var top=list.filter(function(p){return p.points===max});
  var title=top.length===list.length||top.length>1?"Shared win":"Top score";
  var card2=el("article","poster-award");
  card2.appendChild(el("p","", title));
  card2.appendChild(el("h2","", top.map(function(p){return (p.emoji?p.emoji+" ":"")+shownName(p.uid)}).join(", ")));
  card2.appendChild(el("p","", max+" points."));
  box.appendChild(card2);
  list.forEach(function(p){
    row(box, (p.emoji?p.emoji+" ":"")+shownName(p.uid), p.points+" points");
  });
}
function paintTable(){
  var card=currentCard();
  var total="Round "+(table.round+1)+" of 8";
  if($("roundlabel")) $("roundlabel").textContent=table.step==="over"?"That's the game":total;
  if($("badge")) $("badge").textContent=TITLES[GAME];
  if($("kicker")){
    var kick="Hidden until reveal";
    if(table.step==="results") kick="Revealed";
    else if(table.step==="over") kick="Final";
    else if((+table.round||0)===0) kick="Round 1 · hidden until reveal";
    $("kicker").textContent=kick;
  }
  if($("statement")){
    var line="The next card is on the way.";
    if(card) line=card.q;
    $("statement").textContent=line;
  }
  var hostP=meta&&players[meta.hostUid];
  if($("away")) $("away").classList.toggle("hide", !hostP||hostP.connected!==false||isHost());
  paintChoices();
  paintReveal();
  paintAwards();
  var ids=[], pred=function(){return false};
  if(GAME==="split" && table.step==="answer"){ids=parseCsv(table.order); pred=function(id){return tally[id]===1||tally[id]===2}}
  if(GAME==="split" && table.step==="vote"){ids=parseCsv(table.order); pred=function(id){return tally[id]===3||tally[id]===4}}
  var prog=countProgress(ids, pred);
  document.body.setAttribute("data-rm-allin", prog.total&&prog.done>=prog.total?"1":"0");
  if($("progress")) $("progress").textContent=table.step==="results"||table.step==="over"?"":(prog.total?prog.done+" of "+prog.total+" in":"");
  var reveal=$("revealbtn"), next=$("nextround"), retry=$("retrybtn"), deal=$("dealbtn");
  if(reveal) reveal.classList.toggle("hide", !isHost()||(table.step!=="answer"&&table.step!=="vote"));
  if(next){
    next.classList.toggle("hide", !isHost()||table.step!=="results");
    next.textContent=moreAfter()?"Next":"See the result";
  }
  if(retry) retry.classList.add("hide");
  if(deal) deal.classList.add("hide");
}
function moreAfter(){
  if(GAME==="split") return (+table.round||0)<7;
  return false;
}
function render(){
  paintRole();
  if(!meta){screen("home"); return}
  if(meta.createdAt && typeof meta.createdAt==="number" && serverNow()-meta.createdAt>TTL){fail("This room has expired.");}
  if(meta.status==="lobby"){
    screen("lobby"); paintLobby();
    maybeResetScores();
    return;
  }
  screen("table");
  mountRestart();
  if(table) paintTable();
  maybeScore();
  hear();
  if(isHost()) hostThink();
}
function hear(){
  if(!table) return;
  var key=String(table.seq)+":"+table.step;
  if(heard===key) return;
  heard=key;
  if(table.step==="answer"||table.step==="vote") blip("roll");
  if(table.step==="over") blip("win");
}
function maybeResetScores(){
  if(!meta||meta.status!=="lobby"||!uid) return;
  if(resetFor===meta.gameId) return;
  var me=who[uid];
  if(me && ((+me.confessions||0)>0 || (+me.seen||0)>0)){
    resetFor=meta.gameId;
    writeWho(me.emoji||myEmoji(), 0, 0).catch(function(e){resetFor=0; fail(friendly(e))});
  }else resetFor=meta.gameId;
}
function maybeScore(){
  if(!table||table.step!=="results"||!secretsLoaded||!uid) return;
  var token=(meta.gameId)+"/"+(table.round);
  if(applied===token) return;
  var me=who[uid]||{confessions:0, seen:0, emoji:myEmoji()};
  if((+me.seen||0)>=(+table.round||0)+1){applied=token; return}
  var bag=shownSecrets();
  var add=0;
  if(GAME==="split"){
    var eligible=parseCsv(table.order);
    var scored=L.scoreSplitRound(eligible, bag);
    scored.rows.forEach(function(r){if(r.uid===uid) add=r.points});
  }
  applied=token;
  var points=Math.min(40,(+me.confessions||0)+add);
  writeWho(me.emoji||myEmoji(), points, (+table.round||0)+1).catch(function(e){if(applied===token) applied=""; fail(friendly(e))});
}
function submitValue(value, passed){
  if(!table||!meta||sending) return;
  if(table.step!=="answer"&&table.step!=="vote"&&table.step!=="prompt") return;
  var round=+table.round||0;
  var gid=meta.gameId;
  var seal="pass", mark=2;
  if(GAME==="split"&&table.step==="answer"){
    seal=passed?"pass":value; mark=passed?2:1;
  }else if(GAME==="split"&&table.step==="vote"){
    var prev=L.parseSplitSeal(secrets[uid]);
    seal=L.encodeSplitSeal(prev.pref, passed?"pass":+value);
    mark=passed?4:3;
  }
  if(!passed && (value==null || value==="")) return;
  sending=true;
  blip(passed?"no":"yes");
  var payload={};
  payload[rpath("sealed/"+gid+"/"+round+"/"+uid)]=seal;
  payload[rpath("tally/"+gid+"/"+round+"/"+uid)]=mark;
  update(ref(db), payload).then(function(){sending=false; passArm=0}).catch(function(e){sending=false; fail(friendly(e))});
}
function readyMeta(){return meta&&typeof meta.createdAt==="number"&&meta.createdAt>1700000000000}
function writePlay(patch, phase){
  var payload={};
  payload[rpath("nhie/play")]=playObj(patch);
  payload[rpath("meta")]=fullMeta({status:phase==="over"?"over":"play", phase:phase, deck:asDeck(meta.deck), endedAt:phase==="over"?serverNow():null});
  return update(ref(db), payload);
}
function connectedAmong(ids){
  return (ids||[]).filter(function(id){return players[id]&&players[id].connected!==false});
}
function allDone(ids, pred){
  var live=connectedAmong(ids);
  if(!live.length) return false;
  return live.every(pred);
}
function hostThink(){
  if(!isHost()||hostLock||!readyMeta()||!table) return;
  if(table.step!=="answer"&&table.step!=="vote"&&table.step!=="prompt") return;
  var action=null;
  if(GAME==="split") action=splitAuto();
  if(!action) return;
  if(hostSig===action.sig) return;
  hostSig=action.sig;
  hostLock=true;
  action.run().then(function(){hostLock=false}, function(e){hostLock=false; hostSig=""; fail(friendly(e))});
}
function splitAuto(){
  if(table.step==="answer"){
    var roster=parseCsv(table.order);
    if(!allDone(roster, function(id){return tally[id]===1||tally[id]===2})) return null;
    var eligible=L.eligibleFromPref(roster, tally);
    var sig="split-pref-"+table.round+"-"+eligible.join(".");
    return {sig:sig, run:function(){
      if(eligible.length<2) return revealWith(playObj({step:"results", order:csv(eligible), text:"s|out", kind:"have"}));
      return writePlay({step:"vote", kind:"vote", order:csv(eligible), text:"s|pred", seq:Math.min(40,(+table.seq||1)+1)}, "answer");
    }};
  }
  if(table.step==="vote"){
    var elig=parseCsv(table.order);
    if(!allDone(elig, function(id){return tally[id]===3||tally[id]===4})) return null;
    return {sig:"split-pred-"+table.round, run:function(){return revealWith(playObj({step:"results", kind:"have", text:"s|done"}))}};
  }
  return null;
}
function revealWith(nextPlay){
  var gid=meta.gameId, round=+table.round||0;
  return update(ref(db), {
    [rpath("revealed/"+gid+"/"+round)]:true,
    [rpath("nhie/play")]:nextPlay,
    [rpath("meta")]:fullMeta({status:"play", phase:"reveal", deck:asDeck(meta.deck)})
  });
}
function finishGame(){
  return update(ref(db), {
    [rpath("nhie/play")]:playObj({step:"over", text:table.text||GAME, kind:"have"}),
    [rpath("meta")]:fullMeta({status:"over", phase:"over", deck:asDeck(meta.deck), endedAt:serverNow()})
  });
}
function forceReveal(){
  if(!isHost()||!table) return;
  unlock();
  hostLock=true;
  var run;
  if(GAME==="split"&&table.step==="answer"){
    var eligible=L.eligibleFromPref(parseCsv(table.order), tally);
    run=revealWith(playObj({step:"results", order:csv(eligible), text:"s|out", kind:"have"}));
  }else run=revealWith(playObj({step:"results", text:table.text, kind:"have"}));
  Promise.resolve(run).then(function(){hostLock=false}, function(e){hostLock=false; fail(friendly(e))});
}
function goNext(){
  if(!isHost()||!table||table.step!=="results") return;
  unlock();
  hostLock=true;
  var job;
  if(GAME==="split"){
    var n=(+table.round||0)+1;
    if(n>=8) job=finishGame();
    else job=writePlay({step:"answer", kind:"have", round:n, opened:serverNow(), seq:Math.min(40,(+table.seq||1)+1), text:"s|pref", order:csv(connectedIds()), turn:uid}, "answer");
  }
  Promise.resolve(job).then(function(){hostLock=false}, function(e){hostLock=false; fail(friendly(e))});
}
async function begin(){
  if(!isHost()||!meta||sending) return;
  if(!readyMeta()){fail("Still opening the room. One moment."); return}
  var list=connectedIds();
  if(list.length<2||list.length>10){fail("Need 2 to 10 players."); return}
  if(!$("optin").checked){fail("Tick the opt-in first. Passing stays fine."); return}
  fail(""); sending=true; unlock();
  var ids=pack().map(function(c){return c.id});
  var used=[];
  try{used=JSON.parse(sessionStorage.getItem("tp_"+GAME+"_used_"+code)||"[]")}catch(e){used=[]}
  var count=8;
  var dealt=L.dealIds(ids, code+"|"+meta.gameId, used, count);
  try{sessionStorage.setItem("tp_"+GAME+"_used_"+code, JSON.stringify(dealt.used))}catch(e){}
  var patch={step:"answer", text:"s|pref", kind:"have", round:0, order:csv(list), turn:list[0], seq:1, opened:serverNow()};
  try{
    await update(ref(db), {
      [rpath("meta")]:fullMeta({status:"play", phase:"answer", deck:dealt.dealt}),
      [rpath("nhie/play")]:playObj(patch)
    });
    cue("whoosh");
  }catch(e){fail(friendly(e))}
  sending=false;
}
async function hostRoom(name){
  var i, claimed=null;
  for(i=0;i<8;i++){
    var c=makeCode();
    var snap=await get(ref(db, "rooms/"+c+"/meta"));
    if(snap.exists()) continue;
    try{
      await update(ref(db), {["rooms/"+c+"/meta"]:{hostUid:uid, createdAt:serverTimestamp(), status:"lobby", phase:"lobby", spice:"mild", rounds:20, na:true, round:0, gameId:1, kind:GAME}});
      claimed=c; rememberGame(); break;
    }catch(e){if(!/permission/i.test(String(e.code||e.message||""))) throw e}
  }
  if(!claimed) throw new Error("room");
  await set(ref(db, "rooms/"+claimed+"/players/"+uid), {name:name, connected:true, joinedAt:serverNow()});
  await set(ref(db, "rooms/"+claimed+"/nhie/who/"+uid), {emoji:myEmoji(), confessions:0, seen:0});
  code=claimed;
  try{sessionStorage.setItem(roomStore(), code)}catch(e){}
  listen(); armPresence();
}
async function joinRoom(c, name){
  var snap=await get(ref(db, "rooms/"+c+"/meta"));
  if(!snap.exists()) throw new Error("missing");
  var m=snap.val()||{};
  if(m.kind!==GAME) throw new Error("kind");
  if(m.createdAt && typeof m.createdAt==="number" && serverNow()-m.createdAt>TTL) throw new Error("expired");
  var mine=await get(ref(db, "rooms/"+c+"/players/"+uid));
  if(m.status!=="lobby" && !mine.exists()) throw new Error("started");
  var all=await get(ref(db, "rooms/"+c+"/players"));
  var count=all.exists()?Object.keys(all.val()||{}).length:0;
  if(!mine.exists() && count>=L.MAX_PLAYERS) throw new Error("full");
  var prev=mine.val()||{};
  await set(ref(db, "rooms/"+c+"/players/"+uid), {name:name||prev.name||"Player", connected:true, joinedAt:prev.joinedAt||serverNow()});
  var w=await get(ref(db, "rooms/"+c+"/nhie/who/"+uid));
  var cur=w.val()||{};
  await set(ref(db, "rooms/"+c+"/nhie/who/"+uid), {emoji:myEmoji()||cur.emoji||"", confessions:+cur.confessions||0, seen:+cur.seen||0});
  code=c;
  rememberGame();
  try{sessionStorage.setItem(roomStore(), code)}catch(e){}
  listen(); armPresence();
}
function listen(){
  stopAll();
  var watched=code;
  stops.push(onValue(ref(db, rpath("meta")), function(s){
    if(!s.exists()){if(dropping===watched||watched!==code) return; showRoomEnded(); return}
    meta=s.val()||null; render();
  }, function(){fail("That room isn't available.")}));
  stops.push(onValue(ref(db, rpath("players")), function(s){players=s.val()||{}; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("nhie/who")), function(s){who=s.val()||{}; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("nhie/play")), function(s){
    table=s.val()||null;
    hostLock=false;
    var open=table&&(table.step==="results"||table.step==="over");
    var nextKey=(open?"open:":"own:")+(meta?meta.gameId:"")+"/"+(table?table.round:"");
    if(watchKey!==nextKey){
      watchKey=nextKey;
      if(open){secrets={}; secretsLoaded=false; snapKey=""; snapSecrets=null}
    }
    watchSecret(); watchTally(); render();
  }, function(){}));
}
function watchTally(){
  if(!meta||!table) return;
  var key=meta.gameId+"/"+table.round;
  if(tallyKey===key && tallyUnsub) return;
  tallyKey=key;
  if(tallyUnsub){tallyUnsub(); tallyUnsub=null}
  tally={};
  tallyUnsub=onValue(ref(db, rpath("tally/"+key)), function(s){tally=s.val()||{}; render()}, function(){});
}
function watchSecret(){
  if(secretUnsub){secretUnsub(); secretUnsub=null}
  if(!meta||!table||!uid) return;
  var gid=meta.gameId, round=table.round;
  var open=table.step==="results"||table.step==="over";
  var path=open?rpath("sealed/"+gid+"/"+round):rpath("sealed/"+gid+"/"+round+"/"+uid);
  var tries=0;
  function attach(){
    secretUnsub=onValue(ref(db, path), function(s){
      if(open){secrets=s.val()||{}; secretsLoaded=true}
      else{
        var mine=s.exists()?s.val():"";
        if(mine) secrets[uid]=mine;
        else delete secrets[uid];
      }
      render();
    }, function(){
      if(!open || tries>5) return;
      tries++;
      setTimeout(attach, 200);
    });
  }
  attach();
}
function stopAll(){
  stops.forEach(function(fn){try{fn()}catch(e){}}); stops=[];
  if(secretUnsub){secretUnsub(); secretUnsub=null}
  if(tallyUnsub){tallyUnsub(); tallyUnsub=null}
  if(connStop){connStop(); connStop=null}
  tallyKey=""; watchKey=""; tally={};
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
/* The Room sheet closes itself before a click reaches the hidden End session button,
   so the old 2.5s second tap could never land. Split Decision keeps that sheet open
   and turns the same row into "Tap again to end". Eight seconds covers a normal pause.
   The in-page buttons stay put, so they keep the 2.5s second tap. */
var SHEET_ARM_MS=8000, sheetToken=0, sheetTimer=0, endWatchOn=false;
function endSession(){
  if(!isHost()||!code) return;
  closeArm=0; sheetToken=0;
  if(sheetTimer){clearTimeout(sheetTimer); sheetTimer=0}
  hideRoomSheet();
  fail("");
  remove(ref(db, "rooms/"+code)).catch(function(e){fail(friendly(e))});
  try{sessionStorage.removeItem(roomStore())}catch(e){}
}
function askClose(){
  if(!isHost()||!code) return;
  var now=Date.now();
  if(now-closeArm>2500){closeArm=now; fail("Tap end again to close the room for everyone."); return}
  endSession();
}
function hideRoomSheet(){
  var sheet=$("rmsheet"), scrim=document.querySelector(".rm-scrim"), menuBtn=$("rmmenubtn"), invite=$("rminvite");
  if(sheet) sheet.hidden=true;
  if(scrim && (!invite || invite.hidden)) scrim.hidden=true;
  if(menuBtn) menuBtn.setAttribute("aria-expanded","false");
}
function watchEndSheet(){
  if(endWatchOn) return;
  var sheet=$("rmsheet");
  if(!sheet) return;
  endWatchOn=true;
  try{
    new MutationObserver(function(){
      if(!sheet.hidden) return;
      sheetToken=0;
      if(sheetTimer){clearTimeout(sheetTimer); sheetTimer=0}
    }).observe(sheet,{attributes:true,attributeFilter:["hidden"]});
  }catch(e){}
}
function armEndItem(b){
  var token=Date.now();
  if(token===sheetToken) token+=1;
  sheetToken=token;
  b.textContent="Tap again to end";
  b.classList.add("danger");
  b.style.backgroundColor="var(--surface)";
  b.setAttribute("aria-pressed","true");
  if(sheetTimer) clearTimeout(sheetTimer);
  sheetTimer=setTimeout(function(){
    if(sheetToken!==token) return;
    sheetToken=0; sheetTimer=0;
    if((b.textContent||"").trim()==="Tap again to end"){
      b.textContent="End session";
      b.style.backgroundColor="";
      b.removeAttribute("aria-pressed");
    }
  }, SHEET_ARM_MS);
}
document.addEventListener("click", function(e){
  if(GAME!=="split") return;
  watchEndSheet();
  var sheet=$("rmsheet");
  if(!sheet || sheet.hidden) return;
  var t=e.target;
  if(!t) return;
  if(t.nodeType!==1) t=t.parentElement;
  if(!t || !t.closest) return;
  var b=t.closest("#rmsheet button.rm-item");
  if(!b) return;
  var label=(b.textContent||"").replace(/\s+/g," ").trim();
  if(label!=="End session" && label!=="Tap again to end") return;
  if(!isHost()||!code) return;
  e.preventDefault();
  e.stopPropagation();
  if(label==="Tap again to end" && sheetToken && Date.now()-sheetToken<=SHEET_ARM_MS){endSession(); return}
  armEndItem(b);
}, true);
function leaveRoom(){
  if(!code||!uid||isHost()) return askClose();
  remove(ref(db, rpath("players/"+uid))).catch(function(e){fail(friendly(e))});
  try{sessionStorage.removeItem(roomStore())}catch(e){}
  stopAll(); meta=null; table=null; code=null; screen("home");
}
function rememberGame(){
  var slug=GAME==="split"?"split-decision":GAME;
  try{localStorage.setItem("tp_last_game", slug)}catch(e){}
}
function shareRecap(){
  var text=$("recapline")&&$("recapline").textContent||((TITLES[GAME]||"This game")+", 8 rounds");
  var copied=function(){fail("Recap copied.")};
  if(navigator.share) navigator.share({text:text}).catch(function(){if(navigator.clipboard)navigator.clipboard.writeText(text).then(copied).catch(function(){fail(text)}); else fail(text)});
  else if(navigator.clipboard) navigator.clipboard.writeText(text).then(copied).catch(function(){fail(text)});
  else fail(text);
}
async function rematch(){
  if(!isHost()||!meta) return;
  unlock();
  clearOptIns();
  var nextId=Math.min(100,(+meta.gameId||1)+1);
  await update(ref(db), {[rpath("meta")]:fullMeta({status:"lobby", phase:"lobby", gameId:nextId})});
  resetFor=0;
}
function paintEmoji(){
  var box=$("emojis"); if(!box) return;
  var cur=myEmoji(); box.textContent="";
  EMOJIS.forEach(function(emo){
    var b=el("button","", emo||"·"); b.type="button";
    b.setAttribute("aria-label", emo||"No emoji");
    b.setAttribute("aria-pressed", emo===cur?"true":"false");
    b.addEventListener("click", function(){
      try{sessionStorage.setItem("tp_"+GAME+"_emoji", emo)}catch(e){}
      paintEmoji();
      if(code&&uid) writeWho(emo, (who[uid]&&who[uid].confessions)||0, (who[uid]&&who[uid].seen)||0).catch(function(e){fail(friendly(e))});
    });
    box.appendChild(b);
  });
}
function wire(){
  var saved=""; try{saved=localStorage.getItem("tp_name")||""}catch(e){}
  if(saved&&$("pname")&&!$("pname").value) $("pname").value=saved;
  paintEmoji();
  if(window.TipsyJoinQR) TipsyJoinQR.prefill("roomcode", GAME);
  var linked=queryRoom()||($("roomcode")&&normCode($("roomcode").value));
  if(linked&&$("roomcode")) $("roomcode").value=linked;
  if($("hostnew")) $("hostnew").addEventListener("click", function(){
    if($("hostnew").dataset.role==="host") restartSame();
    else openHostFlow();
  });
  $("hostbtn").addEventListener("click", function(){
    var name=normName($("pname").value);
    if(!name){fail("Add your name first."); $("pname").focus(); return}
    if(sending) return;
    sending=true; fail(""); blip("yes");
    try{localStorage.setItem("tp_name", name)}catch(e){}
    hostRoom(name).catch(function(e){fail(e&&e.message==="room"?"Couldn't open a room. Try again.":friendly(e))}).then(function(){sending=false});
  });
  $("joinform").addEventListener("submit", function(e){e.preventDefault(); $("joinbtn").click()});
  $("joinbtn").addEventListener("click", function(){
    var name=normName($("pname").value), c=normCode($("roomcode").value);
    if(!name){fail("Add your name first."); $("pname").focus(); return}
    if(!validCode(c)){fail("Enter the 4-letter code."); $("roomcode").focus(); return}
    if(sending) return;
    sending=true; fail(""); blip("yes");
    try{localStorage.setItem("tp_name", name)}catch(e){}
    joinRoom(c, name).catch(function(e){
      var msg=String((e&&e.message)||"");
      if(msg==="kind") fail("That code is for a different game.");
      else if(msg==="missing") fail("No room with that code.");
      else if(msg==="expired") fail("That room has expired.");
      else if(msg==="full") fail("That room is full (10 players).");
      else if(msg==="started") showClosedChoice("join");
      else fail(friendly(e));
    }).then(function(){sending=false});
  });
  if($("optin")) $("optin").addEventListener("change", render);
  if($("start")) $("start").addEventListener("click", function(){begin()});
  if($("passbtn")) $("passbtn").addEventListener("click", function(){submitValue("pass", true)});
  if($("revealbtn")) $("revealbtn").addEventListener("click", forceReveal);
  if($("nextround")) $("nextround").addEventListener("click", goNext);
  if($("again")) $("again").addEventListener("click", function(){rematch().catch(function(e){fail(friendly(e))})});
  if($("recap")) $("recap").addEventListener("click", function(){shareRecap()});
  if($("close")) $("close").addEventListener("click", askClose);
  if($("closestage")) $("closestage").addEventListener("click", askClose);
  if($("leavebtn")) $("leavebtn").addEventListener("click", leaveRoom);
  if($("copylink")) $("copylink").addEventListener("click", function(){unlock(); copyText(invite()).then(function(){fail("Link copied.")}).catch(function(){fail(invite())})});
  if($("copycode")) $("copycode").addEventListener("click", function(){unlock(); copyText(code||"").then(function(){fail("Code copied.")}).catch(function(){fail(code||"")})});
  if($("sharebtn")) $("sharebtn").addEventListener("click", function(){
    unlock();
    var link=invite();
    if(navigator.share) navigator.share({title:TITLES[GAME], text:"Join my "+TITLES[GAME]+" room "+code, url:link}).catch(function(){copyText(link)});
    else copyText(link);
  });
  if($("qrhide")) $("qrhide").addEventListener("click", function(){
    var canvas=$("qr"); if(!canvas) return;
    var hidden=canvas.dataset.hidden==="1";
    canvas.dataset.hidden=hidden?"0":"1";
    canvas.classList.toggle("hide", !hidden);
    $("qrhide").textContent=hidden?"Hide QR":"Show QR";
    if(hidden) paintQr();
  });
  var mute=$("mute"); if(window.TPSound&&mute) TPSound.bindMute(mute);
  window.addEventListener("offline", function(){fail("You're offline. We'll keep trying when you're back.")});
  window.addEventListener("online", function(){fail(""); if(goOnline&&db){try{goOnline(db)}catch(e){}}});
  window.addEventListener("pageshow", function(ev){if(ev.persisted&&goOnline&&db){try{goOnline(db)}catch(e){}}});
  document.addEventListener("visibilitychange", function(){if(document.visibilityState==="visible"&&goOnline&&db){try{goOnline(db)}catch(e){}}});
  var back=""; try{back=sessionStorage.getItem(roomStore())||""}catch(e){}
  var nm=normName($("pname").value);
  var same=linked&&back&&linked===back;
  if(linked&&!same){
    var yes=document.getElementById("gyes");
    if(yes) yes.addEventListener("click", function(){setTimeout(function(){if($("pname")) $("pname").focus()}, 60)}, {once:true});
  }
  if(!linked&&back&&validCode(back)&&nm) joinRoom(back, nm).catch(function(e){
    try{sessionStorage.removeItem(roomStore())}catch(err){}
    if(String((e&&e.message)||"")==="missing") fail("This room has closed.");
  });
  else if(same&&nm) joinRoom(back, nm).catch(function(e){
    if(String((e&&e.message)||"")==="missing"){try{sessionStorage.removeItem(roomStore())}catch(err){} fail("This room has closed.")}
  });
  watchEndSheet();
}
function showReady(){
  if(bootTimer){clearTimeout(bootTimer); bootTimer=0}
  var boot=$("boot"); if(boot) boot.classList.add("hide");
  var app=$("app"); if(app) app.classList.remove("hide");
}
function showBootError(msg){
  if(bootTimer){clearTimeout(bootTimer); bootTimer=0}
  if($("boot")) $("boot").classList.remove("hide");
  if($("app")) $("app").classList.add("hide");
  if($("bootmsg")) $("bootmsg").textContent="Couldn't open the game.";
  if($("booterr")){$("booterr").textContent=msg||"Check your connection and try again."; $("booterr").classList.remove("hide")}
  if($("bootretry")) $("bootretry").classList.remove("hide");
}
async function boot(){
  bootTimer=setTimeout(function(){if($("app")&&$("app").classList.contains("hide")) showBootError("This is taking too long. Check your connection and try again.")}, 12000);
  if(!navigator.onLine&&!emuOn()){showBootError("You're offline. Reconnect, then try again."); return}
  var base="https://www.gstatic.com/firebasejs/12.4.0/";
  var appMod=await import(base+"firebase-app.js");
  var authMod=await import(base+"firebase-auth.js");
  var dbMod=await import(base+"firebase-database.js");
  var cfg=await import("../firebase-config.js?v=17");
  var app;
  try{app=appMod.initializeApp(cfg.firebaseConfig, GAME)}
  catch(e){app=appMod.getApp(GAME)}
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
  goOnline(db);
  armServerClock();
  window.addEventListener("pagehide", function(){stopServerClock()});
  if(emuOn()){
    window.__tpTest={
      game:GAME,
      uid:function(){return uid},
      code:function(){return code},
      step:function(){return table&&table.step},
      round:function(){return table&&table.round},
      token:function(){return authObj.currentUser.getIdToken()},
      readPath:function(path){
        return get(ref(db, path)).then(function(s){return {ok:true, val:s.val()}}, function(e){return {ok:false, error:String((e&&(e.code||e.message))||e)}});
      },
      guestWrite:function(){
        return update(ref(db), {[rpath("nhie/play")]:{turn:"guest", step:"answer", text:"nope", seq:1, mode:"mild", kind:"have", round:0, opened:serverNow(), order:"guest"}}).then(function(){return {ok:true}}, function(e){return {ok:false, error:String((e&&(e.code||e.message))||e)}});
      }
    };
  }
  showReady();
  try{wire()}catch(err){console.error(err); fail("The table glitched. Reload and try again.")}
}
if($("bootretry")) $("bootretry").addEventListener("click", function(){location.reload()});
boot().catch(function(err){console.error(err); showBootError("The game didn't open. Check your connection and try again.")});
})();
