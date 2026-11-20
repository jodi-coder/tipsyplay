(function(){
"use strict";
/* Five Letter Frenzy, one phone per player. rooms/$code/fl
   The host's phone runs the round with FrenzyLogic and publishes only what everyone may see (fl/pub).
   The secret word is chosen by api/frenzy-word.php and never stored in Firebase or in this phone's
   game state. The script returns marks. The word comes back only when the round is over.
   A per-round token stays in this browser's sessionStorage. It is not written to Firebase.
   Drinking is opt-in, the same idea as the games already on the site:
   Odd Word Out (games/odd-word-out.html) has no per-player box; the host picks Drinks, Shots, or No drinking.
   Split Decision (games/split-decision.html) has the host tick "We're in. The game keeps score in points."
   Here the host has a Points only toggle for the table, and each player has "Points only for me".
   Either one skips the drink prompt. Pass is always on the prompt. Nothing stacks. */
var L=window.FrenzyLogic;
var WORDS=window.FRENZY_WORDS||{answers:[], guesses:[]};
if(L) L.useWords(WORDS);
var FAST=/[?&]emulator=1(?:&|$)/.test(location.search)&&/[?&]fast=1(?:&|$)/.test(location.search);
var AWAY=FAST&&L?L.FAST_IDLE_MS:L?L.IDLE_MS:120000;
var ALPHABET="ABCDEFGHJKMNPQRSTUVWXYZ";
var $=function(id){return document.getElementById(id)};
var uid=null, code=null, meta=null, players={}, pub=null, D=null;
var pointsOnly=false, dryMe=false, sending=false, serverOffset=0, offsetReady=false;
var db, stops=[], hostStops=[], connStop=null, bootTimer=0, tickTimer=0, beatTimer=0;
var ref, onValue, update, set, remove, onDisconnect, get, serverTimestamp, goOnline;
var G=null, guessMap={}, actMap={}, hostLock=false, beat=0, hostAwaySince=0, claiming=false, seenInput={}, roundToken="";
var claimLog=[], lastSeq=-1, lastPhase="";
/* Sound and motion. Everything below only decorates the screen: it never changes the round or delays input.
   Animations are worked out from their start time, so a redraw part-way through carries on instead of restarting. */
var FX=window.FrenzyFX||null;
var STEP=FX?FX.STEP_MS:120, FLIP=FX?FX.FLIP_MS:320, ROW_MS=4*STEP+FLIP;
var anim={reveal:null, bounce:null, shake:null, pop:null, word:null};
var rowsKey="", rowsSeen=0, typedLen=0, turnKey="", promptKey="", introKey="", live=false, sawLobby=false;
var PROMPT="One small drink or a 5-second pose — or Pass.";

function serverNow(){return Date.now()+(offsetReady?serverOffset:0)}
function rpath(p){return "rooms/"+code+"/"+p}
var lobbyErr="";
function fail(msg){var p=$("perr"); if(p) p.textContent=msg||""; lobbyErr=msg||""}
function friendly(e){
  var c=String((e&&(e.code||e.message))||"");
  if(/permission|denied/i.test(c)) return "The server did not accept the game. The site owner needs to publish the latest firebase-rules.json, then try again.";
  if(/offline|network|fetch/i.test(c)) return "You're offline. Check the connection and try again.";
  return "Something went wrong. Try again.";
}
function isHost(){return !!(meta&&uid&&meta.hostUid===uid)}
function normCode(v){
  var s=String(v||""), m=s.match(/(?:room|code)=([A-Za-z]{4})/i);
  if(m) return m[1].toUpperCase();
  return s.toUpperCase().replace(/[^ABCDEFGHJKMNPQRSTUVWXYZ]/g,"").slice(0,4);
}
function validCode(c){return /^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(c)}
function makeRoomCode(){var s="", i; for(i=0;i<4;i++) s+=ALPHABET[L.randomInt(ALPHABET.length)]; return s}
function emuOn(){return /[?&]emulator=1(?:&|$)/.test(location.search)}
function queryRoom(){var m=String(location.search||"").match(/[?&](?:room|code)=([A-Za-z]{4})/i); var c=m?normCode(m[1]):""; return validCode(c)?c:""}
function forcedWord(){
  if(!emuOn()) return "";
  var m=String(location.search||"").match(/[?&]word=([A-Za-z]{5})/);
  if(!m) return "";
  var w=m[1].toLowerCase();
  return L.isAnswer(w)?w:"";
}
function wordApi(op, extra){
  var body=Object.assign({op:op, room:code, token:roundToken||""}, extra||{});
  if(op==="start"&&forcedWord()) body.testWord=forcedWord();
  var root=document.body.getAttribute("data-root")||"";
  return fetch(root+"api/frenzy-word.php", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)}).then(function(r){
    return r.json().then(function(j){ j.status=r.status; return j; }, function(){ return {ok:false, error:"The word keeper didn't answer.", status:r.status}; });
  }).catch(function(){ return {ok:false, error:"The word keeper didn't answer."}; });
}
function saveToken(token){
  roundToken=token||"";
  try{ if(roundToken) sessionStorage.setItem("tp_fl_token_"+code, roundToken); else sessionStorage.removeItem("tp_fl_token_"+code); }catch(e){}
}
function loadToken(){
  try{ roundToken=sessionStorage.getItem("tp_fl_token_"+code)||""; }catch(e){ roundToken=""; }
}
function roomUrl(c){
  if(window.TipsyJoinQR) return TipsyJoinQR.pageInvite("/games/five-letter-frenzy.html", c, "fl");
  return "https://tipsyplay.com/games/five-letter-frenzy.html?room="+c+"&game=fl";
}
function order(){
  return Object.keys(players).map(function(id){var p=players[id]; return {uid:id, name:p.name||"Player", connected:p.connected!==false, joinedAt:p.joinedAt||0, dry:!!p.dry}})
    .sort(function(a,b){return a.joinedAt-b.joinedAt||a.name.localeCompare(b.name)});
}
function nm(id){
  if(D&&D.names&&D.names[id]) return D.names[id];
  return (players[id]&&players[id].name)||"Player";
}
function connMap(){var m={}; order().forEach(function(p){m[p.uid]=p.connected!==false}); return m}
function screen(id){["home","lobby","table","closed"].forEach(function(s){var n=$(s); if(n) n.classList.toggle("hide", s!==id)})}
function show(id, on){var n=$(id); if(n) n.classList.toggle("hide", !on)}
function el(tag, cls, text){var n=document.createElement(tag); if(cls) n.className=cls; if(text!=null) n.textContent=text; return n}
function fx(name, a, b){if(!FX||typeof FX[name]!=="function") return; try{FX[name](a, b)}catch(e){}}
function still(){return !FX||FX.reduced()}
function repaintLater(ms){setTimeout(function(){if(pub&&D) paintGrid()}, Math.max(0, ms))}
/* the animation delay that resumes an animation already "ms" in, or waits "ms" before it starts */
function delayFor(startAt){return (startAt-Date.now())+"ms"}
function roundKey(){return (code||"")+"|"+(meta&&meta.gameId)}
/* A new row arrived: flip it in, with one note per tile; an all-locked row also gets the bounce, confetti and arpeggio. */
function watchRows(){
  var rows=(D&&D.guesses)||[], key=roundKey();
  if(key!==rowsKey){rowsKey=key; rowsSeen=rows.length; return}
  if(rows.length<=rowsSeen){rowsSeen=rows.length; return}
  var r=rows.length-1, marks=rows[r].marks||[], now=Date.now();
  rowsSeen=rows.length;
  var solved=marks.length===5&&marks.every(function(m){return m==="locked"});
  fx("reveal", marks);
  if(solved) fx("solved", ROW_MS);
  if(still()) return;
  anim.reveal={row:r, t0:now};
  marks.forEach(function(m, i){repaintLater(i*STEP+FLIP/2+5)});
  repaintLater(ROW_MS+20);
  if(solved){
    anim.bounce={row:r, t0:now+ROW_MS};
    repaintLater(ROW_MS+5); repaintLater(ROW_MS+5*80+460);
    setTimeout(function(){
      if(FX&&typeof FX.playWin==="function"){
        FX.playWin(function(){fx("confetti")});
      }else fx("confetti");
    }, ROW_MS+350);
  }
}
function buzz(ms){
  try{if(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches) return; if(navigator.vibrate) navigator.vibrate(ms||12)}catch(e){}
}
function parseTagged(v){var s=String(v||""), i=s.lastIndexOf(":"); if(i<0) return null; return {v:s.slice(0,i), seq:+s.slice(i+1)}}
function dupName(list){
  var seen={}, d="";
  list.forEach(function(p){var k=L.cleanName(p.name).toLowerCase(); if(seen[k]) d=p.name; seen[k]=1});
  return d;
}

