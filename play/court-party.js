(function(){
"use strict";
/* Hot Take Court, one phone per player, plus an optional TV display (play/display.html). rooms/$code/hc
   The acting host's phone runs the game with CourtLogic and publishes only what everyone may see (hc/pub).
   The full game state lives in host memory and in hc/secret, which only the acting host can read.
   The three takes offered to the Defendant go to hc/offer/$uid, readable only by them and the host.
   Players write only their own entries: pick, rest, obj, vote, sent, choice, left. Votes stay unreadable to other
   players until the verdict publishes them. Every timer is a server-time deadline in hc/pub. */
var L=window.CourtLogic, DATA=window.CourtData, FX=window.PartyFX, SCR=window.CourtScreen;
var SND=(FX&&FX.sounds)||{};
var EMU=/[?&]emulator=1(?:&|$)/.test(location.search);
var FAST=EMU&&/[?&]fast=1(?:&|$)/.test(location.search);
if(FAST&&L) L.fast();
var AWAY_MS=FAST?1500:8000, SCREEN_FRESH=25000;
var ALPHABET="ABCDEFGHJKMNPQRSTUVWXYZ";
var $=function(id){return document.getElementById(id)};
var uid=null, authUid=null, code=null, meta=null, players={}, pub=null, D=null, hcHost=null, screenAt=0, leftMap={}, objMap={};
var myOffer=null, myPick=null, myRest="", myVote="", mySent="", myChoice="", sending=false, serverOffset=0, offsetReady=false, lobbyErr="";
var db=null, stops=[], hostStops=[], connStop=null, bootTimer=0, tickTimer=0, beatTimer=0;
var ref, onValue, update, set, remove, onDisconnect, get, serverTimestamp, goOnline;
/* host only */
var G=null, phaseAt=0, lastKey="", picks={}, rests={}, votes={}, sents={}, choices={}, hostLock=false, resuming=false, claimedNow=false, claiming=false, hostAwaySince=0;
var lastSeq=-1, lastPhase="", lastMineKey="", lastTurnKey="";

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
function hostId(){return hcHost||(meta&&meta.hostUid)||""}
function amHost(){return !!uid&&hostId()===uid}
function normCode(v){var s=String(v||""), m=s.match(/(?:room|code)=([A-Za-z]{4})/i); if(m) return m[1].toUpperCase(); return s.toUpperCase().replace(/[^ABCDEFGHJKMNPQRSTUVWXYZ]/g,"").slice(0,4)}
function validCode(c){return /^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(c)}
function makeRoomCode(){var s="", i; for(i=0;i<4;i++) s+=ALPHABET.charAt(L.rng(ALPHABET.length)); return s}
function queryRoom(){var m=String(location.search||"").match(/[?&](?:room|code)=([A-Za-z]{4})/i); var c=m?normCode(m[1]):""; return validCode(c)?c:""}
function roomUrl(c){if(window.TipsyJoinQR) return TipsyJoinQR.pageInvite("/play/hot-take-court.html", c, "hc"); return "https://tipsyplay.com/play/hot-take-court.html?room="+c+"&game=hc"}
function displayUrl(c){
  var local=/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(location.host);
  var base=(local?location.origin:"https://tipsyplay.com")+"/play/display.html?room="+c;
  return base+(EMU?"&emulator=1"+(FAST?"&fast=1":""):"");
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
function tag(){return D?D.caseNo:0}
function parseTag(v){var s=String(v||""), i=s.lastIndexOf(":"); if(i<0) return null; return {v:s.slice(0,i), n:+s.slice(i+1)}}
function displayOn(){return screenAt>0&&serverNow()-screenAt<SCREEN_FRESH}
function role(){
  if(!D||!D.order||D.order.indexOf(uid)<0) return "watch";
  if(uid===D.defendant) return "defendant";
  if(uid===D.prosecutor) return "prosecutor";
  return "juror";
}
function dupName(list){var seen={}, d=""; list.forEach(function(p){var k=L.cleanName(p.name).toLowerCase(); if(seen[k]) d=p.name; seen[k]=1}); return d}

/* ---------- rendering ---------- */
function render(){
  document.body.classList.toggle("is-host", amHost());
  if(!meta){screen("home"); return}
  if(meta.status==="lobby"||!pub||!D){screen("lobby"); paintLobby(); return}
  screen("table");
  paintTable();
}
function paintLobby(){
  $("codebig").textContent=code||"";
  $("sharelink").textContent=roomUrl(code);
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
  var pack=meta.spice||"mild", laps=+meta.laps===2?2:1;
  document.querySelectorAll("[data-pack]").forEach(function(b){b.setAttribute("aria-pressed", b.dataset.pack===pack?"true":"false"); b.disabled=!isOwner()});
  document.querySelectorAll("[data-laps]").forEach(function(b){b.setAttribute("aria-pressed", +b.dataset.laps===laps?"true":"false"); b.disabled=!isOwner()});
  $("ona").checked=!!meta.na; $("ona").disabled=!isOwner();
  $("tvlink").textContent=displayUrl(code);
  var qr=$("tvqr"); if(qr&&window.TipsyJoinQR&&qr.dataset.for!==code){qr.dataset.for=code; TipsyJoinQR.draw(qr, displayUrl(code))}
  $("tvstate").textContent=displayOn()?"A display is connected.":"No display yet. The host's phone shows the shared screen instead.";
  var n=list.length, dup=dupName(list), start=$("start");
  start.classList.toggle("hide", !isOwner()); $("close").classList.toggle("hide", !isOwner());
  start.disabled=!isOwner()||n<L.MIN_PLAYERS||n>L.MAX_PLAYERS||!!dup||sending;
  start.textContent="Start game · "+n+" player"+(n===1?"":"s");
  var note=$("lobbynote"); note.classList.toggle("err", !!lobbyErr);
  if(lobbyErr) note.textContent=lobbyErr;
  else if(n<L.MIN_PLAYERS) note.textContent="Need "+(L.MIN_PLAYERS-n)+" more player"+(L.MIN_PLAYERS-n===1?"":"s")+".";
  else if(n>L.MAX_PLAYERS) note.textContent=L.MAX_PLAYERS+" players max.";
  else if(dup) note.textContent="Two players are called "+dup+". One of you, rejoin with another name.";
  else note.textContent=isOwner()?"Everyone in? Start when ready. Each player takes the stand "+(laps===2?"twice":"once")+".":"You're in. The host starts when the table's ready.";
}
function paintTable(){
  var now=serverNow(), p=pub.phase;
  /* the shared screen: on the TV when one is connected, otherwise compact on the host's phone */
  var sharedHere=amHost()&&!displayOn();
  show("shared", sharedHere);
  if(sharedHere&&SCR) SCR.render($("shared"), {pub:pub, D:D, now:now, compact:true, sounds:true});
  show("tvnote", amHost()&&displayOn());
  paintMine(now);
  /* the timer bar on this phone */
  var bar=$("bar"), total=totalFor(p), left=pub.deadline-now;
  var timed=pub.deadline>0&&total>0&&p!=="verdict";
  show("bar", timed&&!sharedHere);
  if(timed){bar.style.setProperty("--p", Math.max(0, Math.min(1, left/total)).toFixed(3)); bar.classList.toggle("hot", left<=3000); $("bartext").textContent=Math.max(0, Math.ceil(left/1000))+"s"}
  show("bartext", timed&&!sharedHere);
  var hosting=amHost();
  show("hosttools", hosting&&p!=="end");
  show("skipbtn", hosting&&/^(case|opening|prosecution|deliberation|sentencing|scores)$/.test(p));
  show("finale", p==="end");
  if(p==="end") paintEnd();
  $("again").classList.toggle("hide", !hosting);
  $("newgame").classList.toggle("hide", !isOwner());
  $("leave").classList.toggle("hide", isOwner()||role()==="watch");
  $("closestage").classList.toggle("hide", !isOwner());
}
function totalFor(p){var T=L.T; return {case:T.caseMs, opening:T.opening, prosecution:T.prosecution, deliberation:T.deliberation, sentencing:T.sentencing, scores:T.scores}[p]||0}
/* Only what this player needs: their private choices, their input and their own status. */
function paintMine(now){
  var box=$("mine"), p=pub.phase, r=role();
  var key=[pub.seq, p, r, myPick, myRest, myVote, mySent, myChoice, (objMap[uid]?1:0), myOffer?myOffer.length:0].join("|");
  if(key===lastMineKey) return;
  var phaseKey=p+"|"+tag();
  var fresh=lastMineKey.split("|")[1]!==p;
  lastMineKey=key; box.textContent="";
  var panel=el("div", "pg-panel"+(fresh?" pg-mine":""));
  box.appendChild(panel);
  var roleName={defendant:"Defendant", prosecutor:"Prosecutor", juror:"Juror", watch:"Watching"}[r];
  if(p!=="end"&&p!=="scores") panel.appendChild(el("span", "pg-role", roleName));
  if(p==="case"){
    if(r==="defendant"){
      panel.appendChild(el("h2", null, "Pick your hot take"));
      panel.appendChild(el("p", null, "You'll defend it out loud. One is picked for you when time runs out."));
      var c=el("div", "pg-choices");
      (myOffer||[]).forEach(function(t, i){
        var b=el("button", null, t); b.type="button"; b.setAttribute("aria-pressed", myPick===i?"true":"false"); b.disabled=myPick!=null;
        b.addEventListener("click", function(){sendPick(i)}); c.appendChild(b);
      });
      if(!(myOffer&&myOffer.length)) c.appendChild(el("p", null, "Opening the case file…"));
      panel.appendChild(c);
      turnCue(phaseKey);
    }else panel.appendChild(el("h2", null, nm(D.defendant)+" is choosing a case."));
  }else if(p==="opening"){
    if(r==="defendant"){
      panel.appendChild(el("h2", null, "You're on. Argue for it, out loud."));
      panel.appendChild(el("p", "pg-take", "“"+D.take+"”"));
      var rb=el("button", "btn host-cta", myRest?"Resting…":"I rest my case"); rb.type="button"; rb.disabled=!!myRest; rb.addEventListener("click", sendRest); panel.appendChild(rb);
      turnCue(phaseKey);
    }else if(r==="prosecutor"){
      panel.appendChild(el("h2", null, "Get ready: you argue against it next."));
      panel.appendChild(el("p", "pg-take", "“"+D.take+"”"));
    }else panel.appendChild(el("h2", null, "Listen to "+nm(D.defendant)+"'s opening."));
  }else if(p==="prosecution"){
    if(r==="prosecutor"){
      panel.appendChild(el("h2", null, "Your turn. Argue against it."));
      panel.appendChild(el("p", "pg-take", "“"+D.take+"”"));
      var pb=el("button", "btn host-cta", myRest?"Resting…":"I rest my case"); pb.type="button"; pb.disabled=!!myRest; pb.addEventListener("click", sendRest); panel.appendChild(pb);
      turnCue(phaseKey);
    }else if(r==="juror"){
      panel.appendChild(el("h2", null, nm(D.prosecutor)+" is prosecuting."));
      var ob=el("button", "pg-objection", objMap[uid]?"Objection noted":"Objection!"); ob.type="button"; ob.disabled=!!objMap[uid];
      ob.addEventListener("click", sendObj); panel.appendChild(ob);
      panel.appendChild(el("p", null, "Once per case. Just for fun: the clock keeps running."));
    }else panel.appendChild(el("h2", null, "Sit tight. "+nm(D.prosecutor)+" is arguing against you."));
  }else if(p==="deliberation"){
    if(r==="juror"){
      panel.appendChild(el("h2", null, myVote?"Vote locked in.":"Your verdict, in secret"));
      panel.appendChild(el("p", "pg-take", "“"+D.take+"”"));
      var two=el("div", "pg-choices pg-two");
      [["g","Guilty"],["n","Not guilty"]].forEach(function(o){
        var b=el("button", null, o[1]); b.type="button"; b.setAttribute("aria-pressed", myVote===o[0]?"true":"false"); b.disabled=!!myVote;
        b.addEventListener("click", function(){sendVote(o[0])}); two.appendChild(b);
      });
      panel.appendChild(two);
      panel.appendChild(el("p", null, "Nobody sees your vote until the verdict."));
      turnCue(phaseKey);
    }else panel.appendChild(el("h2", null, "The jury is out."));
  }else if(p==="verdict"){
    panel.appendChild(el("h2", null, "The verdict is in…"));
    if(r==="juror"&&myVote) panel.appendChild(el("p", null, "You voted "+(myVote==="g"?"guilty":"not guilty")+"."));
  }else if(p==="sentencing"){
    var chooser=pub.c, guilty=(D.verdict||{}).result==="guilty";
    if(chooser===uid){
      panel.className="pg-panel pg-drink"+(fresh?" pg-mine":"");
      panel.appendChild(el("p", "pg-tag", "Drink moment"));
      panel.appendChild(el("h2", null, guilty?"Found guilty. Take a drink, take the jury's sentence, or Pass.":"Not guilty! As prosecutor: take a drink, "+(D.pose||"do a quick pose")+", or Pass."));
      var acts=[["drink","Take a drink"],["alt",guilty?"Take the jury's sentence":"Do the pose instead"],["pass","Pass"]];
      acts.forEach(function(a){
        var b=el("button", "btn"+(a[0]==="pass"?" alt":""), a[1]); b.type="button"; b.setAttribute("aria-pressed", myChoice===a[0]?"true":"false"); b.disabled=!!myChoice;
        b.addEventListener("click", function(){sendChoice(a[0])}); panel.appendChild(b);
      });
      panel.appendChild(el("p", null, myChoice?"Locked in.":"Passing is always fine and costs nothing."));
      if(lastTurnKey!=="drink|"+phaseKey){lastTurnKey="drink|"+phaseKey; snd("clink")}
    }else if(guilty&&r==="juror"){
      panel.appendChild(el("h2", null, mySent!==""?"Sentence vote in.":"Pick a sentence for "+nm(D.defendant)));
      var sc=el("div", "pg-choices");
      (D.sentenceOptions||[]).forEach(function(t, i){
        var b=el("button", null, t); b.type="button"; b.setAttribute("aria-pressed", mySent===String(i)?"true":"false"); b.disabled=mySent!=="";
        b.addEventListener("click", function(){sendSent(i)}); sc.appendChild(b);
      });
      panel.appendChild(sc);
      turnCue(phaseKey);
    }else panel.appendChild(el("h2", null, guilty?"The jury is picking a sentence.":nm(chooser)+" owes the court."));
  }else if(p==="scores"){
    panel.appendChild(el("h2", null, SCR?SCR.outcomeLine(D):"Case closed."));
    panel.appendChild(el("p", null, "You have "+((D.scores||{})[uid]||0)+" point"+(((D.scores||{})[uid]||0)===1?"":"s")+"."));
  }else if(p==="end"){
    panel.appendChild(el("h2", null, "Court is adjourned"));
    var fin=(D.scores||{})[uid]||0; panel.appendChild(el("p", null, "You finished with "+fin+" point"+(fin===1?"":"s")+"."));
  }
}
function turnCue(key){if(lastTurnKey===key) return; var first=!lastTurnKey; lastTurnKey=key; if(!first) snd("turn")}
function paintEnd(){
  var box=$("finalbox");
  if(box.dataset.seq===String(pub.seq)) {if(SCR&&!displayOn()) SCR.render(box, {pub:pub, D:D, now:serverNow(), compact:true, sounds:false}); return}
  box.dataset.seq=String(pub.seq); box.textContent="";
  if(SCR) SCR.render(box, {pub:pub, D:D, now:serverNow(), compact:true, sounds:false});
}

/* ---------- player actions ---------- */
function sendPick(i){
  if(!pub||pub.phase!=="case"||role()!=="defendant"||myPick!=null) return;
  myPick=i; snd("click"); render();
  set(ref(db, rpath("hc/pick/"+uid)), i).catch(function(e){myPick=null; fail(friendly(e)); render()});
}
function sendRest(){
  if(!pub||myRest) return;
  var ph=pub.phase; if(!((ph==="opening"&&role()==="defendant")||(ph==="prosecution"&&role()==="prosecutor"))) return;
  myRest=ph; snd("click"); render();
  set(ref(db, rpath("hc/rest/"+uid)), ph+":"+tag()).catch(function(e){myRest=""; fail(friendly(e)); render()});
}
function sendObj(){
  if(!pub||pub.phase!=="prosecution"||role()!=="juror"||objMap[uid]) return;
  objMap[uid]=1; snd("objection"); render();
  set(ref(db, rpath("hc/obj/"+uid)), serverTimestamp()).catch(function(e){delete objMap[uid]; fail(friendly(e)); render()});
}
function sendVote(v){
  if(!pub||pub.phase!=="deliberation"||role()!=="juror"||myVote) return;
  myVote=v; snd("click"); render();
  set(ref(db, rpath("hc/vote/"+uid)), v+":"+tag()).catch(function(e){myVote=""; fail(friendly(e)); render()});
}
function sendSent(i){
  if(!pub||pub.phase!=="sentencing"||role()!=="juror"||mySent!=="") return;
  mySent=String(i); snd("click"); render();
  set(ref(db, rpath("hc/sent/"+uid)), i+":"+tag()).catch(function(e){mySent=""; fail(friendly(e)); render()});
}
function sendChoice(k){
  if(!pub||pub.phase!=="sentencing"||pub.c!==uid||myChoice) return;
  myChoice=k; snd("click"); render();
  set(ref(db, rpath("hc/choice/"+uid)), k+":"+tag()).catch(function(e){myChoice=""; fail(friendly(e)); render()});
}
var leaveArmed=0;
function leaveGame(){
  if(!code||isOwner()) return;
  if(Date.now()-leaveArmed>3000){leaveArmed=Date.now(); fail("Tap Leave again to leave the game."); return}
  fail("");
  var p={}; p[rpath("hc/left/"+uid)]=true; p[rpath("players/"+uid+"/connected")]=false;
  update(ref(db), p).catch(function(){}).then(function(){leaveRoom(); screen("home"); fail("You left the game.")});
}

/* ---------- host: publishing ---------- */
function metaObj(patch){
  var m=Object.assign({}, meta||{}, patch||{});
  var out={hostUid:m.hostUid, createdAt:m.createdAt, status:m.status, phase:m.phase, spice:/^(mild|spicy|extra)$/.test(m.spice)?m.spice:"mild", rounds:10, na:!!m.na, round:0, gameId:+m.gameId||1, kind:"hc", laps:+m.laps===2?2:1};
  if(m.status!=="lobby") out.deck=["Hot Take Court"];
  return out;
}
var lastCase=-1;
/* One atomic write per change: the public view, the host-only state, a new case's private offer, and inputs to clear. */
function publish(more){
  if(!G||!code) return Promise.resolve(false);
  var now=serverNow(), key=G.phase+"|"+G.played;
  if(key!==lastKey){lastKey=key; phaseAt=now}
  var view=L.publicView(G); view.at=phaseAt;
  var seq=(pub?pub.seq:0)+1, payload=Object.assign({}, more||{});
  payload[rpath("hc/pub")]={phase:G.phase, seq:seq, deadline:G.deadline||0, data:JSON.stringify(view), a:G.defendant||"", b:G.prosecutor||"", c:G.phase==="sentencing"?(L.chooser(G)||""):""};
  payload[rpath("hc/secret")]=JSON.stringify({G:G, phaseAt:phaseAt, lastKey:lastKey});
  payload[rpath("hc/beat")]=serverTimestamp();
  if(G.phase==="case"&&G.caseNo!==lastCase){
    lastCase=G.caseNo;
    G.seats.forEach(function(u){
      ["pick","rest","obj","vote","sent","choice"].forEach(function(k){payload[rpath("hc/"+k+"/"+u)]=null});
      payload[rpath("hc/offer/"+u)]=u===G.defendant?JSON.stringify(G.offer):null;
    });
    picks={}; rests={}; votes={}; sents={}; choices={};
  }
  hostLock=true;
  return update(ref(db), payload).then(function(){hostLock=false; return true}).catch(function(e){hostLock=false; if(amHost()) fail(friendly(e)); return false});
}
/* A player counts as absent only after being disconnected for a short grace period, so a refresh doesn't skip them. */
var GRACE=FAST?4000:8000, offSince={};
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
  var more={}; more[rpath("meta")]=metaObj({status:"play", phase:"answer"}); more[rpath("hc/host")]=null;
  list.forEach(function(p){more[rpath("hc/left/"+p.uid)]=null});
  publish(more).then(function(ok){if(!ok) G=null; else listenHost(); sending=false; render()});
}
function freshGame(list){
  G=L.newGame(list, {pack:meta.spice, na:!!meta.na, laps:+meta.laps===2?2:1});
  lastCase=-1; lastKey="";
  L.startCase(G, DATA, serverNow(), null, awayMap());
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
  payload[rpath("hc/pub")]=null; payload[rpath("hc/secret")]=null; payload[rpath("hc/host")]=null;
  update(ref(db), payload).then(function(){G=null; stopHost()}).catch(function(e){fail(friendly(e))});
}
/* The host skips ahead: the current phase ends now. */
function skipAhead(){if(!amHost()||!G||hostLock||G.phase==="end") return; G.deadline=serverNow(); hostTick()}
function endEarly(){
  if(!amHost()||!G||hostLock) return;
  if(G.phase==="deliberation"||G.phase==="verdict"||G.phase==="sentencing") L.dismiss(G, serverNow(), "The host ended the game.");
  L.finish(G); publish();
}
/* Apply every input that arrived, then let the clock move the game on. */
function hostTick(){
  if(!amHost()||!G||hostLock||resuming) return;
  var now=serverNow(), away=awayMap(), dirty=false, n=G.caseNo;
  var gone=Object.keys(leftMap).filter(function(u){return leftMap[u]&&G.order.indexOf(u)>=0});
  Object.keys(G.names).forEach(function(u){if(G.order.indexOf(u)>=0&&!players[u]&&gone.indexOf(u)<0) gone.push(u)});
  if(gone.length){
    var clear={}; gone.forEach(function(u){L.leave(G, u, now); clear[rpath("hc/left/"+u)]=null});
    publish(clear); return;
  }
  var cn=G.played+1;
  if(G.phase==="case"&&picks[G.defendant]!=null&&L.pickTake(G, G.defendant, picks[G.defendant])) dirty=true;
  Object.keys(rests).forEach(function(u){var t=parseTag(rests[u]); if(t&&t.n===cn&&t.v===G.phase&&L.rest(G, u)) dirty=true});
  Object.keys(objMap).forEach(function(u){if(objMap[u]&&L.object(G, u)) dirty=true});
  Object.keys(votes).forEach(function(u){var t=parseTag(votes[u]); if(t&&t.n===cn&&L.vote(G, u, t.v)) dirty=true});
  Object.keys(sents).forEach(function(u){var t=parseTag(sents[u]); if(t&&t.n===cn&&L.sentVote(G, u, +t.v)) dirty=true});
  Object.keys(choices).forEach(function(u){var t=parseTag(choices[u]); if(t&&t.n===cn&&L.choose(G, u, t.v)) dirty=true});
  var ev=L.tick(G, DATA, now, null, away);
  if(ev||dirty||G.caseNo!==n) publish();
}
/* This phone has become the acting host, or the host's phone reloaded: pick the game up from the saved state. */
function becomeHost(){
  if(G||resuming||!meta||meta.status==="lobby") return;
  resuming=true;
  get(ref(db, rpath("hc/secret"))).then(function(s){
    if(!s.exists()||!amHost()) return;
    var o=null; try{o=JSON.parse(s.val())}catch(e){o=null}
    if(!o||!o.G) return;
    G=o.G; phaseAt=o.phaseAt||serverNow(); lastKey=o.lastKey||""; lastCase=G.caseNo;
    listenHost();
    if(claimedNow){
      claimedNow=false;
      /* a new host could read secret votes, so a case mid-vote is thrown out: nobody scores for it, nobody drinks */
      if(/^(deliberation|verdict|sentencing)$/.test(G.phase)) L.dismiss(G, serverNow(), "The host changed, so this case was dismissed.");
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
  set(ref(db, rpath("hc/host")), uid).catch(function(){claimedNow=false}).then(function(){claiming=false; hostAwaySince=0});
}

/* ---------- listeners ---------- */
function stopAll(){stops.forEach(function(fn){try{fn()}catch(e){}}); stops=[]; stopHost(); if(connStop){connStop(); connStop=null}}
function stopHost(){hostStops.forEach(function(fn){try{fn()}catch(e){}}); hostStops=[]}
function hostCheck(){
  if(amHost()){if(!G&&meta&&meta.status!=="lobby") becomeHost()}
  else if(G||hostStops.length){stopHost(); G=null}
}
function onPub(){
  try{D=pub?JSON.parse(pub.data):null}catch(e){D=null}
  if(pub&&pub.seq!==lastSeq){
    if(pub.phase!==lastPhase||(D&&D.caseNo!==(onPub.lastCase||0))){
      /* new phase: this phone's inputs for the old one no longer apply */
      /* the offer is left alone: its own listener owns it, and it can land before this */
      if(pub.phase==="case"){myPick=null; myRest=""; myVote=""; mySent=""; myChoice=""}
      onPub.lastCase=D?D.caseNo:0;
    }
    lastSeq=pub.seq; lastPhase=pub.phase;
  }
  hostLock=false;
  render();
}
function listen(){
  stopAll();
  var watched=code;
  stops.push(onValue(ref(db, rpath("meta")), function(s){
    if(!s.exists()){if(watched!==code) return; roomEnded(); return}
    meta=s.val()||null; hostCheck(); render();
  }, function(){fail("That room isn't available.")}));
  stops.push(onValue(ref(db, rpath("players")), function(s){players=s.val()||{}; render(); hostTick()}, function(){}));
  stops.push(onValue(ref(db, rpath("hc/host")), function(s){hcHost=s.val()||null; hostCheck(); render()}, function(){}));
  stops.push(onValue(ref(db, rpath("hc/screen")), function(s){var v=s.val(); screenAt=typeof v==="number"?v:0; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("hc/pub")), function(s){pub=s.val()||null; onPub(); hostTick()}, function(){}));
  stops.push(onValue(ref(db, rpath("hc/left")), function(s){leftMap=s.val()||{}; hostTick()}, function(){}));
  stops.push(onValue(ref(db, rpath("hc/obj")), function(s){objMap=s.val()||{}; render(); hostTick()}, function(){}));
  /* this phone's own entries, so a refresh in the middle of a phase still shows what it chose */
  stops.push(onValue(ref(db, rpath("hc/offer/"+uid)), function(s){var v=s.val(); try{myOffer=v?JSON.parse(v):null}catch(e){myOffer=null} render()}, function(){}));
  stops.push(onValue(ref(db, rpath("hc/pick/"+uid)), function(s){var v=s.val(); myPick=typeof v==="number"?v:null; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("hc/vote/"+uid)), function(s){var t=parseTag(s.val()); myVote=t&&t.n===tag()?t.v:""; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("hc/sent/"+uid)), function(s){var t=parseTag(s.val()); mySent=t&&t.n===tag()?t.v:""; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("hc/choice/"+uid)), function(s){var t=parseTag(s.val()); myChoice=t&&t.n===tag()?t.v:""; render()}, function(){}));
  startTicker();
}
function listenHost(){
  stopHost();
  hostStops.push(onValue(ref(db, rpath("hc/pick")), function(s){picks=s.val()||{}; hostTick()}, function(){}));
  hostStops.push(onValue(ref(db, rpath("hc/rest")), function(s){rests=s.val()||{}; hostTick()}, function(){}));
  hostStops.push(onValue(ref(db, rpath("hc/vote")), function(s){votes=s.val()||{}; hostTick()}, function(){}));
  hostStops.push(onValue(ref(db, rpath("hc/sent")), function(s){sents=s.val()||{}; hostTick()}, function(){}));
  hostStops.push(onValue(ref(db, rpath("hc/choice")), function(s){choices=s.val()||{}; hostTick()}, function(){}));
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
function tick(){
  hostTick(); takeoverTick();
  if(pub&&meta&&meta.status!=="lobby") render();
}
function startTicker(){stopTicker(); tickTimer=setInterval(tick, 200)}
function stopTicker(){if(tickTimer){clearInterval(tickTimer); tickTimer=0}}
function leaveRoom(){
  stopAll(); stopTicker();
  try{sessionStorage.removeItem("tp_hc_room")}catch(e){}
  code=null; meta=null; pub=null; D=null; G=null; hcHost=null; players={}; leftMap={}; objMap={}; screenAt=0;
  myOffer=null; myPick=null; myRest=""; myVote=""; mySent=""; myChoice=""; lastSeq=-1; lastPhase=""; lastMineKey=""; lastTurnKey="";
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
      await update(ref(db), {["rooms/"+c+"/meta"]:{hostUid:uid, createdAt:serverTimestamp(), status:"lobby", phase:"lobby", spice:"mild", rounds:10, na:false, round:0, gameId:1, kind:"hc", laps:1}});
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
  if(m.kind!=="hc") throw new Error("kind");
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
function enterRoom(c){
  code=c;
  try{sessionStorage.setItem("tp_hc_room", code); localStorage.setItem("tp_last_game", "hot-take-court")}catch(e){}
  listen(); armPresence();
}
var closeArmed=0;
function askClose(){
  if(!isOwner()||!code) return;
  if(Date.now()-closeArmed>2500){closeArmed=Date.now(); fail("Tap close again to end the room for everyone."); return}
  fail(""); remove(ref(db, "rooms/"+code)).catch(function(e){fail(friendly(e))});
  try{sessionStorage.removeItem("tp_hc_room")}catch(e){}
}
function setMeta(patch){
  if(!isOwner()||!meta||meta.status!=="lobby") return;
  update(ref(db), {[rpath("meta")]:metaObj(patch)}).catch(function(e){fail(friendly(e))});
}
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
  document.querySelectorAll("[data-pack]").forEach(function(b){b.addEventListener("click", function(){setMeta({spice:b.dataset.pack})})});
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
    if(navigator.share) navigator.share({title:"Hot Take Court", text:"Join my Hot Take Court room "+code, url:roomUrl(code)}).catch(function(){});
    else copyText(roomUrl(code)).then(function(){fail("Link copied.")}).catch(function(){fail(roomUrl(code))});
  });
  $("tvcopy").addEventListener("click", function(){if(code) copyText(displayUrl(code)).then(function(){fail("Display link copied.")}).catch(function(){fail(displayUrl(code))})});
  $("tvopen").addEventListener("click", function(){if(code) window.open(displayUrl(code), "_blank", "noopener")});
  window.addEventListener("online", function(){fail(""); if(goOnline&&db){try{goOnline(db)}catch(e){}}});
  if(EMU) window.__tpCourt={uid:function(){return uid}, code:function(){return code}, phase:function(){return pub&&pub.phase}, data:function(){return D},
    host:function(){return amHost()}, role:function(){return role()}, offer:function(){return myOffer}, game:function(){return G?JSON.parse(JSON.stringify(G)):null}, display:function(){return displayOn()}};
  var back=""; try{back=sessionStorage.getItem("tp_hc_room")||""}catch(e){}
  var name=L.cleanName($("pname").value);
  if(back&&validCode(back)&&name&&(!linked||linked===back)) joinRoom(back, name).catch(function(){try{sessionStorage.removeItem("tp_hc_room")}catch(err){}});
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
  if(EMU){
    authMod.connectAuthEmulator(authObj, "http://127.0.0.1:9099", {disableWarnings:true});
    dbMod.connectDatabaseEmulator(db, "127.0.0.1", 9000);
  }
  if(authMod.setPersistence&&authMod.browserLocalPersistence){try{await authMod.setPersistence(authObj, authMod.browserLocalPersistence)}catch(e){}}
  if(authObj.authStateReady) await authObj.authStateReady();
  var cred=authObj.currentUser?{user:authObj.currentUser}:await authMod.signInAnonymously(authObj);
  await cred.user.getIdToken();
  uid=authUid=cred.user.uid;
  onValue(ref(db, ".info/serverTimeOffset"), function(s){var v=s.val(); if(typeof v==="number"&&isFinite(v)){serverOffset=v; offsetReady=true}});
  showReady();
  try{wire()}catch(err){console.error(err); fail("The court glitched. Reload and try again.")}
}
$("retry").addEventListener("click", function(){location.reload()});
boot().catch(function(err){console.error(err); showBootError("The game didn't open. Check your connection and try again.")});
})();
