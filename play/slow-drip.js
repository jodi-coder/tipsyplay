(function(){
"use strict";
/* Slow Drip, one phone per player. rooms/$code/sd
   The acting host's phone runs the round with DripLogic and publishes only what everyone may see (sd/pub):
   the masked board, the timers' deadlines, and, at the payout, the bets. The phrase lives in host memory and in
   sd/secret, which only the host can read. Guests write three things, each to their own path: a buzz (sd/buzz,
   first write wins), a bet (sd/bet/$uid) and a guess (sd/guess/$uid).
   Practice mode runs the same engine on this phone alone, with three bots and no Firebase. */
var L=window.DripLogic, DATA=window.SlowDripData;
var EMU=/[?&]emulator=1(?:&|$)/.test(location.search);
var FAST=EMU&&/[?&]fast=1(?:&|$)/.test(location.search);
var AWAY_MS=FAST?1500:8000;
var ALPHABET="ABCDEFGHJKMNPQRSTUVWXYZ";
var $=function(id){return document.getElementById(id)};
var mode="";            /* "", "room" or "practice" */
var uid=null, code=null, meta=null, players={}, pub=null, D=null, sdHost=null, buzzNode=null, leftMap={};
var myBet="", guessSent=false, sending=false, serverOffset=0, offsetReady=false;
var db=null, stops=[], hostStops=[], connStop=null, bootTimer=0, tickTimer=0, lastTick=0;
var ref, onValue, update, set, remove, onDisconnect, get, serverTimestamp, goOnline, runTransaction;
/* host only */
var G=null, bets={}, guesses={}, hostLock=false, claimedNow=false, claiming=false, hostAwaySince=0, resuming=false;
/* practice only */
var BOTS=[{uid:"bot1", name:"Ada (bot)"}, {uid:"bot2", name:"Max (bot)"}, {uid:"bot3", name:"Zed (bot)"}], botPlan={};
/* painting */
var lastSeq=-1, lastPhase="", prevMask="", prevRound=0, lobbyErr="";

if(FAST&&L){L.T.drip=4000; L.T.bet=1500; L.T.seat=6000; L.T.payout=1500}

/* ---------- small helpers ---------- */
function serverNow(){return Date.now()+(mode==="room"&&offsetReady?serverOffset:0)}
function rpath(p){return "rooms/"+code+"/"+p}
function fail(msg){var p=$("perr"); if(p) p.textContent=msg||""; lobbyErr=msg||""; var l=$("lobby"); if(l&&!l.classList.contains("hide")&&meta) paintLobby()}
function friendly(e){
  var c=String((e&&(e.code||e.message))||"");
  if(/permission|denied/i.test(c)) return "The server did not accept the game. The site owner needs to publish the latest firebase-rules.json, then try again.";
  if(/offline|network|fetch/i.test(c)) return "You're offline. Check the connection and try again.";
  return "Something went wrong. Try again.";
}
function isOwner(){return !!(meta&&uid&&meta.hostUid===uid)}
function hostId(){return mode==="practice"?uid:(sdHost||(meta&&meta.hostUid)||"")}
function amHost(){return !!uid&&hostId()===uid}
function normCode(v){
  var s=String(v||""), m=s.match(/(?:room|code)=([A-Za-z]{4})/i);
  if(m) return m[1].toUpperCase();
  return s.toUpperCase().replace(/[^ABCDEFGHJKMNPQRSTUVWXYZ]/g,"").slice(0,4);
}
function validCode(c){return /^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(c)}
function makeRoomCode(){var s="", i; for(i=0;i<4;i++) s+=ALPHABET.charAt(L.rng(ALPHABET.length)); return s}
function queryRoom(){var m=String(location.search||"").match(/[?&](?:room|code)=([A-Za-z]{4})/i); var c=m?normCode(m[1]):""; return validCode(c)?c:""}
function roomUrl(c){
  if(window.TipsyJoinQR) return TipsyJoinQR.pageInvite("/play/slow-drip.html", c, "sd");
  return "https://tipsyplay.com/play/slow-drip.html?room="+c+"&game=sd";
}
function order(){
  return Object.keys(players).map(function(id){var p=players[id]; return {uid:id, name:p.name||"Player", connected:p.connected!==false, joinedAt:p.joinedAt||0}})
    .sort(function(a,b){return a.joinedAt-b.joinedAt||a.name.localeCompare(b.name)});
}
function nm(id){
  if(D&&D.names&&D.names[id]) return D.names[id];
  return (players[id]&&players[id].name)||"Player";
}
function screen(id){["home","lobby","table","closed"].forEach(function(s){var n=$(s); if(n) n.classList.toggle("hide", s!==id)})}
function show(id, on){var n=$(id); if(n) n.classList.toggle("hide", !on)}
function el(tag, cls, text){var n=document.createElement(tag); if(cls) n.className=cls; if(text!=null) n.textContent=text; return n}
function sound(name){if(window.TPSound&&TPSound[name]){try{TPSound[name]()}catch(e){}}}
function keyed(box, key){if(box.dataset.key===key) return false; box.dataset.key=key; box.textContent=""; return true}
function inGame(){return !!(D&&D.order&&D.order.indexOf(uid)>=0)}
function list(names){return names.length<2?names.join(""):names.slice(0,-1).join(", ")+" and "+names[names.length-1]}

/* ---------- rendering ---------- */
function render(){
  document.body.classList.toggle("is-host", amHost());
  document.body.classList.toggle("sd-practice", mode==="practice");
  if(mode==="practice"){screen("table"); paintTable(); return}
  if(!meta){screen("home"); return}
  if(meta.status==="lobby"||!pub||!D){screen("lobby"); paintLobby(); return}
  screen("table");
  paintTable();
}
function paintLobby(){
  $("codebig").textContent=code||"";
  $("sharelink").textContent=roomUrl(code);
  paintQr();
  var people=order(), box=$("plist"); box.textContent="";
  people.forEach(function(p){
    var row=el("div", "sd-person"+(p.connected?"":" off"));
    row.appendChild(el("span", null, p.name+(p.uid===meta.hostUid?" · host":"")));
    row.appendChild(el("span", null, p.connected?"":"away"));
    if(isOwner()&&p.uid!==uid){
      var kick=el("button", "x", "Remove"); kick.type="button"; kick.setAttribute("aria-label", "Remove "+p.name);
      kick.addEventListener("click", function(){remove(ref(db, rpath("players/"+p.uid))).catch(function(e){fail(friendly(e))})});
      row.appendChild(kick);
    }
    box.appendChild(row);
  });
  var na=!!meta.na, ona=$("ona");
  ona.checked=na; ona.disabled=!isOwner();
  $("drinknote").textContent=na?"No-alcohol mode: every penalty is a quick no-drink dare.":"Losing a bet or a solve means take a drink, or do the no-drink alternative on screen.";
  var n=people.length, dup=dupName(people);
  var start=$("start");
  start.classList.toggle("hide", !isOwner());
  $("close").classList.toggle("hide", !isOwner());
  $("qrfig").classList.toggle("hide", !isOwner());
  start.disabled=!isOwner()||n<L.MIN_PLAYERS||n>L.MAX_PLAYERS||!!dup||sending;
  start.textContent="Start game · "+n+" player"+(n===1?"":"s");
  var note=$("lobbynote");
  note.classList.toggle("err", !!lobbyErr);
  if(lobbyErr) note.textContent=lobbyErr;
  else if(n<L.MIN_PLAYERS) note.textContent="Need "+(L.MIN_PLAYERS-n)+" more player"+(L.MIN_PLAYERS-n===1?"":"s")+".";
  else if(n>L.MAX_PLAYERS) note.textContent=L.MAX_PLAYERS+" players max.";
  else if(dup) note.textContent="Two players are called "+dup+". One of you, rejoin with another name.";
  else note.textContent=isOwner()?"Everyone in? Start when ready.":"You're in. The host starts when the table's ready.";
}
function dupName(people){
  var seen={}, d="";
  people.forEach(function(p){var k=L.cleanName(p.name).toLowerCase(); if(seen[k]) d=p.name; seen[k]=1});
  return d;
}
function paintQr(){
  var canvas=$("qr");
  if(!canvas||!code||!window.TipsyJoinQR||canvas.dataset.hidden==="1") return;
  TipsyJoinQR.draw(canvas, roomUrl(code));
  var credit=$("qrcredit"); if(credit&&!credit.textContent) credit.textContent=TipsyJoinQR.credit;
}
/* A timer you can read three ways: the number, the length of the bar, and the colour, which moves from yellow to pink. */
function paintTimer(id, numId, leftMs, totalMs, frozen){
  var box=$(id), left=Math.max(0, leftMs), secs=Math.ceil(left/1000);
  var p=totalMs>0?Math.max(0, Math.min(1, 1-left/totalMs)):1;
  box.style.setProperty("--p", p.toFixed(3));
  box.classList.toggle("hot", !frozen&&p>=0.66);
  box.classList.toggle("frozen", !!frozen);
  if($(numId).textContent!==String(secs)) $(numId).textContent=String(secs);
  return secs;
}
function paintTable(){
  if(!pub||!D) return;
  var ph=pub.phase, now=serverNow(), left=pub.deadline-now, me=inGame();
  $("roundline").textContent="Round "+D.round;
  $("catline").textContent=D.cat;
  paintScores();
  paintBoard();
  /* the host's phone going away */
  var notice="";
  if(mode==="room"){
    var h=hostId(), hp=players[h];
    if(h&&h!==uid&&(!hp||hp.connected===false)&&ph!=="over") notice="The host's phone is away. Hang on, the game will carry on shortly.";
  }
  $("notice").textContent=notice;

  /* 1. drip */
  var pendingBuzz=ph==="drip"&&buzzNode&&buzzNode.u;
  show("dripbox", ph==="drip");
  if(ph==="drip"){
    paintTimer("driptimer", "dripnum", left, L.T.drip, !!pendingBuzz);
    var boxed=D.box&&D.box[uid], sv=$("solve");
    sv.disabled=!me||!!boxed||!!pendingBuzz||sending;
    var sn="";
    if(pendingBuzz) sn=(buzzNode.u===uid?"You buzzed!":nm(buzzNode.u)+" buzzed!");
    else if(!me) sn="You're watching this game.";
    else if(boxed==="round") sn="Penalty box: you sit out the rest of this round.";
    else if(boxed) sn="Penalty box: you can buzz again after "+boxed+" more letter"+(boxed===1?"":"s")+".";
    else sn="First buzz wins. Then everyone else bets on you.";
    $("solvenote").textContent=sn;
  }
  /* 2 and 3. betting window */
  show("betbox", ph==="bet");
  if(ph==="bet"){
    var solving=D.solver===uid;
    paintTimer("bettimer", "betnum", left, L.T.bet, false);
    $("bethead").textContent=solving?"Waiting for bets…":nm(D.solver)+" is solving.";
    show("bets", !solving&&me); $("betpass").parentNode.classList.toggle("hide", solving||!me);
    var bn="";
    if(solving) bn="Get ready. You'll have "+Math.round(L.T.seat/1000)+" seconds to type the phrase.";
    else if(!me) bn="The others are betting.";
    else if(myBet==="s") bn="Locked in: SOLVE. Bets stay hidden until the window closes.";
    else if(myBet==="f") bn="Locked in: FAIL. Bets stay hidden until the window closes.";
    else if(myBet==="p") bn="You passed this one. No drink either way.";
    else bn="Will they get it? No bet in time counts as FAIL.";
    $("betnote").textContent=bn;
    ["betsolve","betfail","betpass"].forEach(function(id){
      var b=$(id); b.disabled=!!myBet;
      if(b.hasAttribute("aria-pressed")) b.setAttribute("aria-pressed", myBet===b.dataset.bet?"true":"false");
    });
  }
  /* 4. hot seat */
  show("seatbox", ph==="seat");
  if(ph==="seat"){
    var mine=D.solver===uid;
    paintTimer("seattimer", "seatnum", left, L.T.seat, false);
    $("seathead").textContent=mine?"Your answer":nm(D.solver)+" is in the hot seat";
    show("guessform", mine);
    $("guess").disabled=guessSent; $("sendguess").disabled=guessSent;
    var st="";
    if(mine) st=guessSent?"Sent. Checking…":"Type the phrase. Small typos are fine. Out of time counts as wrong.";
    else if(!me) st="";
    else if(myBet==="s") st="You bet SOLVE.";
    else if(myBet==="f") st="You bet FAIL.";
    else if(myBet==="p") st="You passed. No drink either way.";
    else st="No bet in time: counted as FAIL.";
    $("seatnote").textContent=st;
  }
  /* 5. payout after a wrong answer */
  show("payoutbox", ph==="payout"&&!!D.payout);
  if(ph==="payout"&&D.payout){
    var pb=$("payoutbox");
    if(keyed(pb, "p"+pub.seq)){
      paintPayout(pb, D.payout);
      var bx=D.box&&D.box[D.payout.solver];
      pb.appendChild(el("p", null, nm(D.payout.solver)+(bx==="round"?" sits out the rest of this round.":" sits out until "+L.BOX_DROPS+" more letters drop.")));
      var r=el("p", "sd-note"); r.id="resumeline"; pb.appendChild(r);
    }
    var rl=$("resumeline"); if(rl) rl.textContent="The drip resumes in "+Math.max(0, Math.ceil(left/1000))+"…";
  }
  /* 7. round end */
  show("endbox", ph==="end");
  if(ph==="end"&&keyed($("endbox"), "e"+pub.seq)) paintEnd($("endbox"));
  show("finale", ph==="over");
  if(ph==="over"&&keyed($("finalbox"), "o"+pub.seq)) paintFinal($("finalbox"));
  /* host controls: one main action at a time */
  var hosting=amHost();
  $("skipwait").classList.toggle("hide", !(hosting&&ph==="payout"));
  $("nextround").classList.toggle("hide", !(hosting&&ph==="end"));
  $("endgame").classList.toggle("hide", !(hosting&&ph==="end"));
  $("again").classList.toggle("hide", !hosting);
  $("exitpractice").classList.toggle("hide", mode!=="practice");
  $("leave").classList.toggle("hide", mode!=="room"||isOwner()||!me);
  $("closestage").classList.toggle("hide", mode!=="room"||!isOwner());
}
function paintScores(){
  var box=$("scores"), key=JSON.stringify([D.order, D.scores, D.box, D.names]);
  if(!keyed(box, key)) return;
  D.order.forEach(function(u){
    var boxed=D.box&&D.box[u];
    var li=el("li", (u===uid?"me":"")+(boxed?" boxed":""));
    li.appendChild(document.createTextNode(nm(u)));
    li.appendChild(el("b", null, String(D.scores[u]||0)));
    if(boxed) li.setAttribute("aria-label", nm(u)+", "+(D.scores[u]||0)+" solved, in the penalty box");
    box.appendChild(li);
  });
}
function paintBoard(){
  var box=$("board"), mask=D.mask||"";
  if(box.dataset.key===D.round+"|"+mask) return;
  var fresh=prevRound===D.round&&prevMask.length===mask.length;
  box.dataset.key=D.round+"|"+mask; box.textContent="";
  var word=null, i, hidden=0;
  for(i=0;i<mask.length;i++){
    var ch=mask.charAt(i);
    if(ch===" "){word=null; continue}
    if(!word){word=el("span", "sd-word"); box.appendChild(word)}
    var t;
    if(ch==="_"){t=el("span", "sd-tile blank", "_"); hidden++}
    else if(L.isLetter(ch)){t=el("span", "sd-tile", ch); if(fresh&&prevMask.charAt(i)==="_") t.classList.add("new")}
    else t=el("span", "sd-tile mark", ch);
    word.appendChild(t);
  }
  if(fresh&&mask!==prevMask&&pub.phase==="drip") sound("tick");
  prevMask=mask; prevRound=D.round;
  box.setAttribute("aria-label", "The phrase: "+mask.replace(/_/g, " blank ").replace(/\s+/g," "));
  $("boardtext").textContent=pub.phase==="end"||pub.phase==="over"?"The phrase was "+mask+".":D.cat+". "+hidden+" letter"+(hidden===1?"":"s")+" still hidden.";
}
/* The result and every bet, together. Each drink shows who and why, with the no-drink alternative right below. */
function paintPayout(box, p){
  var who=nm(p.solver);
  box.appendChild(el("p", "tag", who+(p.timeout?" ran out of time":" guessed")));
  box.appendChild(el("p", "sd-result", p.correct?"Correct!":p.timeout?"Time's up!":"Wrong!"));
  if(p.guess&&!p.correct) box.appendChild(el("p", "sd-said", "“"+p.guess+"”"));
  var bl=el("ul", "sd-betlist");
  Object.keys(p.bets||{}).forEach(function(u){
    var b=p.bets[u], txt=b==="s"?"bet SOLVE":b==="p"?"passed":(p.missed&&p.missed[u])?"no bet, so FAIL":"bet FAIL";
    bl.appendChild(el("li", null, nm(u)+" "+txt));
  });
  if(bl.children.length) box.appendChild(bl);
  if(!p.drinks||!p.drinks.length){box.appendChild(el("p", "sd-safe", "Everyone is safe. Nobody drinks.")); return}
  var anyDrink=p.drinks.some(function(d){return d.what==="drink"});
  var bn=el("div", "sd-banner"); bn.setAttribute("role", "status");
  bn.appendChild(el("h3", null, anyDrink?"Take a drink":"Penalty time"));
  var ul=el("ul");
  p.drinks.forEach(function(d){
    var line=d.what==="drink"?nm(d.uid)+": take a drink ("+d.why+")"
      :d.capped?nm(d.uid)+": already had a drink this round, so do the alternative ("+d.why+")"
      :nm(d.uid)+": do the alternative ("+d.why+")";
    ul.appendChild(el("li", null, line));
  });
  bn.appendChild(ul);
  bn.appendChild(el("p", null, (anyDrink?"Or skip the drink and ":"The alternative: ")+p.alt+"."));
  bn.appendChild(el("p", null, "Drinking is optional. Passing is always fine."));
  box.appendChild(bn);
  if(p.safe&&p.safe.length) box.appendChild(el("p", "sd-safe", "Safe: "+list(p.safe.map(nm))+"."));
}
function paintRank(box){
  var ol=el("ol", "sd-rank");
  var rows=Object.keys(D.scores).map(function(u){return {uid:u, name:nm(u), score:D.scores[u]||0, here:D.order.indexOf(u)>=0}})
    .sort(function(a,b){return b.score-a.score||a.name.localeCompare(b.name)});
  rows.forEach(function(r){
    var li=el("li", r.here?"":"gone");
    li.appendChild(el("span", null, r.name+(r.here?"":" (left)")));
    li.appendChild(el("span", null, r.score+" solved"));
    ol.appendChild(li);
  });
  box.appendChild(ol);
  return rows;
}
function paintEnd(box){
  var e=D.end||{};
  box.appendChild(el("p", "tag", "The phrase"));
  box.appendChild(el("p", "sd-phrase", e.phrase||D.mask));
  if(e.reason==="solved"&&D.payout){
    box.appendChild(el("p", "sd-safe", "Solved by "+nm(e.solver)+"."));
    paintPayout(box, D.payout);
  }else if(e.reason==="void") box.appendChild(el("p", "sd-safe", "The host changed, so this round was skipped. Nobody drinks."));
  else box.appendChild(el("p", "sd-safe", "Every letter dropped and nobody solved it. Nobody drinks."));
  box.appendChild(el("h2", null, "Scoreboard"));
  paintRank(box);
  if(!amHost()) box.appendChild(el("p", null, "Waiting for "+(nm(hostId())||"the host")+" to start the next round."));
}
function paintFinal(box){
  box.appendChild(el("p", "tag", "Game over"));
  box.appendChild(el("h2", null, "Final scores"));
  var rows=paintRank(box), top=rows.length?rows[0].score:0;
  var winners=rows.filter(function(r){return r.score===top&&top>0}).map(function(r){return r.name});
  box.insertBefore(el("p", "sd-result", winners.length?list(winners)+(winners.length>1?" share the win":" wins"):"No rounds solved"), box.children[2]||null);
  if(!amHost()) box.appendChild(el("p", null, "The host can start a new game."));
}

/* ---------- player actions ---------- */
function doBuzz(){
  if(!pub||pub.phase!=="drip"||!inGame()||(D.box&&D.box[uid])||(buzzNode&&buzzNode.u)||sending) return;
  sound("blip");
  if(mode==="practice"){buzzNode={u:uid, at:serverNow()}; hostTick(); render(); return}
  sending=true;
  /* A transaction: if a buzz is already there, this one backs off. The rules also refuse to replace a buzz. */
  runTransaction(ref(db, rpath("sd/buzz")), function(cur){
    if(cur) return;
    return {u:uid, at:serverTimestamp()};
  }).catch(function(){/* someone else was first, or the letters stopped dripping */}).then(function(){sending=false; render()});
  render();
}
function doBet(v){
  if(!pub||pub.phase!=="bet"||!inGame()||D.solver===uid||myBet) return;
  myBet=v; sound("click");
  if(mode==="practice"){bets[uid]=v; hostTick(); render(); return}
  set(ref(db, rpath("sd/bet/"+uid)), v).catch(function(e){myBet=""; fail(friendly(e)); render()});
  render();
}
function doGuess(){
  if(!pub||pub.phase!=="seat"||D.solver!==uid||guessSent) return;
  var text=String($("guess").value||"").replace(/\s+/g," ").trim().slice(0, L.GUESS_MAX);
  if(!text){$("guess").focus(); return}
  guessSent=true;
  if(mode==="practice"){guesses[uid]=text; hostTick(); render(); return}
  set(ref(db, rpath("sd/guess/"+uid)), text).catch(function(e){guessSent=false; fail(friendly(e)); render()});
  render();
}
var leaveArmed=0;
function leaveGame(){
  if(mode!=="room"||!code||isOwner()) return;
  if(Date.now()-leaveArmed>3000){leaveArmed=Date.now(); fail("Tap Leave again to leave the game."); return}
  fail("");
  var p={}; p[rpath("sd/left/"+uid)]=true; p[rpath("players/"+uid+"/connected")]=false;
  update(ref(db), p).catch(function(){}).then(function(){
    leaveRoom(); screen("home"); fail("You left the game.");
  });
}

/* ---------- host: publishing ---------- */
/* One atomic write per change: the public view, the host-only secret, the penalty-box flags, and any inputs to clear. */
function publish(opts){
  opts=opts||{};
  var view=L.publicView(G), seq=(pub?pub.seq:0)+1;
  var pubObj={phase:G.phase, seq:seq, deadline:G.deadline||0, data:JSON.stringify(view)};
  var inputs=opts.inputs||G.phase==="end"||G.phase==="over";
  var clearBuzz=opts.buzz||G.phase==="end"||G.phase==="over";
  if(mode==="practice"){
    if(inputs){bets={}; guesses={}}
    if(clearBuzz) buzzNode=null;
    pub=pubObj; onPub();
    return Promise.resolve(true);
  }
  var payload=Object.assign({}, opts.more||{});
  payload[rpath("sd/pub")]=pubObj;
  payload[rpath("sd/secret")]=JSON.stringify(G);
  Object.keys(G.names).forEach(function(u){
    payload[rpath("sd/box/"+u)]=G.box[u]?true:null;
    if(inputs){payload[rpath("sd/bet/"+u)]=null; payload[rpath("sd/guess/"+u)]=null}
  });
  if(clearBuzz) payload[rpath("sd/buzz")]=null;
  (opts.left||[]).forEach(function(u){payload[rpath("sd/left/"+u)]=null});
  hostLock=true;
  return update(ref(db), payload).then(function(){hostLock=false; return true}).catch(function(e){hostLock=false; if(amHost()) fail(friendly(e)); return false});
}
function metaObj(patch){
  var m=Object.assign({}, meta||{}, patch||{});
  var out={hostUid:m.hostUid, createdAt:m.createdAt, status:m.status, phase:m.phase, spice:"mild", rounds:10, na:!!m.na, round:0, gameId:+m.gameId||1, kind:"sd"};
  if(m.status!=="lobby") out.deck=["Slow Drip"];
  return out;
}

/* ---------- host: game flow ---------- */
function begin(){
  if(!isOwner()||sending||!meta||meta.status!=="lobby") return;
  var people=order();
  if(people.length<L.MIN_PLAYERS||people.length>L.MAX_PLAYERS){fail("Need "+L.MIN_PLAYERS+" to "+L.MAX_PLAYERS+" players."); return}
  if(dupName(people)){fail("Two players share a name."); return}
  sending=true; fail("");
  G=L.newGame(people.map(function(p){return {uid:p.uid, name:p.name}}), {na:!!meta.na});
  L.startRound(G, DATA.list, serverNow());
  bets={}; guesses={};
  var more={};
  more[rpath("meta")]=metaObj({status:"play", phase:"answer"});
  /* one atomic write: if the server refuses any part, the room stays a normal lobby and the host sees why */
  publish({inputs:true, buzz:true, more:more, left:people.map(function(p){return p.uid})}).then(function(ok){
    if(!ok) G=null; else listenHost();
    sending=false; render();
  });
}
function nextRound(){
  if(!amHost()||!G||hostLock||G.phase!=="end") return;
  L.startRound(G, DATA.list, serverNow());
  publish({inputs:true, buzz:true});
}
function endGame(){
  if(!amHost()||!G||hostLock||G.phase!=="end") return;
  L.endGame(G); publish({});
  sound("celebrate");
}
function playAgain(){
  if(!amHost()||!G||hostLock||G.phase!=="over") return;
  var here=G.order.map(function(u){return {uid:u, name:G.names[u]}});
  if(here.length<L.MIN_PLAYERS){fail("You need at least "+L.MIN_PLAYERS+" players for a new game."); return}
  var used=G.used.slice();
  G=L.newGame(here, {na:G.na}); G.used=used;
  L.startRound(G, DATA.list, serverNow());
  publish({inputs:true, buzz:true});
}
function skipWait(){
  if(!amHost()||!G||hostLock||G.phase!=="payout") return;
  L.resumeDrip(G, serverNow()); publish({buzz:true});
}
function awayMap(){
  var out={}; if(mode!=="room"||!G) return out;
  G.order.forEach(function(u){var p=players[u]; if(!p||p.connected===false) out[u]=true});
  return out;
}
/* The host's clock: reacts to buzzes, bets and guesses, and closes every timed phase from its stored deadline. */
function hostTick(){
  if(!amHost()||!G||hostLock||resuming) return;
  var now=serverNow();
  var gone=Object.keys(leftMap).filter(function(u){return leftMap[u]&&G.order.indexOf(u)>=0});
  if(gone.length){
    gone.forEach(function(u){L.leave(G, u, now)});
    publish({inputs:true, buzz:true, left:gone});
    return;
  }
  if(G.phase==="drip"&&buzzNode&&buzzNode.u){
    if(L.buzz(G, buzzNode.u, +buzzNode.at||now, now)){publish({inputs:true}); return}
    /* a buzz from the penalty box or from outside the game: clear it so the table is not stuck */
    if(mode==="practice") buzzNode=null; else remove(ref(db, rpath("sd/buzz"))).catch(function(){});
    return;
  }
  if(G.phase==="bet") Object.keys(bets).forEach(function(u){if(bets[u]) L.placeBet(G, u, String(bets[u]))});
  if(G.phase==="seat"&&G.solver&&typeof guesses[G.solver]==="string"){
    var right=L.submitGuess(G, G.solver, guesses[G.solver], now)&&G.payout&&G.payout.correct;
    sound(right?"celebrate":"no");
    publish({});
    return;
  }
  var ev=L.tick(G, now, null, awayMap());
  if(!ev) return;
  if(ev==="drip") publish({buzz:true});
  else publish({});
}
/* This phone has just become the host, or the host's phone reloaded: pick the game up from the saved state. */
function becomeHost(){
  if(mode!=="room"||G||resuming) return;
  resuming=true;
  get(ref(db, rpath("sd/secret"))).then(function(s){
    if(!s.exists()||!amHost()) return;
    var o=null; try{o=JSON.parse(s.val())}catch(e){o=null}
    if(!o||!o.order) return;
    G=o; listenHost();
    if(claimedNow){
      claimedNow=false;
      /* a new host could read the phrase, so the round in play is skipped: phrase shown, nobody drinks */
      if(L.voidRound(G)){resuming=false; publish({}); return}
    }
  }).catch(function(){}).then(function(){resuming=false; render()});
}
/* The host's phone has been away for a while: the first connected player in the seating order takes over. */
function takeoverTick(){
  if(mode!=="room"||!meta||meta.status!=="play"||!pub||!D||amHost()||claiming) return;
  var h=hostId(), hp=players[h];
  if(hp&&hp.connected!==false){hostAwaySince=0; return}
  if(!hostAwaySince){hostAwaySince=Date.now(); return}
  if(Date.now()-hostAwaySince<AWAY_MS) return;
  var next=(D.order||[]).filter(function(u){return u!==h&&players[u]&&players[u].connected!==false})[0];
  if(next!==uid) return;
  claiming=true; claimedNow=true;
  set(ref(db, rpath("sd/host")), uid).catch(function(){claimedNow=false}).then(function(){claiming=false; hostAwaySince=0});
}

/* ---------- practice: three bots on this phone ---------- */
function startPractice(){
  leaveRoom();
  var name=L.cleanName($("pname").value).slice(0, L.NAME_MAX)||"You";
  if(BOTS.some(function(b){return b.name.toLowerCase()===name.toLowerCase()})) name="You";
  mode="practice"; uid="you"; code=null; meta=null; players={}; sdHost=null; buzzNode=null; leftMap={}; bets={}; guesses={}; botPlan={};
  pub=null; D=null; lastSeq=-1; lastPhase=""; myBet=""; guessSent=false; fail("");
  G=L.newGame([{uid:"you", name:name}].concat(BOTS), {na:false});
  L.startRound(G, DATA.list, serverNow());
  publish({inputs:true, buzz:true});
  startTicker();
  render();
}
function exitPractice(){
  if(mode!=="practice") return;
  stopTicker(); mode=""; uid=authUid; G=null; pub=null; D=null; buzzNode=null; bets={}; guesses={}; botPlan={};
  document.body.classList.remove("sd-practice");
  show("finale", false); screen("home");
}
function botTick(dt){
  if(mode!=="practice"||!G) return;
  var now=serverNow(), frac=L.shownFraction(G);
  if(G.phase==="drip"&&!buzzNode){
    BOTS.some(function(b){
      if(!L.canBuzz(G, b.uid)||Math.random()>=L.botBuzzChance(frac, dt)) return false;
      buzzNode={u:b.uid, at:now}; return true;
    });
  }else if(G.phase==="bet"){
    BOTS.forEach(function(b){
      if(b.uid===G.solver||bets[b.uid]) return;
      var key="bet|"+pub.seq+"|"+b.uid, plan=botPlan[key];
      /* a bot picks at a random moment in the window, and now and then is too slow, which counts as FAIL */
      if(!plan) plan=botPlan[key]={at:now+300+Math.random()*(L.T.bet-500), v:Math.random()<0.1?"":(Math.random()<0.5?"s":"f")};
      if(plan.v&&now>=plan.at) bets[b.uid]=plan.v;
    });
  }else if(G.phase==="seat"&&/^bot/.test(G.solver)&&typeof guesses[G.solver]!=="string"){
    var k="guess|"+pub.seq, gp=botPlan[k];
    if(!gp) gp=botPlan[k]={at:now+1200+Math.random()*Math.min(4000, L.T.seat-2500), knows:Math.random()<L.botKnowsChance(frac)};
    if(now>=gp.at) guesses[G.solver]=gp.knows?G.phrase:"um… something "+G.cat.toLowerCase();
  }
}

/* ---------- the clock every phone runs ---------- */
function tick(){
  var now=Date.now(), dt=lastTick?Math.min(1000, now-lastTick):200; lastTick=now;
  if(mode==="practice") botTick(dt);
  hostTick();
  takeoverTick();
  if(pub&&(mode==="practice"||(meta&&meta.status!=="lobby"))) render();
}
function startTicker(){stopTicker(); lastTick=0; tickTimer=setInterval(tick, 200)}
function stopTicker(){if(tickTimer){clearInterval(tickTimer); tickTimer=0}}

/* ---------- listeners ---------- */
function onPub(){
  try{D=pub?JSON.parse(pub.data):null}catch(e){D=null}
  if(pub&&pub.seq!==lastSeq){
    if(pub.phase!==lastPhase){
      if(pub.phase==="bet"){myBet=""; guessSent=false; $("guess").value=""; sound("blip")}
      if(pub.phase==="drip"&&lastPhase!=="drip"){myBet=""; guessSent=false}
      if(pub.phase==="seat"){sound("card"); if(D&&D.solver===uid) setTimeout(function(){try{$("guess").focus()}catch(e){}}, 30)}
      if(pub.phase==="payout") sound("no");
      if(pub.phase==="end") sound(D&&D.end&&D.end.reason==="solved"?"yes":"chime");
    }
    lastSeq=pub.seq; lastPhase=pub.phase;
  }
  hostLock=false;
  render();
}
function stopAll(){stops.forEach(function(fn){try{fn()}catch(e){}}); stops=[]; stopHost(); if(connStop){connStop(); connStop=null}}
function stopHost(){hostStops.forEach(function(fn){try{fn()}catch(e){}}); hostStops=[]}
function hostCheck(){
  if(mode!=="room") return;
  if(amHost()){if(!G&&meta&&meta.status!=="lobby") becomeHost()}
  else if(G||hostStops.length){stopHost(); G=null; bets={}; guesses={}}
}
function listen(){
  stopAll();
  var watched=code;
  stops.push(onValue(ref(db, rpath("meta")), function(s){
    if(!s.exists()){if(watched!==code) return; roomEnded(); return}
    meta=s.val()||null; hostCheck(); render();
  }, function(){fail("That room isn't available.")}));
  stops.push(onValue(ref(db, rpath("players")), function(s){players=s.val()||{}; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("sd/host")), function(s){sdHost=s.val()||null; hostCheck(); render()}, function(){}));
  stops.push(onValue(ref(db, rpath("sd/pub")), function(s){pub=s.val()||null; onPub(); hostTick()}, function(){}));
  stops.push(onValue(ref(db, rpath("sd/buzz")), function(s){buzzNode=s.val()||null; render(); hostTick()}, function(){}));
  stops.push(onValue(ref(db, rpath("sd/left")), function(s){leftMap=s.val()||{}; hostTick()}, function(){}));
  /* this phone's own bet, so a reload in the middle of a window still shows it */
  stops.push(onValue(ref(db, rpath("sd/bet/"+uid)), function(s){var v=s.val(); myBet=typeof v==="string"?v:""; render()}, function(){}));
  startTicker();
}
function listenHost(){
  stopHost();
  hostStops.push(onValue(ref(db, rpath("sd/bet")), function(s){bets=s.val()||{}; hostTick()}, function(){}));
  hostStops.push(onValue(ref(db, rpath("sd/guess")), function(s){guesses=s.val()||{}; hostTick()}, function(){}));
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
/* Leaving a room, for any reason: every listener and the ticker stop, and the host state is dropped. */
function leaveRoom(){
  stopAll(); stopTicker();
  if(mode==="room"){try{sessionStorage.removeItem("tp_sd_room")}catch(e){}}
  mode=""; code=null; meta=null; pub=null; D=null; G=null; sdHost=null; buzzNode=null; leftMap={}; bets={}; guesses={};
  players={}; myBet=""; guessSent=false; hostAwaySince=0; claiming=false; claimedNow=false; lastSeq=-1; lastPhase="";
}
function roomEnded(){leaveRoom(); fail("This room has closed."); screen("home")}

/* ---------- rooms ---------- */
var authUid=null;
async function hostRoom(name){
  var i, claimed=null;
  for(i=0;i<6;i++){
    var c=makeRoomCode();
    var snap=await get(ref(db, "rooms/"+c+"/meta"));
    if(snap.exists()) continue;
    try{
      await update(ref(db), {["rooms/"+c+"/meta"]:{hostUid:uid, createdAt:serverTimestamp(), status:"lobby", phase:"lobby", spice:"mild", rounds:10, na:false, round:0, gameId:1, kind:"sd"}});
      claimed=c; break;
    }catch(e){if(!/permission/i.test(String(e.code||e.message||""))) throw e}
  }
  if(!claimed) throw new Error("room");
  await set(ref(db, "rooms/"+claimed+"/players/"+uid), {name:name, connected:true, joinedAt:Date.now()+(offsetReady?serverOffset:0)});
  enterRoom(claimed);
}
async function joinRoom(c, name){
  var snap=await get(ref(db, "rooms/"+c+"/meta"));
  if(!snap.exists()) throw new Error("missing");
  var m=snap.val()||{};
  if(m.kind!=="sd") throw new Error("kind");
  var mineSnap=await get(ref(db, "rooms/"+c+"/players/"+uid));
  if(m.status!=="lobby"&&!mineSnap.exists()) throw new Error("closed");
  var prev=mineSnap.val()||{};
  if(!mineSnap.exists()){
    var all=(await get(ref(db, "rooms/"+c+"/players"))).val()||{};
    if(Object.keys(all).length>=L.MAX_PLAYERS) throw new Error("full");
    var err=L.nameError(name, Object.keys(all).map(function(k){return all[k].name}));
    if(err) throw new Error("name:"+err);
  }
  await set(ref(db, "rooms/"+c+"/players/"+uid), {name:prev.name||name, connected:true, joinedAt:prev.joinedAt||(Date.now()+(offsetReady?serverOffset:0))});
  enterRoom(c);
}
function enterRoom(c){
  if(mode==="practice") exitPractice();
  mode="room"; code=c; uid=authUid;
  try{sessionStorage.setItem("tp_sd_room", code); localStorage.setItem("tp_last_game", "slow-drip")}catch(e){}
  listen(); armPresence();
}
var closeArmed=0;
function askClose(){
  if(!isOwner()||!code) return;
  if(Date.now()-closeArmed>2500){closeArmed=Date.now(); fail("Tap close again to end the room for everyone."); return}
  fail(""); remove(ref(db, "rooms/"+code)).catch(function(e){fail(friendly(e))});
  try{sessionStorage.removeItem("tp_sd_room")}catch(e){}
}
function setNa(on){
  if(!isOwner()||!meta||meta.status!=="lobby") return;
  update(ref(db), {[rpath("meta")]:metaObj({na:!!on})}).catch(function(e){fail(friendly(e))});
}
function copyText(text){
  if(navigator.clipboard&&navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  return Promise.reject(new Error("clipboard"));
}

/* ---------- wiring ---------- */
function wire(){
  var saved=""; try{saved=localStorage.getItem("tp_name")||""}catch(e){}
  if(saved&&!$("pname").value) $("pname").value=L.cleanName(saved).slice(0, L.NAME_MAX);
  var linked=queryRoom(); if(linked) $("roomcode").value=linked;
  var mute=$("mute"); if(window.TPSound&&mute) TPSound.bindMute(mute);
  $("hostbtn").addEventListener("click", function(){
    if(!db){fail("Still connecting. Try again in a moment, or use Practice."); return}
    var name=L.cleanName($("pname").value), err=L.nameError(name, []);
    if(err){fail(err); $("pname").focus(); return}
    if(sending) return; sending=true; fail("");
    try{localStorage.setItem("tp_name", name)}catch(e){}
    hostRoom(name).catch(function(e){fail(e&&e.message==="room"?"Couldn't open a room. Try again.":friendly(e))}).then(function(){sending=false});
  });
  $("joinform").addEventListener("submit", function(e){e.preventDefault(); $("joinbtn").click()});
  $("joinbtn").addEventListener("click", function(){
    if(!db){fail("Still connecting. Try again in a moment, or use Practice."); return}
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
  $("practicebtn").addEventListener("click", startPractice);
  $("exitpractice").addEventListener("click", exitPractice);
  $("ona").addEventListener("change", function(){setNa($("ona").checked)});
  $("start").addEventListener("click", begin);
  $("solve").addEventListener("click", doBuzz);
  ["betsolve","betfail","betpass"].forEach(function(id){$(id).addEventListener("click", function(){doBet($(id).dataset.bet)})});
  $("guessform").addEventListener("submit", function(e){e.preventDefault(); doGuess()});
  $("skipwait").addEventListener("click", skipWait);
  $("nextround").addEventListener("click", nextRound);
  $("endgame").addEventListener("click", endGame);
  $("again").addEventListener("click", playAgain);
  $("leave").addEventListener("click", leaveGame);
  $("close").addEventListener("click", askClose);
  $("closestage").addEventListener("click", askClose);
  $("copylink").addEventListener("click", function(){if(code) copyText(roomUrl(code)).then(function(){fail("Link copied.")}).catch(function(){fail(roomUrl(code))})});
  $("copycode").addEventListener("click", function(){if(code) copyText(code).then(function(){fail("Code copied.")}).catch(function(){fail(code)})});
  $("sharebtn").addEventListener("click", function(){
    if(!code) return;
    if(navigator.share) navigator.share({title:"Slow Drip", text:"Join my Slow Drip room "+code, url:roomUrl(code)}).catch(function(){});
    else copyText(roomUrl(code)).then(function(){fail("Link copied.")}).catch(function(){fail(roomUrl(code))});
  });
  $("qrhide").addEventListener("click", function(){
    var canvas=$("qr"), hidden=canvas.dataset.hidden==="1";
    canvas.dataset.hidden=hidden?"0":"1"; canvas.classList.toggle("hide", !hidden);
    $("qrhide").textContent=hidden?"Hide QR":"Show QR"; if(hidden) paintQr();
  });
  window.addEventListener("online", function(){fail(""); if(goOnline&&db){try{goOnline(db)}catch(e){}}});
  window.addEventListener("pagehide", function(){stopTicker()});
  window.addEventListener("pageshow", function(){if(mode&&!tickTimer) startTicker()});
  if(EMU) window.__tpDrip={uid:function(){return uid}, code:function(){return code}, phase:function(){return pub&&pub.phase}, data:function(){return D}, host:function(){return amHost()},
    mode:function(){return mode}, phrase:function(){return G?G.phrase:null}, deadline:function(){return pub&&pub.deadline}, now:function(){return serverNow()}};
}
var wired=false;
function wireOnce(){if(wired) return; wired=true; wire()}

/* ---------- boot ---------- */
function showReady(){if(bootTimer){clearTimeout(bootTimer); bootTimer=0} show("boot", false); show("app", true)}
function showBootError(msg){
  if(bootTimer){clearTimeout(bootTimer); bootTimer=0}
  show("boot", true); show("app", false);
  $("bootmsg").textContent="Couldn't open the game.";
  $("booterr").textContent=msg||"Check your connection and try again."; $("booterr").classList.remove("hide");
  $("retry").classList.remove("hide");
  if(L&&DATA) $("bootpractice").classList.remove("hide");
}
async function boot(){
  if(!L||!DATA){showBootError("The game rules didn't load. Reload the page."); return}
  /* practice needs nothing from the network */
  if(/[?&]practice=1(?:&|$)/.test(location.search)){showReady(); wireOnce(); startPractice(); return}
  bootTimer=setTimeout(function(){if($("app").classList.contains("hide")) showBootError("This is taking too long. Check your connection and try again.")}, 12000);
  if(!navigator.onLine&&!EMU){showBootError("You're offline. Reconnect, then try again."); return}
  var base="https://www.gstatic.com/firebasejs/12.4.0/";
  var appMod=await import(base+"firebase-app.js");
  var authMod=await import(base+"firebase-auth.js");
  var dbMod=await import(base+"firebase-database.js");
  var cfg=await import("../firebase-config.js?v=17");
  var app=appMod.initializeApp(cfg.firebaseConfig);
  var authObj=authMod.getAuth(app);
  var database=dbMod.getDatabase(app);
  ref=dbMod.ref; onValue=dbMod.onValue; update=dbMod.update; set=dbMod.set; remove=dbMod.remove; onDisconnect=dbMod.onDisconnect; get=dbMod.get;
  serverTimestamp=dbMod.serverTimestamp; goOnline=dbMod.goOnline; runTransaction=dbMod.runTransaction;
  if(EMU){
    authMod.connectAuthEmulator(authObj, "http://127.0.0.1:9099", {disableWarnings:true});
    dbMod.connectDatabaseEmulator(database, "127.0.0.1", 9000);
  }
  if(authMod.setPersistence&&authMod.browserLocalPersistence){try{await authMod.setPersistence(authObj, authMod.browserLocalPersistence)}catch(e){}}
  if(authObj.authStateReady) await authObj.authStateReady();
  var cred=authObj.currentUser?{user:authObj.currentUser}:await authMod.signInAnonymously(authObj);
  await cred.user.getIdToken();
  authUid=cred.user.uid; if(mode!=="practice") uid=authUid;
  db=database;
  onValue(ref(db, ".info/serverTimeOffset"), function(s){var v=s.val(); if(typeof v==="number"&&isFinite(v)){serverOffset=v; offsetReady=true}});
  if(mode!=="practice") showReady();
  wireOnce();
  var back=""; try{back=sessionStorage.getItem("tp_sd_room")||""}catch(e){}
  var linked=queryRoom(), name=L.cleanName($("pname").value);
  if(mode!=="practice"&&back&&validCode(back)&&name&&(!linked||linked===back)) joinRoom(back, name).catch(function(){try{sessionStorage.removeItem("tp_sd_room")}catch(err){}});
}
$("retry").addEventListener("click", function(){location.reload()});
$("bootpractice").addEventListener("click", function(){show("boot", false); show("app", true); wireOnce(); startPractice()});
boot().catch(function(err){console.error(err); if(mode!=="practice") showBootError("The game didn't open. Check your connection and try again.")});
})();
