(function(){
"use strict";
/* Mole, one phone per player. rooms/$code/ml
   The host's phone runs the game with MoleLogic and publishes only what everyone may see (ml/pub).
   Each player's secret card is on ml/role/$uid (only they and the host read it). Players tap through
   clues on ml/done, vote on ml/vote, and the caught mole guesses the word on ml/steal.
   The full game and the secret word live in host memory and ml/secret, which only the host can read. */
var L=window.MoleLogic;
var WORDS=(window.MOLE_WORDS||[]);
var FAST=/[?&]emulator=1(?:&|$)/.test(location.search)&&/[?&]fast=1(?:&|$)/.test(location.search);
var MS={clue:FAST?3000:45000, vote:FAST?3000:30000, reveal:FAST?2500:9000, steal:FAST?4000:20000};
var ALPHABET="ABCDEFGHJKMNPQRSTUVWXYZ";
var $=function(id){return document.getElementById(id)};
var uid=null, code=null, meta=null, players={}, pub=null, D=null, mine=null, readyMap={}, doneMap={}, leftMap={};
var drinkPick="sips", roundPick=8, sending=false, serverOffset=0, offsetReady=false, offsetStop=null;
var db, authObj, stops=[], hostStops=[], connStop=null, bootTimer=0, tickTimer=0;
var ref, onValue, update, set, remove, onDisconnect, get, serverTimestamp, goOnline;
/* host only */
var G=null, votes={}, steals={}, map=null, hostLock=false, afterReveal=null;
var lastSeq=-1, lastPhase="";

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
  if(window.TipsyJoinQR) return TipsyJoinQR.pageInvite("/games/mole.html", c, "ml");
  return "https://tipsyplay.com/games/mole.html?room="+c+"&game=ml";
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
    var row=el("div", "ml-person"+(p.connected?"":" off"));
    row.appendChild(el("span", null, p.name+(p.uid===meta.hostUid?" · host":"")));
    row.appendChild(el("span", null, p.connected?"":"away"));
    if(isHost()&&p.uid!==uid){
      var kick=el("button", "x", "Remove"); kick.type="button"; kick.setAttribute("aria-label", "Remove "+p.name);
      kick.addEventListener("click", function(){remove(ref(db, rpath("players/"+p.uid))).catch(function(e){fail(friendly(e))})});
      row.appendChild(kick);
    }
    box.appendChild(row);
  });
  var setting=(meta.mlDrink)||drinkPick;
  document.querySelectorAll("[data-drink]").forEach(function(b){
    b.setAttribute("aria-pressed", b.dataset.drink===setting?"true":"false");
    b.disabled=!isHost();
  });
  $("drinknote").textContent=setting==="none"?"No drinking: the losing side does the alternative.":setting==="shots"?"Shots: the losing side takes one shot. Pace yourself.":"Drinks: the losing side takes one drink.";
  var rounds=(meta.mlRounds)||roundPick;
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
  else if(n>L.MAX_PLAYERS) note.textContent="10 players max.";
  else if(dup) note.textContent="Two players are called "+dup+". One of you, rejoin with another name.";
  else note.textContent=isHost()?"Everyone in? Start when ready. Each round, one of you is the mole.":"You're in. The host starts when the table's ready.";
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
  $("mlround").textContent="Round "+(D.round+1)+" of "+D.total;
  var ss=$("mlscore"); ss.textContent="";
  (D.standings||[]).slice(0,3).forEach(function(s){ss.appendChild(el("span", "ml-chip", s.name+" "+s.score))});
  ["dealbox","cluebox","votebox","stealbox","revealbox","waitbox"].forEach(function(id){show(id, false)});
  if(ph==="deal") paintDeal();
  else if(ph==="clues") paintClues();
  else if(ph==="vote") paintVote();
  else if(ph==="steal") paintSteal();
  else if(ph==="reveal") paintReveal();
  paintHostTools(ph);
}
function paintDeal(){
  show("dealbox", true);
  var card=$("dealcard");
  if(!mine){card.textContent="Dealing cards…"; return}
  card.textContent="";
  if(mine.r==="mole"){
    card.appendChild(el("p", "ml-role", "You're the mole"));
    card.appendChild(el("p", "ml-cat", "Category: "+(mine.d.cat||"")));
    card.appendChild(el("p", "ml-hint", "You don't know the word. Give a clue vague enough to fit in, specific enough to not get caught."));
  }else{
    card.appendChild(el("p", "ml-word", mine.d.word||""));
    card.appendChild(el("p", "ml-cat", "Category: "+(mine.d.cat||"")));
    card.appendChild(el("p", "ml-hint", "One of you is the mole and only sees the category. Give a one-word clue that proves you know the word, without handing it to the mole."));
  }
  var done=readyMap[uid]===pub.seq;
  var btn=$("dealready"); btn.disabled=done; btn.textContent=done?"Waiting for the table…":"Got it";
}
function paintClues(){
  show("cluebox", true);
  var turn=pub.turn, mineNow=turn===uid;
  $("clueturn").textContent=mineNow?"Your clue. Say it out loud.":"It's "+nm(turn)+"'s clue.";
  var list=$("clueorder"); list.textContent="";
  (D.order||[]).forEach(function(u){
    var gone=D.done&&D.done.indexOf(u)>=0;
    var row=el("div", "ml-turnrow"+(u===turn?" now":"")+(gone?" gone":""));
    row.appendChild(el("span", null, nm(u)));
    row.appendChild(el("span", "ml-tick", gone?"✓":(u===turn?"…":"")));
    list.appendChild(row);
  });
  var btn=$("cluedone");
  btn.classList.toggle("hide", !mineNow);
  btn.disabled=!mineNow;
  $("cluestate").textContent="Clue "+((D.done?D.done.length:0)+1)+" of "+(D.order?D.order.length:0);
}
function paintVote(){
  show("votebox", true);
  $("votehead").textContent="Who's the mole?";
  var box=$("votelist");
  if(keyed(box, "v"+pub.seq)){
    (D.order||[]).forEach(function(u){
      if(u===uid) return; // you can't vote for yourself
      var b=el("button", "ml-choice"); b.type="button"; b.dataset.uid=u;
      b.textContent=nm(u);
      b.addEventListener("click", function(){sendVote(u)});
      box.appendChild(b);
    });
  }
  var mv=parseTagged(votes[uid]);
  var picked=(mv&&mv.seq===pub.seq)?mv.v:"";
  box.querySelectorAll("button").forEach(function(b){b.setAttribute("aria-pressed", b.dataset.uid===picked?"true":"false")});
  $("votestate").textContent=picked?"Vote in. You can change it until the timer ends.":(phaseLeft(MS.vote)+"s to vote. Only you see your vote.");
}
function paintSteal(){
  var mineNow=pub.turn===uid;
  if(mineNow){
    show("stealbox", true);
    $("stealhead").textContent="Caught! Guess the word to steal the round.";
    var box=$("steallist");
    if(keyed(box, "s"+pub.seq)){
      (D.options||[]).forEach(function(o){
        var b=el("button", "ml-choice"); b.type="button"; b.dataset.i=o.i;
        b.textContent=o.word;
        b.addEventListener("click", function(){sendSteal(o.i)});
        box.appendChild(b);
      });
    }
    $("stealstate").textContent=phaseLeft(MS.steal)+"s to guess.";
  }else{
    show("waitbox", true);
    $("waittext").textContent="The mole was caught and is guessing the word…";
  }
}
function paintReveal(){
  show("revealbox", true);
  var box=$("revealbox"); box.textContent="";
  box.appendChild(el("p", "ml-rword", "The word was "+D.word));
  box.appendChild(el("p", "ml-rmole", "The mole was "+nm(D.mole)));
  var verdict;
  if(D.caught&&!D.stole) verdict="The group caught the mole.";
  else if(D.caught&&D.stole) verdict="Caught, but the mole stole the word!";
  else verdict="The mole slipped away.";
  box.appendChild(el("p", "ml-verdict", verdict));
  if(D.banner){
    var b=D.banner, line=b.line;
    if(!b.noDrinking&&b.drinkers&&b.drinkers.length){
      var who=b.drinkers.map(function(u){return nm(u)}).join(", ");
      line+=" "+who+", "+b.amount+" or the alternative.";
    }else if(b.noDrinking) line+=" The alternative.";
    box.appendChild(el("p", "ml-banner", line));
  }
}
function paintEnd(){
  screen("table");
  ["dealbox","cluebox","votebox","stealbox","revealbox","waitbox","hosttools"].forEach(function(id){show(id, false)});
  show("finale", true);
  var box=$("reveal"); box.textContent="";
  var top=D.standings&&D.standings.length?D.standings[0]:null;
  var tied=D.standings?D.standings.filter(function(s){return top&&s.score===top.score&&top.score>0}):[];
  box.appendChild(el("h2", "ml-title", top&&top.score>0?(tied.length>1?"It's a tie!":nm(top.uid)+" wins!"):"Good game"));
  var ol=el("ol", "ml-stand");
  (D.standings||[]).forEach(function(s){
    var li=el("li", null);
    li.appendChild(el("span", "ml-sname", s.name));
    li.appendChild(el("span", "ml-sscore", s.score+" pt"+(s.score===1?"":"s")));
    ol.appendChild(li);
  });
  box.appendChild(ol);
}
function paintHostTools(ph){
  show("hosttools", isHost());
  if(!isHost()) return;
  var cont=$("nextround");
  cont.classList.toggle("hide", ph!=="reveal");
  cont.textContent=(D.round+1>=D.total)?"See the results":"Next round";
}

