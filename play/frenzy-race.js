(function(){
"use strict";
/* Five Letter Frenzy Race: everyone races the same secret word on their own board. rooms/$code/frenzy
   The word never reaches a phone before the race ends. Guesses go to the word server (api/frenzy-word.php), which
   works out the word from the room code, the round and a server-side salt, and answers with colours only.
   Firebase carries: the race everyone sees (frenzy/pub, host writes), each player's key hash (frenzy/keys),
   progress anyone may see (frenzy/prog: guesses used, solved or out, when), and each player's own board
   (frenzy/players/$uid), which is private to them until the race is over. */
var L=window.FrenzyLogic, M=window.FrenzyModes, FX=window.FrenzyFX, WORDS=window.FRENZY_WORDS||{answers:[]};
if(L) L.useWords(WORDS);
var EMU=/[?&]emulator=1(?:&|$)/.test(location.search);
var FAST=EMU&&/[?&]fast=1(?:&|$)/.test(location.search);
var ALPHABET="ABCDEFGHJKMNPQRSTUVWXYZ";
var ALTS=["a 5-second statue pose","a slow, dramatic bow","your best animal impression","a 5-second victory dance"];
var $=function(id){return document.getElementById(id)};
var uid=null, code=null, meta=null, players={}, pub=null, keys={}, prog={}, boards=null;
var myPk="", rows=[], mySt="play", lockUntil=0, reconciled=0, lastRound=0, lastState="", sending=false, sentRetry=0;
var fbBoard=[], fbProg=null, gridKey="", flipAt=null, msgText="", result=null, revealing=false, revealTries=0, drinkOn=false, goneSince={}, finishing=false, lastCd=-1, wentGo=false, localOut=false;
var serverOffset=0, offsetReady=false, lobbyErr="", typedLen=0;
var db, stops=[], connStop=null, bootTimer=0, tickTimer=0, boardsStop=null, offsetStop=null, authObj=null;
var ref, onValue, update, set, remove, onDisconnect, get, serverTimestamp, goOnline;

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
function isHost(){return !!(meta&&uid&&meta.hostUid===uid)}
function normCode(v){var s=String(v||""), m=s.match(/(?:room|code)=([A-Za-z]{4})/i); if(m) return m[1].toUpperCase(); return s.toUpperCase().replace(/[^ABCDEFGHJKMNPQRSTUVWXYZ]/g,"").slice(0,4)}
function validCode(c){return /^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(c)}
function makeRoomCode(){var s="", i; for(i=0;i<4;i++) s+=ALPHABET[L.randomInt(ALPHABET.length)]; return s}
function emuOn(){return /[?&]emulator=1(?:&|$)/.test(location.search)}
function queryRoom(){var m=String(location.search||"").match(/[?&](?:room|code)=([A-Za-z]{4})/i); var c=m?normCode(m[1]):""; return validCode(c)?c:""}
function forcedWord(){
  if(!emuOn()) return "";
  var m=String(location.search||"").match(/[?&]word=([A-Za-z]{5})/);
  return m?m[1].toLowerCase():"";
}
function roomUrl(c){
  if(window.TipsyJoinQR) return TipsyJoinQR.pageInvite("/games/five-letter-race.html", c, "fr");
  return "https://tipsyplay.com/games/five-letter-race.html?room="+c+"&game=fr";
}
function order(){
  return Object.keys(players).map(function(id){var p=players[id]; return {uid:id, name:p.name||"Player", connected:p.connected!==false, joinedAt:p.joinedAt||0}})
    .sort(function(a,b){return a.joinedAt-b.joinedAt||a.name.localeCompare(b.name)});
}
function nm(id){return (players[id]&&players[id].name)||(result&&result.names&&result.names[id])||"Player"}
function screen(id){["home","lobby","table","finale","closed"].forEach(function(s){var n=$(s); if(n) n.classList.toggle("hide", s!==id)})}
function show(id, on){var n=$(id); if(n) n.classList.toggle("hide", !on)}
function el(tag, cls, text){var n=document.createElement(tag); if(cls) n.className=cls; if(text!=null) n.textContent=text; return n}
function reduced(){return !!(FX&&FX.reduced&&FX.reduced())}
function fx(name, a){if(FX&&typeof FX[name]==="function"){try{FX[name](a)}catch(e){}}}
function dupName(list){var seen={}, d=""; list.forEach(function(p){var k=L.cleanName(p.name).toLowerCase(); if(seen[k]) d=p.name; seen[k]=1}); return d}
function round(){return pub?pub.round:1}
function roster(){try{return JSON.parse((pub&&pub.roster)||"[]")}catch(e){return []}}
function raceOn(){return !!pub&&pub.state==="race"}
function goAt(){return pub&&pub.goAt?pub.goAt:0}
function timeLeftMs(){return pub&&pub.limit>0?goAt()+pub.limit*1000-serverNow():Infinity}
function marksToStr(m){return m.map(function(x){return x==="locked"?"l":x==="moved"?"m":"x"}).join("")}
function strToMarks(s){return String(s||"").split("").map(function(c){return c==="l"?"locked":c==="m"?"moved":"absent"})}
function boardStr(){return JSON.stringify(rows.map(function(r){return [r.w, marksToStr(r.m)]}))}
function parseBoard(v){
  try{var a=JSON.parse(v||"[]"); return Array.isArray(a)?a.filter(function(r){return r&&r[0]&&String(r[0]).length===5}).map(function(r){return {w:String(r[0]), m:strToMarks(r[1])}}):[]}catch(e){return []}
}

/* ---------- the word server ---------- */
function api(op, extra){
  var root=document.body.getAttribute("data-root")||"";
  var body=Object.assign({op:op, room:code, round:round(), pid:uid, pk:myPk}, extra||{});
  return fetch(root+"api/frenzy-word.php", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)}).then(function(r){
    return r.json().then(function(j){j.status=r.status; return j}, function(){return {ok:false, error:"The word keeper didn't answer.", status:r.status}});
  }).catch(function(){return {ok:false, error:"The word keeper didn't answer.", status:0}});
}
function keyFor(c){
  var k=""; try{k=localStorage.getItem("tp_fr_pk_"+c)||""}catch(e){}
  if(!/^[a-f0-9]{32}$/.test(k)){k=M.randomHex(16); try{localStorage.setItem("tp_fr_pk_"+c, k)}catch(e){}}
  return k;
}

