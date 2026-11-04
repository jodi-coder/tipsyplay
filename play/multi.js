(function(){
var ALPHABET="ABCDEFGHJKMNPQRSTUVWXYZ";
var TTL=8*60*60*1000;
var GAME=null;
var $=function(id){return document.getElementById(id)};
var uid=null,code=null,meta=null,players={},db=null,authObj=null;
var answered={},noteMap={},tallyMap={},sealedMap={},answerMap={},callMap={},revealedMap={},strokes={},secret=null;
var stops=[],roundStops=[],sharedStops=[],revealStops={},revealedStop=null,seq=0,seqRound="",sending=false,built="",revealLock="",actionLock=false;
var pend=[],flushTimer=0,lastSend=0,drawing=false,localTally=-1;
var timerFor="",tickTimer=0,endTimer=0,roundEnds=0,secretSent="";
var initializeApp,getAuth,signInAnonymously,getDatabase,ref,onValue,update,set,remove,onDisconnect,get,serverTimestamp,goOnline;
var connectAuthEmulator,connectDatabaseEmulator;

function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n}
function motionOk(){return !(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches)}
function emuOn(){return /[?&]emulator=1(?:&|$)/.test(location.search)}
function normName(v){return String(v||"").trim().slice(0,20)}
function normCode(v){
 var up=String(v||"").toUpperCase();
 var q=up.match(/[?&]CODE=([ABCDEFGHJKMNPQRSTUVWXYZ]{4})/);
 if(q)return q[1];
 return up.replace(/[^ABCDEFGHJKMNPQRSTUVWXYZ]/g,"").slice(-4);
}
function validCode(c){return /^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(c)}
function makeCode(){var s="",i;for(i=0;i<4;i++)s+=ALPHABET[Math.floor(Math.random()*ALPHABET.length)];return s}
function asDeck(d){if(!d)return [];if(Array.isArray(d))return d;return Object.keys(d).sort(function(a,b){return (+a)-(+b)}).map(function(k){return d[k]})}
function shuffle(list){var a=list.slice(),i,j,t;for(i=a.length-1;i>0;i--){j=Math.floor(Math.random()*(i+1));t=a[i];a[i]=a[j];a[j]=t}return a}
function normWord(s){return String(s||"").toLowerCase().replace(/[^a-z0-9 ]+/g,"").replace(/\s+/g," ").trim()}
function gid(){return meta?meta.gameId:0}
function rnd(){return meta?meta.round:0}
function rpath(p){return "rooms/"+code+"/"+p}
function fail(msg){var p=$("perr");if(p)p.textContent=msg||""}
function friendly(e){
 var c=String((e&&(e.code||e.message))||"");
 if(/permission|denied/i.test(c))return "That room isn't available.";
 if(/offline|network|fetch/i.test(c))return "You're offline.";
 return "Something went wrong. Try again.";
}
function showOffline(detail){$("connecting").classList.add("hide");$("app").classList.add("hide");$("offline").classList.remove("hide");$("offdetail").textContent=detail||""}
function showApp(){$("connecting").classList.add("hide");$("offline").classList.add("hide");$("app").classList.remove("hide")}
function screen(id){["home","lobby","stage","over"].forEach(function(s){var n=$(s);if(n)n.classList.toggle("hide",s!==id)})}
function isHost(){return !!(meta&&uid&&meta.hostUid===uid)}
function playerList(){
 return Object.keys(players).map(function(id){
  return {uid:id,name:players[id].name||"Player",connected:players[id].connected!==false,joinedAt:players[id].joinedAt||0};
 }).sort(function(a,b){return a.joinedAt-b.joinedAt||a.name.localeCompare(b.name)});
}
function actor(){var list=playerList();if(!meta||!list.length)return null;return list[meta.round%list.length]}
function isActor(){var a=actor();return !!(a&&a.uid===uid)}
function pname(id){return (players[id]&&players[id].name)||"Player"}
function teamName(id){var list=playerList(),i;for(i=0;i<list.length;i++)if(list[i].uid===id)return i%2===0?"Yellow":"Pink";return "Yellow"}
function roomUrl(c){
 var base=/localhost|127\.0\.0\.1/.test(location.host)?location.origin+location.pathname:"https://tipsyplay.com/play/"+GAME.id+".html";
 return base+"?code="+c;
}
function fullMeta(patch){
 var m=Object.assign({},meta||{},patch||{});
 var out={hostUid:m.hostUid,createdAt:m.createdAt,status:m.status,phase:m.phase,spice:m.spice||"mild",rounds:+m.rounds,na:!!m.na,round:+m.round,gameId:+m.gameId,kind:m.kind||GAME.id};
 var deck=asDeck(m.deck);
 if(m.status!=="lobby"&&deck.length)out.deck=deck;
 if(m.endedAt&&m.status==="over")out.endedAt=m.endedAt;
 return out;
}
function writeMeta(patch){return update(ref(db),{[rpath("meta")]:fullMeta(patch)})}
function deckLine(){var d=meta?asDeck(meta.deck):[];return d[rnd()]||""}
function lineText(){return (meta&&meta.na)?GAME.alt:GAME.line}
function loadWords(){try{var raw=sessionStorage.getItem("tp_draw_"+code);if(!raw)return null;var o=JSON.parse(raw);if(!meta||o.gameId!==meta.gameId)return null;return o.words||null}catch(e){return null}}
function myPlayer(name){return {name:name,connected:true,joinedAt:Date.now()}}
function splitLines(s){var p=String(s||"").split("|");while(p.length<3)p.push("");return p.slice(0,3)}
function roundMap(map){return (map&&meta)?(map[rnd()]||{}):{}}

function scores(){
 var totals={},list=playerList(),r;
 list.forEach(function(p){totals[p.uid]=0});
 if(!meta)return totals;
 for(r=0;r<meta.rounds;r++)if(revealedMap[r])scoreRound(totals,r,list);
 return totals;
}
function scoreRound(totals,r,list){
 var kind=GAME.kind,actorP=list.length?list[r%list.length]:null,notes=noteMap[r]||{},sealed=sealedMap[r]||{},ans=answerMap[r]||{},tally=tallyMap[r]||{};
 if(kind==="story"){
  list.forEach(function(p){if(notes[p.uid]&&notes[p.uid]!=="(pass)")totals[p.uid]++});
 }else if(kind==="vote"){
  var counts={},best=0,winners=[],id;
  Object.keys(sealed).forEach(function(pid){var target=sealed[pid];if(target&&target!=="pass"&&Object.prototype.hasOwnProperty.call(totals,target))counts[target]=(counts[target]||0)+1});
  Object.keys(counts).forEach(function(pid){if(counts[pid]>best){best=counts[pid];winners=[pid]}else if(counts[pid]===best)winners.push(pid)});
  if(winners.length===1&&best)totals[winners[0]]++;
 }else if(kind==="court"){
  var g=0,f=0,side="";
  Object.keys(sealed).forEach(function(pid){if(sealed[pid]==="guilty")g++;else if(sealed[pid]==="free")f++});
  if(g>f)side="guilty";else if(f>g)side="free";
  if(side){
   Object.keys(sealed).forEach(function(pid){if(sealed[pid]===side)totals[pid]++});
   if(side==="free"&&actorP)totals[actorP.uid]++;
   if(side==="guilty"&&meta.na&&actorP)totals[actorP.uid]=Math.max(0,(totals[actorP.uid]||0)-1);
  }
 }else if(kind==="flip"){
  list.forEach(function(p){
   if(notes[p.uid]==="(pass)"||!Object.prototype.hasOwnProperty.call(ans,p.uid)||!callMap[r])return;
   var red=ans[p.uid]===true;
   if((red&&callMap[r]==="red")||(!red&&callMap[r]==="black"))totals[p.uid]++;
  });
 }else if(kind==="toss"){
  if(actorP&&ans[actorP.uid]===true)totals[actorP.uid]++;
 }else if(kind==="category"){
  if(actorP)totals[actorP.uid]+=(+tally[actorP.uid]||0);
 }else if(kind==="truths"){
  var fib=actorP?sealed[actorP.uid]:"";
  list.forEach(function(p){
   if(!actorP||p.uid===actorP.uid)return;
   if(sealed[p.uid]&&fib&&sealed[p.uid]===fib)totals[p.uid]++;
   else if(sealed[p.uid]&&sealed[p.uid]!=="pass"&&fib)totals[actorP.uid]++;
  });
 }else if(kind==="draw"){
  var word=normWord(callMap[r]||""),hit=false;
  list.forEach(function(p){
   if(!word||(actorP&&p.uid===actorP.uid))return;
   if(normWord(notes[p.uid])===word){totals[p.uid]++;hit=true}
  });
  if(hit&&actorP)totals[actorP.uid]++;
 }else if(kind==="rule"){
  list.forEach(function(p){if(notes[p.uid]==="(pass)")return;if(ans[p.uid]===false)totals[p.uid]++});
 }
}
function roundReady(){
 var r=rnd(),kind=GAME.kind,notes=noteMap[r]||{},sealed=sealedMap[r]||{},ans=answerMap[r]||{};
 if(kind==="vote"||kind==="court"||kind==="truths")return needed().every(function(p){return !!sealed[p.uid]});
 if(kind==="flip")return !!callMap[r]&&needed().every(function(p){return notes[p.uid]==="(pass)"||Object.prototype.hasOwnProperty.call(ans,p.uid)});
 if(kind==="rule")return needed().every(function(p){return notes[p.uid]==="(pass)"||Object.prototype.hasOwnProperty.call(ans,p.uid)});
 if(kind==="toss"){var a=actor();return !!(a&&Object.prototype.hasOwnProperty.call(ans,a.uid))}
 if(kind==="story")return needed().every(function(p){return !!notes[p.uid]});
 if(kind==="draw")return !!callMap[r];
 return true;
}
function resultLine(){
 if(!roundReady())return "Tallying…";
 var r=rnd(),list=playerList(),actorP=actor(),notes=noteMap[r]||{},sealed=sealedMap[r]||{},ans=answerMap[r]||{},tally=tallyMap[r]||{};
 if(GAME.kind==="story"){
  return list.map(function(p){return p.name+": "+(notes[p.uid]||"(pass)")}).join(" ");
 }
 if(GAME.kind==="vote"){
  var counts={};
  Object.keys(sealed).forEach(function(pid){var target=sealed[pid];if(!target||target==="pass")return;counts[target]=(counts[target]||0)+1});
  var bits=Object.keys(counts).sort(function(a,b){return counts[b]-counts[a]}).map(function(id){return pname(id)+" "+counts[id]});
  return bits.length?bits.join(" · "):"Everyone passed.";
 }
 if(GAME.kind==="court"){
  var g=0,f=0;
  Object.keys(sealed).forEach(function(pid){if(sealed[pid]==="guilty")g++;else if(sealed[pid]==="free")f++});
  var verdict=g>f?"Guilty":f>g?"Not guilty":"Hung jury";
  return (actorP?actorP.name+" is on the stand. ":"")+verdict+" · "+g+" guilty, "+f+" not guilty.";
 }
 if(GAME.kind==="flip"){
  var call=callMap[r]||"…";
  var wrong=list.filter(function(p){if(notes[p.uid]==="(pass)"||!Object.prototype.hasOwnProperty.call(ans,p.uid))return false;var red=ans[p.uid]===true;return (red&&call==="black")||(!red&&call==="red")}).map(function(p){return p.name});
  return "The flip is "+call+". "+(wrong.length?wrong.join(", ")+" guessed wrong.":"Nobody missed.");
 }
 if(GAME.kind==="toss"){
  if(!actorP)return "";
  if(!Object.prototype.hasOwnProperty.call(ans,actorP.uid))return actorP.name+" has not tossed yet.";
  return actorP.name+(ans[actorP.uid]?" sank it. 1 point.":" missed. 0 points.");
 }
 if(GAME.kind==="category"){
  return (actorP?actorP.name:"They")+" named "+((actorP&&tally[actorP.uid])||0)+".";
 }
 if(GAME.kind==="truths"){
  var parts=splitLines(actorP?notes[actorP.uid]:""),fib=actorP?sealed[actorP.uid]:"";
  var n=+fib,fibText=n?String(parts[n-1]).replace(/\.+$/,""):"hidden";
  return "The fib was "+fibText+".";
 }
 if(GAME.kind==="draw"){
  var word=callMap[r]||(secret&&secret.word)||"";
  var who=list.filter(function(p){return actorP&&p.uid!==actorP.uid&&word&&normWord(notes[p.uid])===normWord(word)}).map(function(p){return p.name});
  return "The word was "+word+". "+(who.length?who.join(", ")+" got it.":"Nobody guessed it.");
 }
 if(GAME.kind==="rule"){
  var slipped=list.filter(function(p){return ans[p.uid]===true}).map(function(p){return p.name});
  return slipped.length?slipped.join(", ")+" slipped.":"Nobody slipped.";
 }
 return "";
}
function liveLine(){
 var list=playerList(),a=actor();
 if(GAME.kind==="story"){
  var notes=roundMap(noteMap);
  var bits=list.filter(function(p){return notes[p.uid]&&notes[p.uid]!=="(pass)"}).map(function(p){return p.name+": "+notes[p.uid]});
  return bits.join(" ");
 }
 if(GAME.kind==="draw"){
  var notes=roundMap(noteMap);
  var bits=list.filter(function(p){return notes[p.uid]}).map(function(p){return p.name+": "+notes[p.uid]});
  return bits.join(" ");
 }
 if(GAME.kind==="category"){
  var n=a?((roundMap(tallyMap)[a.uid])||0):0;
  return (a?a.name:"Someone")+" has named "+n+".";
 }
 var need=needed().filter(function(p){return !answered[p.uid]}).map(function(p){return p.name});
 if(!need.length)return "Everyone's in.";
 return "Waiting for "+need.join(", ")+".";
}
function needed(){
 var list=playerList(),a=actor();
 if(!list.length)return [];
 if(GAME.kind==="toss"||GAME.kind==="category")return a?[a]:[];
 if(GAME.kind==="court")return list.filter(function(p){return !a||p.uid!==a.uid});
 if(GAME.kind==="draw")return [];
 return list;
}
function clockBit(){
 if(!roundEnds||!meta||meta.phase!=="answer")return "";
 var s=Math.max(0,Math.ceil((roundEnds-Date.now())/1000));
 return " · "+s+"s";
}
function paintHost(){
 document.body.classList.toggle("is-host",isHost());
 document.querySelectorAll(".hostonly").forEach(function(n){n.classList.toggle("hide",!isHost())});
 document.querySelectorAll(".guestonly").forEach(function(n){n.classList.toggle("hide",isHost())});
}
function paintLobby(){
 $("codebig").textContent=code||"";
 $("sharelink").textContent=roomUrl(code);
 var box=$("plist");box.textContent="";
 playerList().forEach(function(p){var d=el("div",p.connected?"prow":"prow off",p.name+(p.connected?"":" (away)"));box.appendChild(d)});
 document.querySelectorAll("#orounds .chip").forEach(function(b){b.setAttribute("aria-pressed",String(+b.dataset.r===+meta.rounds));b.disabled=!isHost()});
 $("ona").checked=!!meta.na;$("ona").disabled=!isHost();
 var start=$("startbtn");
 if(start)start.disabled=!isHost()||playerList().length<2;
}
function paintBoard(){
 var box=$("board");if(!box)return;box.textContent="";
 var sc=scores();
 playerList().forEach(function(p){
  var d=el("div","prow boardrow");
  d.appendChild(el("span",null,p.name));
  d.appendChild(el("b",null,String(sc[p.uid]||0)));
  box.appendChild(d);
 });
}
function paintStage(){
 var a=actor();
 $("turn").textContent=a?(GAME.kind==="draw"?teamName(a.uid)+" draws · "+a.name:a.name+"'s turn"):"";
 if(GAME.kind!=="draw"&&GAME.kind!=="toss"&&GAME.kind!=="category"&&GAME.kind!=="court"&&GAME.kind!=="truths")$("turn").textContent="Round "+(rnd()+1)+" of "+meta.rounds;
 if(GAME.kind==="court")$("turn").textContent=a?a.name+" is on the stand":"";
 if(GAME.kind==="truths")$("turn").textContent=a?a.name+" is telling":"";
 if(GAME.kind==="toss"||GAME.kind==="category")$("turn").textContent=a?a.name+"'s turn":"";
 $("lvl").textContent="Round "+(rnd()+1)+" of "+meta.rounds+clockBit();
 if(GAME.kind==="draw"){
  if(isActor()&&secret&&secret.word)$("prompt").textContent=secret.word;
  else if(isActor())$("prompt").textContent="Picking a word…";
  else $("prompt").textContent="Guess the sketch";
  $("ask").textContent=isActor()?"Draw it. No letters.":"One or two words.";
 }else{
  $("prompt").textContent=deckLine();
  $("ask").textContent=GAME.ask||"";
 }
 $("instr").textContent=lineText();
 $("said").textContent=meta.phase==="reveal"?resultLine():liveLine();
 var rev=$("revealbtn"),nxt=$("nextbtn");
 if(rev)rev.classList.toggle("hide",!(isHost()&&meta.phase==="answer"));
 if(nxt)nxt.classList.toggle("hide",!(isHost()&&meta.phase==="reveal"));
 paintBoard();
 var sig=[meta.status,meta.phase,meta.round,isActor()?"1":"0",answered[uid]?"1":"0",playerList().map(function(p){return p.uid}).join(","),GAME.kind==="truths"?(actor()&&(noteMap[rnd()]||{})[actor().uid]||""):""].join("|");
 if(sig!==built){built=sig;buildDock()}
 redraw();
 ensureSecret();
 armTimer();
 tryDrawReveal();
}
function paintOver(){
 var sc=scores(),list=playerList().slice().sort(function(a,b){return (sc[b.uid]||0)-(sc[a.uid]||0)});
 var box=$("final");box.textContent="";
 list.forEach(function(p){var li=el("li");li.appendChild(el("span",null,p.name));li.appendChild(el("span",null,String(sc[p.uid]||0)+" pts"));box.appendChild(li)});
 var top=list[0];
 $("crowns").textContent=top?(top.name+" leads with "+(sc[top.uid]||0)+" points. Sipping was always optional."):"Sipping was always optional.";
}
function btn(label,attrs,cls){
 var b=el("button",cls||"btn",label);
 b.type="button";
 Object.keys(attrs).forEach(function(k){b.setAttribute(k,attrs[k])});
 return b;
}
function buildDock(){
 var dock=$("dock");dock.textContent="";
 if(!meta||meta.status!=="play")return;
 if(meta.phase==="reveal"){
  dock.appendChild(el("p",null,"Round locked in. Host moves on when you're ready."));
  return;
 }
 var mine=!!answered[uid],a=actor();
 if(GAME.kind==="story"){
  if(mine){dock.appendChild(el("p",null,"Locked in."));return}
  var input=el("input","bigin linein");input.id="line";input.maxLength=80;input.placeholder="Your sentence";input.setAttribute("aria-label","Your sentence");
  dock.appendChild(input);
  var row=el("div","choice");
  row.appendChild(btn("Add it",{"data-act":"story"}));
  row.appendChild(btn("Pass",{"data-act":"pass"},"btn alt"));
  dock.appendChild(row);
  return;
 }
 if(GAME.kind==="vote"){
  if(mine){dock.appendChild(el("p",null,"Vote locked in."));return}
  playerList().forEach(function(p){dock.appendChild(btn(p.name,{"data-vote":p.uid}))});
  dock.appendChild(btn("Pass",{"data-act":"pass"},"btn alt"));
  return;
 }
 if(GAME.kind==="court"){
  if(isActor()){dock.appendChild(el("p",null,"Defend it in one breath. The others are voting."));return}
  if(mine){dock.appendChild(el("p",null,"Vote locked in."));return}
  var row=el("div","choice");
  row.appendChild(btn("Guilty",{"data-pick":"guilty"}));
  row.appendChild(btn("Not guilty",{"data-pick":"free"},"btn alt"));
  dock.appendChild(row);
  dock.appendChild(btn("Pass",{"data-act":"pass"},"btn alt"));
  return;
 }
 if(GAME.kind==="flip"){
  if(mine){dock.appendChild(el("p",null,"Guess locked in."));return}
  var row=el("div","choice");
  row.appendChild(btn("Red",{"data-pick":"red"}));
  row.appendChild(btn("Black",{"data-pick":"black"},"btn alt"));
  dock.appendChild(row);
  dock.appendChild(btn("Pass",{"data-act":"pass"},"btn alt"));
  return;
 }
 if(GAME.kind==="toss"){
  if(!isActor()){dock.appendChild(el("p",null,(a?a.name:"They")+" is tossing. Cups are for points, not drinking."));return}
  if(mine){dock.appendChild(el("p",null,"Toss logged."));return}
  var row=el("div","choice");
  row.appendChild(btn("Hit",{"data-pick":"hit"}));
  row.appendChild(btn("Miss",{"data-pick":"miss"},"btn alt"));
  dock.appendChild(row);
  return;
 }
 if(GAME.kind==="category"){
  if(!isActor()){dock.appendChild(el("p",null,(a?a.name:"They")+" is naming things out loud."));return}
  if(mine){dock.appendChild(el("p",null,"Turn locked in."));return}
  var count=el("p","ask");count.id="count";count.textContent=String(localTally>=0?localTally:((roundMap(tallyMap)[uid])||0));
  dock.appendChild(count);
  var row=el("div","choice");
  row.appendChild(btn("+1 named",{"data-act":"plus"}));
  row.appendChild(btn("Done",{"data-act":"done"},"btn alt"));
  dock.appendChild(row);
  return;
 }
 if(GAME.kind==="truths"){
  if(isActor()){
   if(mine){dock.appendChild(el("p",null,"Your three lines are in."));return}
   [1,2,3].forEach(function(n){var input=el("input","bigin linein");input.id="t"+n;input.maxLength=60;input.placeholder="Statement "+n;input.setAttribute("aria-label","Statement "+n);dock.appendChild(input)});
   var fib=el("select","bigin");fib.id="fib";fib.setAttribute("aria-label","Which one is the fib");
   ["1","2","3"].forEach(function(n){var o=el("option",null,"Fib is statement "+n);o.value=n;fib.appendChild(o)});
   dock.appendChild(fib);
   dock.appendChild(btn("Share them",{"data-act":"truths"}));
   return;
  }
  var raw=a?(noteMap[rnd()]||{})[a.uid]:"";
  if(!raw){dock.appendChild(el("p",null,"Waiting for "+(a?a.name:"the storyteller")+" to write."));return}
  if(mine){dock.appendChild(el("p",null,"Guess locked in."));return}
  splitLines(raw).forEach(function(text,i){dock.appendChild(btn((i+1)+". "+text,{"data-fib":String(i+1)}))});
  dock.appendChild(btn("Pass",{"data-act":"pass"},"btn alt"));
  return;
 }
 if(GAME.kind==="draw"){
  var pad=el("canvas","sketchpad");pad.id="pad";pad.setAttribute("aria-label","Drawing");dock.appendChild(pad);
  fitPad(pad);bindPad(pad);
  if(isActor())dock.appendChild(btn("Clear",{"data-act":"clear"},"btn alt"));
  else if(!mine){
   var input=el("input","bigin linein");input.id="guess";input.maxLength=40;input.placeholder="Your guess";input.setAttribute("aria-label","Your guess");
   dock.appendChild(input);
   dock.appendChild(btn("Guess",{"data-act":"guess"}));
  }
  return;
 }
 if(GAME.kind==="rule"){
  if(mine){dock.appendChild(el("p",null,"Marked."));return}
  var row=el("div","choice");
  row.appendChild(btn("I kept it",{"data-pick":"kept"}));
  row.appendChild(btn("I slipped",{"data-pick":"slipped"},"btn alt"));
  dock.appendChild(row);
  dock.appendChild(btn("Pass",{"data-act":"pass"},"btn alt"));
 }
}
function fitPad(pad){
 var w=pad.clientWidth||320,h=240;
 pad.width=Math.floor(w*2);pad.height=h*2;
 pad.dataset.strokes="0";
}
function bindPad(pad){
 function point(e,down){
  if(!isActor()||!meta||meta.phase!=="answer")return;
  var rect=pad.getBoundingClientRect();
  if(!rect.width||!rect.height)return;
  var x=Math.max(0,Math.min(1,+((e.clientX-rect.left)/rect.width).toFixed(4)));
  var y=Math.max(0,Math.min(1,+((e.clientY-rect.top)/rect.height).toFixed(4)));
  var pt={x:x,y:y};if(down)pt.d=true;
  pend.push(pt);
  var now=Date.now();
  if(down||now-lastSend>=70)flushPoints();
  else if(!flushTimer)flushTimer=setTimeout(flushPoints,70);
 }
 pad.addEventListener("pointerdown",function(e){if(!isActor())return;e.preventDefault();drawing=true;try{pad.setPointerCapture(e.pointerId)}catch(err){}point(e,true)},{passive:false});
 pad.addEventListener("pointermove",function(e){if(!drawing)return;e.preventDefault();point(e,false)},{passive:false});
 function up(e){if(!drawing)return;drawing=false;point(e,false);flushPoints()}
 pad.addEventListener("pointerup",up);
 pad.addEventListener("pointercancel",up);
}
function flushPoints(){
 if(flushTimer){clearTimeout(flushTimer);flushTimer=0}
 if(!pend.length||!meta||!code)return;
 var batch=pend.splice(0,10),upd={},i;
 for(i=0;i<batch.length;i++){
  if(seq>9998)break;
  upd[rpath("strokes/"+gid()+"/"+rnd()+"/"+uid+"/"+seq)]=batch[i];
  seq++;
 }
 lastSend=Date.now();
 if(Object.keys(upd).length)update(ref(db),upd).catch(function(e){fail(friendly(e))});
}
function redraw(){
 var pad=$("pad");if(!pad)return;
 var ctx=pad.getContext("2d"),w=pad.width,h=pad.height,a=actor();
 ctx.clearRect(0,0,w,h);
 ctx.lineWidth=8;ctx.lineCap="round";ctx.lineJoin="round";ctx.strokeStyle="#111";
 var bag=(a&&strokes[a.uid])||{},keys=Object.keys(bag).sort(function(x,y){return (+x)-(+y)});
 ctx.beginPath();
 var started=false;
 keys.forEach(function(k){
  var p=bag[k];if(!p)return;
  var x=p.x*w,y=p.y*h;
  if(p.d||!started){ctx.moveTo(x,y);started=true}else ctx.lineTo(x,y);
 });
 ctx.stroke();
 pad.dataset.strokes=String(keys.length);
}
function render(){
 paintHost();
 document.body.dataset.phase=meta?meta.phase:"";
 if(!meta){screen("home");return}
 if(meta.kind&&meta.kind!==GAME.id){fail("That code is for a different game.");screen("home");return}
 if(meta.status==="lobby"){screen("lobby");paintLobby();built="";return}
 if(meta.status==="over"||meta.phase==="over"){screen("over");paintOver();built="";return}
 screen("stage");paintStage();
}
function armTimer(){
 if(!meta)return;
 var key=meta.gameId+":"+meta.round+":"+meta.phase;
 if(timerFor===key)return;
 timerFor=key;
 clearInterval(tickTimer);clearTimeout(endTimer);tickTimer=0;endTimer=0;roundEnds=0;
 if(meta.phase!=="answer")return;
 var ms=GAME.kind==="draw"?45000:GAME.kind==="category"?20000:0;
 if(!ms)return;
 roundEnds=Date.now()+ms;
 tickTimer=setInterval(function(){if($("lvl")&&meta){$("lvl").textContent="Round "+(rnd()+1)+" of "+meta.rounds+clockBit()}},250);
 if(GAME.kind==="draw"&&isHost())endTimer=setTimeout(revealNow,ms+50);
 if(GAME.kind==="category"&&isActor())endTimer=setTimeout(autoDone,ms+50);
}
function autoDone(){if(meta&&meta.phase==="answer"&&isActor()&&!answered[uid])sendAnswered()}
function ensureSecret(){
 if(!isHost()||GAME.kind!=="draw"||!meta||meta.phase!=="answer")return;
 var key=meta.gameId+":"+meta.round;
 if(secret&&secret.word){secretSent=key;return}
 if(secretSent===key)return;
 var list=playerList();if(!list.length)return;
 secretSent=key;
 var words=loadWords();
 var word=(words&&words[meta.round])||GAME.prompts[meta.round%GAME.prompts.length];
 var drawer=list[meta.round%list.length];
 update(ref(db),{[rpath("secret/"+meta.gameId+"/"+meta.round)]:{word:String(word).slice(0,40),drawer:drawer.uid}}).catch(function(e){secretSent="";fail(friendly(e))});
}
function tryDrawReveal(){
 if(GAME.kind!=="draw"||!isHost()||!meta||meta.phase!=="answer"||!secret||!secret.word)return;
 var notes=roundMap(noteMap),word=normWord(secret.word),hit=false,id;
 for(id in notes){if(id!==secret.drawer&&normWord(notes[id])===word)hit=true}
 if(hit)revealNow();
}
function maybeAuto(){
 if(!isHost()||!meta||meta.phase!=="answer"||GAME.kind==="draw")return;
 var need=needed();if(!need.length)return;
 if(need.every(function(p){return answered[p.uid]}))revealNow();
}
function revealNow(){
 if(!isHost()||!meta||meta.phase!=="answer")return;
 var key=meta.gameId+":"+meta.round;
 if(revealLock===key)return;
 revealLock=key;
 var payload={};
 payload[rpath("meta")]=fullMeta({phase:"reveal"});
 payload[rpath("revealed/"+meta.gameId+"/"+meta.round)]=true;
 if(GAME.kind==="flip")payload[rpath("call/"+meta.gameId+"/"+meta.round)]=Math.random()<0.5?"red":"black";
 if(GAME.kind==="draw")payload[rpath("call/"+meta.gameId+"/"+meta.round)]=String((secret&&secret.word)||"mystery").slice(0,40);
 update(ref(db),payload).then(function(){if(window.TPSound)TPSound.celebrate()}).catch(function(e){revealLock="";fail(friendly(e))});
}
function nextRound(){
 if(!isHost()||!meta||meta.phase!=="reveal")return;
 if(meta.round+1>=meta.rounds){writeMeta({status:"over",phase:"over",endedAt:Date.now()}).catch(function(e){fail(friendly(e))});return}
 var nr=meta.round+1;
 writeMeta({round:nr,phase:"answer"}).then(function(){
  if(GAME.kind!=="draw")return;
  var words=loadWords(),list=playerList();
  var word=(words&&words[nr])||GAME.prompts[nr%GAME.prompts.length];
  var drawer=list[nr%list.length];
  if(!drawer)return;
  return update(ref(db),{[rpath("secret/"+meta.gameId+"/"+nr)]:{word:String(word).slice(0,40),drawer:drawer.uid}});
 }).catch(function(e){fail(friendly(e))});
 if(window.TPSound)TPSound.card();
}
function send(map){
 if(sending)return;
 sending=true;
 var payload={};
 Object.keys(map).forEach(function(k){payload[rpath(k)]=map[k]});
 update(ref(db),payload).then(function(){sending=false;render()}).catch(function(e){sending=false;fail(friendly(e));render()});
}
function baseKeys(extra){
 var o={};o["answered/"+gid()+"/"+rnd()+"/"+uid]=true;return Object.assign(o,extra||{});
}
function sendAnswered(){send(baseKeys())}
function sendPass(){
 if(answered[uid]||!meta||meta.phase!=="answer")return;
 if(GAME.kind==="vote"||GAME.kind==="court"||GAME.kind==="truths")send(baseKeys((function(){var o={};o["sealed/"+gid()+"/"+rnd()+"/"+uid]="pass";return o})()));
 else send(baseKeys((function(){var o={};o["notes/"+gid()+"/"+rnd()+"/"+uid]="(pass)";return o})()));
}
function sendStory(){
 var input=$("line");if(!input)return;
 var v=input.value.trim().slice(0,80);if(!v){fail("Add a sentence or pass.");return}
 fail("");
 var o={};o["notes/"+gid()+"/"+rnd()+"/"+uid]=v;
 send(baseKeys(o));
 if(window.TPSound)TPSound.yes();
}
function sendVote(target){
 if(!target)return;
 var o={};o["sealed/"+gid()+"/"+rnd()+"/"+uid]=target;
 send(baseKeys(o));
 if(window.TPSound)TPSound.yes();
}
function sendPick(pick){
 if(GAME.kind==="court"){var o={};o["sealed/"+gid()+"/"+rnd()+"/"+uid]=pick;send(baseKeys(o))}
 else if(GAME.kind==="flip"){var o={};o["answers/"+gid()+"/"+rnd()+"/"+uid]=pick==="red";send(baseKeys(o))}
 else if(GAME.kind==="toss"){var o={};o["answers/"+gid()+"/"+rnd()+"/"+uid]=pick==="hit";send(baseKeys(o))}
 else if(GAME.kind==="rule"){var o={};o["answers/"+gid()+"/"+rnd()+"/"+uid]=pick==="slipped";send(baseKeys(o))}
 if(window.TPSound){if(pick==="hit"||pick==="red"||pick==="free"||pick==="kept")TPSound.yes();else TPSound.no()}
}
function sendTruths(){
 var a=$("t1"),b=$("t2"),c=$("t3"),f=$("fib");
 if(!a||!b||!c)return;
 var parts=[a.value,b.value,c.value].map(function(v){return v.trim().replace(/\|/g,"/").slice(0,60)});
 if(parts.some(function(v){return !v})){fail("Add all three lines.");return}
 fail("");
 var o={};o["notes/"+gid()+"/"+rnd()+"/"+uid]=parts.join("|");o["sealed/"+gid()+"/"+rnd()+"/"+uid]=(f&&f.value)||"1";
 send(baseKeys(o));
 if(window.TPSound)TPSound.card();
}
function sendFib(n){
 var o={};o["sealed/"+gid()+"/"+rnd()+"/"+uid]=String(n);
 send(baseKeys(o));
 if(window.TPSound)TPSound.yes();
}
function sendGuess(){
 var input=$("guess");if(!input)return;
 var v=input.value.trim().slice(0,40);if(!v)return;
 var o={};o["notes/"+gid()+"/"+rnd()+"/"+uid]=v;
 send(o);
 input.value="";
 if(window.TPSound)TPSound.yes();
}
function bump(){
 if(!meta||meta.phase!=="answer"||!isActor())return;
 var n=localTally>=0?localTally:((roundMap(tallyMap)[uid])||0);
 if(n>=40)return;
 localTally=n+1;
 var c=$("count");if(c)c.textContent=String(localTally);
 update(ref(db),{[rpath("tally/"+gid()+"/"+rnd()+"/"+uid)]:localTally}).catch(function(e){fail(friendly(e))});
 if(window.TPSound)TPSound.tick();
}
function clearPad(){
 pend=[];seq=0;
 remove(ref(db,rpath("strokes/"+gid()+"/"+rnd()+"/"+uid))).catch(function(e){fail(friendly(e))});
}
function stopAll(){stops.forEach(function(fn){fn()});stops=[];roundStops.forEach(function(fn){fn()});roundStops=[];sharedStops.forEach(function(fn){fn()});sharedStops=[];if(revealedStop)revealedStop();revealedStop=null;}
function watchRound(){
 roundStops.forEach(function(fn){fn()});roundStops=[];
 answered={};strokes={};localTally=-1;pend=[];
 if(!meta||meta.status==="lobby")return;
 var gameId=meta.gameId,round=meta.round;
 seqRound=gameId+":"+round;seq=0;
 roundStops.push(onValue(ref(db,rpath("answered/"+gameId+"/"+round)),function(s){
  if(!meta||meta.gameId!==gameId||meta.round!==round)return;
  answered=s.val()||{};render();maybeAuto();
 },function(){}));
 roundStops.push(onValue(ref(db,rpath("strokes/"+gameId+"/"+round)),function(s){
  if(!meta||meta.gameId!==gameId||meta.round!==round)return;
  strokes=s.val()||{};
  var mine=strokes[uid]||{},m=0;
  Object.keys(mine).forEach(function(k){if(+k>=m)m=+k+1});
  if(m>seq)seq=m;
  redraw();
 },function(){}));
 if(isHost()||isActor()){
  roundStops.push(onValue(ref(db,rpath("secret/"+gameId+"/"+round)),function(s){
   if(!meta||meta.gameId!==gameId||meta.round!==round)return;
   secret=s.val()||null;render();
  },function(){}));
 }else secret=null;
}
function watchRevealed(){
 if(revealedStop)revealedStop();
 revealedStop=null;revealedMap={};revealStops={};answerMap={};sealedMap={};callMap={};
 if(!meta)return;
 var gameId=meta.gameId;
 revealedStop=onValue(ref(db,rpath("revealed/"+gameId)),function(s){
  var map=s.val()||{};
  Object.keys(map).forEach(function(round){if(map[round]){revealedMap[round]=true;watchHidden(gameId,round)}});
  render();
 },function(){});
}
function watchHidden(gameId,round){
 var key=gameId+"/"+round;
 if(revealStops[key])return;
 revealStops[key]=true;
 onValue(ref(db,rpath("answers/"+key)),function(s){if(!meta||String(meta.gameId)!==String(gameId))return;answerMap[round]=s.val()||{};render()},function(){});
 onValue(ref(db,rpath("sealed/"+key)),function(s){if(!meta||String(meta.gameId)!==String(gameId))return;sealedMap[round]=s.val()||{};render()},function(){});
 onValue(ref(db,rpath("call/"+key)),function(s){if(!meta||String(meta.gameId)!==String(gameId))return;callMap[round]=s.val()||"";render()},function(){});
}
function watchShared(){
 sharedStops.forEach(function(fn){fn()});sharedStops=[];
 if(!meta)return;
 var gameId=meta.gameId;
 sharedStops.push(onValue(ref(db,rpath("notes/"+gameId)),function(s){
  noteMap={};
  var val=s.val()||{};
  Object.keys(val).forEach(function(round){noteMap[round]=val[round]||{}});
  render();tryDrawReveal();
 },function(){}));
 sharedStops.push(onValue(ref(db,rpath("tally/"+gameId)),function(s){
  tallyMap={};
  var val=s.val()||{};
  Object.keys(val).forEach(function(round){tallyMap[round]=val[round]||{}});
  if(meta&&tallyMap[meta.round]&&Object.prototype.hasOwnProperty.call(tallyMap[meta.round],uid))localTally=+tallyMap[meta.round][uid];
  var c=$("count");if(c&&localTally>=0)c.textContent=String(localTally);
  render();
 },function(){}));
}
function listenRoom(){
 stopAll();revealStops={};revealedMap={};noteMap={};tallyMap={};sealedMap={};answerMap={};callMap={};secret=null;secretSent="";
 var seen="";
 stops.push(onValue(ref(db,rpath("meta")),function(s){
  if(!s.exists()){clearRoom();fail("This room has closed.");screen("home");showApp();return}
  var prev=seen;
  meta=s.val();
  seen=meta.gameId+"/"+meta.round+"/"+meta.phase+"/"+meta.status;
  if(prev!==seen){watchRound();if(!prev||prev.split("/")[0]!==String(meta.gameId)){watchRevealed();watchShared()}}
  render();maybeAuto();
 },function(e){if(/permission|denied/i.test(String((e&&(e.code||e.message))||""))){clearRoom();fail("That room isn't available.");screen("home");showApp()}}));
 stops.push(onValue(ref(db,rpath("players")),function(s){players=s.val()||{};render();maybeAuto()},function(){}));
}
function clearRoom(){stopAll();code=null;meta=null;players={};sessionStorage.removeItem("tp_room")}
var connStop=null;
function armPresence(){
 if(connStop)connStop();
 connStop=onValue(ref(db,".info/connected"),function(s){
  if(!s.val()||!code||!uid)return;
  var p=ref(db,rpath("players/"+uid));
  onDisconnect(p).update({connected:false}).catch(function(){});
  update(p,{connected:true}).catch(function(){});
 });
}
async function ensureAuth(){if(authObj&&authObj.currentUser)await authObj.currentUser.getIdToken()}
async function hostRoom(name){
 await ensureAuth();
 var i,claimed=null;
 for(i=0;i<6;i++){
  var c=makeCode();
  var snap=await get(ref(db,"rooms/"+c+"/meta"));
  if(snap.exists())continue;
  try{
   await update(ref(db),{["rooms/"+c+"/meta"]:{hostUid:uid,createdAt:serverTimestamp(),status:"lobby",phase:"lobby",spice:"mild",rounds:5,na:false,round:0,gameId:1,kind:GAME.id}});
   claimed=c;break;
  }catch(e){if(!/permission/i.test(String(e.code||e.message||"")))throw e}
 }
 if(!claimed)throw new Error("room");
 await set(ref(db,"rooms/"+claimed+"/players/"+uid),myPlayer(name));
 code=claimed;sessionStorage.setItem("tp_room",code);
 listenRoom();armPresence();
}
async function joinRoom(c,name){
 await ensureAuth();
 var snap=await get(ref(db,"rooms/"+c+"/meta"));
 if(!snap.exists())throw new Error("missing");
 var m=snap.val();
 if(m.kind&&m.kind!==GAME.id)throw new Error("kind");
 if(m.createdAt&&Date.now()-m.createdAt>TTL)throw new Error("expired");
 if(m.status!=="lobby"){
  var mine=await get(ref(db,"rooms/"+c+"/players/"+uid));
  if(!mine.exists())throw new Error("closed");
 }
 await set(ref(db,"rooms/"+c+"/players/"+uid),myPlayer(name));
 code=c;sessionStorage.setItem("tp_room",code);
 listenRoom();armPresence();
}
function doHost(){
 var name=normName($("playername").value);
 if(!name){fail("Add your name first.");$("playername").focus();return}
 if(actionLock)return;
 actionLock=true;
 localStorage.setItem("tp_name",name);fail("");
 hostRoom(name).catch(function(e){fail(friendly(e))}).then(function(){actionLock=false});
}
function doJoin(){
 var name=normName($("playername").value);
 var c=normCode($("roomcode").value);
 if(!name){fail("Add your name first.");return}
 if(!validCode(c)){fail("Enter the 4-letter code.");return}
 if(actionLock)return;
 actionLock=true;
 localStorage.setItem("tp_name",name);fail("");
 joinRoom(c,name).catch(function(e){
  var msg=String((e&&e.message)||"");
  if(msg==="kind")fail("That code is for a different game.");
  else if(msg==="missing"||msg==="expired"||msg==="closed")fail("That room isn't available.");
  else fail(friendly(e));
 }).then(function(){actionLock=false});
}
function doStart(){
 if(!isHost()||!meta)return;
 if(playerList().length<2){fail("Need 2 players on their phones.");return}
 fail("");
 var rounds=+meta.rounds||5,deck,words;
 if(GAME.kind==="draw"){
  words=shuffle(GAME.prompts).slice(0,rounds);
  sessionStorage.setItem("tp_draw_"+code,JSON.stringify({gameId:meta.gameId,words:words}));
  deck=words.map(function(_,i){return "Sketch card "+(i+1)+". Guess in one or two words."});
 }else deck=shuffle(GAME.prompts).slice(0,rounds);
 writeMeta({status:"play",phase:"answer",round:0,deck:deck}).then(function(){if(window.TPSound)TPSound.card()}).catch(function(e){fail(friendly(e))});
}
function doAgain(){
 if(!isHost()||!meta)return;
 var nextId=meta.gameId>=100?1:meta.gameId+1;
 writeMeta({status:"lobby",phase:"lobby",round:0,gameId:nextId,deck:null,endedAt:null}).catch(function(e){fail(friendly(e))});
}
function closeRoom(){
 if(!isHost()||!code)return;
 remove(ref(db,"rooms/"+code)).then(function(){sessionStorage.removeItem("tp_room");location.href="../games/"+GAME.id+".html"}).catch(function(e){fail(friendly(e))});
}
function leaveRoom(){
 if(code&&uid)remove(ref(db,rpath("players/"+uid))).catch(function(){});
 sessionStorage.removeItem("tp_room");
 stopAll();code=null;meta=null;players={};screen("home");fail("");
}
function wire(){
 var saved=localStorage.getItem("tp_name");if(saved&&!$("playername").value)$("playername").value=saved;
 var q=normCode(location.search);if(q&&!$("roomcode").value)$("roomcode").value=q;
 document.addEventListener("click",function(e){
  var t=e.target;if(t&&t.nodeType!==1)t=t.parentElement;
  if(!t||!t.closest)return;
  var b=t.closest("[data-act],[data-vote],[data-pick],[data-fib],[data-r]");
  if(!b||b.disabled)return;
  var act=b.dataset.act;
  if(act==="host")doHost();
  else if(act==="join")doJoin();
  else if(act==="start")doStart();
  else if(act==="again")doAgain();
  else if(act==="close")closeRoom();
  else if(act==="leave")leaveRoom();
  else if(act==="home")location.href="../index.html";
  else if(act==="copy"){var url=roomUrl(code);if(navigator.clipboard)navigator.clipboard.writeText(url).then(function(){fail("Link copied.")}).catch(function(){fail(url)})}
  else if(act==="share"){var link=roomUrl(code);if(navigator.share)navigator.share({title:"TipsyPlay",text:"Join my "+GAME.title+" room "+code,url:link}).catch(function(){});else if(navigator.clipboard)navigator.clipboard.writeText(link)}
  else if(act==="rounds"&&isHost()&&meta&&meta.status==="lobby")writeMeta({rounds:+b.dataset.r}).catch(function(err){fail(friendly(err))});
  else if(act==="reveal")revealNow();
  else if(act==="next")nextRound();
  else if(act==="story")sendStory();
  else if(act==="pass")sendPass();
  else if(act==="truths")sendTruths();
  else if(act==="guess")sendGuess();
  else if(act==="plus")bump();
  else if(act==="done")sendAnswered();
  else if(act==="clear")clearPad();
  else if(b.dataset.vote)sendVote(b.dataset.vote);
  else if(b.dataset.pick)sendPick(b.dataset.pick);
  else if(b.dataset.fib)sendFib(b.dataset.fib);
 });
 $("joinform").addEventListener("submit",function(e){e.preventDefault();doJoin()});
 $("ona").addEventListener("change",function(){if(isHost()&&meta&&meta.status==="lobby")writeMeta({na:$("ona").checked}).catch(function(e){fail(friendly(e))})});
 var lineDock=$("dock");
 lineDock.addEventListener("keydown",function(e){if(e.key==="Enter"&&e.target&&e.target.id==="line"){e.preventDefault();sendStory()}if(e.key==="Enter"&&e.target&&e.target.id==="guess"){e.preventDefault();sendGuess()}});
 if(window.TPSound)TPSound.bindMute($("mute"));
}
function lockScreen(){if("wakeLock" in navigator)navigator.wakeLock.request("screen").then(function(){}).catch(function(){})}
document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible"&&meta&&meta.status==="play")lockScreen()});

async function boot(){
 GAME=window.PARTY&&window.PARTY[document.body.dataset.game];
 if(!GAME){showOffline("This game is missing its deck.");return}
 if(!navigator.onLine&&!emuOn()){showOffline();return}
 var base="https://www.gstatic.com/firebasejs/12.4.0/";
 var appMod=await import(base+"firebase-app.js");
 var authMod=await import(base+"firebase-auth.js");
 var dbMod=await import(base+"firebase-database.js");
 var cfg=await import("../firebase-config.js?v=16");
 initializeApp=appMod.initializeApp;getAuth=authMod.getAuth;signInAnonymously=authMod.signInAnonymously;connectAuthEmulator=authMod.connectAuthEmulator;
 getDatabase=dbMod.getDatabase;ref=dbMod.ref;onValue=dbMod.onValue;update=dbMod.update;set=dbMod.set;remove=dbMod.remove;onDisconnect=dbMod.onDisconnect;get=dbMod.get;serverTimestamp=dbMod.serverTimestamp;goOnline=dbMod.goOnline;connectDatabaseEmulator=dbMod.connectDatabaseEmulator;
 var app=initializeApp(cfg.firebaseConfig);
 authObj=getAuth(app);
 db=getDatabase(app);
 if(emuOn()){
  connectAuthEmulator(authObj,"http://127.0.0.1:9099",{disableWarnings:true});
  connectDatabaseEmulator(db,"127.0.0.1",9000);
 }
 if(authObj.authStateReady)await authObj.authStateReady();
 var cred=await signInAnonymously(authObj);
 await cred.user.getIdToken();
 uid=cred.user.uid;
 goOnline(db);
 showApp();screen("home");wire();
}
boot().catch(function(e){
 var codeStr=e&&e.code?String(e.code):"";
 showOffline(codeStr&&/auth\//.test(codeStr)?"Sign-in didn't start. Check the connection and try again.":"");
});
})();
