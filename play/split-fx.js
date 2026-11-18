/* Split Decision: short looping clips on the phone, as an enhancement only.
   A clip loads only when its phase starts (never in the lobby or on the home page).
   Still image instead of video on reduced motion, Save-Data, or 2g/3g.
   A missing clip falls back to its still; a missing still hides the strip,
   and the CSS animations in poster.css carry the moment on their own.
   The service worker does not cache anything under assets/video/. */
(function(global){
"use strict";
var L=global.PosterLogic;
var CLIPS={"tension-loop":1, "reveal-burst":1, "winner-celebrate":1};
var current="", box=null;

function base(){return (document.body.dataset.root||"../")+"assets/video/"}
function env(){
  var rm=false;
  try{rm=matchMedia("(prefers-reduced-motion: reduce)").matches}catch(e){}
  return {reducedMotion:rm, connection:navigator.connection||navigator.mozConnection||navigator.webkitConnection||null};
}
function mode(){return L&&L.mediaMode?L.mediaMode(env()):"still"}
function clear(){
  if(!box) return;
  var v=box.querySelector("video");
  if(v){try{v.pause()}catch(e){} v.removeAttribute("src"); Array.prototype.forEach.call(v.querySelectorAll("source"), function(s){s.removeAttribute("src")}); try{v.load()}catch(e){}}
  box.textContent="";
  box.classList.add("hide");
  box.removeAttribute("data-media");
}
function shown(kind, name){
  if(current!==name) return;
  box.classList.remove("hide");
  box.setAttribute("data-media", kind);
}
function still(name){
  if(current!==name) return;
  clear();
  var img=document.createElement("img");
  img.alt="";
  img.decoding="async";
  img.addEventListener("load", function(){shown("still", name)});
  img.addEventListener("error", function(){if(current===name) clear(); if(box) box.setAttribute("data-media", "none")});
  img.src=base()+name+".jpg";
  box.appendChild(img);
}
function video(name){
  clear();
  var v=document.createElement("video");
  v.muted=true; v.defaultMuted=true; v.loop=true; v.autoplay=true; v.playsInline=true;
  v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("aria-hidden", "true");
  v.preload="auto";
  v.poster=base()+name+".jpg";
  var fellBack=false;
  function fallback(){if(fellBack) return; fellBack=true; still(name)}
  [["webm","video/webm"],["mp4","video/mp4"]].forEach(function(t, i, all){
    var s=document.createElement("source");
    s.src=base()+name+"."+t[0]; s.type=t[1];
    if(i===all.length-1) s.addEventListener("error", fallback);
    v.appendChild(s);
  });
  v.addEventListener("error", fallback);
  v.addEventListener("loadeddata", function(){if(!fellBack) shown("video", name)});
  box.appendChild(v);
  var p=v.play&&v.play(); if(p&&p.catch) p.catch(function(){});
}
/* name: a clip name, or "" to clear. Safe to call on every render. */
function show(name){
  box=box||document.getElementById("sdfx");
  if(!box) return;
  if(!CLIPS[name]) name="";
  if(name===current) return;
  current=name;
  if(!name){clear(); return}
  if(mode()==="video") video(name);
  else still(name);
}
global.SplitFX={show:show, mode:mode};
})(window);
