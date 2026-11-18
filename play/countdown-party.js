(function(){
"use strict";
/* Category Countdown, one phone per player, plus an optional TV display (play/display.html). rooms/$code/cc
   The acting host's phone runs the game with CountdownLogic and publishes what everyone may see (cc/pub).
   Answers and challenges are public; challenge votes (cc/cvote/$uid) are readable only by the voter and the host
   until the vote closes. Players write only their own entries: ans, chal, cvote, choice, left.
   Every timer is a server-time deadline in cc/pub. */
var L=window.CountdownLogic, DATA=window.CountdownData, FX=window.PartyFX, SCR=window.CountdownScreen;
var SND=(FX&&FX.sounds)||{};
var EMU=/[?&]emulator=1(?:&|$)/.test(location.search);
var FAST=EMU&&/[?&]fast=1(?:&|$)/.test(location.search);
if(FAST&&L) L.fast();
var AWAY_MS=FAST?1500:8000, SCREEN_FRESH=25000, GRACE=FAST?4000:8000;
var ALPHABET="ABCDEFGHJKMNPQRSTUVWXYZ";
var $=function(id){return document.getElementById(id)};
var uid=null, code=null, meta=null, players={}, pub=null, D=null, ccHost=null, screenAt=0, leftMap={};
var sentN=0, myChal="", myVotes={}, myChoice="", sending=false, serverOffset=0, offsetReady=false, lobbyErr="", note="";
var db=null, stops=[], hostStops=[], connStop=null, bootTimer=0, tickTimer=0;
var ref, onValue, update, set, remove, onDisconnect, get, serverTimestamp, goOnline;
/* host only */
var G=null, lastKey="", phaseAt=0, ansMap={}, chalMap={}, cvoteMap={}, choiceMap={}, applied={}, hostLock=false, resuming=false, claimedNow=false, claiming=false, hostAwaySince=0, offSince={}, lastRoundCleared=-1;
var lastSeq=-1, lastPhase="", lastMineKey="", lastCue="", typed="";

/* ---------- helpers ---------- */
function serverNow(){return Date.now()+(offsetReady?serverOffset:0)}
function rpath(p){return "rooms/"+code+"/"+p}
function fail(msg){var p=$("perr"); if(p) p.textContent=msg||""; lobbyErr=msg||""; var l=$("lobby"); if(l&&!l.classList.contains("hide")&&meta) paintLobby()}
function friendly(e){
  var c=String((e&&(e.code||e.message))||"");
  if(/permission|denied/i.test(c)) return "The server did not accept that. The site owner may need to publish the latest firebase-rules.json.";
  if(/offline|network|fetch/i.test(c)) return "You're offline. Check the connection and try again.";
  return "Something went wrong. Try again.";
}
function isOwner(){return !!(meta&&uid&&meta.hostUid===uid)}
function hostId(){return ccHost||(meta&&meta.hostUid)||""}
function amHost(){return !!uid&&hostId()===uid}
function normCode(v){var s=String(v||""), m=s.match(/(?:room|code)=([A-Za-z]{4})/i); if(m) return m[1].toUpperCase(); return s.toUpperCase().replace(/[^ABCDEFGHJKMNPQRSTUVWXYZ]/g,"").slice(0,4)}
function validCode(c){return /^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(c)}
function makeRoomCode(){var s="", i; for(i=0;i<4;i++) s+=ALPHABET.charAt(L.rng(ALPHABET.length)); return s}
function queryRoom(){var m=String(location.search||"").match(/[?&](?:room|code)=([A-Za-z]{4})/i); var c=m?normCode(m[1]):""; return validCode(c)?c:""}
function roomUrl(c){if(window.TipsyJoinQR) return TipsyJoinQR.pageInvite("/play/category-countdown.html", c, "cc"); return "https://tipsyplay.com/play/category-countdown.html?room="+c+"&game=cc"}
function displayUrl(c){
  var local=/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(location.host);
  return (local?location.origin:"https://tipsyplay.com")+"/play/display.html?room="+c+(EMU?"&emulator=1"+(FAST?"&fast=1":""):"");
}
function order(){
  return Object.keys(players).map(function(id){var p=players[id]; return {uid:id, name:p.name||"Player", connected:p.connected!==false, joinedAt:p.joinedAt||0}})
    .sort(function(a,b){return a.joinedAt-b.joinedAt||a.name.localeCompare(b.name)});
}
function nm(id){if(D&&D.names&&D.names[id]) return D.names[id]; return (players[id]&&players[id].name)||"Player"}
function screen(id){["home","lobby","table","closed"].forEach(function(s){var n=$(s); if(n) n.classList.toggle("hide", s!==id)})}
function show(id, on){var n=$(id); if(n) n.classList.toggle("hide", !on)}
function el(tag, cls, text){var n=document.createElement(tag); if(cls) n.className=cls; if(text!=null) n.textContent=text; return n}
function snd(name, a){if(SND[name]){try{SND[name](a)}catch(e){}}}
function displayOn(){return screenAt>0&&serverNow()-screenAt<SCREEN_FRESH}
function inGame(){return !!(D&&D.order&&D.order.indexOf(uid)>=0)}
function myDrink(){return D&&(D.drinks||[]).filter(function(d){return d.uid===uid})[0]}
function dupName(list){var seen={}, d=""; list.forEach(function(p){var k=L.cleanName(p.name).toLowerCase(); if(seen[k]) d=p.name; seen[k]=1}); return d}
function parseList(v){return String(v||"").split(",").filter(Boolean)}
function parseVotes(v){var o={}; String(v||"").split(",").forEach(function(x){var i=x.indexOf(":"); if(i>0) o[x.slice(0,i)]=x.slice(i+1)}); return o}
function encVotes(o){return Object.keys(o).map(function(k){return k+":"+o[k]}).join(",")}

/* ---------- rendering ---------- */
function render(){
  document.body.classList.toggle("is-host", amHost());
  if(!meta){screen("home"); return}
  if(meta.status==="lobby"||!pub||!D){screen("lobby"); paintLobby(); return}
  screen("table"); paintTable();
}
function paintLobby(){
  $("codebig").textContent=code||""; $("sharelink").textContent=roomUrl(code);
  var list=order(), box=$("plist"); box.textContent="";
  list.forEach(function(p){
    var row=el("div", "pg-person"+(p.connected?"":" off"));
    row.appendChild(el("span", null, p.name+(p.uid===meta.hostUid?" · host":"")));
    row.appendChild(el("span", null, p.connected?"":"away"));
    if(isOwner()&&p.uid!==uid){
      var kick=el("button", "x", "Remove"); kick.type="button"; kick.setAttribute("aria-label", "Remove "+p.name);
      kick.addEventListener("click", function(){remove(ref(db, rpath("players/"+p.uid))).catch(function(e){fail(friendly(e))})});
      row.appendChild(kick);
    }
    box.appendChild(row);
  });
  var mode=meta.ccMode==="potato"?"potato":"spot", pack=meta.spice||"mild", diff=meta.ccDiff||"mixed", laps=+meta.laps===2?2:1;
  [["data-mode", mode], ["data-pack", pack], ["data-diff", diff], ["data-laps", String(laps)]].forEach(function(x){
    document.querySelectorAll("["+x[0]+"]").forEach(function(b){b.setAttribute("aria-pressed", b.getAttribute(x[0])===x[1]?"true":"false"); b.disabled=!isOwner()});
  });
  $("lap1").textContent=mode==="spot"?"Everyone once":"3 rounds"; $("lap2").textContent=mode==="spot"?"Everyone twice":"6 rounds";
  $("modenote").textContent=mode==="spot"?"Spotlight: one player names as many as they can in 30 seconds. Everyone else can challenge.":"Hot Potato: one answer each, around the table. A repeat, a thrown-out answer or running out of time and you're out.";
  $("ona").checked=!!meta.na; $("ona").disabled=!isOwner();
  $("tvlink").textContent=displayUrl(code);
  var qr=$("tvqr"); if(qr&&window.TipsyJoinQR&&qr.dataset.for!==code){qr.dataset.for=code; TipsyJoinQR.draw(qr, displayUrl(code))}
  $("tvstate").textContent=displayOn()?"A display is connected.":"No display yet. The host's phone shows the shared screen instead.";
  var n=list.length, dup=dupName(list), start=$("start");
  start.classList.toggle("hide", !isOwner()); $("close").classList.toggle("hide", !isOwner());
  start.disabled=!isOwner()||n<L.MIN_PLAYERS||n>L.MAX_PLAYERS||!!dup||sending;
  start.textContent="Start game · "+n+" player"+(n===1?"":"s");
  var nt=$("lobbynote"); nt.classList.toggle("err", !!lobbyErr);
  if(lobbyErr) nt.textContent=lobbyErr;
  else if(n<L.MIN_PLAYERS) nt.textContent="Need "+(L.MIN_PLAYERS-n)+" more player"+(L.MIN_PLAYERS-n===1?"":"s")+".";
  else if(n>L.MAX_PLAYERS) nt.textContent=L.MAX_PLAYERS+" players max.";
  else if(dup) nt.textContent="Two players are called "+dup+". One of you, rejoin with another name.";
  else nt.textContent=isOwner()?"Everyone in? Start when ready.":"You're in. The host starts when the table's ready.";
}
function totalFor(p){var T=L.T; if(p==="turn") return (D&&D.turnMs)||T.laps[0]; return {intro:T.intro, answer:T.answer, cvote:D&&D.mode==="potato"?T.potatoVote:T.cvote, result:T.result, window:T.window}[p]||0}
function paintTable(){
  var now=serverNow(), p=pub.phase;
  var sharedHere=amHost()&&!displayOn();
  show("shared", sharedHere);
  if(sharedHere&&SCR) SCR.render($("shared"), {pub:pub, D:D, now:now, compact:true, sounds:true});
  show("tvnote", amHost()&&displayOn());
  paintMine();
  var bar=$("bar"), total=totalFor(p), left=pub.deadline-now, timed=pub.deadline>0&&total>0&&!sharedHere;
  show("bar", timed); show("bartext", timed);
  if(timed){bar.style.setProperty("--p", Math.max(0, Math.min(1, left/total)).toFixed(3)); bar.classList.toggle("hot", left<=3000); $("bartext").textContent=Math.max(0, Math.ceil(left/1000))+"s"}
  var hosting=amHost();
  show("hosttools", hosting&&p!=="end");
  show("finale", p==="end");
  if(p==="end"){var fb=$("finalbox"); if(SCR) SCR.render(fb, {pub:pub, D:D, now:now, compact:true, sounds:false})}
  $("again").classList.toggle("hide", !hosting);
  $("newgame").classList.toggle("hide", !isOwner());
  $("leave").classList.toggle("hide", isOwner()||!inGame());
  $("closestage").classList.toggle("hide", !isOwner());
}
/* Only what this player needs: their input, their private choices and their own status. */
function paintMine(){
  var box=$("mine"), p=pub.phase, me=uid, act=D.actor===me, md=myDrink();
  var key=[pub.seq, p, act, myChal, JSON.stringify(myVotes), myChoice, note, md?md.what:""].join("|");
  if(key===lastMineKey){keepInput(); return}
  /* while this player is typing, the answer box is never rebuilt: only the count, the note and the list change */
  var form=$("ans");
  if(form&&act&&(p==="answer"||p==="turn")&&lastMineKey.split("|")[1]===p&&lastMineKey.split("|")[2]==="true"&&!(md&&!myChoice&&!(D.choices||{})[me])&&!$("mine").querySelector(".pg-drink")){
    lastMineKey=key;
    var okc=(D.answers||[]).filter(function(a){return a.status==="ok"}).length;
    if(p==="answer"&&$("minehead")) $("minehead").textContent=okc+" of "+D.cat.target+". Keep going!";
    if($("minenote")) $("minenote").textContent=note;
    var old=$("minetiles"); if(old){var nt=tilesList(false); nt.id="minetiles"; old.parentNode.replaceChild(nt, old)}
    keepInput(); return;
  }
  var fresh=lastMineKey.split("|")[1]!==p;
  var hadFocus=document.activeElement&&document.activeElement.id==="ans";
  lastMineKey=key; box.textContent="";
  /* my drink moment stays on my phone until I choose, even while the game moves on */
  if(md&&!myChoice&&!(D.choices||{})[me]){
    var dp=el("div", "pg-panel pg-drink"+(fresh?" pg-mine":""));
    dp.appendChild(el("p", "pg-tag", "Drink moment"));
    var alt=DATA.alts[(D.round+me.length)%DATA.alts.length];
    var why=/hit the target$/.test(md.why)?md.why+".":"You "+md.why+".";
    dp.appendChild(el("h2", null, why+(md.what==="drink"?" Take a drink, "+alt+", or Pass.":" Do the alternative ("+alt+"), or Pass.")));
    var opts=md.what==="drink"?[["drink","Take a drink"],["alt","Do the alternative"],["pass","Pass"]]:[["alt","Do the alternative"],["pass","Pass"]];
    opts.forEach(function(o){var b=el("button", "btn"+(o[0]==="pass"?" alt":""), o[1]); b.type="button"; b.addEventListener("click", function(){sendChoice(o[0])}); dp.appendChild(b)});
    dp.appendChild(el("p", null, "Passing is always fine and costs nothing."));
    box.appendChild(dp);
    if(lastCue!=="drink|"+D.round+"|"+md.why){lastCue="drink|"+D.round+"|"+md.why; snd("clink")}
  }
  var panel=el("div", "pg-panel"+(fresh?" pg-mine":"")); box.appendChild(panel);
  if(D.cat&&p!=="end") panel.appendChild(el("p", "pg-role", D.cat.text+(D.mode==="spot"?" · name "+D.cat.target:"")));
  if(p==="intro"){
    panel.appendChild(el("h2", null, act&&D.mode==="spot"?"You're in the spotlight! Get ready…":D.mode==="potato"?"Hot Potato. Get ready…":nm(D.actor)+" is in the spotlight."));
  }else if(p==="answer"){
    if(act){
      var ok=(D.answers||[]).filter(function(a){return a.status==="ok"}).length;
      var hh=el("h2", null, ok+" of "+D.cat.target+". Keep going!"); hh.id="minehead"; panel.appendChild(hh);
      panel.appendChild(answerForm("Add"));
      var nn=el("p", "pg-note", note); nn.id="minenote"; nn.setAttribute("aria-live", "polite"); panel.appendChild(nn);
      var tl=tilesList(false); tl.id="minetiles"; panel.appendChild(tl);
      cue("turn|"+D.round);
    }else{
      panel.appendChild(el("h2", null, nm(D.actor)+" is answering. Tap an answer to challenge it."));
      panel.appendChild(tilesList(true));
    }
  }else if(p==="cvote"){
    var mine=D.actor===me;
    if(mine) panel.appendChild(el("h2", null, "The table is voting on your challenged answer"+((D.voteIds||[]).length===1?"":"s")+"."));
    else{
      panel.appendChild(el("h2", null, "Keep it or throw it out?"));
      (D.voteIds||[]).forEach(function(id){
        var a=(D.answers||[]).filter(function(x){return x.id===id})[0]; if(!a) return;
        var row=el("div", "pg-vote"); row.appendChild(el("b", null, a.text));
        [["u","👍 Keep"],["d","👎 Out"]].forEach(function(v){
          var b=el("button", null, v[1]); b.type="button"; b.setAttribute("aria-pressed", myVotes[id]===v[0]?"true":"false"); b.disabled=!!myVotes[id];
          b.setAttribute("aria-label", (v[0]==="u"?"Keep ":"Throw out ")+a.text);
          b.addEventListener("click", function(){sendVote(id, v[0])}); row.appendChild(b);
        });
        panel.appendChild(row);
      });
      cue("vote|"+D.round+"|"+(D.voteIds||[]).join(","));
    }
  }else if(p==="turn"){
    var alive=(D.alive||[]).indexOf(me)>=0;
    if(act){
      panel.appendChild(el("h2", null, "Your turn! One answer, quick."));
      panel.appendChild(answerForm("Go"));
      var pn=el("p", "pg-note", note); pn.id="minenote"; panel.appendChild(pn);
      cue("turn|"+D.round+"|"+(D.answers||[]).length+"|"+(D.out||[]).length);
    }else panel.appendChild(el("h2", null, alive?nm(D.actor)+"'s turn. You're still in.":"You're out this round. "+nm(D.actor)+"'s turn."));
    var pt=tilesList(false); pt.id="minetiles"; panel.appendChild(pt);
  }else if(p==="window"){
    var last=(D.answers||[]).filter(function(a){return a.id===D.current})[0];
    if(D.actor===me) panel.appendChild(el("h2", null, "Hold on… anyone challenging?"));
    else{
      panel.appendChild(el("h2", null, "“"+(last?last.text:"")+"” — does that count?"));
      var on=parseList(myChal).indexOf(D.current)>=0;
      var cb=el("button", "pg-objection", on?"Challenged":"Challenge!"); cb.type="button"; cb.disabled=on;
      cb.addEventListener("click", function(){toggleChal(D.current)}); panel.appendChild(cb);
    }
  }else if(p==="result"){
    var o=D.outcome;
    if(D.note) panel.appendChild(el("h2", null, D.note));
    else if(o&&o.mode==="spot") panel.appendChild(el("h2", null, nm(o.actor)+" got "+o.count+" of "+o.target+(o.hit?". Target hit!":". Missed it.")));
    else if(o&&o.mode==="potato") panel.appendChild(el("h2", null, (o.winner?nm(o.winner)+" is the last one standing!":"Round over.")));
    panel.appendChild(el("p", null, "You have "+((D.scores||{})[me]||0)+" point"+(((D.scores||{})[me]||0)===1?"":"s")+"."));
  }else if(p==="end"){
    var fin=(D.scores||{})[me]||0;
    panel.appendChild(el("h2", null, "That's the countdown"));
    panel.appendChild(el("p", null, "You finished with "+fin+" point"+(fin===1?"":"s")+"."));
  }
  if(hadFocus&&$("ans")){$("ans").focus()}
  keepInput();
}
function keepInput(){var i=$("ans"); if(i&&i.value!==typed) i.value=typed}
function cue(k){if(lastCue===k) return; var first=!lastCue; lastCue=k; if(!first) snd("turn")}
function answerForm(label){
  var f=el("form", "pg-answer");
  var i=el("input", "bigin"); i.id="ans"; i.maxLength=L.ANSWER_MAX; i.autocomplete="off"; i.setAttribute("autocapitalize", "off"); i.setAttribute("enterkeyhint", "send"); i.placeholder="Type an answer"; i.setAttribute("aria-label", "Your answer");
  i.addEventListener("input", function(){typed=i.value});
  var b=el("button", "btn host-cta", label); b.type="submit";
  f.appendChild(i); f.appendChild(b);
  f.addEventListener("submit", function(e){e.preventDefault(); sendAnswer(i.value)});
  return f;
}
function tilesList(tappable){
  var ul=el("ul", "pg-tiles"), mine=parseList(myChal);
  (D.answers||[]).forEach(function(a){
    var li=el("li", a.status==="out"?"out":null);
    if(tappable&&a.status==="ok"){
      li.className=""; var b=el("button", null, a.text); b.type="button";
      var on=mine.indexOf(a.id)>=0; b.setAttribute("aria-pressed", on?"true":"false"); b.setAttribute("aria-label", (on?"Take back your challenge to ":"Challenge ")+a.text);
      b.addEventListener("click", function(){toggleChal(a.id)}); li.appendChild(b);
    }else li.textContent=a.text+(D.mode==="potato"?" · "+nm(a.uid):"");
    ul.appendChild(li);
  });
  return ul;
}

/* ---------- player actions ---------- */
function sendAnswer(text){
  var t=String(text||"").replace(/\s+/g, " ").trim();
  if(!pub||D.actor!==uid||!(pub.phase==="answer"||pub.phase==="turn")||!L.key(t)) return;
  /* Spotlight: a repeat is caught here, with no round trip. Hot Potato: a repeat is sent, because it knocks you out. */
  if(pub.phase==="answer"&&(D.answers||[]).some(function(a){return a.status==="ok"&&L.same(a.text, t)})){note="Already said: “"+t+"”."; typed=""; snd("thud"); lastMineKey=""; render(); return}
  /* the next free slot: whichever is further on, the live list or what this phone has already sent this round */
  var n=Math.max(sentN, Object.keys(ansMap[uid]||{}).length); sentN=n+1;
  note=""; typed=""; snd("pop"); lastMineKey=""; render();
  set(ref(db, rpath("cc/ans/"+uid+"/"+n)), t).catch(function(e){fail(friendly(e))});
}
function toggleChal(id){
  if(!pub||D.actor===uid||!(pub.phase==="answer"||pub.phase==="window")) return;
  var list=parseList(myChal), i=list.indexOf(id);
  if(i>=0) list.splice(i, 1); else list.push(id);
  myChal=list.join(","); snd("ping"); render();
  set(ref(db, rpath("cc/chal/"+uid)), myChal||null).catch(function(e){fail(friendly(e))});
}
function sendVote(id, v){
  if(!pub||pub.phase!=="cvote"||D.actor===uid||myVotes[id]) return;
  myVotes[id]=v; snd("click"); render();
  set(ref(db, rpath("cc/cvote/"+uid)), encVotes(myVotes)).catch(function(e){delete myVotes[id]; fail(friendly(e)); render()});
}
function sendChoice(k){
  if(!pub||!myDrink()||myChoice) return;
  myChoice=k; snd("click"); render();
  set(ref(db, rpath("cc/choice/"+uid)), k+":"+D.round).catch(function(e){myChoice=""; fail(friendly(e)); render()});
}
var leaveArmed=0;
function leaveGame(){
  if(!code||isOwner()) return;
  if(Date.now()-leaveArmed>3000){leaveArmed=Date.now(); fail("Tap Leave again to leave the game."); return}
  fail("");
  var p={}; p[rpath("cc/left/"+uid)]=true; p[rpath("players/"+uid+"/connected")]=false;
  update(ref(db), p).catch(function(){}).then(function(){leaveRoom(); screen("home"); fail("You left the game.")});
}

/* ---------- host: publishing ---------- */
function metaObj(patch){
  var m=Object.assign({}, meta||{}, patch||{});
  var out={hostUid:m.hostUid, createdAt:m.createdAt, status:m.status, phase:m.phase, spice:/^(mild|spicy|extra)$/.test(m.spice)?m.spice:"mild", rounds:10, na:!!m.na, round:0, gameId:+m.gameId||1, kind:"cc",
    laps:+m.laps===2?2:1, ccMode:m.ccMode==="potato"?"potato":"spot", ccDiff:/^(easy|medium|hard)$/.test(m.ccDiff)?m.ccDiff:"mixed"};
  if(m.status!=="lobby") out.deck=["Category Countdown"];
  return out;
}
function publish(more){
  if(!G||!code) return Promise.resolve(false);
  var now=serverNow(), k=G.phase+"|"+G.played+"|"+G.actor+"|"+G.phaseAt;
  if(k!==lastKey){lastKey=k; phaseAt=now}
  var view=L.publicView(G); view.at=phaseAt;
  var payload=Object.assign({}, more||{});
  payload[rpath("cc/pub")]={phase:G.phase, seq:(pub?pub.seq:0)+1, deadline:G.deadline||0, data:JSON.stringify(view), a:G.actor||""};
  payload[rpath("cc/secret")]=JSON.stringify({G:G, phaseAt:phaseAt, lastKey:lastKey, applied:applied, lastRoundCleared:lastRoundCleared});
  payload[rpath("cc/beat")]=serverTimestamp();
  /* a new round: everyone's entries from the last one are cleared */
  if(G.phase==="intro"&&G.played!==lastRoundCleared){
    lastRoundCleared=G.played; applied={};
    G.seats.forEach(function(u){["ans","chal","cvote","choice"].forEach(function(x){payload[rpath("cc/"+x+"/"+u)]=null})});
    ansMap={}; chalMap={}; cvoteMap={}; choiceMap={};
  }
  hostLock=true;
  return update(ref(db), payload).then(function(){hostLock=false; return true}).catch(function(e){hostLock=false; if(amHost()) fail(friendly(e)); return false});
}
function awayMap(){
  var out={}, now=Date.now(); if(!G) return out;
  G.order.forEach(function(u){
    var p=players[u];
    if(p&&p.connected!==false){delete offSince[u]; return}
    if(!offSince[u]) offSince[u]=now;
    if(!p||now-offSince[u]>=GRACE) out[u]=true;
  });
  return out;
}
function begin(){
  if(!isOwner()||sending||!meta||meta.status!=="lobby") return;
  var list=order();
  if(list.length<L.MIN_PLAYERS||list.length>L.MAX_PLAYERS){fail("Need "+L.MIN_PLAYERS+" to "+L.MAX_PLAYERS+" players."); return}
  if(dupName(list)){fail("Two players share a name."); return}
  sending=true; fail("");
  freshGame(list.map(function(p){return {uid:p.uid, name:p.name}}));
  var more={}; more[rpath("meta")]=metaObj({status:"play", phase:"answer"}); more[rpath("cc/host")]=null;
  list.forEach(function(p){more[rpath("cc/left/"+p.uid)]=null});
  publish(more).then(function(ok){if(!ok) G=null; else listenHost(); sending=false; render()});
}
function freshGame(list){
  G=L.newGame(list, {mode:meta.ccMode, pack:meta.spice, diff:meta.ccDiff, na:!!meta.na, laps:+meta.laps===2?2:1});
  lastKey=""; lastRoundCleared=-1;
  L.startRound(G, DATA, serverNow(), null, awayMap());
}
function playAgain(){
  if(!amHost()||!G||G.phase!=="end"||hostLock) return;
  var list=G.order.map(function(u){return {uid:u, name:G.names[u]}});
  if(list.length<L.MIN_PLAYERS){fail("You need at least "+L.MIN_PLAYERS+" players."); return}
  freshGame(list); publish();
}
function newGame(){
  if(!isOwner()) return;
  var payload={}; payload[rpath("meta")]=metaObj({status:"lobby", phase:"lobby", gameId:Math.min(100, (+meta.gameId||1)+1)});
  payload[rpath("cc/pub")]=null; payload[rpath("cc/secret")]=null; payload[rpath("cc/host")]=null;
  update(ref(db), payload).then(function(){G=null; stopHost()}).catch(function(e){fail(friendly(e))});
}
function skipAhead(){if(!amHost()||!G||hostLock||G.phase==="end") return; G.deadline=serverNow(); hostTick()}
function endEarly(){if(!amHost()||!G||hostLock) return; L.finish(G); publish()}
/* Apply every new input, then let the clock move the game on. */
function hostTick(){
  if(!amHost()||!G||hostLock||resuming) return;
  var now=serverNow(), away=awayMap(), dirty=false, before=G.phase+"|"+G.played+"|"+G.actor;
  var gone=Object.keys(leftMap).filter(function(u){return leftMap[u]&&G.order.indexOf(u)>=0});
  Object.keys(G.names).forEach(function(u){if(G.order.indexOf(u)>=0&&!players[u]&&gone.indexOf(u)<0) gone.push(u)});
  if(gone.length){var clear={}; gone.forEach(function(u){L.leave(G, u, now); clear[rpath("cc/left/"+u)]=null}); publish(clear); return}
  /* answers: one per numbered entry, applied once, in order */
  var a=G.actor, list=ansMap[a]||{}, done=applied[a]||0;
  while(list[done]!=null&&G.actor===a&&(G.phase==="answer"||G.phase==="turn")){L.addAnswer(G, a, String(list[done]), now); done++; dirty=true}
  applied[a]=done;
  /* challenges: each player's current list, as toggles */
  Object.keys(chalMap).forEach(function(u){
    var want=parseList(chalMap[u]);
    (G.answers||[]).forEach(function(x){
      var has=!!(G.challenges[x.id]&&G.challenges[x.id][u]), on=want.indexOf(x.id)>=0;
      if(on!==has&&L.challenge(G, u, x.id, on)) dirty=true;
    });
  });
  Object.keys(cvoteMap).forEach(function(u){var v=parseVotes(cvoteMap[u]); Object.keys(v).forEach(function(id){if(L.castVote(G, u, id, v[id])) dirty=true})});
  Object.keys(choiceMap).forEach(function(u){var s=String(choiceMap[u]||""), i=s.lastIndexOf(":"); if(i>0&&+s.slice(i+1)===G.played+1&&L.choose(G, u, s.slice(0, i))) dirty=true});
  var ev=L.tick(G, DATA, now, null, away);
  if(ev||dirty||before!==G.phase+"|"+G.played+"|"+G.actor) publish();
}
function becomeHost(){
  if(G||resuming||!meta||meta.status==="lobby") return;
  resuming=true;
  get(ref(db, rpath("cc/secret"))).then(function(s){
    if(!s.exists()||!amHost()) return;
    var o=null; try{o=JSON.parse(s.val())}catch(e){o=null}
    if(!o||!o.G) return;
    G=o.G; phaseAt=o.phaseAt||serverNow(); lastKey=o.lastKey||""; applied=o.applied||{}; lastRoundCleared=o.lastRoundCleared==null?-1:o.lastRoundCleared;
    listenHost();
    if(claimedNow){
      claimedNow=false;
      /* a new host could read the challenge votes, so a vote in progress is thrown out */
      L.dismiss(G, serverNow(), "The host changed, so that challenge was dropped.");
      resuming=false; publish(); return;
    }
  }).catch(function(){}).then(function(){resuming=false; render()});
}
function takeoverTick(){
  if(!meta||meta.status!=="play"||!pub||!D||amHost()||claiming) return;
  var h=hostId(), hp=players[h];
  if(hp&&hp.connected!==false){hostAwaySince=0; return}
  if(!hostAwaySince){hostAwaySince=Date.now(); return}
  if(Date.now()-hostAwaySince<AWAY_MS) return;
  var next=(D.order||[]).filter(function(u){return u!==h&&players[u]&&players[u].connected!==false})[0];
  if(next!==uid) return;
  claiming=true; claimedNow=true;
  set(ref(db, rpath("cc/host")), uid).catch(function(){claimedNow=false}).then(function(){claiming=false; hostAwaySince=0});
}

/* ---------- listeners ---------- */
function stopAll(){stops.forEach(function(fn){try{fn()}catch(e){}}); stops=[]; stopHost(); if(connStop){connStop(); connStop=null}}
function stopHost(){hostStops.forEach(function(fn){try{fn()}catch(e){}}); hostStops=[]}
function hostCheck(){if(amHost()){if(!G&&meta&&meta.status!=="lobby") becomeHost()} else if(G||hostStops.length){stopHost(); G=null}}
function onPub(){
  try{D=pub?JSON.parse(pub.data):null}catch(e){D=null}
  if(pub&&pub.seq!==lastSeq){
    if(pub.phase!==lastPhase||(D&&D.round!==onPub.round)){
      if(pub.phase==="intro"){myChal=""; myVotes={}; myChoice=""; note=""; typed=""; sentN=0}
      if(pub.phase==="cvote") myVotes={};
      onPub.round=D?D.round:0;
    }
    lastSeq=pub.seq; lastPhase=pub.phase;
  }
  hostLock=false; render();
}
function listen(){
  stopAll();
  var watched=code;
  stops.push(onValue(ref(db, rpath("meta")), function(s){if(!s.exists()){if(watched!==code) return; roomEnded(); return} meta=s.val()||null; hostCheck(); render()}, function(){fail("That room isn't available.")}));
  stops.push(onValue(ref(db, rpath("players")), function(s){players=s.val()||{}; render(); hostTick()}, function(){}));
  stops.push(onValue(ref(db, rpath("cc/host")), function(s){ccHost=s.val()||null; hostCheck(); render()}, function(){}));
  stops.push(onValue(ref(db, rpath("cc/screen")), function(s){var v=s.val(); screenAt=typeof v==="number"?v:0; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("cc/pub")), function(s){pub=s.val()||null; onPub(); hostTick()}, function(){}));
  stops.push(onValue(ref(db, rpath("cc/left")), function(s){leftMap=s.val()||{}; hostTick()}, function(){}));
  /* everyone reads the public answers and challenges; the host acts on them */
  stops.push(onValue(ref(db, rpath("cc/ans")), function(s){ansMap=s.val()||{}; hostTick()}, function(){}));
  stops.push(onValue(ref(db, rpath("cc/chal")), function(s){chalMap=s.val()||{}; myChal=chalMap[uid]||""; render(); hostTick()}, function(){}));
  stops.push(onValue(ref(db, rpath("cc/cvote/"+uid)), function(s){myVotes=parseVotes(s.val()); render()}, function(){}));
  stops.push(onValue(ref(db, rpath("cc/choice/"+uid)), function(s){var v=String(s.val()||""), i=v.lastIndexOf(":"); myChoice=i>0&&D&&+v.slice(i+1)===D.round?v.slice(0, i):""; render()}, function(){}));
  startTicker();
}
function listenHost(){
  stopHost();
  hostStops.push(onValue(ref(db, rpath("cc/cvote")), function(s){cvoteMap=s.val()||{}; hostTick()}, function(){}));
  hostStops.push(onValue(ref(db, rpath("cc/choice")), function(s){choiceMap=s.val()||{}; hostTick()}, function(){}));
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
function tick(){hostTick(); takeoverTick(); if(pub&&meta&&meta.status!=="lobby") render()}
function startTicker(){stopTicker(); tickTimer=setInterval(tick, 200)}
function stopTicker(){if(tickTimer){clearInterval(tickTimer); tickTimer=0}}
function leaveRoom(){
  stopAll(); stopTicker();
  try{sessionStorage.removeItem("tp_cc_room")}catch(e){}
  code=null; meta=null; pub=null; D=null; G=null; ccHost=null; players={}; leftMap={}; screenAt=0;
  sentN=0; myChal=""; myVotes={}; myChoice=""; note=""; typed=""; lastSeq=-1; lastPhase=""; lastMineKey=""; lastCue="";
  hostAwaySince=0; claiming=false; claimedNow=false;
}
function roomEnded(){leaveRoom(); fail("This room has closed."); screen("home")}

/* ---------- rooms ---------- */
async function hostRoom(name){
  var i, claimed=null;
  for(i=0;i<6;i++){
    var c=makeRoomCode();
    var snap=await get(ref(db, "rooms/"+c+"/meta"));
    if(snap.exists()) continue;
    try{
      await update(ref(db), {["rooms/"+c+"/meta"]:{hostUid:uid, createdAt:serverTimestamp(), status:"lobby", phase:"lobby", spice:"mild", rounds:10, na:false, round:0, gameId:1, kind:"cc", laps:1, ccMode:"spot", ccDiff:"mixed"}});
      claimed=c; break;
    }catch(e){if(!/permission/i.test(String(e.code||e.message||""))) throw e}
  }
  if(!claimed) throw new Error("room");
  await set(ref(db, "rooms/"+claimed+"/players/"+uid), {name:name, connected:true, joinedAt:serverNow()});
  enterRoom(claimed);
}
async function joinRoom(c, name){
  var snap=await get(ref(db, "rooms/"+c+"/meta"));
  if(!snap.exists()) throw new Error("missing");
  var m=snap.val()||{};
  if(m.kind!=="cc") throw new Error("kind");
  var mineSnap=await get(ref(db, "rooms/"+c+"/players/"+uid));
  if(m.status!=="lobby"&&!mineSnap.exists()) throw new Error("closed");
  var prev=mineSnap.val()||{};
  if(!mineSnap.exists()){
    var all=(await get(ref(db, "rooms/"+c+"/players"))).val()||{};
    if(Object.keys(all).length>=L.MAX_PLAYERS) throw new Error("full");
    var err=L.nameError(name, Object.keys(all).map(function(k){return all[k].name}));
    if(err) throw new Error("name:"+err);
  }
  await set(ref(db, "rooms/"+c+"/players/"+uid), {name:prev.name||name, connected:true, joinedAt:prev.joinedAt||serverNow()});
  enterRoom(c);
}
function enterRoom(c){code=c; try{sessionStorage.setItem("tp_cc_room", code); localStorage.setItem("tp_last_game", "category-countdown")}catch(e){} listen(); armPresence()}
var closeArmed=0;
function askClose(){
  if(!isOwner()||!code) return;
  if(Date.now()-closeArmed>2500){closeArmed=Date.now(); fail("Tap close again to end the room for everyone."); return}
  fail(""); remove(ref(db, "rooms/"+code)).catch(function(e){fail(friendly(e))});
  try{sessionStorage.removeItem("tp_cc_room")}catch(e){}
}
function setMeta(patch){if(!isOwner()||!meta||meta.status!=="lobby") return; update(ref(db), {[rpath("meta")]:metaObj(patch)}).catch(function(e){fail(friendly(e))})}
function copyText(text){if(navigator.clipboard&&navigator.clipboard.writeText) return navigator.clipboard.writeText(text); return Promise.reject(new Error("clipboard"))}

/* ---------- wiring ---------- */
function wire(){
  var saved=""; try{saved=localStorage.getItem("tp_name")||""}catch(e){}
  if(saved&&!$("pname").value) $("pname").value=L.cleanName(saved).slice(0, L.NAME_MAX);
  var linked=queryRoom(); if(linked) $("roomcode").value=linked;
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
      else if(msg==="closed") fail("That game has already started.");
      else if(msg==="full") fail("That room is full ("+L.MAX_PLAYERS+" players).");
      else if(msg.indexOf("name:")===0) fail(msg.slice(5));
      else fail(friendly(e));
    }).then(function(){sending=false});
  });
  document.querySelectorAll("[data-mode]").forEach(function(b){b.addEventListener("click", function(){setMeta({ccMode:b.dataset.mode})})});
  document.querySelectorAll("[data-pack]").forEach(function(b){b.addEventListener("click", function(){setMeta({spice:b.dataset.pack})})});
  document.querySelectorAll("[data-diff]").forEach(function(b){b.addEventListener("click", function(){setMeta({ccDiff:b.dataset.diff})})});
  document.querySelectorAll("[data-laps]").forEach(function(b){b.addEventListener("click", function(){setMeta({laps:+b.dataset.laps})})});
  $("ona").addEventListener("change", function(){setMeta({na:$("ona").checked})});
  $("start").addEventListener("click", begin);
  $("skipbtn").addEventListener("click", skipAhead);
  $("endbtn").addEventListener("click", endEarly);
  $("again").addEventListener("click", playAgain);
  $("newgame").addEventListener("click", newGame);
  $("leave").addEventListener("click", leaveGame);
  $("close").addEventListener("click", askClose);
  $("closestage").addEventListener("click", askClose);
  $("copylink").addEventListener("click", function(){if(code) copyText(roomUrl(code)).then(function(){fail("Link copied.")}).catch(function(){fail(roomUrl(code))})});
  $("copycode").addEventListener("click", function(){if(code) copyText(code).then(function(){fail("Code copied.")}).catch(function(){fail(code)})});
  $("sharebtn").addEventListener("click", function(){
    if(!code) return;
    if(navigator.share) navigator.share({title:"Category Countdown", text:"Join my Category Countdown room "+code, url:roomUrl(code)}).catch(function(){});
    else copyText(roomUrl(code)).then(function(){fail("Link copied.")}).catch(function(){fail(roomUrl(code))});
  });
  $("tvcopy").addEventListener("click", function(){if(code) copyText(displayUrl(code)).then(function(){fail("Display link copied.")}).catch(function(){fail(displayUrl(code))})});
  $("tvopen").addEventListener("click", function(){if(code) window.open(displayUrl(code), "_blank", "noopener")});
  window.addEventListener("online", function(){fail(""); if(goOnline&&db){try{goOnline(db)}catch(e){}}});
  if(EMU) window.__tpCountdown={uid:function(){return uid}, code:function(){return code}, phase:function(){return pub&&pub.phase}, data:function(){return D},
    host:function(){return amHost()}, display:function(){return displayOn()}, game:function(){return G?JSON.parse(JSON.stringify(G)):null}};
  var back=""; try{back=sessionStorage.getItem("tp_cc_room")||""}catch(e){}
  var name=L.cleanName($("pname").value);
  if(back&&validCode(back)&&name&&(!linked||linked===back)) joinRoom(back, name).catch(function(){try{sessionStorage.removeItem("tp_cc_room")}catch(err){}});
}