/* ---------- rendering ---------- */
function render(){
  document.body.classList.toggle("is-host", isHost());
  document.querySelectorAll(".hostonly").forEach(function(n){n.classList.toggle("hide", !isHost())});
  if(!meta){screen("home"); return}
  if(!pub||pub.state==="lobby"||meta.status==="lobby"){screen("lobby"); paintLobby(); return}
  if(pub.state==="results"||result){screen("finale"); paintFinale(); return}
  screen("table"); paintTable();
}
function paintLobby(){
  $("codebig").textContent=code||"";
  $("sharelink").textContent=roomUrl(code);
  var list=order(), box=$("plist"); box.textContent="";
  list.forEach(function(p){
    var row=el("div", "fl-person"+(p.connected?"":" off"));
    row.appendChild(el("span", null, p.name+(p.uid===meta.hostUid?" · host":"")));
    row.appendChild(el("span", null, p.connected?"":"away"));
    if(isHost()&&p.uid!==uid){
      var kick=el("button", "x", "Remove"); kick.type="button"; kick.setAttribute("aria-label", "Remove "+p.name);
      kick.addEventListener("click", function(){remove(ref(db, rpath("players/"+p.uid))).catch(function(e){fail(friendly(e))})});
      row.appendChild(kick);
    }
    box.appendChild(row);
  });
  var pen=(pub&&pub.penalty)||"none", lim=(pub&&+pub.limit)||0;
  document.querySelectorAll("[data-penalty]").forEach(function(b){b.setAttribute("aria-pressed", b.dataset.penalty===pen?"true":"false"); b.disabled=!isHost()});
  document.querySelectorAll("[data-limit]").forEach(function(b){b.setAttribute("aria-pressed", +b.dataset.limit===lim?"true":"false"); b.disabled=!isHost()});
  $("setnote").textContent=(pen==="none"?"No penalty for a wrong guess.":pen==="lockout"?"A wrong guess locks you out for 10 seconds.":"A wrong guess offers an optional drink card, with a no-drink pose and Pass.")+" "+(lim?"The race ends after "+(lim/60)+" minutes.":"No time limit.");
  var n=list.length, dup=dupName(list), start=$("start");
  start.disabled=!isHost()||n<2||n>8||!!dup||sending;
  start.textContent="Start the race · "+n+" player"+(n===1?"":"s");
  var note=$("lobbynote"); note.classList.toggle("err", !!lobbyErr);
  if(lobbyErr) note.textContent=lobbyErr;
  else if(n<2) note.textContent="Need at least 1 more player.";
  else if(n>8) note.textContent="8 players max.";
  else if(dup) note.textContent="Two players are called "+dup+". One of you, rejoin with another name.";
  else note.textContent=isHost()?"Everyone in? Start when ready. No one can join once the race starts.":"You're in. The host starts the race.";
}
function legend(){
  var box=$("legend"); if(!box||box.childElementCount) return;
  [["lock","●","Right place"],["move","↗","Wrong place"],["miss","×","Not in the word"]].forEach(function(item){
    var li=el("li", "fl-key"); li.appendChild(el("span", "fl-swatch "+item[0], item[1])); li.appendChild(el("span", null, item[2])); box.appendChild(li);
  });
}
function paintGrid(typing){
  var now=Date.now(), key=rows.length+"|"+typing+"|"+(flipAt?flipAt.t0:0)+"|"+mySt;
  if(key===gridKey) return;
  gridKey=key;
  var box=$("grid"); box.textContent="";
  var r, i, row, cell;
  for(r=0;r<L.MAX_GUESSES;r++){
    row=el("div", "fl-row");
    if(rows[r]){
      for(i=0;i<5;i++){
        var m=rows[r].m[i], kind=m==="locked"?"lock":m==="moved"?"move":"miss";
        cell=el("div", "fl-tile "+kind);
        if(flipAt&&flipAt.row===r&&!reduced()&&now<flipAt.t0+(FX?FX.STEP_MS*4+FX.FLIP_MS:800)){cell.classList.add("fl-flip"); cell.style.animationDelay=((flipAt.t0+i*(FX?FX.STEP_MS:120))-now)+"ms"}
        cell.appendChild(el("span", "fl-mark", m==="locked"?"●":m==="moved"?"↗":"×"));
        cell.appendChild(el("span", "fl-letter", rows[r].w[i].toUpperCase()));
        cell.setAttribute("aria-label", rows[r].w[i].toUpperCase()+", "+(m==="locked"?"right place":m==="moved"?"wrong place":"not in the word"));
        row.appendChild(cell);
      }
    }else if(r===rows.length&&typing){
      for(i=0;i<5;i++){
        var ch=typing[i]||"";
        cell=el("div", "fl-tile"+(ch?"":" empty")); cell.appendChild(el("span", "fl-letter", ch.toUpperCase())); row.appendChild(cell);
      }
    }else for(i=0;i<5;i++) row.appendChild(el("div", "fl-tile empty", ""));
    box.appendChild(row);
  }
}
function canGuess(){
  return raceOn()&&mySt==="play"&&serverNow()>=goAt()&&Date.now()>=lockUntil&&!sending&&timeLeftMs()>0;
}
function progOf(u){return prog[u]||{n:0, st:"play"}}
function paintTable(){
  var now=serverNow(), ids=roster();
  legend();
  $("roundline").textContent="Race "+round();
  var cdOn=now<goAt();
  show("getready", cdOn);
  if(cdOn){
    var n=Math.max(1, Math.ceil((goAt()-now)/1000));
    if(n!==lastCd){lastCd=n; $("cd").textContent=String(n); var c=$("cd"); c.classList.remove("beat"); void c.offsetWidth; if(!reduced()) c.classList.add("beat")}
  }else if(!wentGo){
    wentGo=true; lastCd=-1;
    var startPlay=function(){fx("turn"); try{$("guess").focus()}catch(e){}};
    if(mySt==="play"&&rows.length===0&&FX&&typeof FX.playIntro==="function"){
      FX.playIntro(startPlay);
    }else startPlay();
  }
  var lim=timeLeftMs();
  show("clock", pub.limit>0&&!cdOn);
  if(pub.limit>0){$("clock").textContent=M.clock(Math.max(0, lim)); $("clock").classList.toggle("hot", lim<=30000)}
  var typing=(mySt==="play"&&!cdOn)?L.normalize($("guess").value).slice(0, 5):"";
  paintGrid(typing);
  var active=canGuess();
  show("guessform", mySt==="play"&&!cdOn&&timeLeftMs()>0);
  $("guess").disabled=!active&&Date.now()<lockUntil; $("sendguess").disabled=!active;
  var lock=Math.max(0, lockUntil-Date.now());
  show("lockline", lock>0&&mySt==="play");
  if(lock>0) $("lockline").textContent="Locked out for "+Math.ceil(lock/1000)+"s";
  var st="";
  if(mySt==="solved") st="Solved in "+rows.length+"! Waiting for the others…";
  else if(mySt==="out") st="Out of guesses. Waiting for the others…";
  else if(cdOn) st="Get ready. Your board opens at GO.";
  $("status").textContent=st||msgText;
  show("drinkcard", drinkOn&&mySt==="play");
  /* everyone's progress: guesses used, solved or out, and when. Never letters or colours. */
  var box=$("others"), key=JSON.stringify([ids, prog, Object.keys(players).sort(), goAt(), mySt, rows.length]);
  if(box.dataset.key!==key){
    box.dataset.key=key; box.textContent="";
    ids.forEach(function(u){
      var p=progOf(u), li=el("li", u===uid?"me":""), gone=!players[u];
      li.appendChild(el("span", "nm", (u===uid?"You":nm(u))));
      var pips=el("span", "fr-pips"); pips.setAttribute("aria-hidden", "true");
      for(var k=0;k<6;k++) pips.appendChild(el("i", k<p.n?(p.st==="solved"&&k===p.n-1?"on win":"on"):""));
      li.appendChild(pips);
      var txt=gone?"left":p.st==="solved"?"solved · "+M.clock(Math.max(0, (p.t||goAt())-goAt())):p.st==="out"?"out":p.n+" guess"+(p.n===1?"":"es");
      li.appendChild(el("span", "fr-st", txt));
      li.setAttribute("aria-label", (u===uid?"You":nm(u))+": "+txt);
      box.appendChild(li);
    });
  }
  show("hosttools", isHost());
  $("leave").classList.toggle("hide", isHost());
}
function boardMini(list){
  var box=el("div", "fr-mini"); box.setAttribute("role", "img");
  list.forEach(function(r){
    var row=el("div", "r");
    r.m.forEach(function(m, i){
      var t=el("div", "t "+(m==="locked"?"lock":m==="moved"?"move":"miss"), r.w[i].toUpperCase());
      t.setAttribute("data-m", m==="locked"?"●":m==="moved"?"↗":"×"); row.appendChild(t);
    });
    box.appendChild(row);
  });
  box.setAttribute("aria-label", list.length+" guess"+(list.length===1?"":"es"));
  return box;
}
function ranked(){
  var base=(result&&result.results)?result.results.map(function(r){return {uid:r.pid, n:r.n, solved:r.solved, tms:r.tms, out:true}})
    :roster().map(function(u){var p=progOf(u); return {uid:u, n:p.n, solved:p.st==="solved", tms:p.st==="solved"?Math.max(0, (p.t||goAt())-goAt()):null, out:true}});
  return M.rankRace(base, nm);
}
function paintFinale(){
  var box=$("awards"), key=JSON.stringify([result&&result.word, ranked().map(function(r){return r.uid+r.rank}), boards?Object.keys(boards).length:-1]);
  if(box.dataset.key===key) return;
  box.dataset.key=key; box.textContent="";
  var list=ranked();
  box.appendChild(el("p", "tag", "The word was"));
  var wp=el("p", "fl-word");
  if(result&&result.word){
    wp.setAttribute("aria-label", result.word.toUpperCase());
    result.word.toUpperCase().split("").forEach(function(c){var t=el("span", "fl-wtile", c); t.setAttribute("aria-hidden", "true"); wp.appendChild(t)});
  }else wp.textContent="…";
  box.appendChild(wp);
  var win=list[0]&&list[0].status==="solved"?list.filter(function(r){return r.rank===1&&r.status==="solved"}):[];
  box.appendChild(el("p", "fl-award", win.length?(win.length>1?"Tied for the win: ":"Winner: ")+win.map(function(r){return nm(r.uid)}).join(" and "):"Nobody solved it this time."));
  var ol=$("results"); ol.textContent="";
  list.forEach(function(r){
    var li=el("li"), hd=el("div", "hd");
    hd.appendChild(el("b", null, (r.tied?"=":"")+r.rank+". "+(r.uid===uid?"You":nm(r.uid))));
    hd.appendChild(el("span", null, r.status==="solved"?"solved":r.status==="out"?"out":"playing"));
    li.appendChild(hd); li.appendChild(el("p", "sub", M.resultLine(r)));
    var b=boards&&boards[r.uid]?parseBoard(boards[r.uid]):(r.uid===uid?rows:null);
    if(b&&b.length) li.appendChild(boardMini(b));
    else li.appendChild(el("p", "sub", "Board not shown."));
    ol.appendChild(li);
  });
}