/* ---------- player actions ---------- */
function sendReady(){
  if(!pub||pub.phase!=="deal") return;
  set(ref(db, rpath("ml/ready/"+uid)), pub.seq).catch(function(e){fail(friendly(e))});
}
function sendDone(){
  if(!pub||pub.phase!=="clues"||pub.turn!==uid) return;
  set(ref(db, rpath("ml/done/"+uid)), pub.seq).catch(function(e){fail(friendly(e))});
}
function sendVote(target){
  if(!pub||pub.phase!=="vote"||target===uid) return;
  set(ref(db, rpath("ml/vote/"+uid)), target+":"+pub.seq).catch(function(e){fail(friendly(e))});
  render();
}
function sendSteal(i){
  if(!pub||pub.phase!=="steal"||pub.turn!==uid) return;
  set(ref(db, rpath("ml/steal")), i+":"+pub.seq).catch(function(e){fail(friendly(e))});
}
function leaveGame(){
  if(!code) return;
  if(isHost()){askClose(); return}
  set(ref(db, rpath("ml/left/"+uid)), true).catch(function(){});
  remove(ref(db, rpath("players/"+uid))).catch(function(){});
  roomEnded();
}

/* ---------- host: publishing ---------- */
function names(){var m={}; G.players.forEach(function(p){m[p.uid]=p.name}); return m}
function publicData(extra){
  var data={v:1, setting:G.setting, round:G.round, total:G.rounds.length, names:names(), standings:L.standings(G), order:G.order};
  Object.keys(extra||{}).forEach(function(k){data[k]=extra[k]});
  return data;
}
function publish(phase, extra, turn, clear, notes, more){
  var seq=(pub?pub.seq:0)+1;
  var payload=Object.assign({}, more||{});
  var pubObj={phase:phase, seq:seq, opened:serverNow(), data:JSON.stringify(publicData(extra))};
  if(turn!=null) pubObj.turn=turn;
  payload[rpath("ml/pub")]=pubObj;
  payload[rpath("ml/secret")]=JSON.stringify({G:G, map:map});
  (clear||[]).forEach(function(p){payload[rpath(p)]=null});
  Object.keys(notes||{}).forEach(function(u){payload[rpath("ml/role/"+u)]=notes[u]});
  hostLock=true;
  return update(ref(db), payload).then(function(){hostLock=false; return true}).catch(function(e){hostLock=false; fail(friendly(e)); return false});
}
function metaObj(patch){
  var m=Object.assign({}, meta||{}, patch||{});
  var out={hostUid:m.hostUid, createdAt:m.createdAt, status:m.status, phase:m.phase, spice:"mild", rounds:+m.mlRounds||roundPick, na:false, round:0, gameId:+m.gameId||1, kind:"ml", mlDrink:m.mlDrink||"sips", mlRounds:+m.mlRounds||roundPick};
  if(m.status!=="lobby") out.deck=["Mole"];
  if(m.status==="over") out.endedAt=m.endedAt||serverNow();
  return out;
}
function nodePaths(kind, list){return (list||G.order).map(function(u){return "ml/"+kind+"/"+u})}

