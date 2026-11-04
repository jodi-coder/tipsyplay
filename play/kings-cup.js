(function(){
"use strict";
/* ============================================================
   SOUNDS
   Procedural Web Audio only. No samples, no audio files.
   Buses: music (loop + room tone), sfx (panned), voice
   (Web Speech volume). Music ducks while SFX or voice play.
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
  A: { title: "Waterfall", body: "Everyone joins for one beat, then the table stops together. It does not keep going and it does not pass down the line.", line: "One small sip or hold a silly pose, together, then stop. No continuous drinking.", say: "Waterfall!" },
  "2": { title: "You", body: "The drawer points at one other player. That person has the card. One turn, then it is over.", line: "One small sip or take a five-second bow.", say: "You!" },
  "3": { title: "Me", body: "This card lands on the person who drew it.", line: "One small sip or take a dramatic bow.", say: "Me!" },
  "4": { title: "Floor", body: "Everyone touches the floor once. The drawer names who was last. That is the whole contest.", line: "One small sip or do one squat.", say: "Floor!" },
  "5": { title: "Guys", body: "Players who chose Guys, plus anyone who chose Everyone. If nobody fits, the whole table waves instead.", line: "One small sip or hold a flex pose.", say: "Guys!" },
  "6": { title: "Girls", body: "Players who chose Girls, plus anyone who chose Everyone. If nobody fits, the whole table waves instead.", line: "One small sip or do a hair-flip pose.", say: "Girls!" },
  "7": { title: "Heaven", body: "Everyone points at the ceiling. The drawer names who was last.", line: "One small sip or hold a star pose for three seconds.", say: "Heaven!" },
  "8": { title: "Mate", body: "Pick a partner. When one of you takes a sip or the alternative, the other does the same once. It does not bounce back.", line: "One small sip or a handshake. Your mate does the same, once.", say: "Pick a mate!" },
  "9": { title: "Rhyme", body: "Say the seed word. Go around with rhymes. The first person who stalls ends it.", line: "One small sip or make an animal noise.", say: "Rhyme time!" },
  "10": { title: "Categories", body: "Name things in the category. The first stall ends the round. These are not drink names.", line: "One small sip or freeze in a thumbs-up.", say: "Category!" },
  J: { title: "House rule", body: "Invent one silly table rule. It stays on the list until you clear it. Breaking it later is still only one moment. Rules do not stack.", line: "One small sip or write the rule and score the point you already have.", say: "Make a rule!" },
  Q: { title: "Question", body: "Ask the question out loud. The first person to answer finishes the card.", line: "One small sip or score a point for answering.", say: "Question!" },
  K: { title: "King", body: "The cup fills one mark. It counts kings. It is not a drink and nobody finishes it.", line: "One small sip or add a dare to the cup's list.", say: "King!" }
};
/* ============================================================
   TRIGGERS
   Moment -> sound cues. The engine only plays names listed here.
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
  clap: ["applause"]
};
var LINES = { start: "King's Cup!", finale: "Final King!" };
var RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
var RHYMES = ["moon","chair","star","light","blue","dance","night","gold","train","cloud","shoe","river"];
var CATS = ["breakfast foods that are not eggs","animals that would wear sunglasses","movies with a one-word title","things in a junk drawer","green snacks","songs you can hum in one breath","sports you can play while seated","cartoon sidekicks","things that are round","party themes for a Tuesday","hats you can name","things you can fold"];
var QUESTIONS = ["What is a talent you would only show this table?","What song should play when you enter a room?","What is the silliest thing you believed as a kid?","Which fictional character would you hire?","What food do you pretend to like?","Where would you spend one perfect afternoon?"];
var SEED_DARES = ["Take a dramatic bow.","Compliment every player in four words.","Invent a three-step handshake.","Tell a five-second story about a lost sock.","Speak one sentence like a movie trailer.","Do a three-step moonwalk.","Hold a star pose for three seconds.","Give the table a new nickname."];
var KEY = "tp_kc_state";
var MIXKEY = "tp_kc_mix";
var $=function(id){return document.getElementById(id)};
var state = blank();
var mix = loadMix();
var audio = null, musicGain, sfxGain, master, timer = 0, nextTime = 0, step = 0, duckUntil = 0, ambience = null;
var parts = [], raf = 0;

function blank(){
  return { players:[], deck:[], turn:0, kings:0, mates:[], house:[], dares:SEED_DARES.slice(), phase:"setup", card:null, echo:null, idx:{rhyme:0,cat:0,q:0,dare:0}, optin:false };
}
function uid(){return Math.random().toString(36).slice(2,8)}
function player(){return state.players[state.turn] || state.players[0]}
function byId(id){for(var i=0;i<state.players.length;i++) if(state.players[i].id===id) return state.players[i]; return null}
function mateOf(id){
  for(var i=0;i<state.mates.length;i++){
    if(state.mates[i][0]===id) return state.mates[i][1];
    if(state.mates[i][1]===id) return state.mates[i][0];
  }
  return null;
}
function setMate(a,b){
  state.mates = state.mates.filter(function(p){return p[0]!==a && p[1]!==a && p[0]!==b && p[1]!==b});
  state.mates.push([a,b]);
}
function suitOf(id){for(var i=0;i<4;i++) if(["S","H","D","C"][i]===id) return [{sym:"♠",red:false},{sym:"♥",red:true},{sym:"♦",red:true},{sym:"♣",red:false}][i]; return {sym:"",red:false}}
function buildDeck(){
  var d=[], s, r;
  for(s=0;s<4;s++) for(r=0;r<RANKS.length;r++) d.push({r:RANKS[r], s:["S","H","D","C"][s]});
  for(var i=d.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1)); var t=d[i]; d[i]=d[j]; d[j]=t}
  return d;
}
function save(){try{localStorage.setItem(KEY, JSON.stringify(state))}catch(e){}}
function loadMix(){
  var m={music:0.7,sfx:0.9,voice:0.85,muteMusic:false,muteSfx:false,muteVoice:false};
  try{var raw=JSON.parse(localStorage.getItem(MIXKEY)||"null"); if(raw) m=Object.assign(m, raw)}catch(e){}
  return m;
}
function saveMix(){try{localStorage.setItem(MIXKEY, JSON.stringify(mix))}catch(e){}}
function group(kind){return state.players.filter(function(p){return p.gender===kind || p.gender==="everyone"})}

function ensure(){
  var AC=window.AudioContext||window.webkitAudioContext;
  if(!AC) return null;
  if(!audio){
    try{audio=new AC()}catch(e){return null}
    master=audio.createGain(); master.gain.value=0.9;
    var comp=audio.createDynamicsCompressor();
    comp.threshold.value=-14; comp.knee.value=8; comp.ratio.value=6; comp.attack.value=0.01; comp.release.value=0.2;
    master.connect(comp); comp.connect(audio.destination);
    musicGain=audio.createGain(); sfxGain=audio.createGain();
    musicGain.connect(master); sfxGain.connect(master);
    applyMix();
    startAmbience();
  }
  if(audio.state==="suspended"){try{var p=audio.resume(); if(p&&p.catch) p.catch(function(){})}catch(e){}}
  return audio;
}
function applyMix(){
  if(!musicGain) return;
  var now=audio.currentTime;
  musicGain.gain.setTargetAtTime(mix.muteMusic?0.0001:mix.music, now, 0.03);
  sfxGain.gain.setTargetAtTime(mix.muteSfx?0.0001:mix.sfx, now, 0.03);
}
function musicLevel(){return mix.muteMusic?0.0001:Math.max(mix.music,0.0001)}
function duck(seconds){
  if(!audio||!musicGain||mix.muteMusic) return;
  var now=audio.currentTime;
  musicGain.gain.setTargetAtTime(Math.max(musicLevel()*0.35,0.0001), now, 0.02);
  duckUntil=now+seconds;
}
function env(when, peak, dur){
  var g=audio.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(Math.max(peak,0.001), when+Math.min(0.02, dur*0.25));
  g.gain.exponentialRampToValueAtTime(0.0001, when+Math.max(dur,0.05));
  return g;
}
function dest(){
  try{
    var p=audio.createStereoPanner();
    p.pan.value=Math.random()*1.2-0.6;
    p.connect(sfxGain);
    return p;
  }catch(e){return sfxGain}
}
function tone(freq, type, when, dur, peak, slide, target){
  var o=audio.createOscillator(), g=env(when, peak, dur);
  o.type=type; o.frequency.setValueAtTime(Math.max(freq,40), when);
  if(slide && slide>0) o.frequency.exponentialRampToValueAtTime(Math.max(slide,40), when+Math.max(dur,0.05));
  o.connect(g); g.connect(target||dest()); o.start(when); o.stop(when+dur+0.05);
}
function noise(when, dur, peak, f0, f1, kind, target){
  var len=Math.max(1, Math.floor(audio.sampleRate*dur));
  var buf=audio.createBuffer(1, len, audio.sampleRate), data=buf.getChannelData(0), i;
  for(i=0;i<len;i++) data[i]=(Math.random()*2-1)*(1-i/len);
  var src=audio.createBufferSource(); src.buffer=buf;
  var f=audio.createBiquadFilter();
  f.type=kind||"bandpass"; f.Q.value=0.7;
  f.frequency.setValueAtTime(Math.max(f0,50), when);
  if(f1 && f1>0) f.frequency.exponentialRampToValueAtTime(Math.max(f1,50), when+dur*0.8);
  var g=env(when, peak, dur);
  src.connect(f); f.connect(g); g.connect(target||dest()); src.start(when); src.stop(when+dur+0.03);
}
function cue(name, level){
  if(!ensure() || mix.muteSfx) return;
  duck(0.45);
  var t=audio.currentTime, j=0.85+Math.random()*0.3, L=level|| (state.kings/4);
  if(name==="flip"){noise(t,0.12*j,0.45,400,2400); tone(180+Math.random()*40,"sine",t,0.1,0.3,700)}
  else if(name==="shuffle"){var k; for(k=0;k<5;k++) noise(t+k*0.05,0.06,0.35,300,1800)}
  else if(name==="whoosh"){noise(t,0.28*j,0.4,1600,240,"lowpass")}
  else if(name==="gulp"){tone(180,"sine",t,0.12*j,0.4,70); noise(t,0.08,0.2,200,600)}
  else if(name==="clink"){tone(1800+Math.random()*400,"sine",t,0.18,0.28); tone(2400,"triangle",t+0.02,0.12,0.12)}
  else if(name==="crack"){noise(t,0.09,0.6,800,3000); tone(90,"sine",t,0.1,0.35,40)}
  else if(name==="pour"){noise(t,0.35*j,0.35,500,900,"lowpass")}
  else if(name==="ice"){var n; for(n=0;n<3;n++) tone(2200+Math.random()*800,"square",t+n*0.05,0.04,0.12)}
  else if(name==="cheers"){tone(1600,"sine",t,0.16,0.3); tone(2100,"sine",t+0.08,0.18,0.25)}
  else if(name==="cupPour"){noise(t,0.3+L*0.7,0.3+L*0.35,280,700,"lowpass"); tone(90+L*40,"sine",t,0.4,0.2)}
  else if(name==="heavyPour"){noise(t,1.1,0.55,180,500,"lowpass"); tone(55,"sawtooth",t,0.8,0.18,40)}
  else if(name==="sting"){tone(220,"sawtooth",t,0.45,0.28,70); tone(277,"square",t,0.4,0.18,80); tone(330,"triangle",t+0.05,0.5,0.16); noise(t,0.2,0.4,100,800)}
  else if(name==="cheer"){noise(t,0.35,0.35,800,2500); tone(523,"square",t,0.15,0.2); tone(659,"square",t+0.08,0.15,0.18); tone(784,"triangle",t+0.16,0.2,0.16)}
  else if(name==="ooh"){tone(440,"sine",t,0.35,0.22,660); tone(554,"sine",t+0.05,0.3,0.12)}
  else if(name==="gasp"){noise(t,0.18,0.4,1200,3000); tone(880,"sine",t,0.12,0.2,1400)}
  else if(name==="boo"){tone(196,"sawtooth",t,0.4,0.22,110); noise(t,0.3,0.25,200,600)}
  else if(name==="applause"){var a; for(a=0;a<8;a++) noise(t+a*0.04,0.05,0.28,1000,4000)}
  else if(name==="laugh"){var q; for(q=0;q<4;q++){noise(t+q*0.09,0.07,0.3,600,1800); tone(300+q*20,"triangle",t+q*0.09,0.08,0.12)}}
  else if(name==="chant"){tone(196,"square",t,0.12,0.25); tone(196,"square",t+0.2,0.12,0.25); tone(262,"square",t+0.4,0.16,0.22)}
}
function fire(moment, level){
  var list=TRIGGERS[moment]||[];
  list.forEach(function(name){try{cue(name, level)}catch(e){}});
}
function say(line){
  if(mix.muteVoice || !line || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
  try{
    var u=new SpeechSynthesisUtterance(line);
    u.rate=1.08; u.pitch=1.12; u.volume=Math.max(0, Math.min(1, mix.voice));
    u.onstart=function(){duck(1.4)};
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }catch(e){}
}
function startAmbience(){
  try{
    var len=audio.sampleRate*2, buf=audio.createBuffer(1, len, audio.sampleRate), data=buf.getChannelData(0), i;
    for(i=0;i<len;i++) data[i]=Math.random()*2-1;
    ambience=audio.createBufferSource(); ambience.buffer=buf; ambience.loop=true;
    var f=audio.createBiquadFilter(); f.type="lowpass"; f.frequency.value=420;
    var g=audio.createGain(); g.gain.value=0.035;
    ambience.connect(f); f.connect(g); g.connect(musicGain);
    ambience.start();
  }catch(e){}
}
function kick(t){tone(150,"sine",t,0.12,0.45,48,musicGain)}
function hat(t){noise(t,0.03,0.12,5000,8000,"highpass",musicGain)}
function snare(t){noise(t,0.1,0.22,1800,4000,null,musicGain)}
function startMusic(){
  if(!ensure() || timer) return;
  nextTime=audio.currentTime+0.05; step=0;
  timer=setInterval(function(){
    if(!audio) return;
    var bpm=SOUNDS.music.bpm + state.kings*SOUNDS.music.hypePerKing;
    var eighth=60/bpm/2;
    while(nextTime < audio.currentTime+0.22){
      var s=step%8;
      if(s%2===0) hat(nextTime);
      if(s===0||s===4) kick(nextTime);
      if(s===2||s===6) snare(nextTime);
      if(s%2===0) tone(55*(s===4?1.5:1),"square",nextTime,0.12,0.18,0,musicGain);
      if(s===0){tone(262,"triangle",nextTime,0.14,0.08+state.kings*0.02,0,musicGain); tone(330,"triangle",nextTime,0.14,0.06,0,musicGain); pulse()}
      nextTime+=eighth; step++;
    }
    if(duckUntil && audio.currentTime>duckUntil){duckUntil=0; musicGain.gain.setTargetAtTime(musicLevel(), audio.currentTime, 0.08)}
  }, 40);
}
function pulse(){var el=$("lights"); if(!el) return; el.classList.add("on"); setTimeout(function(){el.classList.remove("on")}, 90)}
function unlock(){try{ensure(); startMusic(); if(window.TPSound) TPSound.unlock()}catch(e){}}

function paintPlayers(){
  var box=$("plist"); if(!box) return; box.textContent="";
  state.players.forEach(function(p){
    var row=document.createElement("div"); row.className="prow boardrow";
    var label=document.createElement("span"); label.textContent=p.name+" · "+p.gender;
    var x=document.createElement("button"); x.type="button"; x.className="x"; x.textContent="×"; x.setAttribute("data-act","remove"); x.setAttribute("data-id", p.id); x.setAttribute("aria-label","Remove "+p.name);
    row.appendChild(label); row.appendChild(x); box.appendChild(row);
  });
  var start=$("start");
  if(start) start.disabled=!(state.optin && state.players.length>=2);
  $("setupmsg").textContent=state.players.length<2?"Add 2 to 10 players.":state.players.length+" players";
}
function paintScores(){
  var box=$("scores"); if(!box) return; box.textContent="";
  state.players.forEach(function(p, i){
    var row=document.createElement("div"); row.className="prow boardrow";
    if(state.phase!=="setup" && i===state.turn) row.style.background="#ff2d87";
    var name=document.createElement("span"); name.textContent=p.name;
    var meta=document.createElement("b"); meta.textContent=p.cards+" cards · "+p.points+" pts";
    row.appendChild(name); row.appendChild(meta); box.appendChild(row);
  });
}
function paintRules(){
  var m=$("mates"); m.textContent="";
  var h=document.createElement("p"); h.textContent=state.mates.length?"Mates match once. It does not bounce back.":"Mates: none yet.";
  m.appendChild(h);
  state.mates.forEach(function(pair){
    var a=byId(pair[0]), b=byId(pair[1]);
    if(!a||!b) return;
    var p=document.createElement("p"); p.textContent=a.name+" ↔ "+b.name; m.appendChild(p);
  });
  var house=$("house"); house.textContent="";
  var title=document.createElement("p"); title.textContent=state.house.length?"House rules (one at a time, nothing stacks):":"House rules: none yet.";
  house.appendChild(title);
  state.house.forEach(function(rule, i){
    var row=document.createElement("div"); row.className="prow";
    var s=document.createElement("span"); s.textContent=rule;
    var x=document.createElement("button"); x.type="button"; x.className="x"; x.textContent="×"; x.setAttribute("data-drop", String(i)); x.setAttribute("aria-label","Clear rule");
    row.appendChild(s); row.appendChild(x); house.appendChild(row);
  });
  var d=$("darelist"); d.textContent="";
  var dp=document.createElement("p"); dp.textContent="Dare list (the cup does not hold a drink):";
  d.appendChild(dp);
  state.dares.forEach(function(dare){var p=document.createElement("p"); p.textContent=dare; d.appendChild(p)});
}
function fillCup(){
  var span=$("cupfill"); if(!span) return;
  span.style.height=(Math.min(state.kings,4)*25)+"%";
  $("cuplabel").textContent=Math.min(state.kings,4)+"/4";
}
function lineFor(card){
  if(card.r==="K" && state.kings>=4) return "One small sip or do a dare from the cup. No downing a cup.";
  return RULES[card.r].line;
}
function showCard(){
  var card=state.card, rule=RULES[card.r], suit=suitOf(card.s);
  var face=$("card");
  face.classList.toggle("red", !!suit.red);
  face.classList.remove("kc-card"); void face.offsetWidth; face.classList.add("kc-card");
  $("cardsuit").textContent=suit.sym+"  "+card.r;
  $("cardrank").textContent=card.r;
  $("ruletitle").textContent=rule.title;
  $("rulebody").textContent=rule.body;
  var who="";
  if(card.r==="5") who="In this group: "+(group("guys").map(function(p){return p.name}).join(", ") || "nobody — the whole table waves instead.");
  if(card.r==="6") who="In this group: "+(group("girls").map(function(p){return p.name}).join(", ") || "nobody — the whole table waves instead.");
  if(state.echo){var mate=byId(state.echo); who=mate? mate.name+" matches once. It does not pass back." : who}
  $("who").textContent=who;
  $("sipline").textContent=lineFor(card);
  var extra=$("extra"); extra.textContent="";
  if(state.phase!=="echo" && card.r==="8"){
    state.players.forEach(function(p){
      if(p.id===player().id) return;
      var b=document.createElement("button"); b.type="button"; b.className="btn alt"; b.textContent="Mate with "+p.name; b.setAttribute("data-mate", p.id);
      extra.appendChild(b);
    });
  }
  if(state.phase!=="echo" && card.r==="9"){
    var seed=RHYMES[state.idx.rhyme % RHYMES.length];
    var p=document.createElement("p"); p.textContent="Seed word: "+seed;
    var b=document.createElement("button"); b.type="button"; b.className="btn alt"; b.textContent="Another word"; b.setAttribute("data-act","another");
    extra.appendChild(p); extra.appendChild(b);
  }
  if(state.phase!=="echo" && card.r==="10"){
    var cat=CATS[state.idx.cat % CATS.length];
    var p=document.createElement("p"); p.textContent="Category: "+cat;
    var b=document.createElement("button"); b.type="button"; b.className="btn alt"; b.textContent="Another category"; b.setAttribute("data-act","another");
    extra.appendChild(p); extra.appendChild(b);
  }
  if(state.phase!=="echo" && card.r==="Q"){
    var q=document.createElement("p"); q.textContent=QUESTIONS[state.idx.q % QUESTIONS.length];
    var b=document.createElement("button"); b.type="button"; b.className="btn alt"; b.textContent="Another question"; b.setAttribute("data-act","another");
    extra.appendChild(q); extra.appendChild(b);
  }
  if(state.phase!=="echo" && card.r==="J"){
    var input=document.createElement("input"); input.id="jackrule"; input.className="bigin"; input.maxLength=80; input.placeholder="A silly rule for the table"; input.setAttribute("aria-label","House rule");
    extra.appendChild(input);
  }
  if(card.r==="K" && state.kings>=4){
    var dare=state.dares[state.idx.dare % state.dares.length];
    var p=document.createElement("p"); p.textContent="Dare from the cup: "+dare;
    extra.appendChild(p);
  }
  $("shown").classList.remove("hide");
  $("draw").classList.add("hide");
}
function render(){
  document.body.dataset.phase=state.phase;
  document.body.dataset.kings=String(state.kings);
  document.body.dataset.left=String(state.deck.length);
  var setup=state.phase==="setup";
  $("setup").classList.toggle("hide", !setup);
  $("table").classList.toggle("hide", setup);
  if(setup){paintPlayers(); var saved=false; try{saved=!!localStorage.getItem(KEY)}catch(e){} $("resume").classList.toggle("hide", !saved); return}
  var p=player();
  $("turn").textContent=state.phase==="echo" && state.echo ? (byId(state.echo)||p).name+" matches once" : (p? p.name+" draws" : "");
  fillCup();
  paintScores();
  paintRules();
  var showing=state.phase==="shown" || state.phase==="echo" || state.phase==="finale";
  if(showing && state.card) showCard();
  else { $("shown").classList.add("hide"); $("draw").classList.remove("hide"); }
  $("draw").disabled=state.phase!=="draw" || !state.deck.length;
  var fin=state.phase==="finale";
  $("finale").classList.toggle("hide", !fin);
  if(fin){
    $("finalcopy").textContent="One small sip or do a dare from the cup. No downing a cup. Kings in the counter: "+state.kings+".";
    $("draw").classList.add("hide");
  }
  $("next").textContent=state.phase==="echo"?"Mate did it once":"We took one small sip";
}
function flash(){
  document.body.classList.remove("kc-flash");
  void document.body.offsetWidth;
  document.body.classList.add("kc-flash");
}
function shake(){
  document.body.classList.remove("kc-shake");
  void document.body.offsetWidth;
  document.body.classList.add("kc-shake");
}
function burst(n){
  var c=$("fx"); if(!c) return;
  c.width=window.innerWidth; c.height=window.innerHeight;
  var i;
  for(i=0;i<n;i++) parts.push({x:Math.random()*c.width, y:n>40?-20:c.height*0.35, vx:(Math.random()-0.5)*(n>40?8:4), vy:n>40?2+Math.random()*5:-3-Math.random()*3, life:1, color:i%2?"#ff2d87":"#111"});
  if(!raf) raf=requestAnimationFrame(frame);
}
function frame(){
  var c=$("fx"); if(!c){raf=0; return}
  var ctx=c.getContext("2d"); ctx.clearRect(0,0,c.width,c.height);
  parts=parts.filter(function(p){return p.life>0});
  parts.forEach(function(p){
    p.x+=p.vx; p.y+=p.vy; p.vy+=0.08; p.life-=0.015;
    ctx.globalAlpha=Math.max(p.life,0); ctx.fillStyle=p.color; ctx.fillRect(p.x,p.y,8,8);
  });
  ctx.globalAlpha=1;
  if(parts.length) raf=requestAnimationFrame(frame); else raf=0;
}
function deal(){
  state.deck=buildDeck();
  state.turn=0; state.kings=0; state.card=null; state.echo=null; state.phase="draw";
  state.mates=[]; state.house=[]; state.dares=SEED_DARES.slice();
  state.players.forEach(function(p){p.cards=0; p.points=0});
  unlock(); fire("shuffle"); say(LINES.start); save(); render();
}
function draw(){
  if(state.phase!=="draw" || !state.deck.length) return;
  unlock();
  var card=state.deck.pop();
  state.card=card;
  var p=player(); p.cards+=1; p.points+=1;
  if(card.r==="K") state.kings+=1;
  state.phase = (card.r==="K" && state.kings>=4) ? "finale" : "shown";
  if(card.r==="K" && state.kings<4){
    var extra="Invent a nickname for the person on your left.";
    if(state.dares.indexOf(extra)===-1) state.dares.push(extra);
  }
  save(); render();
  fire("draw");
  flash();
  burst(12);
  var rule=RULES[card.r];
  if(card.r==="A") fire("ace");
  if(card.r==="K" && state.kings>=4){fire("finalKing",1); say(LINES.finale); shake(); burst(90)}
  else if(card.r==="K"){fire("king", state.kings/4); say(rule.say)}
  else if(card.r==="J"){fire("jack"); say(rule.say)}
  else if(card.r==="Q"){fire("queen"); say(rule.say)}
  else if(card.r==="9"){fire("rhyme"); say(rule.say)}
  else if(card.r==="10"){fire("category"); say(rule.say)}
  else if(card.r==="8"){fire("mate"); say(rule.say)}
  else if(card.r==="4" || card.r==="7"){fire("floor"); say(rule.say)}
  else say(rule.say);
}
function finish(kind){
  var input=$("jackrule");
  if(input && input.value.trim()){
    var ruleText=input.value.trim().slice(0,80);
    if(state.house.indexOf(ruleText)===-1) state.house.push(ruleText);
    input.value="";
  }
  fire(kind==="alt"?"alt":"sip");
  if(state.phase==="finale"){save(); render(); return}
  if(state.echo){state.echo=null; advance(); return}
  var me=player();
  var mate=me?mateOf(me.id):null;
  if(mate){
    state.echo=mate; state.phase="echo";
    save(); render(); say("Mate!"); fire("mate"); return;
  }
  advance();
}
function advance(){
  state.echo=null; state.card=null;
  if(!state.deck.length){state.phase="finale"; save(); render(); return}
  state.phase="draw";
  state.turn=(state.turn+1)%state.players.length;
  save(); render();
}
function addPlayer(name, gender){
  name=String(name||"").trim().slice(0,20);
  if(!name || state.players.length>=10) return;
  state.players.push({id:uid(), name:name, gender:gender||"everyone", cards:0, points:0});
  save(); paintPlayers();
}
function bootSaved(){
  try{
    var raw=JSON.parse(localStorage.getItem(KEY)||"null");
    if(raw && raw.players && raw.players.length){state=raw; if(!state.idx) state.idx={rhyme:0,cat:0,q:0,dare:0}}
  }catch(e){state=blank()}
}
function wire(){
  $("optin").addEventListener("change", function(){state.optin=$("optin").checked; if(state.phase==="setup") paintPlayers()});
  $("addform").addEventListener("submit", function(e){e.preventDefault(); addPlayer($("pname").value, $("pgender").value); $("pname").value=""; $("pname").focus()});
  $("start").addEventListener("click", function(){if(state.players.length<2 || !state.optin) return; deal()});
  $("resume").addEventListener("click", function(){if(state.phase==="setup") state.phase=state.deck.length?"draw":"finale"; unlock(); render()});
  $("draw").addEventListener("click", draw);
  $("next").addEventListener("click", function(){finish("sip")});
  $("altdone").addEventListener("click", function(){finish("alt")});
  $("newdeck").addEventListener("click", function(){deal()});
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
  $("mutevoice").addEventListener("change", function(){mix.muteVoice=$("mutevoice").checked; saveMix(); if(mix.muteVoice && window.speechSynthesis){try{window.speechSynthesis.cancel()}catch(e){}}});
  document.addEventListener("click", function(e){
    var t=e.target; if(t && t.nodeType!==1) t=t.parentElement;
    if(!t || !t.closest) return;
    var b=t.closest("[data-act],[data-mate],[data-emo],[data-drop],[data-id]");
    if(!b) return;
    unlock();
    if(b.dataset.act==="remove" && state.phase==="setup"){state.players=state.players.filter(function(p){return p.id!==b.dataset.id}); save(); paintPlayers()}
    else if(b.dataset.act==="another" && state.card){
      var key=state.card.r==="9"?"rhyme":state.card.r==="10"?"cat":"q";
      state.idx[key]=(state.idx[key]||0)+1; save(); showCard();
    }
    else if(b.dataset.mate){setMate(player().id, b.dataset.mate); save(); paintRules(); fire("mate")}
    else if(b.dataset.drop!=null && b.dataset.drop!==""){state.house.splice(+b.dataset.drop,1); save(); paintRules()}
    else if(b.dataset.emo){
      var map={"👏":"clap","😮":"gasp","😂":"rhyme","👎":"boo","🎉":"ace"};
      fire(map[b.dataset.emo]||"reaction");
      var flo=document.createElement("div"); flo.className="kc-float"; flo.textContent=b.dataset.emo;
      flo.style.left=(b.getBoundingClientRect().left)+"px"; flo.style.top="46%";
      document.body.appendChild(flo); setTimeout(function(){flo.remove()},1000);
    }
  });
  var mute=$("mute");
  if(window.TPSound && mute) TPSound.bindMute(mute);
  if(mute) mute.addEventListener("click", function(){if(window.TPSound && !TPSound.enabled()){mix.muteSfx=true; mix.muteMusic=true} else if(window.TPSound && TPSound.enabled()){mix.muteSfx=false; mix.muteMusic=false} saveMix(); applyMix()});
  $("mixmusic").value=Math.round(mix.music*100);
  $("mixsfx").value=Math.round(mix.sfx*100);
  $("mixvoice").value=Math.round(mix.voice*100);
  $("mutemusic").checked=!!mix.muteMusic;
  $("mutesfx").checked=!!mix.muteSfx;
  $("mutevoice").checked=!!mix.muteVoice;
  $("optin").checked=!!state.optin;
  window.addEventListener("pointerdown", unlock, {once:false, passive:true});
}
bootSaved();
if(state.phase!=="setup" && (!state.deck || !state.players || !state.players.length)) state=blank();
wire();
render();
})();