/* ---------- player actions ---------- */
function writeMine(solvedNow){
  var p={}, n=rows.length;
  p[rpath("frenzy/players/"+uid)]=boardStr();
  var pr={n:n, st:mySt};
  if(solvedNow) pr.t=serverTimestamp();
  p[rpath("frenzy/prog/"+uid)]=pr;
  return update(ref(db), p).catch(function(e){fail(friendly(e))});
}
function setMsg(msg){msgText=msg||""; $("status").textContent=msgText}
function sendGuess(raw){
  if(!raceOn()||mySt!=="play"||sending) return;
  if(serverNow()<goAt()){setMsg("Wait for GO."); return}
  if(Date.now()<lockUntil) return;
  var err=L.guessError(raw, rows.map(function(r){return r.w}));
  if(err){setMsg(err); fx("reject"); return}
  setMsg(""); sending=true; sentRetry=0;
  var w=L.normalize(raw);
  (function go(){
    api("race-guess", {guess:w, n:rows.length}).then(function(res){
      if(res.ok){
        sending=false;
        if(!res.duplicate){
          rows.push({w:w, m:res.marks}); $("guess").value=""; typedLen=0;
          if(res.solved){mySt="solved"} else if(res.out){mySt="out"}
          fx("reveal", res.marks);
          if(res.solved){
            fx("solved", FX?FX.STEP_MS*4+FX.FLIP_MS:600);
            setTimeout(function(){
              if(FX&&typeof FX.playWin==="function"){
                FX.playWin(function(){fx("confetti"); render()});
              }else fx("confetti");
            }, FX?FX.STEP_MS*4+FX.FLIP_MS+250:800);
          }
          else if(res.out) setTimeout(function(){fx("outOfGuesses")}, 700);
          else if(pub.penalty==="lockout") lockUntil=Date.now()+10000;
          else if(pub.penalty==="drink"){drinkOn=true; $("altpose").textContent=ALTS[rows.length%ALTS.length]; setTimeout(function(){fx("clink")}, 500)}
          flipAt={row:rows.length-1, t0:Date.now()}; gridKey="";
          writeMine(!!res.solved);
        }
        render();
      }else if(res.error==="not yet"&&sentRetry++<8){setTimeout(go, 350)}
      else{
        sending=false;
        if(res.error==="locked out"){lockUntil=Date.now()+(res.wait||10000); setMsg("")}
        else if(res.error==="out of turn"||res.error==="round over") resync();
        else{setMsg(res.error||"That guess was refused."); fx("reject")}
        render();
      }
    });
  })();
}
/* Trust the word server over this phone's memory when they disagree. */
function resync(){
  api("race-me").then(function(res){
    if(!res.ok) return;
    rows=(res.guesses||[]).map(function(g){return {w:g.g, m:g.m}});
    mySt=res.solved?"solved":res.out?"out":"play";
    reconciled=round();
    writeMine(false); render();
  });
}
function reconcile(){
  if(!raceOn()||reconciled===round()||!myPk) return;
  reconciled=round();
  api("race-me").then(function(res){
    if(!res.ok) return;
    var srv=(res.guesses||[]);
    if(srv.length>rows.length||(res.solved&&mySt!=="solved")||(res.out&&mySt==="play")){
      rows=srv.map(function(g){return {w:g.g, m:g.m}});
      mySt=res.solved?"solved":res.out?"out":"play";
      writeMine(false);
    }
    render();
  });
}
function leaveGame(){
  if(!code) return;
  if(isHost()){askClose(); return}
  remove(ref(db, rpath("players/"+uid))).catch(function(){});
  roomEnded();
}
var closeArmed=0;
function askClose(){
  if(!isHost()||!code) return;
  if(Date.now()-closeArmed>2500){closeArmed=Date.now(); fail("Tap close again to end the room for everyone."); return}
  closeArmed=0;
  fail(""); remove(ref(db, "rooms/"+code)).catch(function(e){fail(friendly(e))});
  try{sessionStorage.removeItem("tp_fr_room")}catch(e){}
}

