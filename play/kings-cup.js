(function(){
"use strict";
/* ============================================================
   SOUNDS
   Procedural Web Audio only. No samples, no audio files.
   Buses: music (host loop + room tone), sfx (panned, every
   phone), voice (host announcer). Music ducks for SFX/voice.
   ============================================================ */
var SOUNDS = {
  buses: { music: 0.7, sfx: 0.9, voice: 0.85 },
  music: { bpm: 108, hypePerKing: 14 },
  sfx: ["flip","shuffle","whoosh","gulp","clink","crack","pour","ice","cheers","cupPour","sting","heavyPour"],
  crowd: { cheer: "cheer", ooh: "ooh", gasp: "gasp", boo: "boo", applause: "applause", laugh: "laugh", chant: "chant" }
};
/* ============================================================
   RULES
   Original lines. Every drink line is one small sip OR a
   visible alternative. Nothing stacks. The cup is a counter.
   ============================================================ */
var RULES = {
  A: { title: "One Beat", body: "Everyone joins for one beat, then the table stops together. It does not keep going and it does not pass down the line.", line: "One small sip or hold a silly pose, together, then stop. No continuous drinking.", say: "One Beat!" },
  "2": { title: "You", body: "The drawer points at one other player. That person has the card. One turn, then it is over.", line: "One small sip or take a five-second bow.", say: "You!" },
  "3": { title: "Me", body: "This card lands on the person who drew it.", line: "One small sip or take a dramatic bow.", say: "Me!" },
  "4": { title: "Floor", body: "Everyone touches the floor once. The drawer names who was last. That is the whole contest.", line: "One small sip or do one squat.", say: "Floor!" },
  "5": { title: "Guys", body: "Players who chose Guys, plus anyone who chose Everyone. If nobody fits, the whole table waves instead.", line: "One small sip or hold a flex pose.", say: "Guys!" },
  "6": { title: "Girls", body: "Players who chose Girls, plus anyone who chose Everyone. If nobody fits, the whole table waves instead.", line: "One small sip or do a hair-flip pose.", say: "Girls!" },
  "7": { title: "Heaven", body: "Everyone points at the ceiling. The drawer names who was last.", line: "One small sip or hold a star pose for three seconds.", say: "Heaven!" },
  "8": { title: "Mate", body: "Pick a partner. When one of you takes a sip or the alternative, the other does the same once. It does not bounce back.", line: "One small sip or a handshake. Your mate does the same, once.", say: "Pick a mate!" },
  "9": { title: "Rhyme", body: "Say the seed word. Go around with rhymes. The first person who stalls ends it.", line: "One small sip or make an animal noise.", say: "Rhyme time!" },
  "10": { title: "Categories", body: "Name things in the category. The first stall ends the round. These are not drink names.", line: "One small sip or freeze in a thumbs-up.", say: "Category!" },
  J: { title: "House rule", body: "Invent one silly table rule. It stays on the list until the host clears it. Breaking it later is still only one moment. Rules do not stack.", line: "One small sip or write the rule and score the point you already have.", say: "Make a rule!" },
  Q: { title: "Question", body: "Ask the question out loud to the player you pick. They answer once.", line: "One small sip or score a point for answering.", say: "Question!" },
  K: { title: "King", body: "The cup fills one mark. It counts kings. It is not a drink and nobody finishes it.", line: "One small sip or add a dare to the cup's list.", say: "King!" }
};
/* ============================================================
   TRIGGERS
   Moment -> sound cues. Host music/voice stay off this map.
   Phones play the short cues locally. The host also speaks.
   ============================================================ */
var TRIGGERS = {
  shuffle: ["shuffle","whoosh"],
  draw: ["flip","whoosh"],
  sip: ["gulp","clink"],
  alt: ["ice"],
  ace: ["cheer"],
  king: ["cupPour","cheer"],
  finalKing: ["sting","heavyPour","gasp"],
  mate: ["ooh"],
  jack: ["chant"],
  queen: ["ooh"],
  rhyme: ["laugh"],
  category: ["applause"],
  floor: ["gasp"],
  reaction: ["clink"],
  boo: ["boo"],
  clap: ["applause"],
  gasp: ["gasp"]
};
var EMOS = { clap: "👏", gasp: "😮", laugh: "😂", boo: "👎", party: "🎉" };
var EMO_CUE = { clap: "clap", gasp: "gasp", laugh: "rhyme", boo: "boo", party: "ace" };
var RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
var RHYMES = ["moon","chair","star","light","blue","dance","night","gold","train","cloud","shoe","river"];
var CATS = ["breakfast foods that are not eggs","animals that would wear sunglasses","movies with a one-word title","things in a junk drawer","green snacks","songs you can hum in one breath","sports you can play while seated","cartoon sidekicks","things that are round","party themes for a Tuesday","hats you can name","things you can fold"];
var QUESTIONS = ["What is a talent you would only show this table?","What song should play when you enter a room?","What is the silliest thing you believed as a kid?","Which fictional character would you hire?","What food do you pretend to like?","Where would you spend one perfect afternoon?"];
var SEED_DARES = ["Take a dramatic bow.","Compliment every player in four words.","Invent a three-step handshake.","Tell a five-second story about a lost sock.","Speak one sentence like a movie trailer.","Do a three-step moonwalk.","Hold a star pose for three seconds.","Give the table a new nickname."];
var ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
var MIXKEY = "tp_kc_mix";
var $=function(id){return document.getElementById(id)};
var mix = window.PartyAudio ? PartyAudio.load(MIXKEY) : {music:0.7,sfx:0.9,voice:0.85,muteMusic:false,muteSfx:false,muteVoice:false};
var engine = null;
var parts = [], raf = 0;
var uid = null, code = null, meta = null, players = {}, who = {}, table = null, ask = false, house = [], mates = {}, deckMem = null;
var serverOffset=0, offsetReady=false, offsetStop=null, lastReactAt=0;
var db, authObj, stops = [], heard = -1, seenReact = null, hostLock = false, hostFlight = 0, pickWait = null, heldPick = null, connStop = null, scoring = 0;
var ref, onValue, update, set, remove, onDisconnect, get, serverTimestamp, goOnline;

function saveMix(){try{localStorage.setItem(MIXKEY, JSON.stringify(mix))}catch(e){} if(engine) engine.apply()}
function applyMix(){if(engine) engine.apply()}
function audioEngine(){
  if(engine||!window.PartyAudio) return engine;
  engine = PartyAudio.create({
    key:MIXKEY, mix:mix, host:isHost,
    hype:function(){return kingCount()},
    bpm:SOUNDS.music.bpm, hypePer:SOUNDS.music.hypePerKing,
    pulse:function(){var el=$("lights"); if(!el) return; el.classList.add("on"); setTimeout(function(){el.classList.remove("on")}, 90)}
  });
  return engine;
}
function fire(moment, level){
  var eng=audioEngine(); if(!eng) return;
  (TRIGGERS[moment]||[]).forEach(function(name){try{eng.cue(name, level)}catch(e){}});
}
function say(line){var eng=audioEngine(); if(eng) eng.say(line)}
function startMusic(){var eng=audioEngine(); if(eng&&isHost()) eng.startMusic()}
function unlock(){try{var eng=audioEngine(); if(eng){eng.unlock(); if(isHost()) eng.startMusic()} if(window.TPSound) TPSound.unlock()}catch(e){}}
function kingCount(){return table&&table.kings?+table.kings:0}
function isHost(){return !!(meta&&uid&&meta.hostUid===uid)}
function order(){
  return Object.keys(players).map(function(id){
    var w=who[id]||{};
    return {uid:id,name:players[id].name||"Player",connected:players[id].connected!==false,joinedAt:players[id].joinedAt||0,gender:w.gender||"everyone",cards:+w.cards||0,points:+w.points||0,seen:+w.seen||0};
  }).sort(function(a,b){return a.joinedAt-b.joinedAt||a.name.localeCompare(b.name)});
}
function nameOf(id){
  var list=order(), count={}, seen={}, map={};
  list.forEach(function(p){count[p.name]=(count[p.name]||0)+1});
  list.forEach(function(p){
    if(count[p.name]<2){map[p.uid]=p.name; return}
    seen[p.name]=(seen[p.name]||0)+1;
    map[p.uid]=seen[p.name]===1?p.name:(p.name+" "+seen[p.name]);
  });
  return map[id]||(players[id]&&players[id].name)||"Player";
}
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
function mine(){for(var i=0;i<order().length;i++) if(order()[i].uid===uid) return order()[i]; return null}
function splitCard(card){if(!card)return null; return {r:card.slice(0,-1), s:card.slice(-1)}}
function suitOf(id){return {S:{sym:"♠",red:false},H:{sym:"♥",red:true},D:{sym:"♦",red:true},C:{sym:"♣",red:false}}[id]||{sym:"",red:false}}
function rpath(p){return "rooms/"+code+"/"+p}
function fail(msg){var p=$("perr"); if(p) p.textContent=msg||""}
function friendly(e){
  var c=String((e&&(e.code||e.message))||"");
  if(/permission|denied/i.test(c)) return "That room isn't available.";
  if(/offline|network|fetch/i.test(c)) return "You're offline.";
  return "Something went wrong. Try again.";
}
function normName(v){return String(v||"").trim().slice(0,20)}
function normCode(v){
  var up=String(v||"").toUpperCase();
  var q=up.match(/[?&]CODE=([ABCDEFGHJKMNPQRSTUVWXYZ]{4})/);
  if(q) return q[1];
  return up.replace(/[^ABCDEFGHJKMNPQRSTUVWXYZ]/g,"").slice(-4);
}
function validCode(c){return /^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(c)}
function makeCode(){var s="",i; for(i=0;i<4;i++) s+=ALPHABET[Math.floor(Math.random()*ALPHABET.length)]; return s}
function emuOn(){return /[?&]emulator=1(?:&|$)/.test(location.search)}
function roomUrl(c){
  var base=/localhost|127\.0\.0\.1/.test(location.host)?location.origin+location.pathname:"https://tipsyplay.com/games/kings-cup.html";
  return base+"?code="+c;
}
function fullMeta(patch){
  var m=Object.assign({}, meta||{}, patch||{});
  var out={hostUid:m.hostUid,createdAt:m.createdAt,status:m.status,phase:m.phase,spice:m.spice||"mild",rounds:+m.rounds||20,na:!!m.na,round:+m.round||0,gameId:+m.gameId||1,kind:"kings-cup"};
  if(m.status!=="lobby") out.deck=["King's Cup"];
  if(m.endedAt&&m.status==="over") out.endedAt=m.endedAt;
  return out;
}
function blankPlay(turn, orderStr){
  return {turn:turn,kings:0,step:"draw",card:"",echo:"",seq:0,left:52,target:"",order:orderStr};
}
function turnList(){
  if(table&&table.order) return String(table.order).split(",").filter(Boolean);
  return order().map(function(p){return p.uid});
}
function buildDeck(){
  var d=[], s, r, suits="SHDC";
  for(s=0;s<4;s++) for(r=0;r<RANKS.length;r++) d.push(RANKS[r]+suits[s]);
  for(var i=d.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1)); var t=d[i]; d[i]=d[j]; d[j]=t}
  return d;
}
function pilePayload(list, prevLen){
  var out={}, i;
  for(i=0;i<list.length;i++) out[rpath("kc/pile/"+i)]=list[i];
  for(i=list.length;i<(prevLen||0);i++) out[rpath("kc/pile/"+i)]=null;
  return out;
}