function render(){
  if(pub&&D){watchRows(); watchTurn()}
  document.body.classList.toggle("is-host", isHost());
  document.querySelectorAll(".hostonly").forEach(function(n){n.classList.toggle("hide", !isHost())});
  show("finale", false);
  if(!meta){screen("home"); return}
  if(meta.status==="lobby"||!pub||!D){screen("lobby"); paintLobby(); return}
  if(pub.phase==="end"||meta.status==="over"){screen("table"); paintEnd(); return}
  screen("table"); paintTable();
  var rk=roundKey();
  if(sawLobby&&introKey!==rk&&pub.phase==="guess"&&((D.guesses||[]).length===0)){
    introKey=rk;
    if(FX&&typeof FX.playIntro==="function"){
      FX.playIntro(function(){if(pub&&pub.turn===uid&&pub.phase==="guess"){try{$("guess").focus()}catch(e){}}});
    }
  }
}
function paintLobby(){
  $("codebig").textContent=code||"";
  $("sharelink").textContent=roomUrl(code);
  var list=order(), box=$("plist"); box.textContent="";
  list.forEach(function(p){
    var row=el("div", "fl-person"+(p.connected?"":" off"));
    row.appendChild(el("span", null, p.name+(p.uid===meta.hostUid?" · host":"")+(p.dry?" · points":"")));
    row.appendChild(el("span", null, p.connected?"":"away"));
    if(isHost()&&p.uid!==uid){
      var kick=el("button", "x", "Remove"); kick.type="button"; kick.setAttribute("aria-label", "Remove "+p.name);
      kick.addEventListener("click", function(){remove(ref(db, rpath("players/"+p.uid))).catch(function(e){fail(friendly(e))})});
      row.appendChild(kick);
    }
    box.appendChild(row);
  });
  var on=!!(meta&&meta.na);
  var chip=$("pointsonly");
  if(chip){chip.setAttribute("aria-pressed", on?"true":"false"); chip.disabled=!isHost()}
  $("pointsnote").textContent=on?"Points only. A miss just moves the turn. Nobody is asked to drink or pose.":"A miss is one small drink, a 5-second pose, or Pass. Nothing stacks.";
  var mineDry=!!(players[uid]&&players[uid].dry)||dryMe;
  if($("dryme")) $("dryme").checked=mineDry;
  if($("dryme2")) $("dryme2").checked=mineDry;
  var n=list.length, dup=dupName(list);
  var start=$("start"); start.disabled=!isHost()||n<L.MIN_PLAYERS||n>L.MAX_PLAYERS||!!dup;
  start.textContent="Start game · "+n+" player"+(n===1?"":"s");
  var note=$("lobbynote");
  note.classList.toggle("err", !!lobbyErr);
  if(lobbyErr) note.textContent=lobbyErr;
  else if(n<L.MIN_PLAYERS) note.textContent="Need "+(L.MIN_PLAYERS-n)+" more player"+(L.MIN_PLAYERS-n===1?"":"s")+".";
  else if(n>L.MAX_PLAYERS) note.textContent="8 players max.";
  else if(dup) note.textContent="Two players are called "+dup+". One of you, rejoin with another name.";
  else note.textContent=isHost()?"Everyone in? The word is picked for the table, and you play too.":"You're in. The host starts when the table is ready.";
}
function paintTable(){
  paintGrid();
  paintTurn();
  var mine=pub.turn===uid, paused=!!pub.paused;
  var showPrompt=mine&&!paused&&pub.phase==="prompt";
  var solving=mine&&!paused&&pub.phase==="handoff"&&!(D&&D.handTo);
  var handed=mine&&!paused&&pub.phase==="handoff"&&D&&D.handTo===uid;
  show("guessform", mine&&!paused&&pub.phase==="guess");
  show("promptbox", showPrompt||handed);
  show("handbox", solving);
  if(showPrompt||handed){
    $("prompttext").textContent=PROMPT; bringIntoView($("promptbox"));
    var pk=roundKey()+"|"+pub.seq+"|"+pub.phase;
    if(promptKey!==pk){var first=!promptKey; promptKey=pk; if(live||!first) fx("clink")}
  }
  if(solving){paintHands(); bringIntoView($("handbox"))}
  paintActLine();
  paintHostTools();
  var legend=$("legend"); if(legend&&!legend.childElementCount) paintLegend(legend);
}
function paintLegend(box){
  [["lock","●","Right place"],["move","↗","Wrong place"],["miss","×","Not in the word"]].forEach(function(item){
    var li=el("li", "fl-key");
    li.appendChild(el("span", "fl-swatch "+item[0], item[1]));
    li.appendChild(el("span", null, item[2]));
    box.appendChild(li);
  });
}
function bringIntoView(node){
  if(!node||!pub) return;
  var key=String(pub.seq)+(pub.phase||"");
  if(node.dataset.seen===key) return;
  node.dataset.seen=key;
  try{node.scrollIntoView({block:"center", behavior:"auto"})}catch(e){}
}
function paintGrid(){
  var box=$("grid"); box.textContent="";
  var rows=(D&&D.guesses)||[];
  var typing=pub&&pub.phase==="guess"&&pub.turn===uid&&!pub.paused?L.normalize($("guess").value).slice(0,5):"";
  var slots=(pub&&pub.phase==="end")?Math.max(rows.length,1):L.MAX_GUESSES;
  var r, row, i, cell, marks, word, ch;
  for(r=0;r<slots;r++){
    row=el("div", "fl-row");
    if(rows[r]){
        word=rows[r].word; marks=rows[r].marks;
      var rv=anim.reveal&&anim.reveal.row===r?anim.reveal:null, bo=anim.bounce&&anim.bounce.row===r?anim.bounce:null, now=Date.now();
      for(i=0;i<5;i++){
        var kind=marks[i]==="locked"?"lock":marks[i]==="moved"?"move":"miss";
        var flipAt=rv?rv.t0+i*STEP:0, turned=!rv||now>=flipAt+FLIP/2;
        /* before its turn comes, a tile shows its letter on white; the mark and colour land at the half-way point of the flip */
        cell=el("div", "fl-tile "+(turned?kind:"fl-pend"));
        if(rv&&now<flipAt+FLIP){cell.classList.add("fl-flip"); cell.style.animationDelay=delayFor(flipAt)}
        else if(bo&&now<bo.t0+i*80+460){cell.classList.add("fl-hop"); cell.style.animationDelay=delayFor(bo.t0+i*80)}
        if(turned) cell.appendChild(el("span", "fl-mark", marks[i]==="locked"?"●":marks[i]==="moved"?"↗":"×"));
        cell.appendChild(el("span", "fl-letter", word[i].toUpperCase()));
        cell.setAttribute("aria-label", word[i].toUpperCase()+", "+(marks[i]==="locked"?"right place":marks[i]==="moved"?"wrong place":"not in the word"));
        row.appendChild(cell);
      }
    }else if(r===rows.length&&(typing||anim.shake)){
      var sh=anim.shake, pp=anim.pop, t=Date.now();
      if(sh&&t<sh.t0+380){row.classList.add("fl-shake"); row.style.animationDelay=delayFor(sh.t0)}
      for(i=0;i<5;i++){
        ch=typing[i]||"";
        cell=el("div", "fl-tile"+(ch?"":" empty"));
        if(ch&&pp&&pp.i===i&&t<pp.t0+160){cell.classList.add("fl-pop"); cell.style.animationDelay=delayFor(pp.t0)}
        cell.appendChild(el("span", "fl-letter", ch.toUpperCase()));
        row.appendChild(cell);
      }
    }else{
      for(i=0;i<5;i++) row.appendChild(el("div", "fl-tile empty", ""));
    }
    box.appendChild(row);
  }
}
function paintTurn(){
  var label=$("turnlabel"), paused=!!pub.paused, text="", who="";
  if(paused) text="Paused";
  else if(pub.phase==="guess"||pub.phase==="prompt"||pub.phase==="handoff"){
    if(pub.turn===uid) text="Your turn"; else{text="Waiting for "; who=nm(pub.turn)}
  }
  var key=text+"|"+who;
  if(label.dataset.key===key) return;
  label.dataset.key=key; label.textContent=text;
  /* other phones see whose turn it is with a small highlight on the name */
  if(who) label.appendChild(el("span", "fl-who", who));
  label.classList.remove("fl-in");
  if(text==="Your turn"&&!still()){void label.offsetWidth; label.classList.add("fl-in")}
}
/* The turn arrives on this phone: a light chime, once per turn, never on a reload. */
function watchTurn(){
  if(!pub||!D) return;
  var key=roundKey()+"|"+pub.turn+"|"+((D.guesses||[]).length);
  var mine=pub.turn===uid&&pub.phase==="guess"&&!pub.paused;
  if(key===turnKey) return;
  var was=turnKey; turnKey=key;
  typedLen=0; anim.pop=null; anim.shake=null;
  /* no chime on a reload: only when this phone saw the turn change, or saw the round start from the lobby */
  if(mine&&(was||sawLobby)) fx("turn");
}
function paintHands(){
  var box=$("handlist"); box.textContent="";
  (D.order||[]).forEach(function(u){
    if(u===uid) return;
    var b=el("button", "btn alt fl-hand"); b.type="button"; b.textContent=nm(u);
    b.addEventListener("click", function(){sendHand(u)});
    box.appendChild(b);
  });
}
function paintActLine(){
  var line=$("actline"), log=D&&D.log||[], last=log[log.length-1];
  if(!last){line.textContent=""; return}
  var who=nm(last.uid);
  if(last.kind==="drink") line.textContent=who+" is having one small drink.";
  else if(last.kind==="pose") line.textContent=who+" is holding a 5-second pose.";
  else line.textContent=who+" passed.";
}
function paintHostTools(){
  show("hosttools", isHost());
  if(!isHost()) return;
  $("pausebtn").textContent=pub.paused?"Resume":"Pause";
}
function paintEnd(){
  show("finale", true);
  show("guessform", false); show("promptbox", false); show("handbox", false); show("hosttools", false);
  var word=(D&&D.word)||"";
  if($("turnlabel")){$("turnlabel").textContent=word?word.toUpperCase():""; $("turnlabel").dataset.key=""; $("turnlabel").classList.remove("fl-in")}
  if($("actline")) $("actline").textContent="";
  paintGrid();
  var box=$("awards"); box.textContent="";
  var awards=D&&D.awards;
  bringIntoView($("finale"));
  var wp=el("p", "fl-word");
  if(word){
    wp.setAttribute("aria-label", word.toUpperCase());
    word.toUpperCase().split("").forEach(function(c, i){
      var t=el("span", "fl-wtile", c); t.setAttribute("aria-hidden", "true");
      if(anim.word&&Date.now()<anim.word+i*160+420){t.classList.add("fl-wflip"); t.style.animationDelay=delayFor(anim.word+i*160)}
      wp.appendChild(t);
    });
  }
  box.appendChild(wp);
  show("sharecard", !!(FX&&D&&D.guesses&&D.guesses.length));
  if(!awards) return;
  if(awards.solvedBy) box.appendChild(el("p", "fl-award", "Solved it: "+nm(awards.solvedBy)));
  else box.appendChild(el("p", "fl-award", "The word"));
  var most=awards.mostLocks||{uids:[], count:0};
  if(most.count>0) box.appendChild(el("p", "fl-award", "Most locked letters: "+most.uids.map(nm).join(", ")+" ("+most.count+")"));
  if(awards.closest) box.appendChild(el("p", "fl-award", "Closest miss: "+nm(awards.closest.uid)+" · "+awards.closest.word.toUpperCase()));
  var ol=el("ol", "fl-stand");
  (D.order||[]).forEach(function(u){
    var li=el("li", null);
    var sc=(D.score&&D.score[u])||0;
    li.appendChild(el("span", null, nm(u)));
    li.appendChild(el("span", null, sc+" pt"+(sc===1?"":"s")));
    ol.appendChild(li);
  });
  box.appendChild(ol);
}

