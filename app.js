(function(){
var NOTICE="You must be of legal drinking age in your location.";
var root=document.body.dataset.root||"";
// age gate
if(localStorage.getItem("tp_age_ok")!=="yes"){
 var g=document.createElement("div");g.id="gate";
 g.innerHTML='<div class="card"><div style="font-size:3rem">🥂</div><h1>Welcome to TipsyPlay</h1><p><strong>'+NOTICE+'</strong></p><p>Are you of legal drinking age where you are?</p><div class="row"><button class="btn" id="gyes">Yes, I am</button><button class="btn alt" id="gno">No</button></div><p id="gmsg" class="hide">Thanks for being honest! TipsyPlay isn\'t for you just yet — come back when you\'re of legal age. Take care! 👋</p></div>';
 document.body.appendChild(g);document.documentElement.style.overflow="hidden";
 g.querySelector("#gyes").onclick=function(){localStorage.setItem("tp_age_ok","yes");g.remove();document.documentElement.style.overflow=""};
 g.querySelector("#gno").onclick=function(){g.querySelector(".row").classList.add("hide");g.querySelector("#gmsg").classList.remove("hide")};
}
// footer
var f=document.querySelector("footer");
if(f&&!f.hasAttribute("data-keep"))f.innerHTML='<p><strong>'+NOTICE+'</strong></p><p>Every game is opt-in. Non-alcoholic drinks are always welcome. Never drink and drive.</p><a href="'+root+'responsible.html">Responsible play</a> · <a href="'+root+'games/">Games</a><p>© TipsyPlay</p>';
// library filters
var list=document.getElementById("games");
if(list){
 var state={players:"any",supplies:"any",vibe:"any",phone:false};
 function apply(){var n=0;list.querySelectorAll(".card").forEach(function(c){var d=c.dataset,ok=true;
  if(state.players!=="any"){var p=+state.players;ok=ok&&p>=+d.min&&p<=+d.max}
  if(state.supplies!=="any")ok=ok&&d.supplies===state.supplies;
  if(state.vibe!=="any")ok=ok&&d.vibe===state.vibe;
  if(state.phone)ok=ok&&d.phone==="yes";
  c.classList.toggle("hide",!ok);if(ok)n++});document.getElementById("count").textContent=n+" game"+(n==1?"":"s")}
 document.querySelectorAll("select[data-f]").forEach(function(s){s.onchange=function(){state[s.dataset.f]=s.value;apply()}});
 document.querySelectorAll(".chip[data-vibe]").forEach(function(b){b.onclick=function(){var on=b.getAttribute("aria-pressed")!=="true";document.querySelectorAll(".chip[data-vibe]").forEach(function(x){x.setAttribute("aria-pressed","false")});b.setAttribute("aria-pressed",on);state.vibe=on?b.dataset.vibe:"any";apply()}});
 var ph=document.getElementById("fphone");ph.onclick=function(){state.phone=!state.phone;ph.setAttribute("aria-pressed",state.phone);apply()};
 apply();
}
// tab bar
var path=location.pathname,tabs=[["index.html","🏠","Home"],["games/","🎲","Games"],["favourites.html","❤️","Favourites"],["settings.html","⚙️","Settings"]];
function tabOn(file){
 if(file==="index.html")return path==="/"||path==="/index.html";
 if(file==="games/")return /\/games(\/|$)/.test(path)||/\/play\//.test(path)||path.endsWith("/library.html");
 return path.endsWith("/"+file);
}
var tb=document.createElement("nav");tb.className="tabbar";tb.setAttribute("aria-label","App tabs");
tb.innerHTML=tabs.map(function(t){var on=tabOn(t[0]);return '<a href="'+root+t[0]+'"'+(on?' class="on" aria-current="page"':'')+'><span>'+t[1]+'</span>'+t[2]+'</a>'}).join("");
document.body.appendChild(tb);
// favourites
function favs(){try{return JSON.parse(localStorage.getItem("tp_favs")||"{}")}catch(e){return {}}}
if(list){list.querySelectorAll(".card").forEach(function(c){var b=document.createElement("button");b.className="heart";var id=c.dataset.id;
 function draw(){var on=!!favs()[id];b.textContent=on?"❤️":"🤍";b.setAttribute("aria-pressed",on);b.setAttribute("aria-label",(on?"Remove ":"Add ")+"favourite")}
 b.onclick=function(){var f=favs();if(f[id])delete f[id];else{var cl=c.cloneNode(true);cl.querySelector(".heart").remove();cl.classList.remove("hide");f[id]=cl.outerHTML}localStorage.setItem("tp_favs",JSON.stringify(f));draw()};
 draw();c.appendChild(b)})}
var fv=document.getElementById("favs");
if(fv){var render=function(){var f=favs(),k=Object.keys(f);fv.innerHTML=k.map(function(i){return f[i]}).join("");document.getElementById("nofav").classList.toggle("hide",k.length>0);
 fv.querySelectorAll(".card").forEach(function(c){var b=document.createElement("button");b.className="heart";b.textContent="❤️";b.setAttribute("aria-label","Remove favourite");b.onclick=function(){var f=favs();delete f[c.dataset.id];localStorage.setItem("tp_favs",JSON.stringify(f));render()};c.appendChild(b)})};render()}
// settings
var sn=document.getElementById("s_na");
if(sn){var sr=document.getElementById("s_rem"),ss=document.getElementById("s_spice"),sd=document.getElementById("s_sound");
 sn.checked=localStorage.getItem("tp_na")==="on";sr.checked=localStorage.getItem("tp_rem")!=="off";ss.value=localStorage.getItem("tp_spice")||"mild";
 sn.onchange=function(){localStorage.setItem("tp_na",sn.checked?"on":"off")};sr.onchange=function(){localStorage.setItem("tp_rem",sr.checked?"on":"off")};ss.onchange=function(){localStorage.setItem("tp_spice",ss.value)};
 if(sd&&window.TPSound){sd.checked=TPSound.enabled();sd.onchange=function(){TPSound.setEnabled(sd.checked);if(sd.checked)TPSound.click()}}
 document.getElementById("s_age").onclick=function(){localStorage.removeItem("tp_age_ok");document.getElementById("s_msg").textContent="Done — reloading…";setTimeout(function(){location.reload()},600)}}
document.addEventListener("click",function(e){var el=e.target;if(!el)return;if(el.nodeType!==1)el=el.parentElement;if(!el||!el.closest)return;var b=el.closest("button");if(!b)return;if(b.id==="next"||b.id==="shuf"||b.id==="plus"||b.id==="minus"||b.id==="mute"||b.closest("#lvls")||b.dataset.cue)return;if(window.TPSound)TPSound.click()},true);
// service worker
if("serviceWorker" in navigator&&location.protocol!=="file:"){window.addEventListener("load",function(){navigator.serviceWorker.register(root+"sw.js").then(function(r){window.__swOK=true}).catch(function(e){console.warn("SW failed",e)})})}
})();