/* ---------- host ---------- */
function metaObj(patch){
  var m=Object.assign({}, meta||{}, patch||{});
  var status=m.status||"lobby", over=status==="over", play=status==="play"||over;
  var out={hostUid:m.hostUid, createdAt:m.createdAt, status:status, phase:over?"over":(play?"answer":"lobby"), spice:"mild", rounds:10, na:false, round:0, gameId:+m.gameId||1, kind:"fr"};
  if(play) out.deck=["Frenzy race"];
  if(over) out.endedAt=m.endedAt||serverNow();
  return out;
}
function pubObj(patch){
  var p=Object.assign({state:"lobby", round:1, seq:0, penalty:"none", limit:0}, pub||{}, patch||{});
  var out={state:p.state, round:p.round, seq:(pub?pub.seq:0)+1, penalty:p.penalty, limit:p.limit};
  if(p.goAt) out.goAt=p.goAt;
  if(p.roster) out.roster=p.roster;
  return out;
}
function setSetting(patch){
  if(!isHost()||!pub||pub.state!=="lobby") return;
  var o=pubObj(patch); o.goAt=null; o.roster=null;
  var p={}; p[rpath("frenzy/pub")]=o;
  update(ref(db), p).catch(function(e){fail(friendly(e))});
}
function begin(){
  if(!isHost()||sending) return;
  var list=order();
  if(list.length<2||list.length>8){fail("Need 2 to 8 players."); return}
  if(dupName(list)){fail("Two players share a name."); return}
  var missing=list.filter(function(p){return !keys[p.uid]});
  if(missing.length){fail("Waiting for "+missing.map(function(p){return p.name}).join(", ")+" to check in. Try again in a moment."); return}
  sending=true; fail("");
  var body={roster:list.map(function(p){return {pid:p.uid, pkh:keys[p.uid]}}), limit:+pub.limit||0, penalty:pub.penalty||"none"};
  if(forcedWord()) body.testWord=forcedWord();
  if(FAST) body.countdownMs=1200;
  api("race-start", body).then(function(res){
    if(!res.ok){sending=false; fail(res.error||"Couldn't start the race."); return}
    var at=serverNow()+(res.goAt-res.now);
    var payload={}, ids=list.map(function(p){return p.uid});
    payload[rpath("meta")]=metaObj({status:"play", phase:"answer"});
    payload[rpath("frenzy/pub")]=pubObj({state:"race", goAt:at, limit:res.limit, penalty:res.penalty, roster:JSON.stringify(ids)});
    ids.forEach(function(u){payload[rpath("frenzy/prog/"+u)]=null; payload[rpath("frenzy/players/"+u)]=null});
    update(ref(db), payload).then(function(){sending=false}).catch(function(e){sending=false; fail(friendly(e))});
  });
}
/* The host calls the race over when everyone still here is done, the host ends it, or time runs out. */
function hostCheck(){
  if(!isHost()||!raceOn()||finishing||sending) return;
  var ids=roster(), now=Date.now(), allIn=true, needEnd=false;
  ids.forEach(function(u){
    var p=progOf(u), done=p.st!=="play", pl=players[u];
    var away=!pl||pl.connected===false;
    if(!away) delete goneSince[u]; else if(!goneSince[u]) goneSince[u]=now;
    var gone=!pl||(away&&now-goneSince[u]>30000);
    if(!done&&!gone) allIn=false;
    if(!done&&gone) needEnd=true;
  });
  var timeUp=timeLeftMs()<=0;
  if(allIn||timeUp) endRace(needEnd&&!timeUp);
}
function endRace(callEnd){
  if(!isHost()||finishing) return;
  finishing=true;
  var go=callEnd?api("race-end"):Promise.resolve({ok:true});
  go.then(function(){
    var payload={};
    payload[rpath("frenzy/pub")]=pubObj({state:"results"});
    payload[rpath("meta")]=metaObj({status:"over", phase:"over", endedAt:serverNow()});
    return update(ref(db), payload);
  }).catch(function(e){fail(friendly(e))}).then(function(){finishing=false});
}
function endNow(){if(isHost()&&raceOn()) endRace(true)}
function again(){
  if(!isHost()||!pub) return;
  var ids=roster(), payload={};
  payload[rpath("meta")]=metaObj({status:"lobby", phase:"lobby", gameId:Math.min(100, (+meta.gameId||1)+1)});
  var o=pubObj({state:"lobby", round:Math.min(99, round()+1)}); o.goAt=null; o.roster=null;
  payload[rpath("frenzy/pub")]=o;
  ids.forEach(function(u){payload[rpath("frenzy/prog/"+u)]=null; payload[rpath("frenzy/players/"+u)]=null});
  update(ref(db), payload).catch(function(e){fail(friendly(e))});
}

