(function(){
"use strict";
/* Punchline Duel, one phone per player. rooms/$code/ql
   The host's phone runs the game with QuiplashLogic and publishes only what everyone may see (ql/pub).
   Each round one prompt goes to two players, who write in private on ql/ans/$uid (only they and the host read it).
   Everyone else votes on ql/vote/$uid. The host reads both, reveals the two answers as A and B with no names,
   collects the votes, then reveals the authors and the winner. The full game lives in host memory. */
var L=window.QuiplashLogic;
var FAST=/[?&]emulator=1(?:&|$)/.test(location.search)&&/[?&]fast=1(?:&|$)/.test(location.search);
var MS={answer:FAST?4000:60000, vote:FAST?3000:30000, reveal:FAST?2500:9000, away:FAST?1500:30000};
var ALPHABET="ABCDEFGHJKMNPQRSTUVWXYZ";
var $=function(id){return document.getElementById(id)};
var uid=null, code=null, meta=null, players={}, pub=null, D=null, mineAns=null, leftMap={};
var drinkPick="sips", roundPick=8, sending=false, serverOffset=0, offsetReady=false, offsetStop=null;
var db, authObj, stops=[], hostStops=[], connStop=null, bootTimer=0, tickTimer=0;
var ref, onValue, update, set, remove, onDisconnect, get, serverTimestamp, goOnline;
var draftAns="", votePick="";
/* host only */
var G=null, answers={}, votes={}, map=null, hostLock=false, afterReveal=null;
var lastSeq=-1, lastPhase="", prompts=(window.QUIPLASH_PROMPTS||[]);

/* ---------- small helpers ---------- */
function serverNow(){return Date.now()+(offsetReady?serverOffset:0)}
function rpath(p){return "rooms/"+code+"/"+p}
var lobbyErr="";
function fail(msg){var p=$("perr"); if(p) p.textContent=msg||""; lobbyErr=msg||""; var l=$("lobby"); if(l&&!l.classList.contains("hide")&&meta) paintLobby()}
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
function roomUrl(c){
  if(window.TipsyJoinQR) return TipsyJoinQR.pageInvite("/games/punchline-duel.html", c, "ql");
  return "https://tipsyplay.com/games/punchline-duel.html?room="+c+"&game=ql";
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
function keyed(box, key){if(box.dataset.key===key) return false; box.dataset.key=key; box.textContent=""; return true}
function parseTagged(v){var s=String(v||""), i=s.lastIndexOf(":"); if(i<0) return null; return {v:s.slice(0,i), seq:+s.slice(i+1)}}
function amIAuthor(){return !!(D&&D.a&&(D.a===uid||D.b===uid))}

/* ---------- rendering ---------- */
function render(){
  document.body.classList.toggle("is-host", isHost());
  document.querySelectorAll(".hostonly").forEach(function(n){n.classList.toggle("hide", !isHost())});
  if(!meta){screen("home"); return}
  if(meta.status==="lobby"||!pub||!D){screen("lobby"); paintLobby(); return}
  if(pub.phase==="end"){screen("table"); paintEnd(); return}
  screen("table"); paintTable();
}
function paintLobby(){
  $("codebig").textContent=code||"";
  $("sharelink").textContent=roomUrl(code);
  paintQr();
  var list=order(), box=$("plist"); box.textContent="";
  list.forEach(function(p){
    var row=el("div", "ql-person"+(p.connected?"":" off"));
    row.appendChild(el("span", null, p.name+(p.uid===meta.hostUid?" · host":"")));
    row.appendChild(el("span", null, p.connected?"":"away"));
    if(isHost()&&p.uid!==uid){
      var kick=el("button", "x", "Remove"); kick.type="button"; kick.setAttribute("aria-label", "Remove "+p.name);
      kick.addEventListener("click", function(){remove(ref(db, rpath("players/"+p.uid))).catch(function(e){fail(friendly(e))})});
      row.appendChild(kick);
    }
    box.appendChild(row);
  });
  var setting=(meta.qlDrink)||drinkPick;
  document.querySelectorAll("[data-drink]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.drink===setting?"true":"false");
    b.disabled=!isHost();
  });
  $("drinknote").textContent=setting==="none"?"No drinking: the losing answer's author does the alternative.":setting==="shots"?"Shots: the losing author takes one shot. Pace yourself.":"Drinks: the losing author takes one drink.";
  var rounds=(meta.qlRounds)||roundPick;
  document.querySelectorAll("[data-rounds]").forEach(function(b){
    b.setAttribute("aria-pressed", (+b.dataset.rounds===rounds)?"true":"false");
    b.disabled=!isHost();
  });
  var n=list.length, dup=dupName(list);
  var start=$("start"); start.disabled=!isHost()||n<L.MIN_PLAYERS||n>L.MAX_PLAYERS||!!dup;
  start.textContent="Start game · "+n+" player"+(n===1?"":"s");
  var note=$("lobbynote");
  note.classList.toggle("err", !!lobbyErr);
  if(lobbyErr) note.textContent=lobbyErr;
  else if(n<L.MIN_PLAYERS) note.textContent="Need "+(L.MIN_PLAYERS-n)+" more player"+(L.MIN_PLAYERS-n===1?"":"s")+".";
  else if(n>L.MAX_PLAYERS) note.textContent="12 players max.";
  else if(dup) note.textContent="Two players are called "+dup+". One of you, rejoin with another name.";
  else note.textContent=isHost()?"Everyone in? Start when ready. Each round, two phones write; the rest vote.":"You're in. The host starts when the table's ready.";
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

function paintTable(){
  var ph=pub.phase;
  $("qlround").textContent="Round "+(D.round+1)+" of "+D.total;
  $("qlscore").textContent="";
  // standings strip
  if(D.standings){
    var ss=$("qlscore");
    D.standings.slice(0,3).forEach(function(s){ss.appendChild(el("span", "ql-chip", s.name+" "+s.score))});
  }
  show("answerbox", ph==="answer");
  show("waitbox", (ph==="answer"&&!amIAuthor())||(ph==="vote"&&amIAuthor()));
  show("votebox", ph==="vote"&&!amIAuthor());
  show("revealbox", ph==="reveal");
  if(ph==="answer") paintAnswer();
  else if(ph==="vote") paintVote();
  else if(ph==="reveal") paintReveal();
  if(ph==="answer"&&!amIAuthor()) $("waittext").textContent="Two phones are writing their answers. Cheer, don't peek.";
  if(ph==="vote"&&amIAuthor()) $("waittext").textContent="Your answer is in. The table is voting now.";
  paintHostTools(ph);
}
function paintAnswer(){
  var mine=amIAuthor();
  show("answerbox", mine);
  if(!mine) return;
  $("qlprompt").textContent=D.prompt;
  var inp=$("qlanswer"), btn=$("qlsend");
  var done=mineAns!=null;
  inp.disabled=done; btn.disabled=done||!L.cleanAnswer(inp.value);
  if(done){
    $("answerstate").textContent="Answer locked in. Waiting for the other player.";
    inp.value=mineAns;
  }else{
    $("answerstate").textContent=phaseLeft(MS.answer)+"s left.";
  }
}
function paintVote(){
  if(amIAuthor()) return;
  $("votepromptline").textContent=D.prompt;
  var box=$("votelist");
  if(keyed(box, "v"+pub.seq)){
    ["a","b"].forEach(function(side){
      var ans=side==="a"?D.ansA:D.ansB;
      var b=el("button", "ql-answer"); b.type="button"; b.dataset.side=side;
      b.appendChild(el("span", "ql-label", side==="a"?"A":"B"));
      b.appendChild(el("span", "ql-text", ans||"(no answer)"));
      b.addEventListener("click", function(){sendVote(side)});
      box.appendChild(b);
    });
  }
  var myVote=parseTagged(votes[uid]);
  var picked=(myVote&&myVote.seq===pub.seq)?myVote.v:votePick;
  box.querySelectorAll("button").forEach(function(b){b.setAttribute("aria-pressed", b.dataset.side===picked?"true":"false")});
  $("votestate").textContent=picked?"Vote in. You can change it until the timer ends.":(phaseLeft(MS.vote)+"s to vote.");
}
function paintReveal(){
  var box=$("revealbox");
  box.textContent="";
  box.appendChild(el("p", "ql-rprompt", D.prompt));
  [["a",D.ansA,D.a],["b",D.ansB,D.b]].forEach(function(row){
    var side=row[0], ans=row[1], who=row[2];
    var win=D.winner===who;
    var card=el("div", "ql-reveal"+(win?" win":""));
    card.appendChild(el("span", "ql-label", side==="a"?"A":"B"));
    var mid=el("div", "ql-mid");
    mid.appendChild(el("p", "ql-text", ans||"(no answer)"));
    mid.appendChild(el("p", "ql-by", nm(who)+(win?" · wins":"")));
    card.appendChild(mid);
    card.appendChild(el("span", "ql-votes", String(side==="a"?D.votesA:D.votesB)));
    box.appendChild(card);
  });
  if(D.tie) box.appendChild(el("p", "ql-banner", "A tie. Nobody drinks."));
  else if(D.banner){
    var b=D.banner, line=b.line;
    if(!b.noDrinking&&b.drinkers&&b.drinkers.length) line+=" "+nm(b.drinkers[0])+", "+b.amount+" or the alternative.";
    else if(b.noDrinking) line+=" "+nm(D.loser)+", the alternative.";
    box.appendChild(el("p", "ql-banner", line));
  }
}
function paintEnd(){
  screen("table");
  ["answerbox","votebox","waitbox","revealbox","hosttools"].forEach(function(id){show(id, false)});
  show("finale", true);
  var box=$("reveal"); box.textContent="";
  var w=D.winner||(D.standings&&D.standings[0]);
  var top=D.standings&&D.standings.length?D.standings[0]:null;
  var tied=D.standings?D.standings.filter(function(s){return top&&s.score===top.score&&top.score>0}):[];
  box.appendChild(el("h2", "ql-title", top&&top.score>0?(tied.length>1?"It's a tie!":nm(top.uid)+" wins!"):"Good game"));
  var ol=el("ol", "ql-stand");
  (D.standings||[]).forEach(function(s){
    var li=el("li", null);
    li.appendChild(el("span", "ql-sname", s.name));
    li.appendChild(el("span", "ql-sscore", s.score+" win"+(s.score===1?"":"s")));
    ol.appendChild(li);
  });
  box.appendChild(ol);
}
function paintHostTools(ph){
  var box=$("hosttools");
  show("hosttools", isHost());
  if(!isHost()){return}
  var cont=$("nextround");
  cont.classList.toggle("hide", ph!=="reveal");
  cont.textContent=(D.round+1>=D.total)?"See the results":"Next round";
}

/* ---------- player actions ---------- */
function sendAnswer(){
  if(!pub||pub.phase!=="answer"||!amIAuthor()||mineAns!=null) return;
  var a=L.cleanAnswer($("qlanswer").value), err=L.answerError(a);
  if(err){fail(err); return}
  set(ref(db, rpath("ql/ans/"+uid)), a).then(function(){mineAns=a; render()}).catch(function(e){fail(friendly(e))});
}
function sendVote(side){
  if(!pub||pub.phase!=="vote"||amIAuthor()) return;
  votePick=side;
  set(ref(db, rpath("ql/vote/"+uid)), side+":"+pub.seq).catch(function(e){fail(friendly(e))});
  render();
}
function leaveGame(){
  if(!code) return;
  if(isHost()){askClose(); return}
  set(ref(db, rpath("ql/left/"+uid)), true).catch(function(){});
  remove(ref(db, rpath("players/"+uid))).catch(function(){});
  roomEnded();
}

/* ---------- host: publishing ---------- */
function names(){var m={}; G.players.forEach(function(p){m[p.uid]=p.name}); return m}
function publicData(extra){
  var data={
    v:1, setting:G.setting, round:G.round, total:G.matchups.length, names:names(),
    standings:L.standings(G), notice:""
  };
  Object.keys(extra||{}).forEach(function(k){data[k]=extra[k]});
  return data;
}
function saveSecret(){return set(ref(db, rpath("ql/secret")), JSON.stringify({G:G, map:map}))}
function publish(phase, extra, clear, more){
  var seq=(pub?pub.seq:0)+1;
  var payload=Object.assign({}, more||{});
  payload[rpath("ql/pub")]={phase:phase, seq:seq, opened:serverNow(), data:JSON.stringify(publicData(extra))};
  payload[rpath("ql/secret")]=JSON.stringify({G:G, map:map});
  (clear||[]).forEach(function(p){payload[rpath(p)]=null});
  hostLock=true;
  return update(ref(db), payload).then(function(){hostLock=false; return true}).catch(function(e){hostLock=false; fail(friendly(e)); return false});
}
function metaObj(patch){
  var m=Object.assign({}, meta||{}, patch||{});
  var out={hostUid:m.hostUid, createdAt:m.createdAt, status:m.status, phase:m.phase, spice:"mild", rounds:10, na:false, round:0, gameId:+m.gameId||1, kind:"ql", qlDrink:m.qlDrink||"sips", qlRounds:+m.qlRounds||roundPick};
  if(m.status!=="lobby") out.deck=["Punchline Duel"];
  if(m.status==="over") out.endedAt=m.endedAt||serverNow();
  return out;
}
function nodePaths(kind, list){return (list||G.order).map(function(u){return "ql/"+kind+"/"+u})}

/* ---------- host: game flow ---------- */
function begin(){
  if(!isHost()||sending) return;
  var list=order();
  if(list.length<L.MIN_PLAYERS||list.length>L.MAX_PLAYERS){fail("Need 3 to 12 players."); return}
  if(dupName(list)){fail("Two players share a name."); return}
  sending=true; fail("");
  var setting=meta.qlDrink||drinkPick, rounds=meta.qlRounds||roundPick;
  G=L.newGame(list.map(function(p){return {uid:p.uid, name:L.cleanName(p.name).slice(0,L.NAME_MAX)}}), setting, rounds, prompts.length||1);
  answers={}; votes={}; map=null; afterReveal=null; D=null;
  var clear=[].concat(nodePaths("ans"), nodePaths("vote"), nodePaths("left"));
  var more={};
  more[rpath("meta")]=metaObj({status:"play", phase:"answer", qlDrink:setting, qlRounds:rounds});
  openAnswer(clear, more).then(function(ok){if(!ok){G=null; D=null}}).then(function(){sending=false; if(isHost()&&meta) paintLobby()});
}
function openAnswer(clear, more){
  var m=L.current(G);
  answers={}; votes={}; map=null;
  var extra={a:m.a, b:m.b, prompt:prompts[m.prompt]||"Say something funny."};
  return publish("answer", extra, clear||[].concat(nodePaths("ans"), nodePaths("vote")), more);
}
function openVote(){
  var m=L.current(G);
  var ansA=L.cleanAnswer(answers[m.a]), ansB=L.cleanAnswer(answers[m.b]);
  // shuffle which author is shown as A so position never leaks identity
  var flip=L.randomInt(2)===1;
  map={A:flip?m.b:m.a, B:flip?m.a:m.b};
  var showA=flip?ansB:ansA, showB=flip?ansA:ansB;
  publish("vote", {a:m.a, b:m.b, prompt:prompts[m.prompt]||"", ansA:showA, ansB:showB}, nodePaths("vote"));
}
function closeVote(){
  var m=L.current(G);
  // translate A/B ballots to author uids for the logic tally
  var ballots={};
  Object.keys(votes).forEach(function(v){
    var t=parseTagged(votes[v]); if(!t||t.seq!==pub.seq) return;
    if(v===m.a||v===m.b) return;
    ballots[v]=(map&&map[t.v==="a"?"A":"B"]===m.a)?"a":"b";
  });
  var entry=L.resolveRound(G, {[m.a]:answers[m.a], [m.b]:answers[m.b]}, ballots);
  var winnerUid=entry.winner;
  var extra={
    a:m.a, b:m.b, prompt:prompts[m.prompt]||"",
    ansA:L.cleanAnswer(answers[m.a]), ansB:L.cleanAnswer(answers[m.b]),
    votesA:entry.votesA, votesB:entry.votesB, winner:winnerUid, tie:entry.tie,
    loser:entry.banner?entry.banner.loser:null, banner:entry.banner
  };
  if(winnerUid) sound("chime");
  afterReveal=function(){
    if(G.round>=G.matchups.length){ publish("end", {standings:L.standings(G), winner:L.leaders(G)}); endRoom(); }
    else openAnswer();
  };
  publish("reveal", extra, nodePaths("ans").concat(nodePaths("vote")));
}
function endRoom(){
  update(ref(db), {[rpath("meta")]:metaObj({status:"over", phase:"end", endedAt:serverNow()})}).catch(function(){});
}
function newGameSame(){
  if(!isHost()) return;
  var patch=metaObj({status:"lobby", phase:"lobby", gameId:(+meta.gameId||1)+1});
  update(ref(db), {[rpath("meta")]:patch, [rpath("ql/pub")]:null, [rpath("ql/secret")]:null}).then(function(){
    G=null; D=null; pub=null; map=null; answers={}; votes={};
  }).catch(function(e){fail(friendly(e))});
}
function hostLeave(u){
  if(!G) return;
  // a player who leaves is dropped from future matchups by using "(gone)"; current round still resolves
  leftMap[u]=false;
}

/* ---------- host tick ---------- */
function hostTick(){
  if(!isHost()||!G||!pub||hostLock) return;
  var ph=pub.phase, age=serverNow()-pub.opened;
  if(ph==="answer"){
    var m=L.current(G);
    var both=answers[m.a]!=null&&answers[m.b]!=null;
    if(both||age>=MS.answer){
      var mm=L.current(G);
      if(answers[mm.a]==null) answers[mm.a]="";
      if(answers[mm.b]==null) answers[mm.b]="";
      openVote();
    }
  }else if(ph==="vote"){
    var mv=L.current(G);
    var need=L.voters(G.order, mv).filter(function(u){return !leftMap[u]});
    var got=need.filter(function(u){var x=parseTagged(votes[u]); return x&&x.seq===pub.seq});
    if((need.length&&got.length>=need.length)||age>=MS.vote) closeVote();
  }else if(ph==="reveal"){
    if(age>=MS.reveal&&afterReveal){var f=afterReveal; afterReveal=null; f()}
  }
}
function resumeHost(){
  get(ref(db, rpath("ql/secret"))).then(function(s){
    if(!s.exists()) return;
    try{var o=JSON.parse(s.val()); G=o.G; map=o.map||null}catch(e){return}
    if(pub&&pub.phase==="reveal") afterReveal=function(){if(G.round>=G.matchups.length){publish("end", {standings:L.standings(G), winner:L.leaders(G)}); endRoom()} else openAnswer()};
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
    if(meta&&meta.qlDrink) drinkPick=meta.qlDrink;
    if(meta&&meta.qlRounds) roundPick=meta.qlRounds;
    if(isHost()&&!was){listenHost(); if(meta.status!=="lobby"&&!G) resumeHost()}
    render();
  }, function(){fail("That room isn't available.")}));
  stops.push(onValue(ref(db, rpath("players")), function(s){players=s.val()||{}; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("ql/pub")), function(s){
    pub=s.val()||null;
    try{D=pub?JSON.parse(pub.data):null}catch(e){D=null}
    if(pub&&pub.seq!==lastSeq){
      if(pub.phase!==lastPhase){
        if(pub.phase==="answer"&&amIAuthor()) sound("card");
        if(pub.phase==="vote") sound("blip");
      }
      if(pub.phase==="answer") mineAns=null;
      if(pub.phase==="vote") votePick="";
      lastSeq=pub.seq; lastPhase=pub.phase;
    }
    hostLock=false;
    render(); hostTick();
  }, function(){}));
  stops.push(onValue(ref(db, rpath("ql/ans/"+uid)), function(s){if(pub&&pub.phase==="answer"){mineAns=s.exists()?s.val():null; render()}}, function(){}));
  stops.push(onValue(ref(db, rpath("ql/vote/"+uid)), function(s){if(!isHost()){var t=parseTagged(s.val()); if(t&&pub&&t.seq===pub.seq) votePick=t.v; render()}}, function(){}));
  stops.push(onValue(ref(db, rpath("ql/left")), function(s){leftMap=s.val()||{}; hostTick()}, function(){}));
}
function listenHost(){
  stopHost();
  hostStops.push(onValue(ref(db, rpath("ql/ans")), function(s){answers=s.val()||{}; hostTick()}, function(){}));
  hostStops.push(onValue(ref(db, rpath("ql/vote")), function(s){votes=s.val()||{}; hostTick()}, function(){}));
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
  stopAll(); code=null; meta=null; pub=null; D=null; G=null; mineAns=null;
  try{sessionStorage.removeItem("tp_ql_room")}catch(e){}
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
      await update(ref(db), {["rooms/"+c+"/meta"]:{hostUid:uid, createdAt:serverTimestamp(), status:"lobby", phase:"lobby", spice:"mild", rounds:10, na:false, round:0, gameId:1, kind:"ql", qlDrink:drinkPick, qlRounds:roundPick}});
      claimed=c; break;
    }catch(e){if(!/permission/i.test(String(e.code||e.message||""))) throw e}
  }
  if(!claimed) throw new Error("room");
  await set(ref(db, "rooms/"+claimed+"/players/"+uid), {name:name, connected:true, joinedAt:serverNow()});
  code=claimed;
  try{sessionStorage.setItem("tp_ql_room", code); localStorage.setItem("tp_last_game", "quiplash")}catch(e){}
  listen(); armPresence();
}
async function joinRoom(c, name){
  var snap=await get(ref(db, "rooms/"+c+"/meta"));
  if(!snap.exists()) throw new Error("missing");
  var m=snap.val()||{};
  if(m.kind!=="ql") throw new Error("kind");
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
  try{sessionStorage.setItem("tp_ql_room", code); localStorage.setItem("tp_last_game", "quiplash")}catch(e){}
  listen(); armPresence();
}
var closeArmed=0;
function askClose(){
  if(!isHost()||!code) return;
  if(Date.now()-closeArmed>2500){closeArmed=Date.now(); fail("Tap close again to end the room for everyone."); return}
  fail(""); remove(ref(db, "rooms/"+code)).catch(function(e){fail(friendly(e))});
  try{sessionStorage.removeItem("tp_ql_room")}catch(e){}
}
function setDrink(v){
  if(!/^(sips|shots|none)$/.test(v)) return;
  if(meta&&!isHost()) return;
  drinkPick=v;
  if(isHost()&&meta&&meta.status==="lobby") update(ref(db), {[rpath("meta")]:metaObj({qlDrink:v})}).catch(function(e){fail(friendly(e))});
  render();
}
function setRounds(v){
  v=+v; if(!(v>=L.MIN_ROUNDS&&v<=L.MAX_ROUNDS)) return;
  if(meta&&!isHost()) return;
  roundPick=v;
  if(isHost()&&meta&&meta.status==="lobby") update(ref(db), {[rpath("meta")]:metaObj({qlRounds:v})}).catch(function(e){fail(friendly(e))});
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
      else if(msg==="full") fail("That room is full (12 players).");
      else if(msg.indexOf("name:")===0) fail(msg.slice(5));
      else fail(friendly(e));
    }).then(function(){sending=false});
  });
  document.querySelectorAll("[data-drink]").forEach(function(b){b.addEventListener("click", function(){setDrink(b.dataset.drink)})});
  document.querySelectorAll("[data-rounds]").forEach(function(b){b.addEventListener("click", function(){setRounds(b.dataset.rounds)})});
  $("start").addEventListener("click", begin);
  $("qlsend").addEventListener("click", sendAnswer);
  $("qlanswer").addEventListener("input", function(){if(pub&&pub.phase==="answer") paintAnswer()});
  $("qlanswer").addEventListener("keydown", function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault(); sendAnswer()}});
  $("nextround").addEventListener("click", function(){
    if(!isHost()||!pub||pub.phase!=="reveal"||!afterReveal) return;
    var f=afterReveal; afterReveal=null; f();
  });
  $("again").addEventListener("click", newGameSame);
  $("leave").addEventListener("click", leaveGame);
  $("close").addEventListener("click", askClose);
  if($("closestage")) $("closestage").addEventListener("click", askClose);
  $("copylink").addEventListener("click", function(){if(code) copyText(roomUrl(code)).then(function(){fail("Link copied.")}).catch(function(){fail(roomUrl(code))})});
  $("copycode").addEventListener("click", function(){if(code) copyText(code).then(function(){fail("Code copied.")}).catch(function(){fail(code)})});
  $("sharebtn").addEventListener("click", function(){
    if(!code) return;
    if(navigator.share) navigator.share({title:"Punchline Duel", text:"Join my Punchline Duel room "+code, url:roomUrl(code)}).catch(function(){});
    else copyText(roomUrl(code)).then(function(){fail("Link copied.")}).catch(function(){fail(roomUrl(code))});
  });
  if($("qrhide")) $("qrhide").addEventListener("click", function(){
    var canvas=$("qr"), hidden=canvas.dataset.hidden==="1";
    canvas.dataset.hidden=hidden?"0":"1"; canvas.classList.toggle("hide", !hidden);
    $("qrhide").textContent=hidden?"Hide QR":"Show QR"; if(hidden) paintQr();
  });
  tickTimer=setInterval(function(){if(pub&&pub.phase!=="end") render(); hostTick()}, 250);
  window.addEventListener("online", function(){fail(""); if(goOnline&&db){try{goOnline(db)}catch(e){}}});
  var back=""; try{back=sessionStorage.getItem("tp_ql_room")||""}catch(e){}
  var name=L.cleanName($("pname").value);
  if(back&&validCode(back)&&name&&(!linked||linked===back)) joinRoom(back, name).catch(function(){try{sessionStorage.removeItem("tp_ql_room")}catch(err){}});
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
  window.__tpQuip={uid:function(){return uid}, code:function(){return code}, phase:function(){return pub&&pub.phase}, seq:function(){return pub&&pub.seq}, data:function(){return D}, host:function(){return isHost()}, mineAns:function(){return mineAns}};
  showReady();
  try{wire()}catch(err){console.error(err); fail("The game glitched. Reload and try again.")}
}
$("retry").addEventListener("click", function(){location.reload()});
boot().catch(function(err){console.error(err); showBootError("The game didn't open. Check your connection and try again.")});
})();
