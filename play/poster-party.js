/* Shared room shell for Split Decision.
   Uses the published rooms/$code schema only: meta, players, nhie/play,
   nhie/who, tally, sealed, revealed. Secrets go in sealed, which other
   players cannot read until the host sets revealed for that round.
   tally is public on purpose and stores only a progress code, never the pick.
   nhie/cast is readable by the whole room, so it never holds a live answer. After the
   reveal the host's phone scores the round once (PosterLogic.scoreRound) and writes one
   result row per player to nhie/cast/$uid. Every phone draws the reveal and the
   leaderboard from those stored rows, so all phones agree. */
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
var cast={}, castLoaded=false, scoredFor="", revealKey="", tickTimer=0;
var SPLIT_MS=L.SPLIT_SECONDS*1000;
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
  try{var q=new URLSearchParams(location.search); raw=q.get("room")||q.get("code")||""}catch(e){
    var m=String(location.search||"").match(/[?&](?:room|code)=([A-Za-z]{4})/i);
    if(m) raw=m[1];
  }
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
  if(kind==="pref") return v===1||v===3;
  if(kind==="pred") return v===3;
  return false;
}
function el(tag, cls, text){var n=document.createElement(tag); if(cls) n.className=cls; if(text!=null) n.textContent=text; return n}
function addChoice(parent, label, value, pressed, nums){
  var b=el("button", "poster-choice", label);
  b.type="button";
  b.dataset.value=value;
  b.setAttribute("aria-pressed", pressed?"true":"false");
  if(nums) parent.classList.add("poster-nums");
  b.addEventListener("click", function(){submitValue(value)});
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
  if(pass) pass.classList.add("hide");
  var card=currentCard();
  if(table.step!=="answer") return;
  var roster=parseCsv(table.order);
  if(roster.indexOf(uid)<0){if(status) status.textContent="You joined after this question started. You're in from the next one."; return}
  var mine=L.parseSplitSeal(secrets[uid]);
  var late=timeLeft()<=0;
  if(secrets[uid]==="pass"){if(status) status.textContent="You passed this one. Back in next round."; return}
  if(!mine.pref){
    if(late){if(status) status.textContent="Time's up. You missed this one."; return}
    if(card){addChoice(box, "A · "+card.a, "A", false, false); addChoice(box, "B · "+card.b, "B", false, false)}
    if(pass) pass.classList.remove("hide");
    if(note) note.textContent="Pass sits this question out for 0 points.";
    if(status) status.textContent="Pick one. Nobody sees it until the reveal.";
    return;
  }
  var denom=Math.max(0, roster.length-1);
  if(mine.pred==null){
    if(note) note.textContent="You picked "+mine.pref+(card?" · "+(mine.pref==="A"?card.a:card.b):"")+". Your own pick doesn't count here.";
    if(late){if(status) status.textContent="Locked. Time's up for the guess."; return}
    var n;
    for(n=0;n<=denom;n++) addChoice(box, String(n), String(n), false, true);
    if(status) status.textContent="How many of the other "+denom+" picked A?";
    return;
  }
  if(note) note.textContent="You picked "+mine.pref+" and guessed "+mine.pred+" of "+denom+".";
  if(status) status.textContent="Locked in. Hidden until the reveal.";
}
function timeLeft(){
  if(!table||table.step!=="answer") return 0;
  return Math.max(0, (+table.opened||0)+SPLIT_MS-serverNow());
}
function paintTimer(){
  var box=$("sdtimer"); if(!box) return;
  var on=!!(table&&table.step==="answer");
  box.classList.toggle("hide", !on);
  if(!on) return;
  var left=timeLeft(), secs=Math.ceil(left/1000);
  var num=$("sdtimern"); if(num) num.textContent=String(secs);
  var bar=$("sdtimerbar"); if(bar) bar.style.width=Math.max(0, Math.min(100, left*100/SPLIT_MS))+"%";
  box.classList.toggle("low", secs<=5);
  box.setAttribute("aria-label", secs+" seconds left");
}
function ensureTick(){
  var want=!!(table&&table.step==="answer"&&meta&&meta.status==="play");
  if(want&&!tickTimer){
    var wasLate=timeLeft()<=0;
    tickTimer=setInterval(function(){
      paintTimer();
      var late=timeLeft()<=0;
      if(late!==wasLate){wasLate=late; render()}
      else if(late&&isHost()) hostThink();
    }, 250);
  }
  if(!want&&tickTimer){clearInterval(tickTimer); tickTimer=0}
}
function paintWho(){
  var list=$("sdwho"); if(!list) return;
  list.textContent="";
  var on=!!(table&&table.step==="answer");
  list.classList.toggle("hide", !on);
  if(!on) return;
  parseCsv(table.order).forEach(function(id){
    var v=tally[id], li=el("li", "sd-who-item"+(v===3?" done":v===1?" half":""));
    li.appendChild(el("span", "sd-who-mark", v===3?"✓":v===1?"…":""));
    li.appendChild(el("span", "sd-who-name", pname(id)));
    li.setAttribute("aria-label", pname(id)+(v===3?" is in":v===1?" is guessing":" is thinking"));
    list.appendChild(li);
  });
}
function reduced(){try{return matchMedia("(prefers-reduced-motion: reduce)").matches}catch(e){return false}}
function countUp(node, from, to, delay, sign){
  var fmt=function(v){return (sign&&v>0?"+":"")+v};
  if(reduced()||from===to){node.textContent=fmt(to); return}
  node.textContent=fmt(from);
  setTimeout(function(){
    var t0=0, dur=700;
    function step(t){
      if(!t0) t0=t;
      var k=Math.min(1, (t-t0)/dur);
      node.textContent=fmt(Math.round(from+(to-from)*k));
      if(k<1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }, delay);
}
/* Rows the host stored for this game and round, keyed by uid. */
function storedRows(round){
  var out={}, gid=meta?+meta.gameId:0;
  Object.keys(cast).forEach(function(id){
    var d=L.decodeResult(cast[id]);
    if(d&&d.gameId===gid&&(round==null?d.round<=(+table.round||0):d.round===round)) out[id]=d;
  });
  return out;
}
function roundReady(){
  if(!table) return false;
  var rows=storedRows(+table.round||0), roster=parseCsv(table.order);
  return roster.length>0&&roster.every(function(id){return !!rows[id]});
}
var BADGE={"exact":"EXACT", "one-away":"ONE AWAY", "miss":"MISS", "missed":"MISSED"};
function badge(result, big){return el("span", "sd-badge sd-"+result+(big?" big":""), BADGE[result]||"MISS")}
function stage(node, d){node.classList.add("sd-step"); node.style.setProperty("--d", String(d)); return node}
function paintReveal(){
  var box=$("reveallist"); if(!box) return;
  var head=$("revealhead"), toast=$("toastline"), wrap=$("revealbox"), board=$("sdboard");
  var show=!!(table&&table.step==="results");
  if(wrap) wrap.classList.toggle("hide", !show);
  if(!show){box.textContent=""; if(board) board.textContent=""; if(head) head.textContent=""; if(toast) toast.textContent=""; revealKey=""; return}
  if(!roundReady()){
    if(revealKey!=="wait"){revealKey="wait"; box.textContent=""; if(board) board.textContent=""; if(head) head.textContent="Counting the split…"; if(toast) toast.textContent=""}
    return;
  }
  var key=meta.gameId+"/"+table.round;
  if(revealKey===key) return;
  revealKey=key;
  box.textContent=""; if(head) head.textContent="";
  paintSplitReveal(box);
  if(toast){toast.textContent="Optional: a small drink, or skip it. Whoever picked the minority side takes a bow instead."; stage(toast, 3.4)}
  if(board) paintBoard(board, 3.8);
}
function paintSplitReveal(box){
  var round=+table.round||0, roster=parseCsv(table.order), rows=storedRows(round), card=currentCard();
  var a=0, b=0;
  roster.forEach(function(id){if(rows[id].answer==="A") a++; else if(rows[id].answer==="B") b++});
  var answered=a+b, pct=answered?Math.round(a*100/answered):0;
  var mineRow=rows[uid];
  if(mineRow){
    var me=stage(el("section", "sd-me"), 0);
    me.appendChild(el("p", "sd-me-label", "Your result"));
    me.appendChild(badge(mineRow.result, true));
    var pts=el("p", "sd-me-pts"), n=el("span", "sd-me-num", "0");
    pts.appendChild(n); pts.appendChild(document.createTextNode(mineRow.points===1?" point":" points"));
    me.appendChild(pts);
    box.appendChild(me);
    countUp(n, 0, mineRow.points, 400, true);
  }
  var split=stage(el("section", "sd-split"), 0.7);
  split.appendChild(el("p", "sd-split-q", card?card.q:""));
  split.appendChild(el("p", "sd-split-count", "A "+a+" · B "+b));
  var bar=el("div", "sd-bar"); bar.setAttribute("role", "img"); bar.setAttribute("aria-label", pct+"% picked A");
  var fill=el("span", "sd-bar-a"); fill.style.setProperty("--pct", pct+"%");
  bar.appendChild(fill); split.appendChild(bar);
  var legend=el("div", "sd-legend");
  legend.appendChild(el("span", "", "A "+pct+"%"+(card?" · "+card.a:"")));
  legend.appendChild(el("span", "", "B "+(answered?100-pct:0)+"%"+(card?" · "+card.b:"")));
  split.appendChild(legend);
  box.appendChild(split);
  var cards=el("div", "sd-cards");
  roster.slice().sort(function(x, y){return (x===uid?-1:0)-(y===uid?-1:0)}).forEach(function(id, i){
    var r=rows[id], c=stage(el("article", "sd-pcard"+(id===uid?" me":"")), 1.4+i*0.12);
    c.appendChild(el("p", "sd-pname", pname(id)));
    c.appendChild(el("p", "sd-pline", r.answer?("Picked "+r.answer+" · guessed "+(r.prediction==null?"—":r.prediction)):"No answer"));
    var foot=el("div", "sd-pfoot");
    foot.appendChild(badge(r.result, false));
    var p=el("span", "sd-ppts", "0"); foot.appendChild(p);
    c.appendChild(foot);
    cards.appendChild(c);
    countUp(p, 0, r.points, (2.2+i*0.12)*1000, true);
  });
  box.appendChild(cards);
  if(mineRow) box.appendChild(stage(el("p", "sd-quip", L.quipFor(mineRow.result, meta.gameId+"/"+round+"/"+uid)), 3));
}
function boardEntries(){
  var round=+table.round||0, rows=storedRows(null);
  return Object.keys(rows).filter(function(id){return players[id]||parseCsv(table.order).indexOf(id)>=0}).map(function(id){
    var d=rows[id];
    return {id:id, name:pname(id), total:d.total, points:d.round===round?d.points:0, exact:d.exact, hits:d.hits, played:d.played, streak:d.round===round?d.streak:0};
  });
}
function paintBoard(board, delay){
  board.textContent="";
  var list=L.rankBoard(boardEntries(), (+table.round||0)===0);
  if(!list.length) return;
  var wrap=stage(el("section", "sd-board"), delay);
  wrap.appendChild(el("h2", "sd-board-h", "Leaderboard"));
  var ol=el("ol", "sd-rows");
  list.forEach(function(e){
    var li=el("li", "sd-row"+(e.leader?" leader":"")+(e.mover?" mover":"")+(e.id===uid?" me":""));
    li.dataset.prev=String(e.prevIndex);
    li.appendChild(el("span", "sd-rank", String(e.rank)));
    var who=el("span", "sd-rname"); who.appendChild(el("span", "", e.name));
    if(e.leader) who.appendChild(el("span", "sd-tag", "Leader"));
    if(e.mover) who.appendChild(el("span", "sd-tag mover", "▲"+e.moved+" biggest mover"));
    li.appendChild(who);
    var tot=el("span", "sd-total", String(e.total)); li.appendChild(tot);
    var stats=el("span", "sd-stats");
    stats.appendChild(el("span", "sd-delta", (e.points>0?"+":"")+e.points+" this round"));
    stats.appendChild(el("span", "", e.exact+" exact"));
    stats.appendChild(el("span", "", e.accuracy+"% close"));
    stats.appendChild(el("span", "", e.streak?("streak "+e.streak):"no streak"));
    li.appendChild(stats);
    ol.appendChild(li);
    countUp(tot, e.total-e.points, e.total, delay*1000+500, false);
  });
  wrap.appendChild(ol);
  board.appendChild(wrap);
  if(reduced()) return;
  /* Slide each row from last round's place to its new one. */
  setTimeout(function(){
    var items=Array.prototype.slice.call(ol.children);
    items.forEach(function(li, i){
      var from=+li.dataset.prev;
      if(!isFinite(from)||from===i) return;
      li.style.transition="none";
      li.style.transform="translateY("+((from-i)*li.offsetHeight)+"px)";
    });
    void ol.offsetHeight;
    items.forEach(function(li){li.style.transition=""; li.style.transform=""});
  }, delay*1000+450);
}
function paintAwards(){
  var box=$("awards"); if(!box) return;
  box.textContent="";
  var over=table&&table.step==="over";
  var finale=$("finale"); if(finale) finale.classList.toggle("hide", !over);
  if(!over) return;
  var n=meta&&meta.deck?(Array.isArray(meta.deck)?meta.deck.length:Object.keys(meta.deck).length):8;
  var line=$("recapline"); if(line) line.textContent=(TITLES[GAME]||"This game")+", "+n+" rounds";
  var totals=storedRows(null);
  var list=orderPlayers().map(function(p){return Object.assign({}, p, {points:totals[p.uid]?totals[p.uid].total:0})});
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
  if($("card")) $("card").classList.toggle("hide", table.step==="results");
  paintChoices();
  paintTimer();
  paintWho();
  paintReveal();
  paintAwards();
  if(window.SplitFX) SplitFX.show(table.step==="answer"?"tension-loop":table.step==="results"?"reveal-burst":table.step==="over"?"winner-celebrate":"");
  var ids=[], pred=function(){return false};
  if(table.step==="answer"){ids=parseCsv(table.order); pred=function(id){return tally[id]===3}}
  var prog=countProgress(ids, pred);
  document.body.setAttribute("data-rm-allin", prog.total&&prog.done>=prog.total?"1":"0");
  if($("progress")) $("progress").textContent=table.step==="results"||table.step==="over"?"":(prog.total?prog.done+" of "+prog.total+" in":"");
  var reveal=$("revealbtn"), next=$("nextround"), retry=$("retrybtn"), deal=$("dealbtn");
  if(reveal) reveal.classList.toggle("hide", !isHost()||(table.step!=="answer"&&table.step!=="vote"));
  if(next){
    next.classList.toggle("hide", !isHost()||table.step!=="results");
    next.textContent=moreAfter()?"Continue":"See the result";
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
    ensureTick();
    if(window.SplitFX) SplitFX.show("");
    screen("lobby"); paintLobby();
    maybeResetScores();
    return;
  }
  screen("table");
  mountRestart();
  if(table) paintTable();
  ensureTick();
  hostScore();
  hear();
  if(isHost()) hostThink();
}
function hear(){
  if(!table) return;
  var key=String(table.seq)+":"+table.step;
  if(heard===key) return;
  heard=key;
  if(table.step==="answer") blip("roll");
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
/* Host only: score the round once and store one row per player.
   Round-number guard: if this round's rows are already stored, nothing is written. */
function hostScore(){
  if(!isHost()||!table||table.step!=="results"||!secretsLoaded||!castLoaded||!uid) return;
  var gid=+meta.gameId, round=+table.round||0, token=gid+"/"+round;
  if(scoredFor===token) return;
  var roster=parseCsv(table.order);
  var done=storedRows(round);
  if(Object.keys(done).length){scoredFor=token; return}
  scoredFor=token;
  var bag=shownSecrets();
  var scored=L.scoreRound(roster.map(function(id){var s=L.parseSplitSeal(bag[id]); return {id:id, answer:s.pref, prediction:s.pred}}));
  var prev={};
  Object.keys(cast).forEach(function(id){var d=L.decodeResult(cast[id]); if(d&&d.gameId===gid&&d.round<round) prev[id]=d});
  var stats=L.nextStats(prev, scored);
  var payload={};
  scored.rows.forEach(function(r){payload[rpath("nhie/cast/"+r.id)]=L.encodeResult(gid, round, r, stats[r.id])});
  update(ref(db), payload).catch(function(e){if(scoredFor===token) scoredFor=""; fail(friendly(e))});
}
/* First answer wins: once a pick or a guess is stored, later taps are ignored. */
function submitValue(value){
  if(!table||!meta||sending||table.step!=="answer") return;
  if(parseCsv(table.order).indexOf(uid)<0||timeLeft()<=0) return;
  var round=+table.round||0, gid=meta.gameId;
  var mine=L.parseSplitSeal(secrets[uid]), seal, mark;
  if(secrets[uid]==="pass") return;
  if(!mine.pref){
    if(value==="pass"){seal="pass"; mark=3} /* a pass is a no-answer: scored as missed, and the round doesn't wait */
    else if(value==="A"||value==="B"){seal=value; mark=1}
    else return;
  }else if(mine.pred==null){
    var n=+value, max=parseCsv(table.order).length-1;
    if(!/^\d+$/.test(String(value))||n>max) return;
    seal=L.encodeSplitSeal(mine.pref, n); mark=3;
  }else return;
  sending=true;
  blip("yes");
  secrets[uid]=seal;
  var payload={};
  payload[rpath("sealed/"+gid+"/"+round+"/"+uid)]=seal;
  payload[rpath("tally/"+gid+"/"+round+"/"+uid)]=mark;
  render();
  update(ref(db), payload).then(function(){sending=false; render()}).catch(function(e){sending=false; secrets[uid]=mine.pref?L.encodeSplitSeal(mine.pref, mine.pred):""; if(!secrets[uid]) delete secrets[uid]; render(); fail(friendly(e))});
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
  if(table.step!=="answer") return;
  var action=null;
  if(GAME==="split") action=splitAuto();
  if(!action) return;
  if(hostSig===action.sig) return;
  hostSig=action.sig;
  hostLock=true;
  action.run().then(function(){hostLock=false}, function(e){hostLock=false; hostSig=""; fail(friendly(e))});
}
/* Reveal when every connected player has picked and guessed, or when the clock runs out.
   A player who answered and then dropped keeps their answer in the count. */
function splitAuto(){
  if(table.step!=="answer") return null;
  var roster=parseCsv(table.order);
  var everyone=allDone(roster, function(id){return tally[id]===3});
  if(!everyone&&timeLeft()>0) return null;
  return {sig:"split-reveal-"+meta.gameId+"-"+table.round, run:function(){return revealWith(playObj({step:"results", kind:"have", text:"s|done"}))}};
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
  if(!isHost()||!table||table.step!=="answer") return;
  unlock();
  hostLock=true;
  Promise.resolve(revealWith(playObj({step:"results", text:"s|done", kind:"have"}))).then(function(){hostLock=false}, function(e){hostLock=false; fail(friendly(e))});
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
  castLoaded=false; cast={};
  stops.push(onValue(ref(db, rpath("nhie/cast")), function(s){cast=s.val()||{}; castLoaded=true; render()}, function(){}));
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
  if(tickTimer){clearInterval(tickTimer); tickTimer=0}
  scoredFor=""; revealKey="";
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
  if($("revealbtn")) $("revealbtn").addEventListener("click", forceReveal);
  if($("nextround")) $("nextround").addEventListener("click", goNext);
  if($("again")) $("again").addEventListener("click", function(){rematch().catch(function(e){fail(friendly(e))})});
  if($("recap")) $("recap").addEventListener("click", function(){shareRecap()});
  if($("close")) $("close").addEventListener("click", askClose);
  if($("closestage")) $("closestage").addEventListener("click", askClose);
  if($("leavebtn")) $("leavebtn").addEventListener("click", leaveRoom);
  if($("passbtn")) $("passbtn").addEventListener("click", function(){submitValue("pass")});
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