/* ---------- finishing, for everyone ---------- */
function allDone(){var ids=roster(); return ids.length>0&&ids.every(function(u){return progOf(u).st!=="play"})}
function maybeReveal(){
  if(result||revealing||!pub||pub.state==="lobby") return;
  var over=pub.state==="results"||(raceOn()&&(allDone()||timeLeftMs()<=0));
  if(!over) return;
  revealing=true; revealTries=0;
  (function go(){
    api("race-reveal").then(function(res){
      if(res.ok){
        revealing=false;
        result=res; result.names={}; Object.keys(players).forEach(function(u){result.names[u]=players[u].name});
        /* everyone's boards open to all once the host calls the race over */
        render();
      }else if(++revealTries<14){setTimeout(go, 900)}
      else{revealing=false; result={word:"", results:null, names:{}}; render()}
    });
  })();
}
/* A player who runs out the clock without solving counts as out. */
function checkTimeout(){
  if(!raceOn()||mySt!=="play"||localOut||timeLeftMs()>0) return;
  localOut=true; mySt="out"; writeMine(false); render();
}

/* ---------- listeners ---------- */
/* Put this phone's board back from Firebase (a refresh, a reconnect). The word server settles any difference. */
function adopt(){
  if(!raceOn()) return;
  if(fbBoard.length>rows.length){rows=fbBoard.slice(); gridKey=""}
  if(fbProg&&fbProg.st==="solved") mySt="solved"; else if(fbProg&&fbProg.st==="out") mySt="out";
  else if(rows.length>=L.MAX_GUESSES&&mySt==="play") mySt="out";
}
function resetRound(){
  rows=[]; mySt="play"; lockUntil=0; reconciled=0; result=null; revealing=false; revealTries=0; drinkOn=false; wentGo=false; lastCd=-1; localOut=false; sending=false; finishing=false; boards=null; goneSince={};
  if($("guess")) $("guess").value="";
  msgText=""; gridKey=""; flipAt=null;
  if(boardsStop){try{boardsStop()}catch(e){} boardsStop=null}
}
function stopAll(){stops.forEach(function(fn){try{fn()}catch(e){}}); stops=[]; if(boardsStop){try{boardsStop()}catch(e){} boardsStop=null} if(connStop){connStop(); connStop=null}}
function listen(){
  stopAll();
  var watched=code;
  stops.push(onValue(ref(db, rpath("meta")), function(s){
    if(!s.exists()){if(watched!==code) return; roomEnded(); return}
    meta=s.val()||null; render();
  }, function(){fail("That room isn't available.")}));
  stops.push(onValue(ref(db, rpath("players")), function(s){players=s.val()||{}; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("frenzy/keys")), function(s){keys=s.val()||{}; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("frenzy/prog")), function(s){prog=s.val()||{}; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("frenzy/pub")), function(s){
    var was=pub; pub=s.val()||null;
    if(pub&&(pub.round!==lastRound||(pub.state==="lobby"&&lastState!=="lobby"))){resetRound(); lastRound=pub.round}
    if(pub&&pub.state==="lobby") resetRound();
    if(pub&&pub.state==="results"&&lastState!=="results"&&!boardsStop){
      boardsStop=onValue(ref(db, rpath("frenzy/players")), function(b){boards=b.val()||{}; $("awards").dataset.key=""; render()}, function(){});
    }
    lastState=pub?pub.state:"";
    adopt(); render(); reconcile(); maybeReveal();
  }, function(){}));
  /* this phone's own board, so a refresh in the middle of a race puts it back */
  stops.push(onValue(ref(db, rpath("frenzy/players/"+uid)), function(s){fbBoard=parseBoard(s.val()); adopt(); render()}, function(){}));
  stops.push(onValue(ref(db, rpath("frenzy/prog/"+uid)), function(s){fbProg=s.val()||null; adopt(); render()}, function(){}));
  startTicker();
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
  if(pub&&meta&&meta.status!=="lobby"&&pub.state==="race"){render(); checkTimeout(); hostCheck(); maybeReveal()}
}
function startTicker(){stopTicker(); tickTimer=setInterval(tick, 250)}
function stopTicker(){if(tickTimer){clearInterval(tickTimer); tickTimer=0}}
function roomEnded(){
  stopAll(); stopTicker(); code=null; meta=null; pub=null; prog={}; keys={}; players={}; result=null; rows=[]; resetRound();
  try{sessionStorage.removeItem("tp_fr_room")}catch(e){}
  fail("This room has closed."); screen("home");
}

