(function(){
var D=window.NHIE,S=localStorage,$=function(id){return document.getElementById(id)};
var KEY="tp_party_players";
var players=[],deck=[],answers=[],pi=0,ai=0,mode="",locked=false,na=false,lvl="mild",rounds=10,tid=0,wl=null,fxRAF=0;
function motionOk(){return !(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches)}
function later(fn,ms){clearTimeout(tid);tid=setTimeout(fn,ms)}
function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n}
function listNames(arr){if(arr.length<=1)return arr[0]||"";if(arr.length===2)return arr[0]+" and "+arr[1];return arr.slice(0,-1).join(", ")+" and "+arr[arr.length-1]}
function instr(){return na?"Points only. Passing is always fine.":"Take a small drink or skip; passing is always fine."}
function paintChips(sel,attr,val){document.querySelectorAll(sel).forEach(function(b){b.setAttribute("aria-pressed",String(b.getAttribute(attr))===String(val))})}
function syncAdd(){var n=$("plist").children.length;$("padd").disabled=n>=12;$("pcount").textContent=n+" of 12 players"}
function saveNames(){var names=[],inputs=$("plist").querySelectorAll("input"),i;for(i=0;i<inputs.length;i++){var n=inputs[i].value.trim();if(n)names.push(n)}try{S.setItem(KEY,JSON.stringify(names))}catch(e){}}
function addRow(val){
 if($("plist").children.length>=12)return;
 var row=el("div","prow"),input=document.createElement("input"),rm=el("button","x","✕");
 input.maxLength=18;input.placeholder="Name";input.value=val||"";input.autocomplete="off";input.autocapitalize="words";input.spellcheck=false;input.setAttribute("aria-label","Player name");input.enterKeyHint="done";
 input.addEventListener("input",saveNames);
 rm.type="button";rm.setAttribute("aria-label","Remove player");
 rm.addEventListener("click",function(){row.remove();saveNames();syncAdd()});
 row.appendChild(input);row.appendChild(rm);$("plist").appendChild(row);syncAdd();
}
function loadNames(){
 var list=[];try{list=JSON.parse(S.getItem(KEY)||"[]")}catch(e){list=[]}
 if(!Array.isArray(list))list=[];
 list=list.filter(function(n){return typeof n==="string"&&n.trim()}).map(function(n){return n.trim().slice(0,18)}).slice(0,12);
 $("plist").textContent="";
 if(!list.length){addRow("");addRow("")}
 else {list.forEach(function(n){addRow(n)});while($("plist").children.length<2)addRow("")}
 syncAdd();
}
function collect(){
 var inputs=$("plist").querySelectorAll("input"),names=[],seen={},i;
 if(inputs.length<2)return {error:"Add at least 2 players."};
 if(inputs.length>12)return {error:"12 players max."};
 for(i=0;i<inputs.length;i++){
  var n=inputs[i].value.trim();
  if(!n)return {error:"Give everyone a name."};
  var k=n.toLowerCase();
  if(seen[k])return {error:"Use a different name for each player."};
  seen[k]=1;names.push(n);
 }
 return {names:names};
}
function deal(){
 var pool=(D[lvl]||D.mild).slice(),i,j,t,n;
 for(i=pool.length-1;i>0;i--){j=Math.floor(Math.random()*(i+1));t=pool[i];pool[i]=pool[j];pool[j]=t}
 n=Math.min(rounds,pool.length);return pool.slice(0,n);
}
function paintBoard(active){
 var b=$("board");b.textContent="";
 players.forEach(function(p,i){var s=el("span",i===active?"on":"",p.name+" "+p.score);b.appendChild(s)});
}
function showChoices(on){$("choices").classList.toggle("hide",!on);$("yes").disabled=!on;$("no").disabled=!on}
function showAdvance(on){$("nextwrap").classList.toggle("hide",!on)}
function lockScreen(){if("wakeLock" in navigator)navigator.wakeLock.request("screen").then(function(w){wl=w}).catch(function(){})}
function handoff(label,then){
 locked=true;showChoices(false);showAdvance(false);
 $("pass").textContent=label;$("pass").classList.remove("hide");
 if(motionOk())$("pass").classList.add("go");else $("pass").classList.remove("go");
 if(window.TPSound)TPSound.roll();
 later(function(){$("pass").classList.add("hide");$("pass").classList.remove("go");locked=false;then()},motionOk()?520:200);
}
function showAsk(){
 mode="ask";locked=false;
 $("card").classList.remove("rem","flash-yes","flash-no");
 $("lvl").textContent="Prompt "+(pi+1)+" of "+deck.length;
 $("prompt").textContent=deck[pi];
 $("instr").textContent=instr();
 $("ask").textContent=players[ai].name+": have you?";
 showChoices(true);showAdvance(false);paintBoard(ai);
}
function showReveal(){
 var who=[],i,n,title;
 mode="reveal";locked=false;
 for(i=0;i<players.length;i++)if(answers[i])who.push(players[i].name);
 n=who.length;
 title=n===0?"Nobody has!":n===1?"1 of you has!":n+" of you have!";
 $("card").classList.remove("rem","flash-yes","flash-no");
 $("lvl").textContent="Prompt "+(pi+1)+" of "+deck.length+" · Reveal";
 $("prompt").textContent=title;
 $("instr").textContent=instr();
 $("ask").textContent=n?listNames(who):"Clean slates — no points this round.";
 showChoices(false);showAdvance(true);
 $("advance").textContent=pi+1>=deck.length?"See results 🎉":"Next prompt ▶";
 paintBoard(-1);
}
function showReminder(){
 var list=D.reminders||[],idx=Math.floor(pi/8)-1;
 mode="remind";locked=false;
 $("card").classList.add("rem");$("card").classList.remove("flash-yes","flash-no");
 $("lvl").textContent="Gentle reminder";
 $("prompt").textContent=list.length?list[((idx%list.length)+list.length)%list.length]:"Take a breath. Passing is always welcome.";
 $("instr").textContent="Take your time. Tap continue when ready.";
 $("ask").textContent="";
 showChoices(false);showAdvance(true);$("advance").textContent="Continue";paintBoard(-1);
 if(window.TPSound)TPSound.reminder();
}
function startAnswers(){answers=[];ai=0;handoff("Pass to "+players[0].name,showAsk)}
function openPrompt(){
 if(pi>=deck.length)return finish();
 if(S.getItem("tp_rem")!=="off"&&pi>0&&pi%8===0)return showReminder();
 startAnswers();
}
function pick(have){
 var card;
 if(locked||mode!=="ask")return;
 locked=true;showChoices(false);showAdvance(false);
 answers[ai]=!!have;
 if(have)players[ai].score++;
 paintBoard(ai);
 if(window.TPSound){if(have)TPSound.yes();else TPSound.no()}
 card=$("card");
 if(motionOk()){card.classList.remove("flash-yes","flash-no");void card.offsetWidth;card.classList.add(have?"flash-yes":"flash-no")}
 later(function(){
  card.classList.remove("flash-yes","flash-no");
  ai++;
  if(ai<players.length)handoff("Pass to "+players[ai].name,showAsk);
  else handoff("Reveal",showReveal);
 },motionOk()?240:80);
}
function renderOver(){
 var scores=players.map(function(p){return p.score}),max=Math.max.apply(null,scores),min=Math.min.apply(null,scores);
 var wild=players.filter(function(p){return p.score===max}),angel=players.filter(function(p){return p.score===min});
 var wildTitle="The Wild One 👑",angelTitle="The Angel 😇",box=$("crowns"),list=$("final");
 var ranked=players.map(function(p){return {name:p.name,score:p.score}}).sort(function(a,b){return b.score-a.score||a.name.localeCompare(b.name)});
 box.textContent="";list.textContent="";
 if(max===min){
  box.appendChild(el("h2","","It's a tie"));
  box.appendChild(el("p","",wildTitle+" and "+angelTitle+": "+listNames(players.map(function(p){return p.name}))));
 }else{
  box.appendChild(el("p","",wildTitle+": "+listNames(wild.map(function(p){return p.name}))));
  box.appendChild(el("p","",angelTitle+": "+listNames(angel.map(function(p){return p.name}))));
 }
 ranked.forEach(function(p){
  var li=el("li"),name=el("span","",p.name),pts=el("span","",p.score+(p.score===1?" pt":" pts"));
  li.appendChild(name);li.appendChild(pts);list.appendChild(li);
 });
}
function stopFx(){
 if(fxRAF)cancelAnimationFrame(fxRAF);fxRAF=0;
 var c=$("fx");if(!c)return;c.classList.add("hide");
 var g=c.getContext("2d");if(g&&c.width)g.clearRect(0,0,c.width,c.height);
}
function startFx(){
 var c=$("fx"),dpr,w,h,g,colors,bits,sparks,rockets,t0,launches;
 stopFx();
 if(!motionOk()||!c)return;
 c.classList.remove("hide");
 dpr=Math.min(window.devicePixelRatio||1,2);
 w=c.width=Math.floor(window.innerWidth*dpr);
 h=c.height=Math.floor(window.innerHeight*dpr);
 if(w<10||h<10){c.classList.add("hide");return}
 g=c.getContext("2d");if(!g)return;
 colors=["--surface","--primary","--danger","--tile-green"].map(function(n){return getComputedStyle(document.documentElement).getPropertyValue(n).trim()||"#FFFFFF"});
 bits=[];sparks=[];rockets=[];launches=0;t0=performance.now();
 for(var i=0;i<70;i++)bits.push({x:Math.random()*w,y:-Math.random()*h*0.5,w:(4+Math.random()*5)*dpr,h:(7+Math.random()*8)*dpr,vy:(1.5+Math.random()*2.2)*dpr,vx:(Math.random()-0.5)*1.3*dpr,rot:Math.random()*6,vr:(Math.random()-0.5)*0.2,c:colors[i%colors.length]});
 function burst(x,y,col){for(var k=0;k<32;k++){var a=Math.random()*Math.PI*2,sp=(0.5+Math.random()*2.6)*dpr;sparks.push({x:x,y:y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:1,c:col})}}
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
function finish(){
 locked=true;mode="over";
 $("pass").classList.add("hide");$("stage").classList.add("hide");$("over").classList.remove("hide");
 renderOver();
 if(window.TPSound)TPSound.celebrate();
 startFx();
}
function gotoSetup(){
 clearTimeout(tid);locked=false;mode="";
 stopFx();$("pass").classList.add("hide");$("stage").classList.add("hide");$("over").classList.add("hide");$("setup").classList.remove("hide");
}
function boot(fromAgain){
 if(!fromAgain){
  var got=collect();
  if(got.error){$("perr").textContent=got.error;if(window.TPSound)TPSound.click();return}
  $("perr").textContent="";saveNames();
  na=$("pna").checked;
  players=got.names.map(function(n){return {name:n,score:0}});
 }
 players.forEach(function(p){p.score=0});
 deck=deal();pi=0;
 $("setup").classList.add("hide");$("over").classList.add("hide");$("stage").classList.remove("hide");
 stopFx();lockScreen();openPrompt();
}
$("padd").onclick=function(){addRow("");var inputs=$("plist").querySelectorAll("input");if(inputs.length)inputs[inputs.length-1].focus()};
$("plist").addEventListener("keydown",function(e){if(e.key!=="Enter")return;e.preventDefault();if(!$("padd").disabled)$("padd").click()});
document.querySelectorAll("#pspice .chip").forEach(function(b){b.onclick=function(){lvl=b.dataset.l;paintChips("#pspice .chip","data-l",lvl)}});
document.querySelectorAll("#prounds .chip").forEach(function(b){b.onclick=function(){rounds=+b.dataset.r;paintChips("#prounds .chip","data-r",rounds)}});
$("pstart").onclick=function(){boot(false)};
$("yes").onclick=function(){pick(true)};
$("no").onclick=function(){pick(false)};
$("advance").onclick=function(){
 if(locked)return;
 if(mode==="remind"){startAnswers();return}
 if(mode!=="reveal")return;
 pi++;
 if(pi>=deck.length)finish();else handoff("Next prompt",openPrompt);
};
$("again").onclick=function(){boot(true)};
$("newp").onclick=gotoSetup;
var spice=S.getItem("tp_spice")||"mild";if(D[spice])lvl=spice;
paintChips("#pspice .chip","data-l",lvl);
paintChips("#prounds .chip","data-r",rounds);
$("pna").checked=S.getItem("tp_na")==="on";
loadNames();
if(window.TPSound)TPSound.bindMute($("mute"));
document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible"&&!$("stage").classList.contains("hide"))lockScreen()});
})();