/* ---------- host: game flow ---------- */
function begin(){
  if(!isHost()||sending) return;
  var list=order();
  if(list.length<L.MIN_PLAYERS||list.length>L.MAX_PLAYERS){fail("Need 4 to 10 players."); return}
  if(dupName(list)){fail("Two players share a name."); return}
  sending=true; fail("");
  var setting=meta.mlDrink||drinkPick, rounds=meta.mlRounds||roundPick;
  G=L.newGame(list.map(function(p){return {uid:p.uid, name:L.cleanName(p.name).slice(0,L.NAME_MAX)}}), setting, rounds, WORDS.length||1);
  votes={}; steals={}; map=null; afterReveal=null; D=null;
  var clear=[].concat(nodePaths("ready"), nodePaths("done"), nodePaths("vote"), nodePaths("left"), ["ml/steal"]);
  var more={}; more[rpath("meta")]=metaObj({status:"play", phase:"deal", mlDrink:setting, mlRounds:rounds});
  openDeal(clear, more).then(function(ok){if(!ok){G=null; D=null}}).then(function(){sending=false; if(isHost()&&meta) paintLobby()});
}
function wordOf(i){return WORDS[i]||{cat:"", word:""}}
function openDeal(clear, more){
  var m=L.current(G), w=wordOf(m.word);
  var notes={};
  G.order.forEach(function(u){
    var role=u===m.mole?"mole":"player";
    var d=role==="mole"?{cat:w.cat}:{cat:w.cat, word:w.word};
    notes[u]={r:role, d:JSON.stringify(d)};
  });
  return publish("deal", {}, "", clear||[].concat(nodePaths("ready"), nodePaths("done"), nodePaths("vote"), ["ml/steal"]), notes, more);
}
function openClues(){
  publish("clues", {done:[]}, G.order[0], nodePaths("done"));
}
function advanceClue(){
  var done=G.order.filter(function(u){return doneMap[u]===pub.seq});
  if(done.length>=G.order.length){openVote(); return}
  // next player who hasn't gone, in order. Keep the same seq so earlier "done" writes still count;
  // only the turn and the clock move on.
  var next=G.order.filter(function(u){return done.indexOf(u)<0})[0];
  var pubObj={phase:"clues", seq:pub.seq, opened:serverNow(), turn:next, data:JSON.stringify(publicData({done:done}))};
  hostLock=true;
  Promise.all([
    set(ref(db, rpath("ml/pub")), pubObj),
    set(ref(db, rpath("ml/secret")), JSON.stringify({G:G, map:map}))
  ]).then(function(){hostLock=false}).catch(function(e){hostLock=false; fail(friendly(e))});
}
function openVote(){
  votes={};
  publish("vote", {}, "", nodePaths("vote"));
}
function closeVote(){
  var ballots={};
  Object.keys(votes).forEach(function(v){var t=parseTagged(votes[v]); if(t&&t.seq===pub.seq&&G.order.indexOf(t.v)>=0&&t.v!==v) ballots[v]=t.v});
  var outcome=L.voteOutcome(G, ballots);
  if(outcome.caught){ openSteal(outcome); }
  else { var e=L.finishRound(G, {caught:false, accused:outcome.accused, stole:false}); sound("chime"); openReveal(e); }
}
function openSteal(outcome){
  var m=L.current(G), w=wordOf(m.word);
  var opts=WORDS.map(function(x,i){return {i:i, word:x.word, cat:x.cat}}).filter(function(x){return x.cat===w.cat});
  opts=L.shuffle(opts).map(function(x){return {i:x.i, word:x.word}});
  map={outcome:outcome};
  steals={};
  publish("steal", {options:opts}, m.mole, ["ml/steal"]);
}
function closeSteal(){
  var m=L.current(G);
  var stole=false;
  if(stealRaw){var t=parseTagged(stealRaw); if(t&&t.seq===pub.seq) stole=(+t.v===m.word)}
  var e=L.finishRound(G, {caught:true, accused:m.mole, stole:stole});
  if(stole) sound("blip"); else sound("chime");
  openReveal(e);
}
function openReveal(entry){
  afterReveal=function(){
    if(G.round>=G.rounds.length){ publish("end", {standings:L.standings(G), winner:L.leaders(G)}, ""); endRoom(); }
    else openDeal();
  };
  publish("reveal", {word:wordOf(entry.word).word, mole:entry.mole, caught:entry.caught, accused:entry.accused, stole:entry.stole, banner:entry.banner}, "", nodePaths("vote").concat(nodePaths("done"), ["ml/steal"]));
}
function endRoom(){
  update(ref(db), {[rpath("meta")]:metaObj({status:"over", phase:"end", endedAt:serverNow()})}).catch(function(){});
}
function newGameSame(){
  if(!isHost()) return;
  var patch=metaObj({status:"lobby", phase:"lobby", gameId:(+meta.gameId||1)+1});
  update(ref(db), {[rpath("meta")]:patch, [rpath("ml/pub")]:null, [rpath("ml/secret")]:null}).then(function(){
    G=null; D=null; pub=null; map=null; votes={}; steals={};
  }).catch(function(e){fail(friendly(e))});
}