function sendGuess(word){
  if(!pub||pub.phase!=="guess"||pub.turn!==uid||pub.paused) return;
  var err=L.guessError(word, (D&&D.guesses)||[]);
  if(err){
    fail(err); fx("reject");
    if(!still()){anim.shake={t0:Date.now()}; paintGrid(); repaintLater(400)}
    return;
  }
  fail("");
  if($("guess")) $("guess").value="";
  typedLen=0; anim.pop=null; anim.shake=null;
  buzz(12);
  set(ref(db, rpath("fl/guess/"+uid)), L.normalize(word)+":"+pub.seq).catch(function(e){fail(friendly(e))});
}
function sendAct(kind){
  if(!pub||pub.turn!==uid||pub.paused) return;
  if(pub.phase!=="prompt"&&pub.phase!=="handoff") return;
  set(ref(db, rpath("fl/act/"+uid)), kind+":"+pub.seq).catch(function(e){fail(friendly(e))});
}
function sendHand(target){
  if(!pub||pub.phase!=="handoff"||pub.turn!==uid||pub.paused) return;
  set(ref(db, rpath("fl/act/"+uid)), "hand:"+target+":"+pub.seq).catch(function(e){fail(friendly(e))});
}

function metaObj(patch){
  var m=Object.assign({}, meta||{}, patch||{});
  var status=m.status||"lobby", over=status==="over", play=status==="play"||over;
  var out={
    hostUid:m.hostUid, createdAt:m.createdAt, status:status,
    phase:over?"over":(play?"answer":"lobby"),
    spice:"mild", rounds:10, na:!!m.na, round:0, gameId:+m.gameId||1, kind:"fl"
  };
  if(typeof m.flStart==="number") out.flStart=m.flStart;
  if(play) out.deck=["Frenzy"];
  if(over) out.endedAt=m.endedAt||serverNow();
  return out;
}
function publishFromG(clear){
  if(!G||!code) return Promise.resolve(false);
  var prep=(G.phase==="end"&&!G.word)?wordApi("reveal").then(function(res){ if(res&&res.word&&G) G.word=res.word; }):Promise.resolve();
  return prep.then(function(){ if(!G||!code) return false; return writePub(clear); });
}
function writePub(clear){
  if(!G||!code) return Promise.resolve(false);
  var seq=(pub?pub.seq:0)+1;
  var pubObj={phase:G.phase, seq:seq, opened:serverNow(), paused:!!G.paused, data:JSON.stringify(L.publicView(G))};
  if(G.turn) pubObj.turn=G.turn;
  var payload={};
  payload[rpath("fl/pub")]=pubObj;
  if(!window.__tpFrenzyHoldBeat) payload[rpath("fl/beat")]=serverTimestamp();
  (clear||[]).forEach(function(p){payload[rpath(p)]=null});
  if(G.phase==="end") payload[rpath("meta")]=metaObj({status:"over", phase:"over", endedAt:serverNow()});
  hostLock=true;
  return update(ref(db), payload).then(function(){hostLock=false; return true}).catch(function(e){hostLock=false; fail(friendly(e)); return false});
}
function begin(){
  if(!isHost()||sending) return;
  var list=order();
  if(list.length<L.MIN_PLAYERS||list.length>L.MAX_PLAYERS){fail("Need 3 to 8 players."); return}
  if(dupName(list)){fail("Two players share a name."); return}
  sending=true; fail(""); seenInput={};
  var starter=(+meta.flStart||0);
  wordApi("start").then(function(res){
    if(!res||!res.ok||!res.token){sending=false; fail(res&&res.error||"Couldn't lock a word."); return}
    saveToken(res.token);
    try{G=L.newRound(list.map(function(p){return {uid:p.uid, name:p.name, dry:!!p.dry}}), {word:"", pointsOnly:!!(meta.na), starter:starter})}
    catch(e){sending=false; fail("Couldn't start the round."); return}
    var seq=1;
    var pubObj={phase:G.phase, seq:seq, opened:serverNow(), paused:false, turn:G.turn, data:JSON.stringify(L.publicView(G))};
    var payload={};
    payload[rpath("meta")]=metaObj({status:"play", phase:"answer", na:!!meta.na, flStart:starter});
    payload[rpath("fl/pub")]=pubObj;
    payload[rpath("fl/beat")]=serverTimestamp();
    hostLock=true;
    update(ref(db), payload).then(function(){hostLock=false; sending=false}).catch(function(e){hostLock=false; sending=false; G=null; fail(friendly(e))});
  });
}
function applyGuess(who, raw){
  var key="g|"+who+"|"+raw;
  if(seenInput[key]||hostLock) return;
  var t=parseTagged(raw);
  if(!t||t.seq!==pub.seq) return;
  seenInput[key]=1;
  hostLock=true;
  var connected=connMap();
  wordApi("guess", {guess:t.v, n:G.guesses.length}).then(function(res){
    hostLock=false;
    if(!res||!res.ok||!res.marks){fail(res&&res.error||"That guess was refused."); return}
    if(res.word) G.word=res.word;
    if(res.seal) G.seal={text:res.seal, sig:res.sig||""};
    var r=L.applyMarkedGuess(G, who, t.v, res.marks, connected, !!(players[who]&&players[who].dry));
    if(!r||!r.ok) return;
    publishFromG(["fl/guess/"+who]);
  });
}
function applyAct(who, raw){
  var key="a|"+who+"|"+raw;
  if(seenInput[key]) return;
  var t=parseTagged(raw);
  if(!t||t.seq!==pub.seq||who!==G.turn){return}
  var connected=connMap(), ok=false;
  if(G.phase==="prompt"&&/^(drink|pose|pass)$/.test(t.v)) ok=L.choose(G, who, t.v, connected).ok;
  else if(G.phase==="handoff"&&t.v.indexOf("hand:")===0) ok=L.hand(G, who, t.v.slice(5), connected).ok;
  else if(G.phase==="handoff"&&t.v==="pass"&&!G.handTo) ok=L.hand(G, who, null, connected).ok;
  else if(G.phase==="handoff"&&G.handTo&&/^(drink|pose|pass)$/.test(t.v)) ok=L.answerHand(G, who, t.v).ok;
  if(!ok){seenInput[key]=1; return}
  publishFromG(["fl/act/"+who]);
}
function syncRoster(){
  if(!isHost()||!G||hostLock||G.phase==="end") return;
  var live={};
  Object.keys(players).forEach(function(id){live[id]=1});
  var gone=G.order.filter(function(u){return !live[u]});
  if(!gone.length) return;
  gone.forEach(function(u){L.removePlayer(G, u, connMap())});
  publishFromG();
}
function hostTick(){
  if(!isHost()||!G||!pub||hostLock||G.phase==="end") return;
  if(G.paused) return;
  var connected=connMap();
  if(L.skipDisconnected(G, connected)){publishFromG(); return}
  if(pub.phase==="guess"&&guessMap[pub.turn]) applyGuess(pub.turn, guessMap[pub.turn]);
  else if((pub.phase==="prompt"||pub.phase==="handoff")&&actMap[pub.turn]) applyAct(pub.turn, actMap[pub.turn]);
}
function resumeHost(){
  if(!isHost()||!pub||!D) return;
  loadToken();
  G={
    players:(D.order||[]).map(function(u){return {uid:u, name:(D.names&&D.names[u])||"Player", dry:!!(players[u]&&players[u].dry)}}),
    order:(D.order||[]).slice(), word:D.word||"", pointsOnly:!!D.pointsOnly, starter:D.starter||0,
    guesses:D.guesses||[], phase:pub.phase, turn:pub.turn||"", paused:!!pub.paused,
    score:D.score||{}, solvedBy:D.solvedBy||null, handTo:D.handTo||null, log:D.log||[], seal:D.seal||null
  };
  listenHost();
}
function claimHost(){
  if(claiming||isHost()||!meta) return;
  claiming=true;
  var patch=metaObj({hostUid:uid});
  update(ref(db), {[rpath("meta")]:patch}).then(function(){
    return get(ref(db, rpath("meta")));
  }).then(function(s){
    var m=s.val()||{};
    claimLog.push("meta");
    if(m.hostUid!==uid){claiming=false; return}
    meta=m;
    listenHost();
    claiming=false;
    var lobby=metaObj({status:"lobby", phase:"lobby", hostUid:uid});
    lobby.note="The host changed. This round was cleared. The word was not shown.";
    return update(ref(db), {[rpath("meta")]:lobby, [rpath("fl/pub")]:null}).then(function(){
      G=null; D=null; pub=null; saveToken("");
      fail(lobby.note);
    });
  }).catch(function(){claiming=false});
}
function takeoverTick(){
  if(!meta||meta.status==="lobby"||isHost()||claiming||!pub||!D) return;
  var h=meta.hostUid, hp=players[h];
  if(hp&&hp.connected!==false){hostAwaySince=0; return}
  if(!hostAwaySince){hostAwaySince=Date.now(); return}
  if(Date.now()-hostAwaySince<AWAY) return;
  if(!beat||serverNow()-beat<L.IDLE_MS) return;
  var next=(D.order||[]).filter(function(u){return u!==h&&players[u]&&players[u].connected!==false})[0];
  if(next!==uid) return;
  claimHost();
}
function togglePause(){
  if(!isHost()||!G||G.phase==="end") return;
  L.setPaused(G, !G.paused);
  publishFromG();
}
function hostSkip(){
  if(!isHost()||!G) return;
  if(L.skipTurn(G, connMap()).ok) publishFromG();
}
function endGame(){
  if(!isHost()||!G) return;
  wordApi("end").then(function(res){
    if(res&&res.word) G.word=res.word;
    G.phase="end"; G.paused=false; G.turn="";
    publishFromG();
  });
}
function playAgain(){
  if(!isHost()||!code) return;
  var next=((+meta.flStart||0)+1);
  saveToken("");
  var patch=metaObj({status:"lobby", phase:"lobby", gameId:(+meta.gameId||1)+1, flStart:next, na:!!meta.na});
  update(ref(db), {[rpath("meta")]:patch, [rpath("fl/pub")]:null}).then(function(){
    G=null; D=null; pub=null;
  }).catch(function(e){fail(friendly(e))});
}
function setPoints(on){
  if(meta&&!isHost()) return;
  pointsOnly=!!on;
  if(isHost()&&meta&&meta.status==="lobby") update(ref(db), {[rpath("meta")]:metaObj({na:pointsOnly})}).catch(function(e){fail(friendly(e))});
  render();
}
function setDry(on){
  dryMe=!!on;
  if(code&&uid) update(ref(db, rpath("players/"+uid)), {dry:dryMe}).catch(function(e){fail(friendly(e))});
}

