(function(){
var D=window.NHIE,S=localStorage,lvl=S.getItem("tp_spice")||"mild",na=S.getItem("tp_na")==="on",rem=S.getItem("tp_rem")!=="off";
var deck=[],shown=0,pts=0,hear=false,$=function(i){return document.getElementById(i)},names={mild:"Mild",spicy:"Spicy",extra:"Extra Spicy"};
function cue(kind){if(!hear||!window.TPSound)return;if(kind==="card")TPSound.card();else if(kind==="done")TPSound.chime();else if(kind==="rem")TPSound.reminder()}
function shuffle(){deck=D[lvl].slice();for(var i=deck.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1)),t=deck[i];deck[i]=deck[j];deck[j]=t}}
function instr(){return na?"<b>If you have:</b> fold a finger or score a point.":"<b>If you have:</b> take one small drink <i>or</i> fold a finger / score a point. Passing is always fine."}
function next(){var c=$("card");
 if(rem&&shown>0&&shown%8===0&&!c.dataset.rem){c.dataset.rem=1;c.classList.add("rem");$("lvl").textContent="Gentle reminder";$("prompt").textContent=D.reminders[(shown/8-1)%D.reminders.length];$("instr").innerHTML="Take your time. Tap next when ready.";cue("rem");return}
 delete c.dataset.rem;c.classList.remove("rem");
 if(!deck.length){$("lvl").textContent="Deck complete 🎉";$("prompt").textContent="You've seen every "+names[lvl]+" card!";$("instr").innerHTML="Tap Reshuffle to play again, or pick another level.";$("left").textContent="";cue("done");return}
 shown++;$("lvl").textContent=names[lvl]+" · card "+shown;$("prompt").textContent=deck.pop();$("instr").innerHTML=instr();$("left").textContent=deck.length+" cards left in deck";cue("card")}
function setL(l){lvl=l;document.querySelectorAll("#lvls .chip").forEach(function(b){b.setAttribute("aria-pressed",b.dataset.l===l)});shown=0;shuffle();next()}
document.querySelectorAll("#lvls .chip").forEach(function(b){b.onclick=function(){setL(b.dataset.l)}});
$("na").checked=na;$("na").onchange=function(){na=this.checked;if(!$("card").dataset.rem&&deck)$("instr").innerHTML=instr()};
$("next").onclick=next;$("shuf").onclick=function(){hear=false;setL(lvl);hear=true;if(window.TPSound)TPSound.chime()};
$("card").onclick=next;
var x0=null;$("card").addEventListener("touchstart",function(e){x0=e.touches[0].clientX},{passive:true});
$("card").addEventListener("touchend",function(e){if(x0!==null&&Math.abs(e.changedTouches[0].clientX-x0)>50){e.preventDefault();next()}x0=null});
$("plus").onclick=function(){$("pts").textContent=++pts;if(window.TPSound)TPSound.blip(true)};$("minus").onclick=function(){$("pts").textContent=pts=Math.max(0,pts-1);if(window.TPSound)TPSound.blip(false)};
var wl;function lock(){if("wakeLock" in navigator)navigator.wakeLock.request("screen").then(function(w){wl=w}).catch(function(){})}
lock();document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible")lock()});
setL(lvl);
hear=true;
if(window.TPSound)TPSound.bindMute($("mute"));
})();