/* ---------- host tick ---------- */
var stealRaw=null;
function hostTick(){
  if(!isHost()||!G||!pub||hostLock) return;
  var ph=pub.phase, age=serverNow()-pub.opened;
  if(ph==="deal"){
    var ready=G.order.filter(function(u){return !leftMap[u]});
    var all=ready.every(function(u){return readyMap[u]===pub.seq});
    if(all) openClues();
  }else if(ph==="clues"){
    var t=pub.turn;
    if((t&&doneMap[t]===pub.seq)||age>=MS.clue){
      if(age>=MS.clue&&!(t&&doneMap[t]===pub.seq)){
        // time ran out for this player: mark them done and move on
        set(ref(db, rpath("ml/done/"+t)), pub.seq).catch(function(){});
        return;
      }
      advanceClue();
    }
  }else if(ph==="vote"){
    var need=G.order.filter(function(u){return !leftMap[u]});
    var got=need.filter(function(u){var x=parseTagged(votes[u]); return x&&x.seq===pub.seq});
    if(got.length>=need.length||age>=MS.vote) closeVote();
  }else if(ph==="steal"){
    if((stealRaw&&(parseTagged(stealRaw)||{}).seq===pub.seq)||age>=MS.steal) closeSteal();
  }else if(ph==="reveal"){
    if(age>=MS.reveal&&afterReveal){var f=afterReveal; afterReveal=null; f()}
  }
}
function resumeHost(){
  get(ref(db, rpath("ml/secret"))).then(function(s){
    if(!s.exists()) return;
    try{var o=JSON.parse(s.val()); G=o.G; map=o.map||null}catch(e){return}
    if(pub&&pub.phase==="reveal") afterReveal=function(){if(G.round>=G.rounds.length){publish("end", {standings:L.standings(G), winner:L.leaders(G)}, ""); endRoom()} else openDeal()};
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
    if(meta&&meta.mlDrink) drinkPick=meta.mlDrink;
    if(meta&&meta.mlRounds) roundPick=meta.mlRounds;
    if(isHost()&&!was){listenHost(); if(meta.status!=="lobby"&&!G) resumeHost()}
    render();
  }, function(){fail("That room isn't available.")}));
  stops.push(onValue(ref(db, rpath("players")), function(s){players=s.val()||{}; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("ml/pub")), function(s){
    pub=s.val()||null;
    try{D=pub?JSON.parse(pub.data):null}catch(e){D=null}
    if(pub&&pub.seq!==lastSeq){
      if(pub.phase!==lastPhase){
        if(pub.phase==="deal") sound("card");
        if(pub.phase==="vote") sound("blip");
      }
      lastSeq=pub.seq; lastPhase=pub.phase;
    }
    hostLock=false;
    render(); hostTick();
  }, function(){}));
  stops.push(onValue(ref(db, rpath("ml/role/"+uid)), function(s){
    var v=s.val(); mine=null;
    if(v){try{mine={r:v.r, d:JSON.parse(v.d||"{}")}}catch(e){mine={r:v.r, d:{}}}}
    render();
  }, function(){}));
  stops.push(onValue(ref(db, rpath("ml/ready")), function(s){readyMap=s.val()||{}; render(); hostTick()}, function(){}));
  stops.push(onValue(ref(db, rpath("ml/done")), function(s){doneMap=s.val()||{}; render(); hostTick()}, function(){}));
  stops.push(onValue(ref(db, rpath("ml/left")), function(s){leftMap=s.val()||{}; hostTick()}, function(){}));
}
function listenHost(){
  stopHost();
  hostStops.push(onValue(ref(db, rpath("ml/vote")), function(s){votes=s.val()||{}; hostTick()}, function(){}));
  hostStops.push(onValue(ref(db, rpath("ml/steal")), function(s){stealRaw=s.val()||null; hostTick()}, function(){}));
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
  stopAll(); code=null; meta=null; pub=null; D=null; G=null; mine=null;
  try{sessionStorage.removeItem("tp_ml_room")}catch(e){}
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
      await update(ref(db), {["rooms/"+c+"/meta"]:{hostUid:uid, createdAt:serverTimestamp(), status:"lobby", phase:"lobby", spice:"mild", rounds:roundPick, na:false, round:0, gameId:1, kind:"ml", mlDrink:drinkPick, mlRounds:roundPick}});
      claimed=c; break;
    }catch(e){if(!/permission/i.test(String(e.code||e.message||""))) throw e}
  }
  if(!claimed) throw new Error("room");
  await set(ref(db, "rooms/"+claimed+"/players/"+uid), {name:name, connected:true, joinedAt:serverNow()});
  code=claimed;
  try{sessionStorage.setItem("tp_ml_room", code); localStorage.setItem("tp_last_game", "mole")}catch(e){}
  listen(); armPresence();
}
async function joinRoom(c, name){
  var snap=await get(ref(db, "rooms/"+c+"/meta"));
  if(!snap.exists()) throw new Error("missing");
  var m=snap.val()||{};
  if(m.kind!=="ml") throw new Error("kind");
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
  try{sessionStorage.setItem("tp_ml_room", code); localStorage.setItem("tp_last_game", "mole")}catch(e){}
  listen(); armPresence();
}
var closeArmed=0;
function askClose(){
  if(!isHost()||!code) return;
  if(Date.now()-closeArmed>2500){closeArmed=Date.now(); fail("Tap close again to end the room for everyone."); return}
  fail(""); remove(ref(db, "rooms/"+code)).catch(function(e){fail(friendly(e))});
  try{sessionStorage.removeItem("tp_ml_room")}catch(e){}
}
function setDrink(v){
  if(!/^(sips|shots|none)$/.test(v)) return;
  if(meta&&!isHost()) return;
  drinkPick=v;
  if(isHost()&&meta&&meta.status==="lobby") update(ref(db), {[rpath("meta")]:metaObj({mlDrink:v})}).catch(function(e){fail(friendly(e))});
  render();
}
function setRounds(v){
  v=+v; if(!(v>=L.MIN_ROUNDS&&v<=L.MAX_ROUNDS)) return;
  if(meta&&!isHost()) return;
  roundPick=v;
  if(isHost()&&meta&&meta.status==="lobby") update(ref(db), {[rpath("meta")]:metaObj({mlRounds:v})}).catch(function(e){fail(friendly(e))});
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
      else if(msg==="full") fail("That room is full (10 players).");
      else if(msg.indexOf("name:")===0) fail(msg.slice(5));
      else fail(friendly(e));
    }).then(function(){sending=false});
  });
  document.querySelectorAll("[data-drink]").forEach(function(b){b.addEventListener("click", function(){setDrink(b.dataset.drink)})});
  document.querySelectorAll("[data-rounds]").forEach(function(b){b.addEventListener("click", function(){setRounds(b.dataset.rounds)})});
  $("start").addEventListener("click", begin);
  $("dealready").addEventListener("click", sendReady);
  $("cluedone").addEventListener("click", sendDone);
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
    if(navigator.share) navigator.share({title:"Mole", text:"Join my Mole room "+code, url:roomUrl(code)}).catch(function(){});
    else copyText(roomUrl(code)).then(function(){fail("Link copied.")}).catch(function(){fail(roomUrl(code))});
  });
  if($("qrhide")) $("qrhide").addEventListener("click", function(){
    var canvas=$("qr"), hidden=canvas.dataset.hidden==="1";
    canvas.dataset.hidden=hidden?"0":"1"; canvas.classList.toggle("hide", !hidden);
    $("qrhide").textContent=hidden?"Hide QR":"Show QR"; if(hidden) paintQr();
  });
  tickTimer=setInterval(function(){if(pub&&pub.phase!=="end") render(); hostTick()}, 250);
  window.addEventListener("online", function(){fail(""); if(goOnline&&db){try{goOnline(db)}catch(e){}}});
  var back=""; try{back=sessionStorage.getItem("tp_ml_room")||""}catch(e){}
  var name=L.cleanName($("pname").value);
  if(back&&validCode(back)&&name&&(!linked||linked===back)) joinRoom(back, name).catch(function(){try{sessionStorage.removeItem("tp_ml_room")}catch(err){}});
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
  window.__tpMole={uid:function(){return uid}, code:function(){return code}, phase:function(){return pub&&pub.phase}, seq:function(){return pub&&pub.seq}, turn:function(){return pub&&pub.turn}, data:function(){return D}, role:function(){return mine&&mine.r}, host:function(){return isHost()}};
  showReady();
  try{wire()}catch(err){console.error(err); fail("The game glitched. Reload and try again.")}
}
$("retry").addEventListener("click", function(){location.reload()});
boot().catch(function(err){console.error(err); showBootError("The game didn't open. Check your connection and try again.")});
})();