function burst(n){
  var c=$("fx"); if(!c) return;
  c.width=window.innerWidth; c.height=window.innerHeight;
  for(var i=0;i<n;i++) parts.push({x:Math.random()*c.width,y:n>40?-20:c.height*0.35,vx:(Math.random()-0.5)*(n>40?8:4),vy:n>40?2+Math.random()*5:-3-Math.random()*3,life:1,color:i%2?"#ff2d87":"#111"});
  if(!raf) raf=requestAnimationFrame(frame);
}
function frame(){
  var c=$("fx"); if(!c){raf=0; return}
  var ctx=c.getContext("2d"); ctx.clearRect(0,0,c.width,c.height);
  parts=parts.filter(function(p){return p.life>0});
  parts.forEach(function(p){p.x+=p.vx; p.y+=p.vy; p.vy+=0.08; p.life-=0.015; ctx.globalAlpha=Math.max(p.life,0); ctx.fillStyle=p.color; ctx.fillRect(p.x,p.y,8,8)});
  ctx.globalAlpha=1;
  if(parts.length) raf=requestAnimationFrame(frame); else raf=0;
}
function shake(){document.body.classList.remove("kc-shake"); void document.body.offsetWidth; document.body.classList.add("kc-shake")}
function flash(){document.body.classList.remove("kc-flash"); void document.body.offsetWidth; document.body.classList.add("kc-flash")}
function floatIcon(emoji, x){
  var n=document.createElement("div"); n.className="kc-float"; n.textContent=emoji;
  n.style.left=(x||window.innerWidth/2)+"px"; n.style.top="46%";
  document.body.appendChild(n); setTimeout(function(){n.remove()},1000);
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
  code=null; meta=null; players={};
  try{sessionStorage.removeItem("tp_kc_room")}catch(e){}
}
function openHostFlow(){
  screen("home");
  var name=savedName();
  if(!name){var el=$("pname"); if(el) el.focus(); return}
  if($("hostbtn")) $("hostbtn").click();
}
function restartSame(){
  var name=savedName();
  var gender=($("pgender")&&$("pgender").value)||sessionStorage.getItem("tp_kc_group")||"everyone";
  if(!name){openHostFlow(); return}
  releaseRoom();
  screen("home");
  hostRoom(name, gender).catch(function(e){fail(friendly(e))});
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
  var row=document.createElement("div"); row.className="ctrl"; row.setAttribute("data-restart","1");
  var p=document.createElement("p"); p.textContent="This room is closed to new players.";
  var b=document.createElement("button"); b.type="button"; b.className="btn alt"; b.textContent="Restart with same game";
  b.addEventListener("click", function(){restartSame()});
  row.appendChild(p); row.appendChild(b); sec.appendChild(row);
}
function paintRole(){
  document.body.classList.toggle("is-host", isHost());
  document.body.dataset.role=isHost()?"host":"player";
  document.querySelectorAll(".hostonly").forEach(function(n){n.classList.toggle("hide", !isHost())});
  document.querySelectorAll(".guestonly").forEach(function(n){n.classList.toggle("hide", isHost())});
}
function paintLobby(){
  $("codebig").textContent=code||"";
  $("sharelink").textContent=roomUrl(code);
  var box=$("plist"); box.textContent="";
  order().forEach(function(p){
    var row=document.createElement("div"); row.className=p.connected?"prow":"prow off";
    row.textContent=nameOf(p.uid)+" · "+p.gender+(p.connected?"":" (away)");
    if(isHost()&&meta&&meta.status==="lobby"&&p.uid!==uid){
      var kick=document.createElement("button"); kick.type="button"; kick.className="x"; kick.textContent="Remove";
      kick.setAttribute("aria-label", "Remove "+nameOf(p.uid));
      kick.addEventListener("click", function(){remove(ref(db, rpath("players/"+p.uid))).catch(function(e){fail(friendly(e))})});
      row.appendChild(kick);
    }
    box.appendChild(row);
  });
  var start=$("start");
  if(start) start.disabled=!(isHost()&&$("optin").checked&&order().length>=2);
}
function paintScores(){
  var box=$("scores"); box.textContent="";
  order().forEach(function(p){
    var row=document.createElement("div"); row.className="prow boardrow";
    if(table&&table.turn===p.uid) row.style.background="#ff2d87";
    var name=document.createElement("span"); name.textContent=nameOf(p.uid)+(p.connected?"":" (away)");
    var metaEl=document.createElement("b"); metaEl.textContent=p.cards+" cards · "+p.points+" pts";
    row.appendChild(name); row.appendChild(metaEl); box.appendChild(row);
  });
}
function paintRules(){
  var box=$("mates"); box.textContent="";
  var pairs=[], seen={};
  Object.keys(mates).forEach(function(a){
    var b=mates[a]; if(!b||seen[a]||seen[b]) return; seen[a]=seen[b]=1;
    if(a<b) pairs.push([a,b]); else pairs.push([b,a]);
  });
  var h=document.createElement("p"); h.textContent=pairs.length?"Mates match once. It does not bounce back.":"Mates: none yet.";
  box.appendChild(h);
  pairs.forEach(function(pair){var p=document.createElement("p"); p.textContent=nameOf(pair[0])+" ↔ "+nameOf(pair[1]); box.appendChild(p)});
  var houseBox=$("house"); houseBox.textContent="";
  var title=document.createElement("p"); title.textContent=house.length?"House rules (one at a time, nothing stacks):":"House rules: none yet.";
  houseBox.appendChild(title);
  house.forEach(function(rule,i){
    var row=document.createElement("div"); row.className="prow";
    var s=document.createElement("span"); s.textContent=rule;
    row.appendChild(s);
    if(isHost()){var x=document.createElement("button"); x.type="button"; x.className="x"; x.textContent="×"; x.setAttribute("data-drop", String(i)); x.setAttribute("aria-label","Clear rule"); row.appendChild(x)}
    houseBox.appendChild(row);
  });
  var d=$("darelist"); d.textContent="";
  var dp=document.createElement("p"); dp.textContent="Dare list (the cup does not hold a drink):";
  d.appendChild(dp);
  SEED_DARES.forEach(function(dare){var p=document.createElement("p"); p.textContent=dare; d.appendChild(p)});
}
function lineFor(card){
  if(card.r==="K"&&kingCount()>=4) return "One small sip or do a dare from the cup. No downing a cup.";
  return RULES[card.r].line;
}
function actorUid(){
  if(!table) return "";
  if(table.step==="echo") return table.echo||"";
  return table.turn||"";
}
function showCard(){
  var card=splitCard(table.card); if(!card) return;
  var rule=RULES[card.r], suit=suitOf(card.s), face=$("card");
  face.classList.toggle("red", !!suit.red);
  if(showCard.seq!==table.seq){showCard.seq=table.seq; face.classList.remove("kc-card"); void face.offsetWidth; face.classList.add("kc-card")}
  $("cardsuit").textContent=suit.sym+"  "+card.r;
  $("cardrank").textContent=card.r;
  $("ruletitle").textContent=rule.title;
  $("rulebody").textContent=rule.body;
  var whoLine="";
  if(card.r==="5"||card.r==="6"){
    var kind=card.r==="5"?"guys":"girls";
    var names=order().filter(function(p){return p.gender===kind||p.gender==="everyone"}).map(function(p){return p.name});
    whoLine="In this group: "+(names.join(", ")||"nobody — the whole table waves instead.");
  }
  if(table.target) whoLine=(whoLine?whoLine+" ":"")+"Chosen: "+nameOf(table.target)+".";
  if(table.step==="echo") whoLine=nameOf(table.echo)+" matches once. It does not pass back.";
  $("who").textContent=whoLine;
  $("sipline").textContent=lineFor(card);
  var extra=$("extra");
  var mineTurn=actorUid()===uid;
  var choice=mineTurn&&table.step==="shown"&&(card.r==="2"||card.r==="8"||card.r==="J"||card.r==="Q");
  var sig=[table.step,table.seq,table.card,actorUid(),table.target||"",table.echo||"",order().map(function(p){return p.uid}).join(",")].join("|");
  if(showCard.sig!==sig){
    showCard.sig=sig;
    extra.textContent="";
    if(choice&&card.r!=="J"){
      order().forEach(function(p){
        if(p.uid===uid) return;
        var b=document.createElement("button"); b.type="button"; b.className="btn alt"; b.setAttribute("data-uid", p.uid);
        b.setAttribute("data-kind", card.r==="8"?"mate":card.r==="Q"?"ask":"target");
        b.textContent=(card.r==="8"?"Mate with ":card.r==="Q"?"Ask ":"Point at ")+p.name;
        extra.appendChild(b);
      });
    }
    if(choice&&card.r==="J"){
      var input=document.createElement("input"); input.id="jackrule"; input.className="bigin"; input.maxLength=80; input.placeholder="A silly rule for the table"; input.setAttribute("aria-label","House rule");
      var save=document.createElement("button"); save.type="button"; save.id="jacksave"; save.className="btn"; save.textContent="Save the rule";
      extra.appendChild(input); extra.appendChild(save);
    }
    if(!choice&&card.r==="9"){var p=document.createElement("p"); p.textContent="Seed word: "+RHYMES[(table.seq||0)%RHYMES.length]; extra.appendChild(p)}
    if(!choice&&card.r==="10"){var p2=document.createElement("p"); p2.textContent="Category: "+CATS[(table.seq||0)%CATS.length]; extra.appendChild(p2)}
    if(card.r==="Q"){var q=document.createElement("p"); q.textContent=QUESTIONS[(table.seq||0)%QUESTIONS.length]; extra.appendChild(q)}
    if(card.r==="K"&&kingCount()>=4){var dare=document.createElement("p"); dare.textContent="Dare from the cup: "+SEED_DARES[(table.seq||0)%SEED_DARES.length]; extra.appendChild(dare)}
  }
  $("shown").classList.remove("hide");
  $("acks").classList.toggle("hide", !(mineTurn&&!choice));
  $("wait").classList.toggle("hide", mineTurn);
  $("wait").textContent="Waiting for "+nameOf(actorUid())+" to choose.";
}
function render(){
  paintRole();
  if(!meta){screen("home"); return}
  document.body.dataset.phase=table?table.step:(meta.status==="lobby"?"lobby":"");
  document.body.dataset.kings=String(kingCount());
  document.body.dataset.turn=table?table.turn||"":"";
  document.body.dataset.echo=table?table.echo||"":"";
  document.body.dataset.ask=ask?"1":"0";
  document.body.dataset.actor=table&&actorUid()===uid?"1":"0";
  document.body.dataset.card=table&&table.card||"";
  if(meta.status==="lobby"){screen("lobby"); paintLobby(); return}
  screen("table");
  mountRestart();
  var hostP=players[meta.hostUid];
  $("away").classList.toggle("hide", !hostP || hostP.connected!==false);
  var list=order();
  var turnName=table?nameOf(table.turn):"";
  $("turn").textContent=table&&table.step==="echo"?nameOf(table.echo)+" matches once":turnName+(table&&table.step==="draw"?" draws":" has the card");
  $("left").textContent=(table?table.left:0)+" cards left in the deck";
  $("audioline").textContent=isHost()?"Music, room tone, and the announcer play on this phone.":"Short sounds on this phone. Music stays with the host.";
  var span=$("cupfill"); if(span) span.style.height=(Math.min(kingCount(),4)*25)+"%";
  $("cuplabel").textContent=Math.min(kingCount(),4)+"/4";
  paintScores(); paintRules();
  var myDraw=table&&table.step==="draw"&&table.turn===uid;
  $("draw").classList.toggle("hide", !myDraw);
  $("draw").disabled=!!ask;
  $("draw").textContent=ask?"Telling the host…":"Tap to draw";
  var show=table&&(table.step==="shown"||table.step==="echo"||table.step==="finale")&&table.card;
  if(show) showCard();
  else{
    showCard.sig=""; showCard.seq=-1;
    $("shown").classList.add("hide");
    $("wait").classList.toggle("hide", !!myDraw);
    $("wait").textContent="Waiting for "+turnName+" to draw.";
  }
  var fin=table&&table.step==="finale";
  $("finale").classList.toggle("hide", !fin);
  if(fin){
    $("finalcopy").textContent="One small sip or do a dare from the cup. No downing a cup. Kings in the counter: "+kingCount()+".";
    var line=$("recapline"); if(line) line.textContent="King's Cup, "+(meta.rounds||0)+" rounds";
    $("draw").classList.add("hide");
    $("wait").classList.add("hide");
  }
  if(isHost()&&meta.status==="play") startMusic();
  if(isHost()&&!hostLock&&ask&&table){
    if(table.step==="draw"&&deckMem&&deckMem.length) consumeAsk(true);
    else if(table.step!=="draw") update(ref(db),{[rpath("kc/ask")]:null}).catch(function(){});
  }
}
function hear(next){
  if(!next||next.seq==null||next.seq===heard) return;
  if(next.step!=="shown"&&next.step!=="finale") return;
  var card=splitCard(next.card); if(!card) return;
  heard=next.seq;
  unlock();
  flash();
  if(isHost()){
    if(next.step==="finale"){fire("draw"); fire("finalKing",1); say("Final King!"); shake(); burst(90)}
    else{
      fire("draw");
      var rule=RULES[card.r];
      if(card.r==="K") fire("king", next.kings/4);
      else if(card.r==="A") fire("ace");
      else if(card.r==="J") fire("jack");
      else if(card.r==="Q") fire("queen");
      else if(card.r==="8") fire("mate");
      else if(card.r==="9") fire("rhyme");
      else if(card.r==="10") fire("category");
      else if(card.r==="4"||card.r==="7") fire("floor");
      say(rule.say);
      burst(12);
    }
  }else{
    fire("draw");
    if(next.step==="finale"){fire("gasp"); shake(); burst(40)}
  }
}
function maybeScore(){
  var me=who[uid]; if(!me||!table||table.turn!==uid) return;
  if((+table.seq||0)===0){
    if(me.seen>0&&scoring!==0){scoring=0; writeWho(0,0,0)}
    return;
  }
  if(table.step==="draw") return;
  if((+table.seq||0)>me.seen&&scoring!==+table.seq){scoring=+table.seq; writeWho(me.cards+1, me.points+1, +table.seq)}
}
function writeWho(cards, points, seen){
  var g=(who[uid]&&who[uid].gender)||sessionStorage.getItem("tp_kc_group")||"everyone";
  set(ref(db, rpath("kc/who/"+uid)), {gender:g, cards:cards, points:points, seen:seen}).catch(function(e){fail(friendly(e))});
}
function nextUid(from){
  var list=order().map(function(p){return p.uid});
  if(!list.length) return from;
  var idx=list.indexOf(from); if(idx<0) idx=list.length-1;
  return list[(idx+1)%list.length];
}
function mateOf(id){return mates[id]||""}
function orderStr(){return (table&&table.order)||turnList().join(",")||(table&&table.turn)||uid}
function releaseHost(mine, failed){
  if(mine!==hostFlight) return;
  hostFlight++;
  hostLock=false;
  if(failed) consumePick.sent="";
  var again=pickWait; pickWait=null;
  render();
  if(again) consumePick(again);
  else if(failed&&heldPick&&(consumePick.tries||0)<2){consumePick.tries=(consumePick.tries||0)+1; consumePick(heldPick)}
  else consumePick.tries=0;
}
function consumeAsk(val){
  if(!isHost()||val!==true||hostLock) return;
  if(!table||table.step!=="draw"){
    if(val===true) update(ref(db),{[rpath("kc/ask")]:null}).catch(function(e){fail(friendly(e))});
    return;
  }
  if(!deckMem||!deckMem.length){
    update(ref(db),{[rpath("kc/ask")]:null}).catch(function(){});
    return;
  }
  hostLock=true;
  ask=false;
  var mine=++hostFlight;
  var card=deckMem[deckMem.length-1];
  var rank=card.slice(0,-1);
  var kings=(+table.kings||0)+(rank==="K"?1:0);
  var step=(rank==="K"&&kings>=4)?"finale":"shown";
  var seq=(+table.seq||0)+1;
  update(ref(db), {
    [rpath("kc/play")]:{turn:table.turn,kings:kings,step:step,card:card,echo:"",seq:seq,left:deckMem.length-1,target:"",order:orderStr()},
    [rpath("kc/ask")]:null
  }).then(function(){
    if(deckMem&&deckMem[deckMem.length-1]===card) deckMem.pop();
    releaseHost(mine, false);
  }).catch(function(e){
    ask=true;
    fail(friendly(e));
    releaseHost(mine, false);
  });
  setTimeout(function(){
    if(mine!==hostFlight||!hostLock) return;
    var landed=table&&+table.seq>=seq;
    if(landed&&deckMem&&deckMem[deckMem.length-1]===card) deckMem.pop();
    if(!landed) ask=true;
    releaseHost(mine, false);
  }, 900);
}
function consumePick(pick){
  if(!isHost()||!pick||!table) return;
  if(hostLock){pickWait=pick; return}
  var mark=(table.seq||0)+":"+table.step+":"+(pick.kind||"")+":"+(pick.value||"");
  if(consumePick.sent===mark) return;
  consumePick.sent=mark;
  hostLock=true;
  var mine=++hostFlight;
  var rank=table.card?table.card.slice(0,-1):"";
  var actor=table.step==="echo"?table.echo:table.turn;
  var target=pick.value||"";
  var mateMap=Object.assign({}, mates);
  var houseList=house.slice();
  if(pick.kind==="mate"&&target&&target!==actor){mateMap[actor]=target; mateMap[target]=actor}
  if(pick.kind==="rule"){var text=String(target).slice(0,80); if(text&&houseList.indexOf(text)===-1) houseList.push(text)}
  var shownTarget=(pick.kind==="target"||pick.kind==="ask"||pick.kind==="mate")?target:(table.target||"");
  var echo="";
  if(table.step==="shown"&&!(pick.kind==="ack"&&pick.value==="pass")){
    var whoId=actor;
    if((rank==="2"||rank==="Q"||rank==="8")&&target) whoId=target;
    var m=mateMap[whoId]||"";
    if(m&&m!==whoId) echo=m;
  }
  var playNext, ord=orderStr();
  if(table.step==="finale"||(rank==="K"&&(+table.kings||0)>=4)){
    playNext={turn:table.turn,kings:+table.kings||0,step:"finale",card:table.card||"",echo:"",seq:+table.seq||0,left:+table.left||0,target:shownTarget,order:ord};
  }else if(echo){
    playNext={turn:table.turn,kings:+table.kings||0,step:"echo",card:table.card||"",echo:echo,seq:+table.seq||0,left:+table.left||0,target:shownTarget,order:ord};
  }else{
    var nxt=nextUid(table.turn);
    playNext={turn:nxt,kings:+table.kings||0,step:(+table.left||0)?"draw":"finale",card:"",echo:"",seq:+table.seq||0,left:+table.left||0,target:"",order:ord};
  }
  var before=(table.step||"")+"|"+(table.seq||0)+"|"+(table.turn||"")+"|"+(table.echo||"");
  var payload={};
  payload[rpath("kc/play")]=playNext;
  payload[rpath("kc/pick")]=null;
  Object.keys(mates).forEach(function(k){if(!mateMap[k]) payload[rpath("kc/mates/"+k)]=null});
  Object.keys(mateMap).forEach(function(k){payload[rpath("kc/mates/"+k)]=mateMap[k]});
  house.forEach(function(_,i){if(i>=houseList.length) payload[rpath("kc/house/"+i)]=null});
  houseList.forEach(function(rule,i){payload[rpath("kc/house/"+i)]=rule});
  update(ref(db), payload).then(function(){releaseHost(mine, false)}).catch(function(e){fail(friendly(e)); releaseHost(mine, true)});
  setTimeout(function(){
    if(mine!==hostFlight||!hostLock) return;
    var now=(table.step||"")+"|"+(table.seq||0)+"|"+(table.turn||"")+"|"+(table.echo||"");
    releaseHost(mine, now===before);
  }, 900);
}
function sendPick(kind, value){
  if(actorUid()!==uid||!table) return;
  update(ref(db),{[rpath("kc/pick")]:{kind:kind, value:String(value).slice(0,80)}}).catch(function(e){fail(friendly(e))});
  if(kind==="ack"&&value==="pass") return;
  fire(kind==="ack"&&value==="alt"?"alt":"sip");
}
function sendAsk(){
  if(!table||table.step!=="draw"||table.turn!==uid||ask) return;
  unlock();
  fire("shuffle");
  update(ref(db),{[rpath("kc/ask")]:true}).catch(function(e){fail(friendly(e))});
}
function sendReact(emo){
  var now=serverNow();
  if(now-lastReactAt<1500) return;
  lastReactAt=now;
  var id=now.toString(36)+Math.random().toString(36).slice(2,6);
  id=id.replace(/[^A-Za-z0-9]/g,"").slice(0,24);
  if(id.length<6) id=("react"+id+"xxxxxx").slice(0,12);
  update(ref(db),{[rpath("kc/react/"+id)]:{e:emo, u:uid}}).catch(function(e){fail(friendly(e))});
}
async function deal(){
  if(!isHost()||!meta) return;
  var list=order(); if(list.length<2){fail("Need 2 players on their phones."); return}
  fail("");
  var deck=buildDeck();
  try{await set(ref(db, rpath("kc/pile")), deck)}catch(e){fail(friendly(e)); return}
  deckMem=deck.slice();
  var payload={};
  payload[rpath("meta")]=fullMeta({status:"play", phase:"answer", round:0});
  payload[rpath("kc/play")]=blankPlay(list[0].uid, list.map(function(p){return p.uid}).join(","));
  payload[rpath("kc/ask")]=null;
  payload[rpath("kc/pick")]=null;
  Object.keys(mates).forEach(function(k){payload[rpath("kc/mates/"+k)]=null});
  house.forEach(function(_,i){payload[rpath("kc/house/"+i)]=null});
  try{await update(ref(db), payload); fire("shuffle"); say("King's Cup!"); unlock()}
  catch(e){fail(friendly(e))}
}
function stopAll(){stops.forEach(function(fn){fn()}); stops=[]; if(connStop){connStop(); connStop=null}}
function listen(){
  stopAll(); heard=-1; seenReact=null;
  stops.push(onValue(ref(db, rpath("meta")), function(s){
    if(!s.exists()){var wasHost=isHost(); stopAll(); meta=null; code=null; showClosedChoice(wasHost?"host":"join"); return}
    meta=s.val(); render();
  }, function(){fail("That room isn't available.")}));
  stops.push(onValue(ref(db, rpath("players")), function(s){players=s.val()||{}; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("kc/who")), function(s){who=s.val()||{}; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("kc/play")), function(s){
    table=s.val()||null; hear(table); maybeScore(); render();
  }, function(){}));
  stops.push(onValue(ref(db, rpath("kc/ask")), function(s){ask=s.val()===true; if(isHost()) consumeAsk(s.val()); render()}, function(){}));
  stops.push(onValue(ref(db, rpath("kc/pick")), function(s){heldPick=s.val()||null; if(isHost()&&heldPick) consumePick(heldPick)}, function(){}));
  stops.push(onValue(ref(db, rpath("kc/house")), function(s){
    var v=s.val()||{}; house=Object.keys(v).sort(function(a,b){return (+a)-(+b)}).map(function(k){return v[k]}); render();
  }, function(){}));
  stops.push(onValue(ref(db, rpath("kc/mates")), function(s){mates=s.val()||{}; render()}, function(){}));
  stops.push(onValue(ref(db, rpath("kc/react")), function(s){
    var v=s.val()||{}, first=seenReact===null; if(first) seenReact={};
    Object.keys(v).forEach(function(id){
      if(seenReact[id]) return; seenReact[id]=1;
      if(first) return;
      var emo=v[id].e; floatIcon(EMOS[emo]||"👏"); fire(EMO_CUE[emo]||"reaction");
    });
  }, function(){}));
  if(isHost()){
    stops.push(onValue(ref(db, rpath("kc/pile")), function(s){
      if(deckMem!==null) return;
      var v=s.val();
      var full=v?Object.keys(v).sort(function(a,b){return (+a)-(+b)}).map(function(k){return v[k]}):[];
      var keep=table&&typeof table.left==="number"?table.left:full.length;
      deckMem=full.slice(0, keep);
      if(ask&&table&&table.step==="draw") consumeAsk(true);
    }, function(){}));
  }
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
async function hostRoom(name, gender){
  var i, claimed=null;
  for(i=0;i<6;i++){
    var c=makeCode();
    var snap=await get(ref(db, "rooms/"+c+"/meta"));
    if(snap.exists()) continue;
    try{
      await update(ref(db), {["rooms/"+c+"/meta"]:{hostUid:uid, createdAt:serverTimestamp(), status:"lobby", phase:"lobby", spice:"mild", rounds:20, na:false, round:0, gameId:1, kind:"kings-cup"}});
      claimed=c; break;
    }catch(e){if(!/permission/i.test(String(e.code||e.message||""))) throw e}
  }
  if(!claimed) throw new Error("room");
  await set(ref(db, "rooms/"+claimed+"/players/"+uid), {name:name, connected:true, joinedAt:serverNow()});
  await set(ref(db, "rooms/"+claimed+"/kc/who/"+uid), {gender:gender, cards:0, points:0, seen:0});
  code=claimed; sessionStorage.setItem("tp_kc_room", code); sessionStorage.setItem("tp_kc_group", gender);
  try{localStorage.setItem("tp_last_game","kings-cup")}catch(e){}
  listen(); armPresence();
}
async function joinRoom(c, name, gender){
  var snap=await get(ref(db, "rooms/"+c+"/meta"));
  if(!snap.exists()) throw new Error("missing");
  var m=snap.val();
  if(m.kind&&m.kind!=="kings-cup") throw new Error("kind");
  var mine=await get(ref(db, "rooms/"+c+"/players/"+uid));
  if(m.status!=="lobby"&&!mine.exists()) throw new Error("closed");
  var prev=mine.val()||{};
  await set(ref(db, "rooms/"+c+"/players/"+uid), {name:name||prev.name||"Player", connected:true, joinedAt:prev.joinedAt||serverNow()});
  var w=await get(ref(db, "rooms/"+c+"/kc/who/"+uid));
  var cur=w.val()||{cards:0, points:0, seen:0};
  await set(ref(db, "rooms/"+c+"/kc/who/"+uid), {gender:gender||cur.gender||"everyone", cards:+cur.cards||0, points:+cur.points||0, seen:+cur.seen||0});
  code=c; sessionStorage.setItem("tp_kc_room", code); sessionStorage.setItem("tp_kc_group", gender||cur.gender||"everyone");
  try{localStorage.setItem("tp_last_game","kings-cup")}catch(e){}
  listen(); armPresence();
}
function closeRoom(){
  if(!isHost()||!code) return;
  remove(ref(db, "rooms/"+code)).catch(function(e){fail(friendly(e))});
  sessionStorage.removeItem("tp_kc_room");
}
function leaveRoom(){
  if(code&&uid&&!isHost()) remove(ref(db, rpath("players/"+uid))).catch(function(){});
  sessionStorage.removeItem("tp_kc_room");
  stopAll(); code=null; meta=null; screen("home");
}
function wire(){
  var saved=localStorage.getItem("tp_name"); if(saved&&!$("pname").value) $("pname").value=saved;
  var g=sessionStorage.getItem("tp_kc_group"); if(g) $("pgender").value=g;
  var q=normCode(location.search); if(q) $("roomcode").value=q;
  if($("hostnew")) $("hostnew").addEventListener("click", function(){
    if($("hostnew").dataset.role==="host") restartSame();
    else openHostFlow();
  });
  $("hostbtn").addEventListener("click", function(){
    var name=normName($("pname").value), gender=$("pgender").value||"everyone";
    if(!name){fail("Add your name first."); return}
    localStorage.setItem("tp_name", name); fail(""); unlock();
    hostRoom(name, gender).catch(function(e){fail(friendly(e))});
  });
  $("joinform").addEventListener("submit", function(e){e.preventDefault(); $("joinbtn").click()});
  $("joinbtn").addEventListener("click", function(){
    var name=normName($("pname").value), c=normCode($("roomcode").value), gender=$("pgender").value||"everyone";
    if(!name){fail("Add your name first."); return}
    if(!validCode(c)){fail("Enter the 4-letter code."); return}
    localStorage.setItem("tp_name", name); fail(""); unlock();
    joinRoom(c, name, gender).catch(function(e){
      var msg=String((e&&e.message)||"");
      if(msg==="kind") fail("That code is for a different game.");
      else if(msg==="missing") fail("No room with that code.");
      else if(msg==="closed") showClosedChoice("join");
      else fail(friendly(e));
    });
  });
  $("optin").addEventListener("change", render);
  $("start").addEventListener("click", function(){unlock(); deal()});
  $("draw").addEventListener("click", sendAsk);
  $("next").addEventListener("click", function(){sendPick("ack","sip")});
  $("altdone").addEventListener("click", function(){sendPick("ack","alt")});
  if($("passbtn")) $("passbtn").addEventListener("click", function(){sendPick("ack","pass")});
  $("newdeck").addEventListener("click", deal);
  if($("playagain")) $("playagain").addEventListener("click", function(){deal()});
  if($("recap")) $("recap").addEventListener("click", function(){
    var text=$("recapline")&&$("recapline").textContent||"King's Cup, "+(meta&&meta.rounds||0)+" rounds";
    var copied=function(){fail("Recap copied.")};
    if(navigator.share) navigator.share({text:text}).catch(function(){if(navigator.clipboard)navigator.clipboard.writeText(text).then(copied).catch(function(){fail(text)}); else fail(text)});
    else if(navigator.clipboard) navigator.clipboard.writeText(text).then(copied).catch(function(){fail(text)});
    else fail(text);
  });
  $("close").addEventListener("click", closeRoom);
  $("closestage").addEventListener("click", closeRoom);
  $("leave").addEventListener("click", leaveRoom);
  $("leavestage").addEventListener("click", leaveRoom);
  $("mixbtn").addEventListener("click", function(){$("mixer").classList.toggle("hide"); unlock()});
  ["mixmusic","mixsfx","mixvoice"].forEach(function(id){
    $(id).addEventListener("input", function(){
      var v=$(id).value/100;
      if(id==="mixmusic") mix.music=v; else if(id==="mixsfx") mix.sfx=v; else mix.voice=v;
      saveMix(); applyMix();
    });
  });
  $("mutemusic").addEventListener("change", function(){mix.muteMusic=$("mutemusic").checked; saveMix(); applyMix()});
  $("mutesfx").addEventListener("change", function(){mix.muteSfx=$("mutesfx").checked; saveMix(); applyMix()});
  $("mutevoice").addEventListener("change", function(){mix.muteVoice=$("mutevoice").checked; saveMix(); if(mix.muteVoice&&window.speechSynthesis){try{window.speechSynthesis.cancel()}catch(e){}}});
  document.addEventListener("click", function(e){
    var t=e.target; if(t&&t.nodeType!==1) t=t.parentElement;
    if(!t||!t.closest) return;
    unlock();
    var choice=t.closest("[data-uid]");
    if(choice&&choice.dataset.kind){sendPick(choice.dataset.kind, choice.dataset.uid); return}
    if(t.closest("#jacksave")){var input=$("jackrule"); if(input&&input.value.trim()) sendPick("rule", input.value.trim()); return}
    var emo=t.closest("[data-emo]");
    if(emo){sendReact(emo.dataset.emo); return}
    var drop=t.closest("[data-drop]");
    if(drop&&isHost()){
      var i=+drop.dataset.drop;
      update(ref(db),{[rpath("kc/house/"+i)]:null}).catch(function(err){fail(friendly(err))});
    }
  });
  $("mixmusic").value=Math.round(mix.music*100);
  $("mixsfx").value=Math.round(mix.sfx*100);
  $("mixvoice").value=Math.round(mix.voice*100);
  $("mutemusic").checked=!!mix.muteMusic;
  $("mutesfx").checked=!!mix.muteSfx;
  $("mutevoice").checked=!!mix.muteVoice;
  var mute=$("mute");
  if(window.TPSound&&mute) TPSound.bindMute(mute);
  window.addEventListener("pointerdown", unlock, {passive:true});
}
async function boot(){
  if(!navigator.onLine&&!emuOn()){$("connecting").classList.add("hide"); $("offline").classList.remove("hide"); return}
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
  if(authObj.authStateReady) await authObj.authStateReady();
  var cred=await authMod.signInAnonymously(authObj);
  await cred.user.getIdToken();
  uid=cred.user.uid;
  document.body.dataset.uid=uid;
  goOnline(db);
  armServerClock();
  window.addEventListener("pagehide", function(){stopServerClock()});
  $("connecting").classList.add("hide");
  $("app").classList.remove("hide");
  wire();
  var back=sessionStorage.getItem("tp_kc_room");
  var nm=normName($("pname").value);
  if(back&&validCode(back)&&nm){
    joinRoom(back, nm, sessionStorage.getItem("tp_kc_group")||"everyone").catch(function(){sessionStorage.removeItem("tp_kc_room")});
  }
}
boot().catch(function(){
  $("connecting").classList.add("hide");
  $("offline").classList.remove("hide");
  $("offdetail").textContent="Sign-in didn't start. Check the connection and try again.";
});
})();
