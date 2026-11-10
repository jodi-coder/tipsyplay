(function(){
var ALPHABET="ABCDEFGHJKMNPQRSTUVWXYZ";
var TTL=8*60*60*1000;
var $=function(id){return document.getElementById(id)};
var uid=null,code=null,meta=null,players={},answered={},skips={},known={},db=null;
var stops=[],roundStop=null,skipStop=null,revStop=null,answerStops={},fxRAF=0,revealLock="",revealKey="",promptKey="",overKey="",connStop=null,sending=false,liveRound="";
var serverOffset=0,offsetReady=false,offsetStop=null;
var initializeApp,getAuth,signInAnonymously,getDatabase,ref,onValue,update,set,remove,onDisconnect,get,serverTimestamp,goOnline,authObj;

function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n}
function listNames(arr){if(arr.length<=1)return arr[0]||"";if(arr.length===2)return arr[0]+" and "+arr[1];return arr.slice(0,-1).join(", ")+" and "+arr[arr.length-1]}
function motionOk(){return !(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches)}
function instr(){return meta&&meta.na?"Points only. Passing is always fine.":"Sip, water, or pose, or skip. Passing is always fine."}
function roomUrl(c){return "https://tipsyplay.com/play/join.html?code="+c}
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
function deal(spice,rounds){
 var pool=(window.NHIE&&(window.NHIE[spice]||window.NHIE.mild)||[]).slice(),i,j,t;
 for(i=pool.length-1;i>0;i--){j=Math.floor(Math.random()*(i+1));t=pool[i];pool[i]=pool[j];pool[j]=t}
 return pool.slice(0,rounds);
}
function fail(msg){var p=$("perr");if(p)p.textContent=msg||""}
function friendly(e){
 var c=String((e&&(e.code||e.message))||"");
 if(/permission|denied/i.test(c))return "That room isn't available.";
 if(/offline|network|fetch/i.test(c))return "You're offline.";
 return "Something went wrong. Try again.";
}
function showOffline(detail){
 $("connecting").classList.add("hide");
 $("app").classList.add("hide");
 $("offline").classList.remove("hide");
 $("offdetail").textContent=detail||"";
}
function showApp(){
 $("connecting").classList.add("hide");
 $("offline").classList.add("hide");
 $("app").classList.remove("hide");
}
function screen(id){["home","lobby","stage","over","closed"].forEach(function(s){var n=$(s); if(n) n.classList.toggle("hide",s!==id)})}
function savedName(){
 var el=$("playername")||$("pname");
 var name=el?normName(el.value):"";
 if(!name){try{name=normName(localStorage.getItem("tp_online_name")||localStorage.getItem("tp_name")||"")}catch(e){}}
 if(name&&el&&!normName(el.value)) el.value=name;
 return name;
}
function releaseRoom(){
 var c=code, me=uid;
 if(connStop){connStop(); connStop=null}
 if(c&&me){try{onDisconnect(ref(db,"rooms/"+c+"/players/"+me)).cancel()}catch(e){}}
 clearRoom();
}
function openHostFlow(){
 screen("home"); if(typeof showApp==="function") showApp();
 var name=savedName();
 if(!name){var el=$("playername"); if(el) el.focus(); return}
 doHost();
}
function restartSame(){
 var name=savedName();
 if(!name){openHostFlow(); return}
 releaseRoom();
 screen("home");
 hostRoom(name).catch(function(e){fail(friendly(e))});
}
function showClosedChoice(role){
 var sec=$("closed");
 if(!sec){
  sec=document.createElement("section"); sec.id="closed"; sec.className="card";
  var h=document.createElement("h2"); h.textContent="Room closed"; sec.appendChild(h);
  var p=document.createElement("p"); p.id="closedmsg"; p.textContent="This room is closed to new players."; sec.appendChild(p);
  var b=document.createElement("button"); b.type="button"; b.className="btn"; b.id="hostnew"; b.textContent="Host a new room";
  b.addEventListener("click", function(){ if(b.dataset.role==="host") restartSame(); else openHostFlow(); });
  sec.appendChild(b);
  var app=$("app")||document.body; app.appendChild(sec);
 }
 var msg=$("closedmsg"); if(msg) msg.textContent="This room is closed to new players.";
 var btnEl=$("hostnew");
 if(btnEl){
  btnEl.dataset.role=role==="host"?"host":"join";
  btnEl.textContent=role==="host"?"Restart with same game":"Host a new room";
 }
 fail("This room is closed to new players.");
 screen("closed"); if(typeof showApp==="function") showApp();
}
function mountRestart(){
 if(!isHost()||!meta||meta.status==="lobby") return;
 var sec=null;
 ["over","stage"].forEach(function(id){var n=$(id); if(n&&!n.classList.contains("hide")) sec=n});
 if(!sec||sec.querySelector("[data-restart]")) return;
 var row=document.createElement("div"); row.className="ctrl"; row.setAttribute("data-restart","1");
 var p=document.createElement("p"); p.textContent="This room is closed to new players.";
 var b=document.createElement("button"); b.type="button"; b.className="btn alt"; b.textContent="Restart with same game";
 b.addEventListener("click", function(){restartSame()});
 row.appendChild(p); row.appendChild(b); sec.appendChild(row);
}
function isHost(){return !!(meta&&uid&&meta.hostUid===uid)}
function playerList(){
 return Object.keys(players).map(function(id){
  return {uid:id,name:players[id].name||"Player",connected:players[id].connected!==false,joinedAt:players[id].joinedAt||0,score:scoreOf(id)};
 }).sort(function(a,b){return a.joinedAt-b.joinedAt||a.name.localeCompare(b.name)});
}
function shown(id){
 var list=playerList(),count={},seen={},map={};
 list.forEach(function(p){count[p.name]=(count[p.name]||0)+1});
 list.forEach(function(p){
  if(count[p.name]<2){map[p.uid]=p.name;return}
  seen[p.name]=(seen[p.name]||0)+1;
  map[p.uid]=seen[p.name]===1?p.name:(p.name+" "+seen[p.name]);
 });
 return map[id]||(players[id]&&players[id].name)||"Player";
}
function serverNow(){return Date.now()+(offsetReady?serverOffset:0)}
function armServerClock(){
 if(!db||!ref||!onValue)return;
 if(offsetStop)offsetStop();
 offsetStop=onValue(ref(db,".info/serverTimeOffset"),function(s){
  var v=s.val();
  if(typeof v==="number"&&isFinite(v)){serverOffset=v;offsetReady=true}
 },function(){offsetReady=false;serverOffset=0});
}
function stopServerClock(){if(offsetStop){try{offsetStop()}catch(e){}offsetStop=null}}
function scoreOf(id){
 var n=0,prefix=meta?meta.gameId+"/":"";
 Object.keys(known).forEach(function(k){if(prefix&&k.indexOf(prefix)===0&&known[k][id]===true)n++});
 return n;
}
function fullMeta(patch){
 var m=Object.assign({},meta||{},patch||{}),out={
  hostUid:m.hostUid,createdAt:m.createdAt,status:m.status,phase:m.phase,spice:m.spice,
  rounds:+m.rounds,na:!!m.na,round:+m.round,gameId:+m.gameId
 };
 if(m.deck&&asDeck(m.deck).length)out.deck=asDeck(m.deck);
 if(m.endedAt)out.endedAt=m.endedAt;
 return out;
}
function roomPath(child){return "rooms/"+code+"/"+child}
function writeMeta(patch){
 var next=fullMeta(patch);
 return update(ref(db),{["rooms/"+code+"/meta"]:next});
}
function paintHost(){
 document.body.classList.toggle("is-host",isHost());
 document.querySelectorAll(".hostonly").forEach(function(n){n.classList.toggle("hide",!isHost())});
 document.querySelectorAll(".guestonly").forEach(function(n){n.classList.toggle("hide",isHost())});
}
function paintChips(){
 if(!meta)return;
 document.querySelectorAll("#ospice .chip").forEach(function(b){b.setAttribute("aria-pressed",b.dataset.l===meta.spice);b.disabled=!isHost()||meta.status!=="lobby"});
 document.querySelectorAll("#orounds .chip").forEach(function(b){b.setAttribute("aria-pressed",+b.dataset.r===+meta.rounds);b.disabled=!isHost()||meta.status!=="lobby"});
 $("ona").checked=!!meta.na;$("ona").disabled=!isHost()||meta.status!=="lobby";
}
function stopFx(){
 if(fxRAF)cancelAnimationFrame(fxRAF);fxRAF=0;
 var c=$("fx");if(!c)return;c.classList.add("hide");
 var g=c.getContext("2d");if(g&&c.width)g.clearRect(0,0,c.width,c.height);
}
function startFx(){
 var c=$("fx"),dpr,w,h,g,colors,bits,sparks,rockets,t0,launches,i;
 stopFx();
 if(!motionOk()||!c)return;
 c.classList.remove("hide");
 dpr=Math.min(window.devicePixelRatio||1,2);
 w=c.width=Math.floor(window.innerWidth*dpr);
 h=c.height=Math.floor(window.innerHeight*dpr);
 if(w<10||h<10){c.classList.add("hide");return}
 g=c.getContext("2d");if(!g)return;
 colors=["#ff4fa3","#3de0d0","#ffd166","#f4efff","#b388ff"];
 bits=[];sparks=[];rockets=[];launches=0;t0=performance.now();
 for(i=0;i<70;i++)bits.push({x:Math.random()*w,y:-Math.random()*h*0.5,w:(4+Math.random()*5)*dpr,h:(7+Math.random()*8)*dpr,vy:(1.5+Math.random()*2.2)*dpr,vx:(Math.random()-0.5)*1.3*dpr,rot:Math.random()*6,vr:(Math.random()-0.5)*0.2,c:colors[i%colors.length]});
 function burst(x,y,col){var k,a,sp;for(k=0;k<32;k++){a=Math.random()*Math.PI*2;sp=(0.5+Math.random()*2.6)*dpr;sparks.push({x:x,y:y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:1,c:col})}}
 function frame(now){
  var t=(now-t0)/1000,r;
  g.clearRect(0,0,w,h);
  if(launches<4&&t>0.15+launches*0.55){rockets.push({x:(0.18+Math.random()*0.64)*w,y:h+4,vy:-(5.2+Math.random()*1.6)*dpr,vx:(Math.random()-0.5)*0.8*dpr,c:colors[launches%colors.length]});launches++}
  bits.forEach(function(p){p.x+=p.vx;p.y+=p.vy;p.vy+=0.02*dpr;p.rot+=p.vr;g.save();g.translate(p.x,p.y);g.rotate(p.rot);g.fillStyle=p.c;g.fillRect(-p.w/2,-p.h/2,p.w,p.h);g.restore()});
  for(r=rockets.length-1;r>=0;r--){
   rockets[r].x+=rockets[r].vx;rockets[r].y+=rockets[r].vy;rockets[r].vy+=0.04*dpr;
   g.fillStyle=rockets[r].c;g.beginPath();g.arc(rockets[r].x,rockets[r].y,2.4*dpr,0,7);g.fill();
   if(rockets[r].vy>=-0.4*dpr||rockets[r].y<h*0.22){burst(rockets[r].x,rockets[r].y,rockets[r].c);rockets.splice(r,1)}
  }
  sparks.forEach(function(s){s.x+=s.vx;s.y+=s.vy;s.vy+=0.025*dpr;s.life-=0.016;g.globalAlpha=Math.max(s.life,0);g.fillStyle=s.c;g.beginPath();g.arc(s.x,s.y,2.1*dpr,0,7);g.fill()});
  g.globalAlpha=1;sparks=sparks.filter(function(s){return s.life>0});
  if(t<4.4)fxRAF=requestAnimationFrame(frame);else stopFx();
 }
 fxRAF=requestAnimationFrame(frame);
}
function renderOver(){
 var list=playerList(),scores=list.map(function(p){return p.score});
 var max=Math.max.apply(null,scores),min=Math.min.apply(null,scores);
 var wild=list.filter(function(p){return p.score===max}),angel=list.filter(function(p){return p.score===min});
 var wildTitle="The Wild One 👑",angelTitle="The Angel 😇",box=$("crowns"),ol=$("final");
 var ranked=list.slice().sort(function(a,b){return b.score-a.score||a.name.localeCompare(b.name)});
 box.textContent="";ol.textContent="";
 if(!list.length){box.appendChild(el("p","","No players left."));return}
 if(max===min){
  box.appendChild(el("h2","","It's a tie"));
  box.appendChild(el("p","",wildTitle+" and "+angelTitle+": "+listNames(list.map(function(p){return shown(p.uid)}))));
 }else{
  box.appendChild(el("p","",wildTitle+": "+listNames(wild.map(function(p){return shown(p.uid)}))));
  box.appendChild(el("p","",angelTitle+": "+listNames(angel.map(function(p){return shown(p.uid)}))));
 }
 ranked.forEach(function(p){
  var li=el("li");
  li.appendChild(el("span","",shown(p.uid)));
  li.appendChild(el("span","",p.score+(p.score===1?" pt":" pts")));
  ol.appendChild(li);
 });
 var text="Never Have I Ever, "+((meta&&meta.rounds)||0)+" rounds";
 var line=$("recapline");
 if(!line){
  line=el("p","",text); line.id="recapline";
  var share=el("button","btn alt","Share recap"); share.type="button"; share.setAttribute("data-action","recap");
  var row=el("div","ctrl"); row.appendChild(line); row.appendChild(share);
  var over=$("over"); if(over) over.appendChild(row);
 }else line.textContent=text;
}
function rowButtons(p,mode){
 var wrap=el("div","prow"),label=el("span",p.connected?"":"off",shown(p.uid)+(p.uid===meta.hostUid?" · host":"")+(p.uid===uid?" · you":"")+(p.connected?"":" · offline")+(mode==="lobby"?"":" · "+p.score));
 wrap.appendChild(label);
 if(isHost()&&p.uid!==uid){
  var kick=el("button","x","Remove");kick.type="button";kick.setAttribute("aria-label","Remove "+shown(p.uid));
  kick.onclick=function(){if(confirm("Remove "+p.name+" from the room?"))remove(ref(db,roomPath("players/"+p.uid))).catch(function(e){fail(friendly(e))})};
  wrap.appendChild(kick);
 }
 if(mode==="wait"&&isHost()&&!answered[p.uid]&&!skips[p.uid]){
  var skip=el("button","x","Skip");skip.type="button";skip.setAttribute("aria-label","Skip "+shown(p.uid));
  skip.onclick=function(){setSkip(p.uid)};
  wrap.appendChild(skip);
 }
 return wrap;
}
function render(){
 if(!meta)return;
 if(meta.createdAt&&serverNow()-meta.createdAt>TTL){cleanupExpired();return}
 if(meta.endedAt&&serverNow()-meta.endedAt>30*60*1000){cleanupExpired();return}
 paintHost();paintChips();
 var roundKey=meta.gameId+":"+meta.round+":"+meta.phase;
 if(meta.phase==="answer"&&liveRound!==roundKey){liveRound=roundKey;sending=false}
 if(meta.status==="lobby"||meta.phase==="lobby"){
  screen("lobby");
  $("codebig").textContent=code;
  $("sharelink").textContent=roomUrl(code);
  var box=$("plist");box.textContent="";
  playerList().forEach(function(p){box.appendChild(rowButtons(p,"lobby"))});
  $("startbtn").disabled=playerList().length<2;
  stopFx();
  return;
 }
 if(meta.phase==="over"||meta.status==="over"){
  screen("over");
  renderOver();
  mountRestart();
  var ok=String(meta.gameId);
  if(overKey!==ok){overKey=ok;if(window.TPSound)TPSound.celebrate();startFx()}
  return;
 }
 screen("stage");
 mountRestart();
 stopFx();
 var deck=asDeck(meta.deck),prompt=deck[meta.round]||"",list=playerList();
 var mine=!!answered[uid],phase=meta.phase;
 $("lvl").textContent="Prompt "+(meta.round+1)+" of "+meta.rounds+(phase==="reveal"?" · Reveal":"");
 $("instr").textContent=instr();
 $("yes").disabled=phase!=="answer"||mine||sending;
 $("no").disabled=phase!=="answer"||mine||sending;
 $("revealbtn").classList.toggle("hide",!isHost()||phase!=="answer");
 $("nextbtn").classList.toggle("hide",!isHost()||phase!=="reveal");
 if(phase==="reveal"){
  var knownKey=meta.gameId+"/"+meta.round,bag=known[knownKey],names=[];
  if(bag)list.forEach(function(p){if(bag[p.uid]===true)names.push(shown(p.uid))});
  var n=names.length,title=!bag?"Revealing…":n===0?"Nobody has!":n===1?"1 of you has!":n+" of you have!";
  $("prompt").textContent=title;
  $("ask").textContent=!bag?"":n?listNames(names):"Clean slates — no points this round.";
  $("said").textContent=prompt;
  var rk=meta.gameId+":"+meta.round;
  if(revealKey!==rk){revealKey=rk;if(window.TPSound)TPSound.roll()}
 }else{
  $("prompt").textContent=prompt;
  $("ask").textContent=mine?"Answer locked in. It's secret until the reveal.":"Your answer stays secret until everyone is in.";
  var waiting=list.filter(function(p){return !answered[p.uid]&&!skips[p.uid]}).map(function(p){return shown(p.uid)});
  $("said").textContent=waiting.length?"Waiting for "+listNames(waiting)+".":"";
  var pk=meta.gameId+":"+meta.round;
  if(promptKey&&promptKey!==pk&&window.TPSound)TPSound.card();
  promptKey=pk;
 }
 var board=$("board");board.textContent="";
 list.forEach(function(p){board.appendChild(rowButtons(p,phase==="answer"&&!answered[p.uid]&&!skips[p.uid]?"wait":"score"))});
 if(isHost()&&phase==="reveal")$("nextbtn").textContent=meta.round+1>=meta.rounds?"See results 🎉":"Next prompt ▶";
}
function cleanupExpired(){
 var c=code;
 clearRoom();
 if(c)remove(ref(db,"rooms/"+c)).catch(function(){});
 fail("This room has expired.");
 screen("home");
}
function clearRoom(){
 stops.forEach(function(u){u()});stops=[];
 if(roundStop)roundStop();roundStop=null;
 if(skipStop)skipStop();skipStop=null;
 if(revStop)revStop();revStop=null;
 Object.keys(answerStops).forEach(function(k){answerStops[k]();delete answerStops[k]});
 code=null;meta=null;players={};answered={};skips={};known={};
 revealLock="";revealKey="";promptKey="";overKey="";sending=false;liveRound="";
 stopFx();
 sessionStorage.removeItem("tp_room");
}
function watchRound(){
 if(roundStop)roundStop();if(skipStop)skipStop();
 answered={};skips={};sending=false;
 if(!meta||meta.status==="lobby")return;
 var gameId=meta.gameId,round=meta.round;
 roundStop=onValue(ref(db,roomPath("answered/"+gameId+"/"+round)),function(s){
  // ignore a late snapshot from the previous question
  if(!meta||meta.gameId!==gameId||meta.round!==round)return;
  answered=s.val()||{};render();maybeAuto();
 },quietErr);
 skipStop=onValue(ref(db,roomPath("skips/"+gameId+"/"+round)),function(s){
  if(!meta||meta.gameId!==gameId||meta.round!==round)return;
  skips=s.val()||{};render();maybeAuto();
 },quietErr);
}
function watchRevealed(){
 if(revStop)revStop();
 if(!meta)return;
 revStop=onValue(ref(db,roomPath("revealed/"+meta.gameId)),function(s){
  var map=s.val()||{};
  Object.keys(map).forEach(function(round){if(map[round])watchAnswers(meta.gameId,round)});
 },quietErr);
}
function watchAnswers(gameId,round){
 var key=gameId+"/"+round;
 if(answerStops[key])return;
 answerStops[key]=onValue(ref(db,roomPath("answers/"+key)),function(s){known[key]=s.val()||{};render()},function(){});
}
function denied(e){return /permission|denied/i.test(String((e&&(e.code||e.message))||""))}
function listenErr(e){if(denied(e)){clearRoom();fail("That room isn't available.");screen("home");showApp()}}
function quietErr(){}
function listenRoom(){
 stops.forEach(function(u){u()});stops=[];
 stops.push(onValue(ref(db,roomPath("meta")),function(s){
  if(!s.exists()){var wasHost=isHost();clearRoom();showClosedChoice(wasHost?"host":"join");return}
  var prev=meta?meta.gameId+"/"+meta.round+"/"+meta.phase:"";
  meta=s.val();
  var nowKey=meta.gameId+"/"+meta.round+"/"+meta.phase;
  if(prev!==nowKey){watchRound();watchRevealed()}
  render();
 },listenErr));
 stops.push(onValue(ref(db,roomPath("players")),function(s){players=s.val()||{};render();maybeAuto()},quietErr));
}
function maybeAuto(){
 if(!meta||!isHost()||meta.phase!=="answer")return;
 var list=playerList();
 if(!list.length)return;
 if(list.every(function(p){return answered[p.uid]||skips[p.uid]}))revealNow();
}
function setSkip(pid){setTrue("skips/"+meta.gameId+"/"+meta.round+"/"+pid)}
function setTrue(path){update(ref(db),{["rooms/"+code+"/"+path]:true}).catch(function(e){fail(friendly(e))})}
function revealNow(){
 if(!meta||!isHost()||meta.phase!=="answer")return;
 var key=meta.gameId+":"+meta.round;
 if(revealLock===key)return;
 revealLock=key;
 update(ref(db),{
  ["rooms/"+code+"/meta"]:fullMeta({phase:"reveal"}),
  ["rooms/"+code+"/revealed/"+meta.gameId+"/"+meta.round]:true
 }).catch(function(e){revealLock="";fail(friendly(e))});
}
function nextRound(){
 if(!meta||!isHost()||meta.phase!=="reveal")return;
 if(meta.round+1>=meta.rounds)writeMeta({status:"over",phase:"over",endedAt:serverNow()}).catch(function(e){fail(friendly(e))});
 else writeMeta({round:meta.round+1,phase:"answer"}).catch(function(e){fail(friendly(e))});
}
function answer(have){
 if(sending||!meta||meta.phase!=="answer"||answered[uid])return;
 sending=true;$("yes").disabled=true;$("no").disabled=true;
 if(window.TPSound){if(have)TPSound.yes();else TPSound.no()}
 if(motionOk()){var card=$("card");card.classList.remove("flash-yes","flash-no");void card.offsetWidth;card.classList.add(have?"flash-yes":"flash-no")}
 var base="rooms/"+code+"/";
 var payload={};
 payload[base+"answers/"+meta.gameId+"/"+meta.round+"/"+uid]=!!have;
 payload[base+"answered/"+meta.gameId+"/"+meta.round+"/"+uid]=true;
 update(ref(db),payload).then(function(){sending=false;render()}).catch(function(e){sending=false;fail(friendly(e));render()});
}
function myPlayer(name){return {name:name,connected:true,joinedAt:serverNow()}}
function armPresence(){
 if(connStop)connStop();
 var drop=null;
 connStop=onValue(ref(db,".info/connected"),function(s){
  if(drop){try{drop.cancel()}catch(e){}drop=null}
  if(!s.val()||!code||!uid)return;
  var p=ref(db,roomPath("players/"+uid));
  drop=onDisconnect(p);
  drop.update({connected:false}).catch(function(){});
  update(p,{connected:true}).catch(function(){});
 });
}
async function hostRoom(name){
 await ensureAuth();
 var spice=localStorage.getItem("tp_spice")||"mild";
 if(!window.NHIE||!window.NHIE[spice])spice="mild";
 var i,claimed=null;
 for(i=0;i<6;i++){
  var c=makeCode();
  var snap=await get(ref(db,"rooms/"+c+"/meta"));
  if(snap.exists())continue;
  try{
   await update(ref(db),{["rooms/"+c+"/meta"]:{
    hostUid:uid,createdAt:serverTimestamp(),status:"lobby",phase:"lobby",spice:spice,rounds:10,na:localStorage.getItem("tp_na")==="on",round:0,gameId:1
   }});
   claimed=c;break;
  }catch(e){if(!/permission/i.test(String(e.code||e.message||"")))throw e}
 }
 if(!claimed)throw new Error("room");
 await set(ref(db,"rooms/"+claimed+"/players/"+uid),myPlayer(name));
 code=claimed;
 sessionStorage.setItem("tp_room",code);
 try{localStorage.setItem("tp_last_game","never-have-i-ever")}catch(e){}
 listenRoom();armPresence();
}
async function joinRoom(c,name){
 await ensureAuth();
 var snap=await get(ref(db,"rooms/"+c+"/meta"));
 if(!snap.exists())throw new Error("missing");
 var m=snap.val();
 if(m.createdAt&&serverNow()-m.createdAt>TTL){remove(ref(db,"rooms/"+c)).catch(function(){});throw new Error("expired")}
 if(m.endedAt&&serverNow()-m.endedAt>30*60*1000){remove(ref(db,"rooms/"+c)).catch(function(){});throw new Error("expired")}
 var ps=await get(ref(db,"rooms/"+c+"/players"));
 var existing=ps.exists()?ps.val():{};
 var count=Object.keys(existing).length;
 if(!existing[uid]&&m.status!=="lobby")throw new Error("started");
 if(!existing[uid]&&count>=12)throw new Error("full");
 var body=myPlayer(name);
 if(existing[uid]&&existing[uid].joinedAt)body.joinedAt=existing[uid].joinedAt;
 if(existing[uid])await update(ref(db,"rooms/"+c+"/players/"+uid),body);
 else await set(ref(db,"rooms/"+c+"/players/"+uid),body);
 code=c;sessionStorage.setItem("tp_room",code);
 try{localStorage.setItem("tp_last_game","never-have-i-ever")}catch(e){}
 listenRoom();armPresence();
}
async function closeRoom(){
 var c=code;
 try{if(connStop){/* presence listener stays until next connect */}if(uid&&c)await onDisconnect(ref(db,"rooms/"+c+"/players/"+uid)).cancel()}catch(e){}
 clearRoom();
 if(c){try{await remove(ref(db,"rooms/"+c))}catch(e){}}
 fail("");screen("home");
}
async function leaveRoom(){
 var c=code,me=uid;
 try{if(me&&c){await onDisconnect(ref(db,"rooms/"+c+"/players/"+me)).cancel();await remove(ref(db,"rooms/"+c+"/players/"+me))}}catch(e){}
 clearRoom();fail("");screen("home");
}
function readName(){
 var name=normName($("playername").value);
 if(!name){fail("Add your name (20 characters max).");return ""}
 localStorage.setItem("tp_online_name",name);
 return name;
}
function showJoinErr(e){
 var m=String(e&&e.message||"");
 if(m==="missing")fail("No room with that code.");
 else if(m==="expired")fail("That room has expired.");
 else if(m==="started")showClosedChoice("join");
 else if(m==="full")fail("That room is full (12 players).");
 else fail(friendly(e));
}
function afterDeny(run){
 return function(e){
  if(!denied(e))return showJoinErr(e);
  ensureAuth().then(function(){return authObj.currentUser.getIdToken(true)}).then(run).catch(showJoinErr);
 };
}
function doHost(){
 var name=readName();if(!name)return;fail("");
 hostRoom(name).catch(afterDeny(function(){return hostRoom(name)}));
}
function doJoin(){
 var name=readName();if(!name)return;
 var c=normCode($("roomcode").value);
 if(!validCode(c)){fail("Enter the 4-letter code. Rooms don't use I, L, or O.");return}
 fail("");
 joinRoom(c,name).catch(afterDeny(function(){return joinRoom(c,name)}));
}
function doStart(){
 if(!isHost())return;
 if(playerList().length<2){fail("Need at least 2 players.");return}
 var deck=deal(meta.spice,meta.rounds);
 if(deck.length<+meta.rounds){fail("Not enough prompts for that spice level.");return}
 fail("");sending=false;
 writeMeta({status:"play",phase:"answer",round:0,deck:deck}).catch(function(e){fail(friendly(e))});
}
function doAgain(){
 if(!isHost())return;
 var deck=deal(meta.spice,meta.rounds);
 revealKey="";promptKey="";sending=false;liveRound="";
 writeMeta({status:"play",phase:"answer",round:0,gameId:meta.gameId+1,deck:deck,endedAt:0}).catch(function(e){fail(friendly(e))});
}
function wire(){
 var q=normCode(new URLSearchParams(location.search).get("code")||"");
 if(q)$("roomcode").value=q;
 var saved=localStorage.getItem("tp_online_name")||"";
 if(saved)$("playername").value=saved;
 // clicks stay on #app, so replaced buttons still work every round
 $("app").addEventListener("click",function(e){
  var btn=e.target.closest("[data-action]");
  if(!btn||btn.disabled||!$("app").contains(btn))return;
  var action=btn.getAttribute("data-action");
  if(action==="yes")answer(true);
  else if(action==="no")answer(false);
  else if(action==="next")nextRound();
  else if(action==="reveal")revealNow();
  else if(action==="host")doHost();
  else if(action==="join")doJoin();
  else if(action==="start")doStart();
  else if(action==="again")doAgain();
  else if(action==="recap"){
   var text=$("recapline")&&$("recapline").textContent||("Never Have I Ever, "+((meta&&meta.rounds)||0)+" rounds");
   var copied=function(){fail("Recap copied.")};
   if(navigator.share) navigator.share({text:text}).catch(function(){if(navigator.clipboard)navigator.clipboard.writeText(text).then(copied).catch(function(){fail(text)}); else fail(text)});
   else if(navigator.clipboard) navigator.clipboard.writeText(text).then(copied).catch(function(){fail(text)});
   else fail(text);
  }
  else if(action==="close")closeRoom();
  else if(action==="leave")leaveRoom();
  else if(action==="home")location.href="../index.html";
  else if(action==="copy"){var url=roomUrl(code);if(navigator.clipboard)navigator.clipboard.writeText(url).then(function(){fail("Link copied.")}).catch(function(){fail(url)})}
  else if(action==="share"){var link=roomUrl(code);if(navigator.share)navigator.share({title:"TipsyPlay",text:"Join my Never Have I Ever room "+code,url:link}).catch(function(){});else if(navigator.clipboard)navigator.clipboard.writeText(link)}
  else if(action==="spice"&&isHost()&&meta&&meta.status==="lobby")writeMeta({spice:btn.dataset.l}).catch(function(err){fail(friendly(err))});
  else if(action==="rounds"&&isHost()&&meta&&meta.status==="lobby")writeMeta({rounds:+btn.dataset.r}).catch(function(err){fail(friendly(err))});
 });
 $("joinform").addEventListener("submit",function(e){e.preventDefault();doJoin()});
 $("ona").addEventListener("change",function(){if(isHost()&&meta&&meta.status==="lobby")writeMeta({na:$("ona").checked}).catch(function(e){fail(friendly(e))})});
 if(window.TPSound)TPSound.bindMute($("mute"));
 var back=sessionStorage.getItem("tp_room");
 if(back&&validCode(back)&&normName($("playername").value)){
  joinRoom(back,normName($("playername").value)).catch(function(){sessionStorage.removeItem("tp_room")});
 }
}
function lockScreen(){if("wakeLock" in navigator)navigator.wakeLock.request("screen").then(function(){}).catch(function(){})}
document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible"&&meta&&meta.status==="play")lockScreen()});

async function ensureAuth(){
 if(authObj&&authObj.currentUser)await authObj.currentUser.getIdToken();
}
async function boot(){
 if(!navigator.onLine){showOffline();return}
 var base="https://www.gstatic.com/firebasejs/12.4.0/";
 var appMod=await import(base+"firebase-app.js");
 var authMod=await import(base+"firebase-auth.js");
 var dbMod=await import(base+"firebase-database.js");
 var cfg=await import("../firebase-config.js?v=17");
 initializeApp=appMod.initializeApp;getAuth=authMod.getAuth;signInAnonymously=authMod.signInAnonymously;
 getDatabase=dbMod.getDatabase;ref=dbMod.ref;onValue=dbMod.onValue;update=dbMod.update;set=dbMod.set;remove=dbMod.remove;onDisconnect=dbMod.onDisconnect;get=dbMod.get;serverTimestamp=dbMod.serverTimestamp;goOnline=dbMod.goOnline;
 var app=initializeApp(cfg.firebaseConfig);
 authObj=getAuth(app);
 db=getDatabase(app);
 if(authObj.authStateReady)await authObj.authStateReady();
 var cred=await signInAnonymously(authObj);
 await cred.user.getIdToken();
 uid=cred.user.uid;
 goOnline(db);
 armServerClock();
 window.addEventListener("pagehide",function(){stopServerClock()});
 showApp();screen("home");wire();
}
if(window.TPSound)TPSound.bindMute($("mute"));
boot().catch(function(e){
 var codeStr=e&&e.code?String(e.code):"";
 showOffline(codeStr&&/auth\//.test(codeStr)?"If you're online, enable Anonymous sign-in and allow this domain in Firebase Auth.":"");
});
})();
