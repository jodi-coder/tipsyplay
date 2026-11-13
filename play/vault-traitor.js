(function(){
"use strict";
/* Vault Traitor, one phone per player. rooms/$code/vt
   The host's phone runs the game with VaultLogic and publishes only what everyone may see (vt/pub).
   Private things travel on private paths: vt/role/$uid (your role, your seal options, your drink choice),
   and vt/act, vt/lie, vt/ballot, vt/choice, which only the writer and the host can read.
   The code and the full game live in host memory and in vt/secret, which only the host can read. */
var L=window.VaultLogic;
var FAST=/[?&]emulator=1(?:&|$)/.test(location.search)&&/[?&]fast=1(?:&|$)/.test(location.search);
var MS={seal:FAST?900:6000, debate:FAST?2500:30000, ballot:FAST?2500:20000, tally:FAST?600:4000, choice:FAST?4000:15000, banner:FAST?900:7000, away:FAST?1500:30000};
var ALPHABET="ABCDEFGHJKMNPQRSTUVWXYZ";
var $=function(id){return document.getElementById(id)};
var uid=null, code=null, meta=null, players={}, pub=null, D=null, mine=null, readyMap={}, leftMap={}, call=null;
var drinkPick="sips", entry="", sending=false, serverOffset=0, offsetReady=false, offsetStop=null;
var db, authObj, stops=[], hostStops=[], connStop=null, bootTimer=0, tickTimer=0;
var ref, onValue, update, set, remove, onDisconnect, get, serverTimestamp, goOnline;
/* host only */
var G=null, acts={}, lies={}, ballots={}, choices={}, hostLock=false, sealPick=null, awaySince={}, afterBanner=null;
var lastSeq=-1, lastPhase="", lastCountSaid=-1;

/* ---------- small helpers ---------- */
function serverNow(){return Date.now()+(offsetReady?serverOffset:0)}
function rpath(p){return "rooms/"+code+"/"+p}
function fail(msg){var p=$("perr"); if(p) p.textContent=msg||""}
function friendly(e){
  var c=String((e&&(e.code||e.message))||"");
  if(/permission|denied/i.test(c)) return "That didn't go through. Try again.";
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
function roomUrl(c){
  if(window.TipsyJoinQR) return TipsyJoinQR.pageInvite("/games/vault-traitor.html", c, "vt");
  return "https://tipsyplay.com/games/vault-traitor.html?room="+c+"&game=vt";
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
function phaseLeft(ms){if(!pub) return 0; return Math.max(0, Math.ceil((pub.opened+ms-serverNow())/1000))}
/* The screen repaints four times a second for the timers. Lists of buttons are rebuilt only when what they show changes,
   so a tap never lands on a button that is being replaced. */
function keyed(box, key){if(box.dataset.key===key) return false; box.dataset.key=key; box.textContent=""; return true}
function parseTagged(v){var s=String(v||""), i=s.lastIndexOf(":"); if(i<0) return null; return {v:s.slice(0,i), seq:+s.slice(i+1)}}

/* ---------- rendering ---------- */
function render(){
  document.body.classList.toggle("is-host", isHost());
  document.querySelectorAll(".hostonly").forEach(function(n){n.classList.toggle("hide", !isHost())});
  if(!meta){screen("home"); return}
  if(meta.status==="lobby"||!pub||!D){screen("lobby"); paintLobby(); return}
  screen("table");
  paintTable();
}
function paintLobby(){
  $("codebig").textContent=code||"";
  $("sharelink").textContent=roomUrl(code);
  paintQr();
  var list=order(), box=$("plist"); box.textContent="";
  list.forEach(function(p){
    var row=el("div", "vt-person"+(p.connected?"":" off"));
    row.appendChild(el("span", null, p.name+(p.uid===meta.hostUid?" · host":"")));
    row.appendChild(el("span", null, p.connected?"":"away"));
    if(isHost()&&p.uid!==uid){
      var kick=el("button", "x", "Remove"); kick.type="button"; kick.setAttribute("aria-label", "Remove "+p.name);
      kick.addEventListener("click", function(){remove(ref(db, rpath("players/"+p.uid))).catch(function(e){fail(friendly(e))})});
      row.appendChild(kick);
    }
    box.appendChild(row);
  });
  var setting=(meta.vtDrink)||drinkPick;
  document.querySelectorAll("[data-drink]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.drink===setting?"true":"false");
    b.disabled=!isHost();
  });
  $("drinknote").textContent=setting==="none"?"No drinking: every drink becomes a no-drink alternative.":setting==="shots"?"Shots: each drink is one shot. Pace yourself.":"Drinks: each one is a single drink.";
  var n=list.length, dup=dupName(list);
  var start=$("start"); start.disabled=!isHost()||n<L.MIN_PLAYERS||n>L.MAX_PLAYERS||!!dup;
  start.textContent="Start game · "+n+" player"+(n===1?"":"s");
  var note=$("lobbynote");
  if(n<L.MIN_PLAYERS) note.textContent="Need "+(L.MIN_PLAYERS-n)+" more player"+(L.MIN_PLAYERS-n===1?"":"s")+".";
  else if(n>L.MAX_PLAYERS) note.textContent="8 players max.";
  else if(dup) note.textContent="Two players are called "+dup+". One of you, rejoin with another name.";
  else note.textContent=isHost()?"Everyone in? Start when ready. "+(L.traitorCount(n)===2?"Two Traitors":"One Traitor")+" will be dealt.":"You're in. The host starts when the table's ready.";
}
function dupName(list){
  var seen={}, d="";
  list.forEach(function(p){var k=L.cleanName(p.name).toLowerCase(); if(seen[k]) d=p.name; seen[k]=1});
  return d;
}
function paintQr(){
  var canvas=$("qr");
  if(!canvas||!code||!window.TipsyJoinQR||canvas.dataset.hidden==="1") return;
  TipsyJoinQR.draw(canvas, roomUrl(code));
  var credit=$("qrcredit"); if(credit&&!credit.textContent) credit.textContent=TipsyJoinQR.credit;
}
function inGame(){return D&&D.order&&D.order.indexOf(uid)>=0&&!(D.removed&&D.removed[uid])}
function paintTable(){
  var ph=pub.phase, left=D.left;
  var lb=$("left"); lb.textContent=""; var b=el("b", null, String(Math.max(0,left))); lb.appendChild(b);
  lb.appendChild(document.createTextNode(left===1?" guess left":" guesses left"));
  lb.classList.toggle("urgent", left<=3&&ph!=="end");
  var tl=$("turnline");
  tl.textContent=ph==="end"?"Round over":(pub.turn?(pub.turn===uid?"Your turn":nm(pub.turn)+"'s turn"):"");
  $("notice").textContent=D.notice||"";
  paintBoard();
  paintPrivate(ph);
  var myTurn=ph==="turn"&&pub.turn===uid;
  show("keypad", myTurn);
  if(myTurn) paintKeypad(); else if(entry&&ph!=="turn") entry="";
  var wait="";
  if(ph==="turn"&&!myTurn) wait=nm(pub.turn)+" is guessing…";
  else if(ph==="seal"&&!(mine&&mine.seal&&mine.seal.seq===pub.seq)) wait="Sealing the feedback… "+phaseLeft(MS.seal)+"s";
  else if(ph==="ballot"&&!(mine&&inGame())) wait="Votes are coming in…";
  else if(ph==="choice"&&!(mine&&mine.choice&&mine.choice.seq===pub.seq)) wait="Waiting on a private choice… "+phaseLeft(MS.choice)+"s";
  else if(ph==="deal"&&!(mine&&inGame())) wait="Roles are being dealt.";
  else if(ph==="short") wait="Fewer than 3 players are left. The host can start a new game.";
  $("waittext").textContent=wait; show("waitbox", !!wait);
  show("debate", ph==="debate");
  if(ph==="debate") paintDebate();
  paintTally(ph);
  paintBanner(ph);
  paintHostTools(ph);
  var next=$("nextround");
  var nextOn=isHost()&&(ph==="deal"||ph==="banner"||ph==="short");
  next.classList.toggle("hide", !nextOn);
  if(ph==="deal"){var n=D.order.filter(function(u){return !D.removed[u]}).length, r=Object.keys(readyMap).filter(function(u){return readyMap[u]===pub.seq}).length; next.textContent="Start guessing · "+r+" of "+n+" ready"}
  else if(ph==="banner") next.textContent="Continue";
  else if(ph==="short") next.textContent="New game";
  show("finale", ph==="end");
  if(ph==="end") paintReveal();
  $("leave").classList.toggle("hide", isHost()||!inGame()||ph==="end");
}
function paintBoard(){
  var box=$("board"); box.textContent="";
  var hist=(D.hist||[]).slice().reverse();
  show("boardempty", !hist.length);
  hist.forEach(function(h, idx){
    var li=el("li");
    li.appendChild(el("span", "who", "Guess "+h.n+" · "+nm(h.by)));
    var dg=el("span", "vt-digits"); dg.setAttribute("aria-hidden", "true");
    h.g.split("").forEach(function(c){dg.appendChild(el("span", null, c))});
    li.appendChild(dg);
    var pegs=el("span", "vt-pegs"); pegs.setAttribute("aria-hidden", "true");
    var i, k=0;
    for(i=0;i<h.b;i++){var p=el("span", "vt-peg exact"); var dot=el("i"); if(idx===0) dot.style.setProperty("--i", String(k++)); else dot.style.animation="none"; p.appendChild(dot); pegs.appendChild(p)}
    for(i=0;i<h.w;i++){var q=el("span", "vt-peg miss"); var d2=el("i"); if(idx===0) d2.style.setProperty("--i", String(k++)); else d2.style.animation="none"; q.appendChild(d2); pegs.appendChild(q)}
    li.appendChild(pegs);
    li.appendChild(el("span", "vt-fbtext", h.g+": "+h.b+" exact, "+h.w+" misplaced"+(h.cracked?" · cracked!":"")));
    box.appendChild(li);
  });
}
/* Only this phone's own private screen. Nothing here reaches other phones. */
function paintPrivate(ph){
  var role=mine&&mine.r, d=(mine&&mine.d)||{};
  /* role card during the deal */
  var showRole=ph==="deal"&&!!role&&inGame();
  show("rolebox", showRole);
  if(showRole){
    $("rolename").textContent=role==="traitor"?"Traitor":"Codebreaker";
    $("rolegoal").textContent=role==="traitor"?"Keep the vault shut. You can bend the feedback twice this game, and nobody sees when you do.":"Crack the code in 10 guesses. Watch for clues that don't add up.";
    $("rolepartner").textContent=role==="traitor"&&d.partners&&d.partners.length?"Your fellow Traitor: "+d.partners.join(", ")+".":"";
    var done=readyMap[uid]===pub.seq;
    $("readybtn").disabled=done; $("readybtn").textContent=done?"Ready. Waiting for the others…":"Got it";
  }
  /* seal: only a Traitor with a valid lie gets options */
  var sealing=ph==="seal"&&d.seal&&d.seal.seq===pub.seq;
  show("sealbox", !!sealing);
  if(sealing){
    var s=d.seal, picked=parseTagged(localStorage.getItem("vt_lie_"+code)||"");
    var mineSeq=picked&&picked.seq===pub.seq?picked.v:"";
    var taken=d.taken===pub.seq;
    $("sealhead").textContent=taken?"Your partner already chose for this guess":"Secret choice: shown to the group as…";
    $("sealtruth").textContent="True feedback: "+s.b+" exact, "+s.w+" misplaced. Lies left: "+s.lies+".";
    var box=$("sealopts");
    if(keyed(box, [pub.seq, taken, mineSeq].join("|"))&&!taken){
      var opts=[{key:"truth", b:s.b, w:s.w}].concat(s.opts||[]);
      opts.forEach(function(o){
        var btn=el("button"); btn.type="button";
        btn.appendChild(document.createTextNode(o.key==="truth"?"Tell the truth":L.lieLabel(o.key)));
        btn.appendChild(el("small", null, "Shows "+o.b+" exact, "+o.w+" misplaced"));
        btn.setAttribute("aria-pressed", mineSeq===o.key?"true":"false");
        btn.disabled=!!mineSeq;
        btn.addEventListener("click", function(){sendLie(o.key)});
        box.appendChild(btn);
      });
    }
    $("sealtimer").textContent=phaseLeft(MS.seal)+"s left. No choice means the truth.";
  }
  /* secret ballot */
  var voting=ph==="ballot"&&inGame();
  show("ballotbox", voting);
  if(voting){
    var list=$("ballotlist");
    var sat=d.sit===pub.seq;
    var cast=parseTagged(localStorage.getItem("vt_vote_"+code)||"");
    var castFor=cast&&cast.seq===pub.seq?cast.v:"";
    $("ballotnote").textContent=sat?"You sit this vote out.":(castFor?"Vote locked in. Only you see it.":"Who is a Traitor? Only you see your vote.");
    if(keyed(list, [pub.seq, sat, castFor, JSON.stringify(D.removed)].join("|"))&&!sat) D.order.forEach(function(u){
      if(u===uid||D.removed[u]) return;
      var btn=el("button", null, nm(u)); btn.type="button";
      btn.setAttribute("aria-pressed", castFor===u?"true":"false"); btn.disabled=!!castFor;
      btn.addEventListener("click", function(){sendBallot(u)});
      list.appendChild(btn);
    });
    $("ballottimer").textContent=phaseLeft(MS.ballot)+"s left. No vote counts as an abstain.";
  }
  /* private drink choice */
  var choosing=ph==="choice"&&d.choice&&d.choice.seq===pub.seq;
  show("choicebox", !!choosing);
  if(choosing){
    var c=d.choice, made=parseTagged(localStorage.getItem("vt_choice_"+code)||"");
    var madeV=made&&made.seq===pub.seq?made.v:"";
    $("choicenote").textContent=c.none?"No drinking tonight. Pick your alternative:":"You're up for "+c.amount+". Drink, or pick an alternative:";
    var cl=$("choicelist");
    var labels={drink:"Drink: "+c.amount, skipvote:"Skip your next vote", token:"Give up your pass token"};
    if(keyed(cl, [pub.seq, madeV].join("|"))) (c.none?[]:["drink"]).concat(c.alts||[]).forEach(function(k){
      var btn=el("button", null, labels[k]||k); btn.type="button";
      btn.setAttribute("aria-pressed", madeV===k?"true":"false"); btn.disabled=!!madeV;
      btn.addEventListener("click", function(){sendChoice(k)});
      cl.appendChild(btn);
    });
    $("choicetimer").textContent=madeV?"Locked in.":phaseLeft(MS.choice)+"s left. No answer means you skip your next vote.";
  }
}
function paintKeypad(){
  var spans=$("entry").querySelectorAll("span");
  spans.forEach(function(s, i){s.textContent=entry[i]||""; s.classList.toggle("on", i===entry.length)});
  $("entry").setAttribute("aria-label", entry.length?"Your guess so far: "+entry.split("").join(" "):"Your guess: empty");
  $("submitguess").disabled=entry.length!==4||sending;
  document.querySelectorAll("#keys [data-k]").forEach(function(k){
    var dk=k.dataset.k;
    k.disabled=sending||(/^[0-9]$/.test(dk)&&entry.length>=4)||((dk==="back"||dk==="clear")&&!entry.length);
  });
  var pt=$("passtoken"), has=D.passLeft&&D.passLeft[uid];
  pt.disabled=!has||sending;
  pt.textContent=has?"Use pass token (skip turn)":"Pass token used";
}
function paintDebate(){
  var n=phaseLeft(MS.debate), c=$("count");
  c.textContent=String(n);
  c.classList.toggle("hot", n<=10);
  if(n!==lastCountSaid&&(n===10||n===0)){lastCountSaid=n; $("countlive").textContent=n===10?"10 seconds left to debate.":"Debate over."}
  $("callvote").disabled=!inGame()||!!call;
  $("callvote").textContent=call?"Vote called by "+nm(call):"Call a vote";
}
function paintTally(ph){
  var box=$("tallybox"), t=D.tally;
  var on=(ph==="tally"||ph==="choice"||ph==="banner")&&!!t&&t.seq===D.tallySeq;
  show("tallybox", on);
  if(!on) return;
  box.textContent="";
  var line=t.result==="tie"?"No majority":t.result==="correct"?nm(t.target)+" was a Traitor!":nm(t.target)+" was not a Traitor";
  box.appendChild(el("p", "tag", "Vote called by "+nm(t.caller)));
  box.appendChild(el("p", "big", line));
  box.appendChild(el("p", null, t.result==="tie"?"That costs 1 guess.":t.result==="wrong"?"Wrong call. That costs 2 guesses.":"Caught. Their lies are exposed below."));
  if(t.result!=="tie") box.appendChild(el("p", null, t.votes+" of "+t.of+" votes."));
  if(t.result==="correct"&&D.exposed){
    D.exposed.filter(function(x){return x.by===t.target}).forEach(function(x){
      box.appendChild(el("p", null, "Guess "+x.n+" showed "+x.shown.b+" exact, "+x.shown.w+" misplaced. Truth: "+x.truth.b+" exact, "+x.truth.w+" misplaced."));
    });
  }
}
function paintBanner(ph){
  var box=$("banner"), b=D.banner;
  var on=ph==="banner"&&!!b;
  show("banner", on);
  if(!on) return;
  box.textContent="";
  box.appendChild(el("h2", null, b.none?"Penalty time":"Drink up"));
  (b.lines||[]).forEach(function(l){box.appendChild(el("p", null, l))});
  var ul=el("ul");
  (b.entries||[]).forEach(function(e){ul.appendChild(el("li", null, nm(e.uid)+": "+(e.what==="drink"?b.amount:e.what==="token"?"gave up their pass token":"skips their next vote")))});
  box.appendChild(ul);
}
function paintReveal(){
  var box=$("reveal"), e=D.end; if(!e) return;
  box.textContent="";
  box.appendChild(el("p", "tag", "Round over"));
  box.appendChild(el("h2", null, e.winner==="codebreakers"?"Codebreakers win":"Traitors win"));
  box.appendChild(el("p", null, e.reason==="cracked the code"?"The vault is open.":e.reason==="ran out of guesses"?"Out of guesses. The vault stays shut.":"Every Traitor is out."));
  box.appendChild(el("p", "tag", "The code"));
  box.appendChild(el("p", "vt-code", e.code));
  var sum=el("div", "vt-sum");
  [["Guesses used", e.summary.guessesUsed], ["Lies told", e.summary.liesTold], ["Correct calls", e.summary.correct], ["Wrong calls", e.summary.wrong]].forEach(function(x){
    var dv=el("div"); dv.appendChild(el("b", null, String(x[1]))); dv.appendChild(document.createTextNode(x[0])); sum.appendChild(dv);
  });
  box.appendChild(sum);
  box.appendChild(el("h3", null, "Roles"));
  var ul=el("ul");
  D.order.forEach(function(u){ul.appendChild(el("li", null, nm(u)+": "+(e.roles[u]==="traitor"?"Traitor":"Codebreaker")+(D.removed[u]?(D.removed[u].how==="left"?" (left)":" (caught)"):"")))});
  box.appendChild(ul);
  box.appendChild(el("h3", null, "Lies"));
  if(!e.lies.length) box.appendChild(el("p", null, "No lies told."));
  else{var ll=el("ul"); e.lies.forEach(function(l){ll.appendChild(el("li", null, nm(l.by)+", guess "+l.n+": showed "+l.shown.b+" exact, "+l.shown.w+" misplaced; truth "+l.truth.b+" exact, "+l.truth.w+" misplaced ("+l.status+")"))}); box.appendChild(ll)}
  box.appendChild(el("h3", null, "Votes"));
  if(!e.votes.length) box.appendChild(el("p", null, "No votes called."));
  else{var vl=el("ul"); e.votes.forEach(function(v){vl.appendChild(el("li", null, "After guess "+v.n+", "+nm(v.caller)+" called: "+(v.result==="tie"?"no majority (-1 guess)":(v.result==="correct"?nm(v.target)+" caught":nm(v.target)+" wrongly accused (-2 guesses)")+", "+v.votes+" of "+v.of)))}); box.appendChild(vl)}
  if(e.banner){
    var bn=el("div", "vt-banner");
    bn.appendChild(el("h2", null, e.banner.none?"Bragging rights":"Last call"));
    (e.banner.lines||[]).forEach(function(l){bn.appendChild(el("p", null, l))});
    bn.appendChild(el("p", null, e.banner.none?"No drinking: nothing to do but gloat.":e.banner.affected.map(nm).join(", ")+": "+e.banner.amount+", or skip it. Your call."));
    box.appendChild(bn);
  }
}
function paintHostTools(ph){
  var box=$("hosttools");
  var on=isHost()&&ph!=="end"&&D&&D.order;
  box.textContent="";
  if(!on){show("hosttools", false); return}
  var now=Date.now(), any=false;
  D.order.forEach(function(u){
    if(u===uid||D.removed[u]) return;
    var p=players[u], gone=!p||p.connected===false;
    if(!gone){delete awaySince[u]; return}
    if(!awaySince[u]) awaySince[u]=now;
    if(now-awaySince[u]<MS.away) return;
    any=true;
    var btn=el("button", "btn alt", "Remove "+nm(u)+" (away)"); btn.type="button";
    btn.addEventListener("click", function(){hostLeave(u)});
    box.appendChild(btn);
  });
  show("hosttools", any);
}

/* ---------- player actions ---------- */
function press(k){
  if(!pub||pub.phase!=="turn"||pub.turn!==uid||sending) return;
  if(/^[0-9]$/.test(k)){if(entry.length<4) entry+=k}
  else if(k==="back") entry=entry.slice(0,-1);
  else if(k==="clear") entry="";
  sound("click");
  paintKeypad();
}
function submitGuess(){
  if(entry.length!==4||!pub||pub.phase!=="turn"||pub.turn!==uid||sending) return;
  var dup=(D.hist||[]).some(function(h){return h.g===entry});
  if(dup){fail(entry+" was already guessed. Try a different code. No guess used."); sound("no"); return}
  fail(""); sending=true; paintKeypad();
  var g=entry;
  set(ref(db, rpath("vt/act/"+uid)), "g:"+g+":"+pub.seq).then(function(){entry=""}).catch(function(e){fail(friendly(e))}).then(function(){sending=false; render()});
}
function usePass(){
  if(!pub||pub.phase!=="turn"||pub.turn!==uid||sending||!(D.passLeft&&D.passLeft[uid])) return;
  sending=true;
  set(ref(db, rpath("vt/act/"+uid)), "p:"+pub.seq).catch(function(e){fail(friendly(e))}).then(function(){sending=false; render()});
}
function sendLie(key){
  if(!pub||pub.phase!=="seal") return;
  var v=key+":"+pub.seq;
  try{localStorage.setItem("vt_lie_"+code, v)}catch(e){}
  set(ref(db, rpath("vt/lie/"+uid)), v).catch(function(e){fail(friendly(e))});
  render();
}
function sendBallot(target){
  if(!pub||pub.phase!=="ballot") return;
  var v=target+":"+pub.seq;
  try{localStorage.setItem("vt_vote_"+code, v)}catch(e){}
  set(ref(db, rpath("vt/ballot/"+uid)), v).catch(function(e){fail(friendly(e))});
  render();
}
function sendChoice(k){
  if(!pub||pub.phase!=="choice") return;
  var v=k+":"+pub.seq;
  try{localStorage.setItem("vt_choice_"+code, v)}catch(e){}
  set(ref(db, rpath("vt/choice/"+uid)), v).catch(function(e){fail(friendly(e))});
  render();
}
function callVote(){
  if(!pub||pub.phase!=="debate"||call||!inGame()) return;
  set(ref(db, rpath("vt/call")), uid).catch(function(){/* someone else was first */});
}
function sendReady(){
  if(!pub||pub.phase!=="deal") return;
  set(ref(db, rpath("vt/ready/"+uid)), pub.seq).catch(function(e){fail(friendly(e))});
}
var leaveArmed=0;
function leaveGame(){
  if(!code||isHost()) return;
  if(Date.now()-leaveArmed>3000){leaveArmed=Date.now(); fail("Tap Leave again to leave. Your role will be shown to everyone."); return}
  fail("");
  set(ref(db, rpath("vt/left/"+uid)), true).catch(function(){}).then(function(){
    stopAll(); code=null; meta=null; pub=null; D=null; mine=null;
    try{sessionStorage.removeItem("tp_vt_room")}catch(e){}
    screen("home"); fail("You left the game.");
  });
}

/* ---------- host: publishing ---------- */
function names(){var m={}; G.players.forEach(function(p){m[p.uid]=p.name}); return m}
function publicData(extra){
  var removed={};
  Object.keys(G.removed).forEach(function(u){removed[u]={how:G.removed[u], role:G.roles[u]}});
  var data={
    v:1, setting:G.setting, order:G.order, names:names(), left:L.guessesLeft(G), used:G.used,
    hist:G.history.map(function(h){return {n:h.n, by:h.by, g:h.guess, b:h.shown.b, w:h.shown.w, cracked:h.guess===G.code}}),
    removed:removed, passLeft:G.passLeft,
    exposed:G.lies.filter(function(l){return l.exposed}).map(function(l){return {by:l.by, n:l.n, truth:l.truth, shown:l.shown}}),
    notice:"", tally:null, tallySeq:0, banner:null, end:null
  };
  if(extra&&extra.keepTally&&D){data.tally=D.tally||null; data.tallySeq=D.tallySeq||0}
  Object.keys(extra||{}).forEach(function(k){if(k!=="keepTally") data[k]=extra[k]});
  return data;
}
function saveSecret(){return set(ref(db, rpath("vt/secret")), JSON.stringify({G:G, sealPick:sealPick, afterBanner:afterBanner}))}
/* One atomic write per phase change: the public state, the host-only secret, and any private role notes. */
function publish(phase, extra, privateNotes, clear){
  var seq=(pub?pub.seq:0)+1;
  var payload={};
  var turn=G.winner?"":(L.currentTurn(G)||"");
  payload[rpath("vt/pub")]={phase:phase, seq:seq, opened:serverNow(), turn:turn, data:JSON.stringify(publicData(extra))};
  payload[rpath("vt/secret")]=JSON.stringify({G:G, sealPick:sealPick, afterBanner:afterBanner});
  (clear||[]).forEach(function(p){payload[rpath(p)]=null});
  Object.keys(privateNotes||{}).forEach(function(u){payload[rpath("vt/role/"+u)]=privateNotes[u]});
  hostLock=true;
  return update(ref(db), payload).then(function(){hostLock=false}).catch(function(e){hostLock=false; fail(friendly(e))});
}
function roleNote(u, d){return {r:G.roles[u], d:JSON.stringify(d||baseNote(u))}}
function baseNote(u){
  var partners=G.roles[u]==="traitor"?G.order.filter(function(o){return o!==u&&G.roles[o]==="traitor"}).map(function(o){return L.nameOf(G, o)}):[];
  return {partners:partners};
}
function nodePaths(kind, list){return (list||G.order).map(function(u){return "vt/"+kind+"/"+u})}

/* ---------- host: game flow ---------- */
function begin(){
  if(!isHost()||sending) return;
  var list=order();
  if(list.length<L.MIN_PLAYERS||list.length>L.MAX_PLAYERS){fail("Need 3 to 8 players."); return}
  if(dupName(list)){fail("Two players share a name."); return}
  sending=true; fail("");
  var setting=meta.vtDrink||drinkPick;
  G=L.newGame(list.map(function(p){return {uid:p.uid, name:L.cleanName(p.name).slice(0,L.NAME_MAX)}}), setting);
  sealPick=null; afterBanner=null; acts={}; lies={}; ballots={}; choices={}; D=null;
  var notes={}; G.order.forEach(function(u){notes[u]=roleNote(u)});
  var clear=[].concat(nodePaths("act"), nodePaths("lie"), nodePaths("ballot"), nodePaths("choice"), nodePaths("ready"), nodePaths("left"), ["vt/call"]);
  var payload={};
  payload[rpath("meta")]=metaObj({status:"play", phase:"answer", deck:["Vault Traitor"]});
  update(ref(db), payload).then(function(){return publish("deal", {}, notes, clear)}).catch(function(e){fail(friendly(e))}).then(function(){sending=false});
}
function metaObj(patch){
  var m=Object.assign({}, meta||{}, patch||{});
  var out={hostUid:m.hostUid, createdAt:m.createdAt, status:m.status, phase:m.phase, spice:"mild", rounds:10, na:false, round:0, gameId:+m.gameId||1, kind:"vt", vtDrink:m.vtDrink||"sips"};
  if(m.status!=="lobby") out.deck=["Vault Traitor"];
  if(m.status==="over") out.endedAt=m.endedAt||serverNow();
  return out;
}
function startTurns(){publish("turn", {}, null, nodePaths("ready"))}
function nextTurnPhase(notice){
  if(G.winner){endRound(); return}
  L.nextTurn(G);
  publish("turn", {notice:notice||""}, null, nodePaths("act"));
}
function handleAct(u, raw){
  var t=parseTagged(raw); if(!t||t.seq!==pub.seq||u!==pub.turn) return;
  if(t.v==="p"){
    var r=L.usePass(G, u); if(r.error) return;
    toDrinks(function(){nextTurnPhase()}, [ "vt/act/"+u ]);
    return;
  }
  var g=t.v.slice(2), res=L.submitGuess(G, u, g);
  if(res.error) return;
  if(res.duplicate){publish("turn", {notice:g+" was already guessed. No guess used. Try again, "+L.nameOf(G, u)+"."}, null, ["vt/act/"+u]); return}
  if(res.win){endRound(["vt/act/"+u]); return}
  sealPick=null;
  var notes={}, truth=G.pending.truth, opts=L.lieOptions(truth);
  res.liars.forEach(function(x){var d=baseNote(x); d.seal={seq:pub.seq+1, b:truth.b, w:truth.w, opts:opts, lies:G.liesLeft[x]}; notes[x]=roleNote(x, d)});
  publish("seal", {}, notes, ["vt/act/"+u].concat(nodePaths("lie")));
}
function handleLie(u, raw){
  var t=parseTagged(raw); if(!t||t.seq!==pub.seq||sealPick) return;
  if(t.v==="truth") return; // the truth never blocks a partner's lie
  if(L.liars(G).indexOf(u)<0||!L.applyLie(G.pending.truth, t.v)) return;
  sealPick={uid:u, key:t.v};
  /* tell the partner, privately, that this guess is taken */
  var notes={};
  L.liars(G).forEach(function(x){if(x!==u){var d=baseNote(x); var truth=G.pending.truth; d.seal={seq:pub.seq, b:truth.b, w:truth.w, opts:L.lieOptions(truth), lies:G.liesLeft[x]}; d.taken=pub.seq; notes[x]=roleNote(x, d)}});
  var payload={}; Object.keys(notes).forEach(function(x){payload[rpath("vt/role/"+x)]=notes[x]});
  payload[rpath("vt/secret")]=JSON.stringify({G:G, sealPick:sealPick, afterBanner:afterBanner});
  update(ref(db), payload).catch(function(){});
}
function closeSeal(){
  var pick=sealPick&&sealPick.key!=="truth"?sealPick:null;
  var entryRow=L.seal(G, pick);
  sealPick=null;
  var notes={}; G.order.forEach(function(u){if(G.roles[u]==="traitor") notes[u]=roleNote(u)});
  if(G.winner){endRound(nodePaths("lie"), notes); return}
  publish("debate", {}, notes, nodePaths("lie").concat(["vt/call"]));
  return entryRow;
}
function openBallot(caller){
  var notes={};
  L.active(G).forEach(function(u){if(G.skipVote[u]){var d=baseNote(u); d.sit=pub.seq+1; notes[u]=roleNote(u, d)}});
  publish("ballot", {caller:caller}, notes, nodePaths("ballot"));
}
function closeBallot(){
  var clean={};
  Object.keys(ballots).forEach(function(v){var t=parseTagged(ballots[v]); if(t&&t.seq===pub.seq) clean[v]=t.v});
  var caller=D.caller||call;
  var rec=L.vote(G, caller, clean);
  var tally={seq:pub.seq+1, caller:caller, target:rec.target, votes:rec.votes, of:rec.of, result:rec.result, cost:rec.cost};
  var notes={}; L.active(G).forEach(function(u){notes[u]=roleNote(u)});
  publish("tally", {tally:tally, tallySeq:pub.seq+1}, notes, nodePaths("ballot").concat(["vt/call"]));
  sound(rec.result==="correct"?"yes":"no");
}
/* After a turn: one private choice per affected player, then one shared banner, then cont(). */
function toDrinks(cont, clear){
  var b=L.turnDrinks(G);
  afterBanner=cont;
  if(!b){publishAfter(cont, clear); return}
  var notes={};
  b.affected.forEach(function(u){var d=baseNote(u); d.choice={seq:pub.seq+1, amount:b.amount, none:b.noDrinking, alts:L.alternatives(G, u)}; notes[u]=roleNote(u, d)});
  pendingBanner=b;
  publish("choice", {choiceFor:b.affected, keepTally:true}, notes, (clear||[]).concat(nodePaths("choice")));
}
var pendingBanner=null;
function publishAfter(cont, clear){
  if(clear&&clear.length){var p={}; clear.forEach(function(x){p[rpath(x)]=null}); update(ref(db), p).catch(function(){})}
  cont();
}
function closeChoice(){
  var b=pendingBanner; pendingBanner=null;
  if(!b){afterBanner&&afterBanner(); return}
  var entries=b.affected.map(function(u){
    var t=parseTagged(choices[u]), pick=t&&t.seq===pub.seq?t.v:"";
    return {uid:u, what:L.applyChoice(G, u, pick)};
  });
  var notes={}; b.affected.forEach(function(u){notes[u]=roleNote(u)});
  publish("banner", {banner:{lines:b.lines, entries:entries, amount:b.amount, none:b.noDrinking}, keepTally:true}, notes, nodePaths("choice"));
  sound("chime");
}
function closeBanner(){
  var cont=afterBanner; afterBanner=null;
  if(cont) cont(); else nextTurnPhase();
}
function endRound(clear, notes){
  var f=L.finish(G);
  var payload={};
  publish("end", {end:{winner:f.winner, reason:f.reason, code:f.code, roles:f.roles, lies:f.lies, votes:f.votes, summary:f.summary, banner:f.banner?{lines:f.banner.lines, affected:f.banner.affected, amount:f.banner.amount, none:f.banner.noDrinking}:null}}, notes, (clear||[]).concat(nodePaths("act"), nodePaths("lie"), nodePaths("ballot"), nodePaths("choice"), ["vt/call"])).then(function(){
    payload[rpath("meta")]=metaObj({status:"over", phase:"over", endedAt:serverNow()});
    return update(ref(db), payload);
  }).catch(function(e){fail(friendly(e))});
  sound("celebrate");
}
function hostLeave(u){
  if(!G||G.removed[u]) return;
  var r=L.leave(G, u); if(!r) return;
  var msg=L.nameOf(G, u)+" left. They were "+(r.role==="traitor"?"a Traitor":"a Codebreaker")+".";
  delete ballots[u]; delete choices[u];
  var gone=["vt/left/"+u, "players/"+u];
  if(G.winner){endRound(gone); return}
  if(r.short){publish("short", {notice:msg}, null, gone); return}
  var ph=pub.phase;
  if(ph==="turn") publish("turn", {notice:msg}, null, gone.concat(["vt/act/"+u]));
  else{var p={}; p[rpath("vt/pub/data")]=JSON.stringify(publicData(Object.assign({}, D, {notice:msg, left:L.guessesLeft(G), removed:publicData().removed, exposed:publicData().exposed}))); p[rpath("vt/left/"+u)]=null; p[rpath("players/"+u)]=null; p[rpath("vt/secret")]=JSON.stringify({G:G, sealPick:sealPick, afterBanner:null}); update(ref(db), p).catch(function(){})}
}
function newGameSame(){
  if(!isHost()) return;
  begin();
}
function backToLobby(){
  if(!isHost()) return;
  var payload={};
  payload[rpath("meta")]=metaObj({status:"lobby", phase:"lobby", gameId:Math.min(100,(+meta.gameId||1)+1)});
  payload[rpath("vt/pub")]=null;
  payload[rpath("vt/secret")]=null;
  update(ref(db), payload).catch(function(e){fail(friendly(e))});
}
/* The host's clock: closes timed phases and reacts to private writes. */
function hostTick(){
  if(!isHost()||!G||!pub||hostLock) return;
  var ph=pub.phase, age=serverNow()-pub.opened;
  if(ph==="deal"){
    var act=L.active(G), allReady=act.every(function(u){return readyMap[u]===pub.seq});
    if(allReady) startTurns();
  }else if(ph==="turn"){
    var t=pub.turn; if(t&&acts[t]) handleAct(t, acts[t]);
  }else if(ph==="seal"){
    Object.keys(lies).forEach(function(u){handleLie(u, lies[u])});
    if(age>=MS.seal) closeSeal();
  }else if(ph==="debate"){
    if(call&&L.active(G).indexOf(call)>=0) openBallot(call);
    else if(age>=MS.debate) nextTurnPhase();
  }else if(ph==="ballot"){
    var need=L.voters(G), got=need.filter(function(u){var x=parseTagged(ballots[u]); return x&&x.seq===pub.seq});
    if(got.length===need.length||age>=MS.ballot) closeBallot();
  }else if(ph==="tally"){
    if(age>=MS.tally) toDrinks(function(){if(G.winner) endRound(); else nextTurnPhase()});
  }else if(ph==="choice"){
    var who=(D.choiceFor||[]), done=who.filter(function(u){var x=parseTagged(choices[u]); return (x&&x.seq===pub.seq)||G.removed[u]==="left"});
    if(done.length===who.length||age>=MS.choice) closeChoice();
  }else if(ph==="banner"){
    if(age>=MS.banner) closeBanner();
  }
  Object.keys(leftMap).forEach(function(u){if(leftMap[u]&&G&&!G.removed[u]) hostLeave(u)});
}
function resumeHost(){
  get(ref(db, rpath("vt/secret"))).then(function(s){
    if(!s.exists()) return;
    try{var o=JSON.parse(s.val()); G=o.G; sealPick=o.sealPick||null}catch(e){return}
    /* continuations cannot be saved: rebuild the obvious next step */
    if(pub&&pub.phase==="banner") afterBanner=function(){if(G.winner) endRound(); else nextTurnPhase()};
    if(pub&&pub.phase==="choice"){var b=L.resolveDrinks([{type:"x", uids:D.choiceFor||[]}], G.setting); pendingBanner=b?Object.assign(b, {lines:(D.banner&&D.banner.lines)||["Drinks."]}):null; afterBanner=function(){if(G.winner) endRound(); else nextTurnPhase()}}
    listenHost();
  }).catch(function(){});
}

/* ---------- listeners ---------- */
function stopAll(){stops.forEach(function(fn){try{fn()}catch(e){}}); stops=[]; stopHost(); if(connStop){connStop(); connStop=null}}
function stopHost(){hostStops.forEach(function(fn){try{fn()}catch(e){}}); hostStops=[]}
function listen(){
  stopAll();
  var watched=code;
  stops.push(onValue(ref(db, rpath("meta")), function(s){
    if(!s.exists()){if(watched!==code) return; roomEnded(); return}
    var was=isHost(); meta=s.val()||null;
    if(meta&&meta.vtDrink) drinkPick=meta.vtDrink;
    if(isHost()&&!was) {listenHost(); if(meta.status!=="lobby"&&!G) resumeHost()}
    render();
  }, function(){fail("That room isn't available.")}));
  stops.push(onValue(ref(db, rpath("players")), function(s){players=s.val()||{}; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("vt/pub")), function(s){
    pub=s.val()||null;
    try{D=pub?JSON.parse(pub.data):null}catch(e){D=null}
    if(pub&&(pub.seq!==lastSeq)){
      if(pub.phase!==lastPhase){
        if(pub.phase==="debate"){sound("blip"); lastCountSaid=-1}
        if(pub.phase==="banner") sound("chime");
        if(pub.phase==="turn"&&pub.turn===uid) sound("card");
      }
      lastSeq=pub.seq; lastPhase=pub.phase;
    }
    hostLock=false;
    render(); hostTick();
  }, function(){}));
  stops.push(onValue(ref(db, rpath("vt/role/"+uid)), function(s){
    var v=s.val(); mine=null;
    if(v){try{mine={r:v.r, d:JSON.parse(v.d||"{}")}}catch(e){mine={r:v.r, d:{}}}}
    render();
  }, function(){}));
  stops.push(onValue(ref(db, rpath("vt/ready")), function(s){readyMap=s.val()||{}; render(); hostTick()}, function(){}));
  stops.push(onValue(ref(db, rpath("vt/left")), function(s){leftMap=s.val()||{}; hostTick()}, function(){}));
  stops.push(onValue(ref(db, rpath("vt/call")), function(s){call=s.val()||null; render(); hostTick()}, function(){}));
}
function listenHost(){
  stopHost();
  hostStops.push(onValue(ref(db, rpath("vt/act")), function(s){acts=s.val()||{}; hostTick()}, function(){}));
  hostStops.push(onValue(ref(db, rpath("vt/lie")), function(s){lies=s.val()||{}; hostTick()}, function(){}));
  hostStops.push(onValue(ref(db, rpath("vt/ballot")), function(s){ballots=s.val()||{}; hostTick()}, function(){}));
  hostStops.push(onValue(ref(db, rpath("vt/choice")), function(s){choices=s.val()||{}; hostTick()}, function(){}));
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
  stopAll(); code=null; meta=null; pub=null; D=null; mine=null; G=null;
  try{sessionStorage.removeItem("tp_vt_room")}catch(e){}
  fail("This room has closed."); screen("home");
}

/* ---------- rooms ---------- */
async function hostRoom(name){
  var i, claimed=null;
  for(i=0;i<6;i++){
    var c=makeRoomCode();
    var snap=await get(ref(db, "rooms/"+c+"/meta"));
    if(snap.exists()) continue;
    try{
      await update(ref(db), {["rooms/"+c+"/meta"]:{hostUid:uid, createdAt:serverTimestamp(), status:"lobby", phase:"lobby", spice:"mild", rounds:10, na:false, round:0, gameId:1, kind:"vt", vtDrink:drinkPick}});
      claimed=c; break;
    }catch(e){if(!/permission/i.test(String(e.code||e.message||""))) throw e}
  }
  if(!claimed) throw new Error("room");
  await set(ref(db, "rooms/"+claimed+"/players/"+uid), {name:name, connected:true, joinedAt:serverNow()});
  code=claimed;
  try{sessionStorage.setItem("tp_vt_room", code); localStorage.setItem("tp_last_game", "vault-traitor")}catch(e){}
  listen(); armPresence();
}
async function joinRoom(c, name){
  var snap=await get(ref(db, "rooms/"+c+"/meta"));
  if(!snap.exists()) throw new Error("missing");
  var m=snap.val()||{};
  if(m.kind!=="vt") throw new Error("kind");
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
  code=c;
  try{sessionStorage.setItem("tp_vt_room", code); localStorage.setItem("tp_last_game", "vault-traitor")}catch(e){}
  listen(); armPresence();
}
var closeArmed=0;
function askClose(){
  if(!isHost()||!code) return;
  if(Date.now()-closeArmed>2500){closeArmed=Date.now(); fail("Tap close again to end the room for everyone."); return}
  fail(""); remove(ref(db, "rooms/"+code)).catch(function(e){fail(friendly(e))});
  try{sessionStorage.removeItem("tp_vt_room")}catch(e){}
}
function setDrink(v){
  if(!/^(sips|shots|none)$/.test(v)) return;
  if(meta&&!isHost()) return;
  drinkPick=v;
  if(isHost()&&meta&&meta.status==="lobby") update(ref(db), {[rpath("meta")]:metaObj({vtDrink:v})}).catch(function(e){fail(friendly(e))});
  render();
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
  /* Sound starts off on this game unless the player has already chosen, as the spec asks. */
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
      else if(msg==="closed") fail("That game has already started.");
      else if(msg==="full") fail("That room is full (8 players).");
      else if(msg.indexOf("name:")===0) fail(msg.slice(5));
      else fail(friendly(e));
    }).then(function(){sending=false});
  });
  document.querySelectorAll("[data-drink]").forEach(function(b){b.addEventListener("click", function(){setDrink(b.dataset.drink)})});
  $("start").addEventListener("click", begin);
  $("readybtn").addEventListener("click", sendReady);
  document.querySelectorAll("#keys [data-k]").forEach(function(k){k.addEventListener("click", function(){press(k.dataset.k)})});
  $("submitguess").addEventListener("click", submitGuess);
  $("passtoken").addEventListener("click", usePass);
  $("callvote").addEventListener("click", callVote);
  $("nextround").addEventListener("click", function(){
    if(!isHost()||!pub) return;
    if(pub.phase==="deal") startTurns();
    else if(pub.phase==="banner") closeBanner();
    else if(pub.phase==="short") backToLobby();
  });
  $("again").addEventListener("click", newGameSame);
  $("leave").addEventListener("click", leaveGame);
  $("close").addEventListener("click", askClose);
  $("closestage").addEventListener("click", askClose);
  $("copylink").addEventListener("click", function(){if(code) copyText(roomUrl(code)).then(function(){fail("Link copied.")}).catch(function(){fail(roomUrl(code))})});
  $("copycode").addEventListener("click", function(){if(code) copyText(code).then(function(){fail("Code copied.")}).catch(function(){fail(code)})});
  $("sharebtn").addEventListener("click", function(){
    if(!code) return;
    if(navigator.share) navigator.share({title:"Vault Traitor", text:"Join my Vault Traitor room "+code, url:roomUrl(code)}).catch(function(){});
    else copyText(roomUrl(code)).then(function(){fail("Link copied.")}).catch(function(){fail(roomUrl(code))});
  });
  if($("qrhide")) $("qrhide").addEventListener("click", function(){
    var canvas=$("qr"), hidden=canvas.dataset.hidden==="1";
    canvas.dataset.hidden=hidden?"0":"1"; canvas.classList.toggle("hide", !hidden);
    $("qrhide").textContent=hidden?"Hide QR":"Show QR"; if(hidden) paintQr();
  });
  /* desktop keyboard: digits, Backspace and Enter on your turn */
  document.addEventListener("keydown", function(e){
    if(!pub||pub.phase!=="turn"||pub.turn!==uid) return;
    var tag=(e.target&&e.target.tagName)||"";
    if(/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    if(/^[0-9]$/.test(e.key)){press(e.key); flashKey(e.key); e.preventDefault()}
    else if(e.key==="Backspace"){press("back"); e.preventDefault()}
    else if(e.key==="Enter"&&entry.length===4){submitGuess(); e.preventDefault()}
  });
  tickTimer=setInterval(function(){if(pub&&pub.phase!=="lobby"&&pub.phase!=="end") render(); hostTick()}, 250);
  window.addEventListener("online", function(){fail(""); if(goOnline&&db){try{goOnline(db)}catch(e){}}});
  var back=""; try{back=sessionStorage.getItem("tp_vt_room")||""}catch(e){}
  var name=L.cleanName($("pname").value);
  if(back&&validCode(back)&&name&&(!linked||linked===back)) joinRoom(back, name).catch(function(){try{sessionStorage.removeItem("tp_vt_room")}catch(err){}});
}
function flashKey(k){var b=document.querySelector('#keys [data-k="'+k+'"]'); if(b){b.classList.add("down"); setTimeout(function(){b.classList.remove("down")}, 120)}}

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
  if(emuOn()) window.__tpVault={uid:function(){return uid}, code:function(){return code}, phase:function(){return pub&&pub.phase}, data:function(){return D}, role:function(){return mine&&mine.r}, host:function(){return isHost()}};
  showReady();
  try{wire()}catch(err){console.error(err); fail("The vault glitched. Reload and try again.")}
}
$("retry").addEventListener("click", function(){location.reload()});
boot().catch(function(err){console.error(err); showBootError("The game didn't open. Check your connection and try again.")});
})();
