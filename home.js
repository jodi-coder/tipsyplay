/* Homepage: the try-it phone, the vibe filters, and the room-code box. Nothing here talks to a server. */
(function(){
"use strict";
var d=document;
function $(id){return d.getElementById(id)}

/* ---------- room code: letters only, upper case ---------- */
var code=$("joincode");
if(code) code.addEventListener("input",function(){
  var v=code.value.replace(/[^a-z]/gi,"").toUpperCase().slice(0,4);
  if(v!==code.value) code.value=v;
});

/* ---------- vibe filters ---------- */
var cat=$("catalog"), pills=[].slice.call(d.querySelectorAll("#vibes [data-filter]"));
var count=$("gcount"), empty=$("catempty"), more=$("catmore");
var PHONE_LIMIT=6, expanded=false, mq=window.matchMedia?window.matchMedia("(max-width:619px)"):null;
function applyFilter(key){
  if(!cat) return;
  var cards=[].slice.call(cat.querySelectorAll(".gc")), shown=0;
  cards.forEach(function(c){
    var ok=key==="all"||(" "+c.getAttribute("data-cats")+" ").indexOf(" "+key+" ")!==-1;
    c.hidden=!ok;
    c.classList.remove("over");
    if(ok){
      shown++;
      // on phones the full list folds after six, behind one button
      if(mq&&mq.matches&&!expanded&&shown>PHONE_LIMIT) c.classList.add("over");
    }
  });
  pills.forEach(function(p){p.setAttribute("aria-pressed",p.getAttribute("data-filter")===key?"true":"false")});
  if(count) count.textContent=shown+(shown===1?" game":" games")+(key==="all"?"":" match");
  if(empty) empty.hidden=shown>0;
  if(more){
    var hiddenCount=cat.querySelectorAll(".gc.over").length;
    more.hidden=!hiddenCount;
    more.textContent="Show all "+shown+" games";
  }
}
var current="all";
pills.forEach(function(p){
  p.setAttribute("role","button");
  p.addEventListener("click",function(e){
    e.preventDefault();
    current=p.getAttribute("data-filter");
    expanded=false;
    applyFilter(current);
  });
  p.addEventListener("keydown",function(e){if(e.key===" "){e.preventDefault();p.click()}});
});
if(more) more.addEventListener("click",function(){
  var first=cat.querySelector(".gc.over");
  expanded=true; applyFilter(current);
  if(first){var a=first; a.focus({preventScroll:true})}
});
if(mq&&mq.addEventListener) mq.addEventListener("change",function(){applyFilter(current)});
applyFilter("all");

/* ---------- the try-it phone ---------- */
var demo=$("demo"); if(!demo) return;
var tabs=[].slice.call(demo.querySelectorAll('[role="tab"]'));
var PLAYERS=[
  {id:"me",name:"You",emo:"🎧"},
  {id:"maya",name:"Maya",emo:"🦊",delay:500},
  {id:"jordan",name:"Jordan",emo:"🌙",delay:1100},
  {id:"sam",name:"Sam",emo:"🔥",delay:1700},
  {id:"priya",name:"Priya",emo:"🍓",delay:2300}
];
var PROMPTS=["texted the wrong group chat.","pretended to know the words at karaoke.","left a party without saying goodbye.","laughed at a joke I didn't get.","stalked an ex's playlist.","faked being sick to skip plans."];
var BOT_SETS=[["have","never","have","never"],["never","have","have","have"],["have","have","never","never"],["never","never","have","never"],["have","never","never","have"],["never","have","never","have"]];
var st={round:3, prompt:0, mine:null, locked:{}, timers:[]};
var reduce=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function clearTimers(){st.timers.forEach(clearTimeout); st.timers=[]}
function later(fn,ms){st.timers.push(setTimeout(fn,reduce?0:ms))}
function botAns(i){return BOT_SETS[st.prompt%BOT_SETS.length][i-1]}

function paintAvatars(){
  var ul=$("dm-avatars"); if(!ul) return;
  ul.textContent="";
  PLAYERS.forEach(function(p){
    var li=d.createElement("li");
    li.textContent=p.emo;
    if(p.id==="me") li.className="me";
    var done=p.id==="me"?!!st.mine:!!st.locked[p.id];
    if(done) li.classList.add("in");
    li.setAttribute("aria-label",p.name+(done?", answered":""));
    li.title=p.name;
    ul.appendChild(li);
  });
}
function paintLobby(){
  var ul=$("dm-plist"); if(!ul) return; ul.textContent="";
  PLAYERS.forEach(function(p){
    var li=d.createElement("li"), s=d.createElement("span"), r=d.createElement("small");
    s.textContent=p.emo+"  "+p.name+(p.id==="me"?" (host)":"");
    r.textContent="Ready";
    li.appendChild(s); li.appendChild(r); ul.appendChild(li);
  });
}
function lockedCount(){return Object.keys(st.locked).length+(st.mine?1:0)}
function paintRound(){
  $("dm-prompt").textContent=PROMPTS[st.prompt%PROMPTS.length];
  $("dm-round-txt").textContent="Round "+st.round+" of 10";
  var bar=demo.querySelector(".ph-track i"); if(bar) bar.style.width=(st.round*10)+"%";
  var tr=$("dt-round"); if(tr) tr.textContent="Round "+st.round;
  demo.querySelectorAll("[data-ans]").forEach(function(b){
    var on=st.mine===b.getAttribute("data-ans");
    b.setAttribute("aria-pressed",on?"true":"false");
    b.disabled=!!st.mine;
  });
  var s=$("dm-status");
  if(!st.mine) s.textContent=lockedCount()+" of 5 answered · tap to try it";
  else if(st.mine==="pass") s.textContent="Passed. No drink, no explanation needed.";
  else s.textContent="Locked in · "+lockedCount()+" of 5 answered";
  paintAvatars();
}
function paintResults(){
  var ul=$("dm-haves"); ul.textContent="";
  var haves=0;
  PLAYERS.forEach(function(p,i){
    var a=p.id==="me"?st.mine:botAns(i);
    var li=d.createElement("li"), s=d.createElement("span"), r=d.createElement("small");
    s.textContent=p.emo+"  "+p.name;
    r.textContent=a==="have"?"I HAVE":a==="never"?"Never":a==="pass"?"Passed":"Thinking…";
    if(a==="have"){li.className="have"; haves++}
    li.appendChild(s); li.appendChild(r); ul.appendChild(li);
  });
  $("dm-count").textContent=haves+" of 5 said I HAVE";
}
function startBots(){
  clearTimers();
  PLAYERS.forEach(function(p,i){
    if(p.id==="me"||st.locked[p.id]) return;
    later(function(){st.locked[p.id]=true; paintRound(); maybeReveal()}, p.delay);
  });
}
function maybeReveal(){
  if(st.mine&&lockedCount()===5) later(function(){select("results")}, 900);
}
function answer(a){
  if(st.mine) return;
  st.mine=a;
  paintRound();
  if(window.TPSound&&TPSound.click) try{TPSound.click()}catch(e){}
  maybeReveal();
}
function nextPrompt(){
  clearTimers();
  st.prompt++; st.round=st.round>=10?1:st.round+1; st.mine=null; st.locked={};
  select("round");
}
function select(name, focus){
  tabs.forEach(function(t){
    var on=t.id==="dt-"+name;
    t.setAttribute("aria-selected",on?"true":"false");
    t.tabIndex=on?0:-1;
    var panel=$(t.getAttribute("aria-controls")); if(panel) panel.hidden=!on;
    if(on&&focus) t.focus();
  });
  if(name==="lobby"){clearTimers(); paintLobby(); paintAvatars()}
  if(name==="round"){paintRound(); startBots()}
  if(name==="results"){
    clearTimers();
    PLAYERS.forEach(function(p){if(p.id!=="me") st.locked[p.id]=true});
    paintAvatars(); paintResults();
  }
}
tabs.forEach(function(t,i){
  t.addEventListener("click",function(){select(t.id.slice(3))});
  t.addEventListener("keydown",function(e){
    var k=e.key, n=null;
    if(k==="ArrowRight") n=tabs[(i+1)%tabs.length];
    else if(k==="ArrowLeft") n=tabs[(i-1+tabs.length)%tabs.length];
    else if(k==="Home") n=tabs[0];
    else if(k==="End") n=tabs[tabs.length-1];
    if(n){e.preventDefault(); select(n.id.slice(3), true)}
  });
});
demo.querySelectorAll("[data-ans]").forEach(function(b){b.addEventListener("click",function(){answer(b.getAttribute("data-ans"))})});
$("dm-start").addEventListener("click",function(){select("round")});
$("dm-next").addEventListener("click",nextPrompt);

/* Start the bots only once the phone is on screen, so the checkmarks are seen arriving. */
paintLobby(); paintRound();
if("IntersectionObserver" in window){
  var io=new IntersectionObserver(function(e){if(e[0].isIntersecting){io.disconnect(); if(!st.mine) startBots()}},{threshold:.4});
  io.observe(demo);
}else startBots();
})();