/* ---------- boot ---------- */
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
  if(!L||!DATA){showBootError("The game rules didn't load. Reload the page."); return}
  if(!navigator.onLine&&!EMU){showBootError("You're offline. Reconnect, then try again."); return}
  var base="https://www.gstatic.com/firebasejs/12.4.0/";
  var appMod=await import(base+"firebase-app.js");
  var authMod=await import(base+"firebase-auth.js");
  var dbMod=await import(base+"firebase-database.js");
  var cfg=await import("../firebase-config.js?v=17");
  var app=appMod.initializeApp(cfg.firebaseConfig);
  var authObj=authMod.getAuth(app);
  db=dbMod.getDatabase(app);
  ref=dbMod.ref; onValue=dbMod.onValue; update=dbMod.update; set=dbMod.set; remove=dbMod.remove; onDisconnect=dbMod.onDisconnect; get=dbMod.get; serverTimestamp=dbMod.serverTimestamp; goOnline=dbMod.goOnline;
  if(EMU){authMod.connectAuthEmulator(authObj, "http://127.0.0.1:9099", {disableWarnings:true}); dbMod.connectDatabaseEmulator(db, "127.0.0.1", 9000)}
  if(authMod.setPersistence&&authMod.browserLocalPersistence){try{await authMod.setPersistence(authObj, authMod.browserLocalPersistence)}catch(e){}}
  if(authObj.authStateReady) await authObj.authStateReady();
  var cred=authObj.currentUser?{user:authObj.currentUser}:await authMod.signInAnonymously(authObj);
  await cred.user.getIdToken();
  uid=cred.user.uid;
  onValue(ref(db, ".info/serverTimeOffset"), function(s){var v=s.val(); if(typeof v==="number"&&isFinite(v)){serverOffset=v; offsetReady=true}});
  showReady();
  try{wire()}catch(err){console.error(err); fail("The countdown glitched. Reload and try again.")}
}
$("retry").addEventListener("click", function(){location.reload()});
boot().catch(function(err){console.error(err); showBootError("The game didn't open. Check your connection and try again.")});
})();