/* ---------- rooms ---------- */
async function publishKey(){
  myPk=keyFor(code);
  await set(ref(db, rpath("frenzy/keys/"+uid)), M.sha256Hex(myPk));
}
async function hostRoom(name){
  var i, claimed=null;
  for(i=0;i<6;i++){
    var c=makeRoomCode();
    var snap=await get(ref(db, "rooms/"+c+"/meta"));
    if(snap.exists()) continue;
    try{
      await update(ref(db), {["rooms/"+c+"/meta"]:{hostUid:uid, createdAt:serverTimestamp(), status:"lobby", phase:"lobby", spice:"mild", rounds:10, na:false, round:0, gameId:1, kind:"fr"}});
      claimed=c; break;
    }catch(e){if(!/permission/i.test(String(e.code||e.message||""))) throw e}
  }
  if(!claimed) throw new Error("room");
  code=claimed;
  await set(ref(db, "rooms/"+claimed+"/players/"+uid), {name:name, connected:true, joinedAt:serverNow()});
  await set(ref(db, "rooms/"+claimed+"/frenzy/pub"), {state:"lobby", round:1, seq:1, penalty:"none", limit:0});
  await publishKey();
  enter();
}
async function joinRoom(c, name){
  var snap=await get(ref(db, "rooms/"+c+"/meta"));
  if(!snap.exists()) throw new Error("missing");
  var m=snap.val()||{};
  if(m.kind!=="fr") throw new Error("kind");
  var mineSnap=await get(ref(db, "rooms/"+c+"/players/"+uid));
  if(m.status!=="lobby"&&!mineSnap.exists()) throw new Error("closed");
  var prev=mineSnap.val()||{};
  if(!mineSnap.exists()){
    var all=(await get(ref(db, "rooms/"+c+"/players"))).val()||{};
    if(Object.keys(all).length>=8) throw new Error("full");
    var err=L.nameError(name, Object.keys(all).map(function(k){return all[k].name}));
    if(err) throw new Error("name:"+err);
  }
  code=c;
  await set(ref(db, "rooms/"+c+"/players/"+uid), {name:prev.name||name, connected:true, joinedAt:prev.joinedAt||serverNow()});
  await publishKey();
  enter();
}
function enter(){
  try{sessionStorage.setItem("tp_fr_room", code); localStorage.setItem("tp_last_game", "five-letter-frenzy")}catch(e){}
  listen(); armPresence();
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
      code=null;
      var msg=String((e&&e.message)||"");
      if(msg==="kind") fail("That code is for a different game or mode.");
      else if(msg==="missing") fail("No room with that code.");
      else if(msg==="closed") fail("This race has already started. Join the next one from the lobby.");
      else if(msg==="full") fail("That room is full (8 players).");
      else if(msg.indexOf("name:")===0) fail(msg.slice(5));
      else fail(friendly(e));
    }).then(function(){sending=false});
  });
  document.querySelectorAll("[data-penalty]").forEach(function(b){b.addEventListener("click", function(){setSetting({penalty:b.dataset.penalty})})});
  document.querySelectorAll("[data-limit]").forEach(function(b){b.addEventListener("click", function(){setSetting({limit:+b.dataset.limit})})});
  $("start").addEventListener("click", begin);
  $("guessform").addEventListener("submit", function(e){e.preventDefault(); sendGuess($("guess").value)});
  $("guess").addEventListener("input", function(){
    if(!raceOn()||mySt!=="play") return;
    var n=L.normalize($("guess").value).slice(0, 5).length;
    if(n>typedLen) fx("type");
    typedLen=n; paintGrid(L.normalize($("guess").value).slice(0, 5));
  });
  $("dcdrink").addEventListener("click", function(){drinkOn=false; fx("clink"); render()});
  $("dcpose").addEventListener("click", function(){drinkOn=false; render()});
  $("dcpass").addEventListener("click", function(){drinkOn=false; render()});
  $("endrace").addEventListener("click", endNow);
  $("again").addEventListener("click", again);
  $("leave").addEventListener("click", leaveGame);
  $("close").addEventListener("click", askClose);
  if($("closestage")) $("closestage").addEventListener("click", askClose);
  $("copylink").addEventListener("click", function(){if(code) copyText(roomUrl(code)).then(function(){fail("Link copied.")}).catch(function(){fail(roomUrl(code))})});
  $("copycode").addEventListener("click", function(){if(code) copyText(code).then(function(){fail("Code copied.")}).catch(function(){fail(code)})});
  $("sharebtn").addEventListener("click", function(){
    if(!code) return;
    if(navigator.share) navigator.share({title:"Five Letter Frenzy Race", text:"Join my Five Letter Frenzy race "+code, url:roomUrl(code)}).catch(function(){});
    else copyText(roomUrl(code)).then(function(){fail("Link copied.")}).catch(function(){fail(roomUrl(code))});
  });
  window.addEventListener("online", function(){fail(""); if(goOnline&&db){try{goOnline(db)}catch(e){}}});
  var back=""; try{back=sessionStorage.getItem("tp_fr_room")||""}catch(e){}
  var name=L.cleanName($("pname").value);
  if(back&&validCode(back)&&name&&(!linked||linked===back)) joinRoom(back, name).catch(function(){code=null; try{sessionStorage.removeItem("tp_fr_room")}catch(err){}});
  if(emuOn()) window.__tpRace={
    uid:function(){return uid}, code:function(){return code}, host:function(){return isHost()}, pub:function(){return pub},
    phase:function(){return !pub?"":pub.state==="race"?(serverNow()<goAt()?"countdown":"race"):pub.state},
    rows:function(){return rows.map(function(r){return r.w})}, st:function(){return mySt}, word:function(){return result&&result.word},
    ranks:function(){return ranked().map(function(r){return {uid:r.uid, rank:r.rank, status:r.status, n:r.n}})}, prog:function(){return prog}
  };
}

/* ---------- boot ---------- */
function showReady(){if(bootTimer){clearTimeout(bootTimer); bootTimer=0} show("boot", false); show("app", true)}
function showBootError(msg){
  if(bootTimer){clearTimeout(bootTimer); bootTimer=0}
  show("boot", true); show("app", false);
  $("bootmsg").textContent="Couldn't open the race.";
  $("booterr").textContent=msg||"Check your connection and try again."; $("booterr").classList.remove("hide");
  $("retry").classList.remove("hide");
}
async function boot(){
  bootTimer=setTimeout(function(){if($("app").classList.contains("hide")) showBootError("This is taking too long. Check your connection and try again.")}, 12000);
  if(!L||!M){showBootError("The game rules didn't load. Reload the page."); return}
  if(!navigator.onLine&&!emuOn()){showBootError("You're offline. Race mode needs a connection. Solo works offline."); return}
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
  showReady();
  try{wire()}catch(err){console.error(err); fail("The race glitched. Reload and try again.")}
}
$("retry").addEventListener("click", function(){location.reload()});
boot().catch(function(err){console.error(err); showBootError("The race didn't open. Check your connection and try again.")});
})();