function stopAll(){stops.forEach(function(fn){try{fn()}catch(e){}}); stops=[]; stopHost(); if(connStop){connStop(); connStop=null} if(beatTimer){clearInterval(beatTimer); beatTimer=0}}
function stopHost(){hostStops.forEach(function(fn){try{fn()}catch(e){}}); hostStops=[]}
function listen(){
  stopAll();
  var watched=code;
  stops.push(onValue(ref(db, rpath("meta")), function(s){
    if(!s.exists()){if(watched!==code) return; roomEnded(); return}
    var was=isHost(); meta=s.val()||null;
    if(meta) pointsOnly=!!meta.na;
    if(meta&&meta.status==="lobby") sawLobby=true;
    if(meta&&meta.note&&meta.status==="lobby") fail(meta.note);
    if(isHost()&&!was){listenHost(); if(meta.status!=="lobby"&&!G) resumeHost()}
    if(!isHost()&&was){stopHost(); G=null}
    render();
  }, function(){fail("That room isn't available.")}));
  stops.push(onValue(ref(db, rpath("players")), function(s){players=s.val()||{}; syncRoster(); render()}, function(){}));
  stops.push(onValue(ref(db, rpath("fl/pub")), function(s){
    pub=s.val()||null;
    try{D=pub?JSON.parse(pub.data):null}catch(e){D=null}
    if(pub&&pub.seq!==lastSeq){
      if(pub.phase!==lastPhase&&lastPhase&&pub.phase==="end"&&D&&!D.solvedBy){
        /* not solved: the word turns over one tile at a time, after any row still flipping */
        var wait=anim.reveal?Math.max(0, anim.reveal.t0+ROW_MS-Date.now()):0;
        if(!still()) anim.word=Date.now()+wait;
        if((D.guesses||[]).length>=(D.max||L.MAX_GUESSES)) setTimeout(function(){fx("outOfGuesses")}, wait);
      }
      lastSeq=pub.seq; lastPhase=pub.phase;
    }
    hostLock=false;
    render(); hostTick();
    live=true;
  }, function(){}));
  stops.push(onValue(ref(db, rpath("fl/beat")), function(s){var v=s.val(); beat=typeof v==="number"?v:0}, function(){}));
  beatTimer=setInterval(function(){
    if(!isHost()||!code||window.__tpFrenzyHoldBeat) return;
    set(ref(db, rpath("fl/beat")), serverTimestamp()).catch(function(){});
    if(roundToken) wordApi("beat");
  }, FAST?5000:20000);
}
function listenHost(){
  stopHost();
  hostStops.push(onValue(ref(db, rpath("fl/guess")), function(s){guessMap=s.val()||{}; hostTick()}, function(){}));
  hostStops.push(onValue(ref(db, rpath("fl/act")), function(s){actMap=s.val()||{}; hostTick()}, function(){}));
}
function armPresence(){
  if(connStop) connStop();
  var drop=null;
  connStop=onValue(ref(db, ".info/connected"), function(s){
    if(drop){try{drop.cancel()}catch(e){} drop=null}
    if(!s.val()||!code||!uid) return;
    var p=ref(db, rpath("players/"+uid));
    drop=onDisconnect(p); drop.update({connected:false}).catch(function(){});
    update(p, {connected:true}).catch(function(){});
  });
}
function roomEnded(){
  stopAll(); code=null; meta=null; pub=null; D=null; G=null;
  try{sessionStorage.removeItem("tp_fl_room")}catch(e){}
  fail("This room has closed."); screen("home");
}
async function hostRoom(name){
  var i, claimed=null;
  for(i=0;i<6;i++){
    var c=makeRoomCode();
    var snap=await get(ref(db, "rooms/"+c+"/meta"));
    if(snap.exists()) continue;
    try{
      await update(ref(db), {["rooms/"+c+"/meta"]:{hostUid:uid, createdAt:serverTimestamp(), status:"lobby", phase:"lobby", spice:"mild", rounds:10, na:!!pointsOnly, round:0, gameId:1, kind:"fl", flStart:0}});
      claimed=c; break;
    }catch(e){if(!/permission/i.test(String(e.code||e.message||""))) throw e}
  }
  if(!claimed) throw new Error("room");
  await set(ref(db, "rooms/"+claimed+"/players/"+uid), {name:name, connected:true, joinedAt:serverNow(), dry:!!dryMe});
  code=claimed;
  try{sessionStorage.setItem("tp_fl_room", code); localStorage.setItem("tp_last_game", "five-letter-frenzy")}catch(e){}
  listen(); armPresence();
}
async function joinRoom(c, name){
  var snap=await get(ref(db, "rooms/"+c+"/meta"));
  if(!snap.exists()) throw new Error("missing");
  var m=snap.val()||{};
  if(m.kind!=="fl") throw new Error("kind");
  var mineSnap=await get(ref(db, "rooms/"+c+"/players/"+uid));
  if(m.status!=="lobby"&&!mineSnap.exists()) throw new Error("closed");
  var prev=mineSnap.val()||{};
  if(!mineSnap.exists()){
    var all=(await get(ref(db, "rooms/"+c+"/players"))).val()||{};
    if(Object.keys(all).length>=L.MAX_PLAYERS) throw new Error("full");
    var err=L.nameError(name, Object.keys(all).map(function(k){return all[k].name}));
    if(err) throw new Error("name:"+err);
  }
  await set(ref(db, "rooms/"+c+"/players/"+uid), {name:prev.name||name, connected:true, joinedAt:prev.joinedAt||serverNow(), dry:prev.dry!=null?!!prev.dry:!!dryMe});
  code=c;
  try{sessionStorage.setItem("tp_fl_room", code); localStorage.setItem("tp_last_game", "five-letter-frenzy")}catch(e){}
  listen(); armPresence();
}
var closeArmed=0;
function askClose(){
  if(!isHost()||!code) return;
  if(Date.now()-closeArmed>2500){closeArmed=Date.now(); fail("Tap close again to end the room for everyone."); return}
  closeArmed=0;
  fail(""); remove(ref(db, "rooms/"+code)).catch(function(e){fail(friendly(e))});
  try{sessionStorage.removeItem("tp_fl_room")}catch(e){}
}
function leaveGame(){
  if(!code) return;
  if(isHost()){askClose(); return}
  remove(ref(db, rpath("players/"+uid))).catch(function(){});
  roomEnded();
}
function copyText(text){
  if(navigator.clipboard&&navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  return Promise.reject(new Error("clipboard"));
}

function wire(){
  var saved=""; try{saved=localStorage.getItem("tp_name")||""}catch(e){}
  if(saved&&!$("pname").value) $("pname").value=L.cleanName(saved).slice(0, L.NAME_MAX);
  var linked=queryRoom(); if(linked) $("roomcode").value=linked;
  try{if(localStorage.getItem("tp_sound")===null&&window.TPSound) TPSound.setEnabled(false)}catch(e){}
  var mute=$("mute"); if(window.TPSound&&mute) TPSound.bindMute(mute);
  $("hostbtn").addEventListener("click", function(){
    var name=L.cleanName($("pname").value), err=L.nameError(name, []);
    if(err){fail(err); $("pname").focus(); return}
    if(sending) return; sending=true; fail("");
    try{localStorage.setItem("tp_name", name)}catch(e){}
    hostRoom(name).catch(function(e){fail(e&&e.message==="room"?"Couldn't open a room. Try again.":friendly(e))}).then(function(){sending=false});
  });
  $("joinform").addEventListener("submit", function(e){e.preventDefault(); $("joinbtn").click()});
  $("joinbtn").addEventListener("click", function(){
    var name=L.cleanName($("pname").value), c=normCode($("roomcode").value), err=L.nameError(name, []);
    if(err){fail(err); $("pname").focus(); return}
    if(!validCode(c)){fail("Enter the 4-letter code."); $("roomcode").focus(); return}
    if(sending) return; sending=true; fail("");
    try{localStorage.setItem("tp_name", name)}catch(e){}
    joinRoom(c, name).catch(function(e){
      var msg=String((e&&e.message)||"");
      if(msg==="kind") fail("That code is for a different game.");
      else if(msg==="missing") fail("No room with that code.");
      else if(msg==="closed") fail("This round has already started. Join the next one from the lobby.");
      else if(msg==="full") fail("That room is full (8 players).");
      else if(msg.indexOf("name:")===0) fail(msg.slice(5));
      else fail(friendly(e));
    }).then(function(){sending=false});
  });
  $("pointsonly").addEventListener("click", function(){setPoints($("pointsonly").getAttribute("aria-pressed")!=="true")});
  function onDry(e){setDry(e.target.checked)}
  $("dryme").addEventListener("change", onDry);
  if($("dryme2")) $("dryme2").addEventListener("change", onDry);
  $("start").addEventListener("click", begin);
  $("guessform").addEventListener("submit", function(e){e.preventDefault(); sendGuess($("guess").value)});
  $("guess").addEventListener("input", function(){
    if(!pub||pub.phase!=="guess") return;
    var n=L.normalize($("guess").value).slice(0,5).length;
    if(n>typedLen){fx("type"); if(!still()){anim.pop={i:n-1, t0:Date.now()}; repaintLater(170)}}
    typedLen=n;
    paintGrid();
  });
  if($("sharecard")) $("sharecard").addEventListener("click", function(){
    if(!FX||!D||!D.guesses) return;
    /* marks only: the letters and the secret word never reach the image */
    FX.share(D.guesses.map(function(g){return g.marks}), {solved:!!D.solvedBy, max:D.max||L.MAX_GUESSES}).then(function(how){
      if(how==="downloaded") fail("Result image saved.");
    });
  });
  $("drinkbtn").addEventListener("click", function(){sendAct("drink")});
  $("posebtn").addEventListener("click", function(){sendAct("pose")});
  $("passbtn").addEventListener("click", function(){sendAct("pass")});
  $("skiphand").addEventListener("click", function(){sendAct("pass")});
  $("pausebtn").addEventListener("click", togglePause);
  $("skipbtn").addEventListener("click", hostSkip);
  $("endbtn").addEventListener("click", endGame);
  $("again").addEventListener("click", playAgain);
  $("leave").addEventListener("click", leaveGame);
  $("close").addEventListener("click", askClose);
  if($("closestage")) $("closestage").addEventListener("click", askClose);
  $("copylink").addEventListener("click", function(){if(code) copyText(roomUrl(code)).then(function(){fail("Link copied.")}).catch(function(){fail(roomUrl(code))})});
  $("copycode").addEventListener("click", function(){if(code) copyText(code).then(function(){fail("Code copied.")}).catch(function(){fail(code)})});
  $("sharebtn").addEventListener("click", function(){
    if(!code) return;
    if(navigator.share) navigator.share({title:"Five Letter Frenzy", text:"Join my Five Letter Frenzy room "+code, url:roomUrl(code)}).catch(function(){});
    else copyText(roomUrl(code)).then(function(){fail("Link copied.")}).catch(function(){fail(roomUrl(code))});
  });
  tickTimer=setInterval(function(){hostTick(); takeoverTick()}, 300);
  window.addEventListener("online", function(){fail(""); if(goOnline&&db){try{goOnline(db)}catch(e){}}});
  var back=""; try{back=sessionStorage.getItem("tp_fl_room")||""}catch(e){}
  var name=L.cleanName($("pname").value);
  if(back&&validCode(back)&&name&&(!linked||linked===back)) joinRoom(back, name).catch(function(){try{sessionStorage.removeItem("tp_fl_room")}catch(err){}});
}

function showReady(){if(bootTimer){clearTimeout(bootTimer); bootTimer=0} show("boot", false); show("app", true)}
function showBootError(msg){
  if(bootTimer){clearTimeout(bootTimer); bootTimer=0}
  show("boot", true); show("app", false);
  $("bootmsg").textContent="Couldn't open the game.";
  $("booterr").textContent=msg||"Check your connection and try again."; $("booterr").classList.remove("hide");
  $("retry").classList.remove("hide");
}
async function boot(){
  bootTimer=setTimeout(function(){if($("app").classList.contains("hide")) showBootError("This is taking too long. Check your connection and try again.")}, 12000);
  if(!L){showBootError("The game rules didn't load. Reload the page."); return}
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
  if(authMod.setPersistence&&authMod.browserLocalPersistence){try{await authMod.setPersistence(authObj, authMod.browserLocalPersistence)}catch(e){}}
  if(authObj.authStateReady) await authObj.authStateReady();
  var cred=authObj.currentUser?{user:authObj.currentUser}:await authMod.signInAnonymously(authObj);
  await cred.user.getIdToken();
  uid=cred.user.uid;
  offsetStop=onValue(ref(db, ".info/serverTimeOffset"), function(s){var v=s.val(); if(typeof v==="number"&&isFinite(v)){serverOffset=v; offsetReady=true}});
  window.__tpFrenzy={
    uid:function(){return uid}, code:function(){return code}, phase:function(){return pub&&pub.phase},
    seq:function(){return pub&&pub.seq}, turn:function(){return pub&&pub.turn}, data:function(){return D},
    host:function(){return isHost()}, secret:function(){return null}, token:function(){return isHost()?roundToken:""},
    paused:function(){return !!(pub&&pub.paused)}, claimLog:function(){return claimLog.slice()}, anim:function(){return JSON.parse(JSON.stringify(anim))},
    beat:function(){return beat}
  };
  showReady();
  try{wire()}catch(err){console.error(err); fail("The game glitched. Reload and try again.")}
}
var authObj, offsetStop;
$("retry").addEventListener("click", function(){location.reload()});
/* Table mode starts only when it is chosen, so the mode picker and Solo never wait for the network. */
var started=false;
window.FrenzyTable={start:function(){
  if(started) return; started=true;
  ["modes", "solo"].forEach(function(id){var n=$(id); if(n) n.classList.add("hide")});
  show("boot", true);
  boot().catch(function(err){console.error(err); showBootError("The game didn't open. Check your connection and try again.")});
}};
})();
