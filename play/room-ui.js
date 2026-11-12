/* Shared room chrome for every hosted game (all 14 room pages load this).
   - One Menu holds the secondary actions: invite, reveal, reactions, own line, players, rules, sound, restart, close or leave.
   - One Invite sheet with a QR code, Share, Copy link and Copy code. The QR library loads only when it is opened.
   - One slim line that is always visible: sips are optional, water counts, pass any time, Play responsibly.
   - One main action pinned at the bottom for the host (Start, Reveal when everyone is in, Next, Play again).
   The games' own buttons are not replaced. They are hidden visually and the Menu forwards taps to them,
   so every game keeps its own handlers and state. Nothing here touches Firebase. */
(function(){
"use strict";
var d=document, app=d.getElementById("app");
if(!app||!d.getElementById("lobby")) return;
var body=d.body, ROOT=body.getAttribute("data-root")||"";
var SELF=(d.currentScript&&d.currentScript.src)||"";
var BASE=SELF.replace(/[^\/]*$/,"");

/* Controls that move into the Menu or the Invite sheet. Hidden visually, still in the page. */
var HIDE_SEL=[
  "#copybtn","#sharebtn","#copylink","#copycode","#qrhide","#qrfig","#sharelink",".nh-share",".mlt-share",".poster-share",
  "canvas#qr",".mlt-qr",'[data-act="copy"]','[data-act="share"]',
  "#plist button.x","#close","#closestage","#leave","#leavestage",'[data-act="close"]','[data-act="leave"]',
  "#react","#revealbtn",'[data-act="reveal"]'
];
var CLOSE_SEL="#close,#closestage,#leave,#leavestage,[data-act=\"close\"],[data-act=\"leave\"]";
var REVEAL_SEL="#revealbtn,[data-act=\"reveal\"]";
var PRIMARY={
  lobby:["#start","#startbtn",'[data-act="start"]'],
  round:["#dealbtn","#nextround","#nextbtn",'[data-act="next"]',"#draw"],
  over:["#again","#playagain",'[data-act="again"]']
};

function q(s,r){return (r||d).querySelector(s)}
function qa(s,r){return Array.prototype.slice.call((r||d).querySelectorAll(s))}
function shown(el){return !!el&&!el.classList.contains("hide")&&!el.closest(".hide")}
function setCls(el,c,on){if(el&&el.classList.contains(c)!==!!on) el.classList.toggle(c,!!on)}
function setAttr(el,k,v){if(el&&el.getAttribute(k)!==v) el.setAttribute(k,v)}
function mk(tag,cls,text){var n=d.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n}
function allIn(){return body.getAttribute("data-rm-allin")==="1"}

function state(){
  if(shown(q("#over"))||shown(q("#finale"))) return "over";
  if(shown(q("#lobby"))) return "lobby";
  if(shown(q("#stage"))||shown(q("#table"))) return "round";
  return "home";
}
function roomCode(){var c=q("#codebig");return c?c.textContent.trim():""}
function roomUrl(){var l=q("#sharelink"),t=l?l.textContent.trim():"";return t||location.href}

/* ---------- structure ---------- */
var bar=mk("div","rm-bar"); bar.id="rmbar";
var chip=mk("span","rm-chip"); chip.id="rmchip";
var menuBtn=mk("button","rm-menubtn"); menuBtn.type="button"; menuBtn.id="rmmenubtn";
menuBtn.setAttribute("aria-haspopup","dialog"); menuBtn.setAttribute("aria-controls","rmsheet"); menuBtn.setAttribute("aria-expanded","false");
menuBtn.innerHTML="<span aria-hidden=\"true\">⋯</span> <span>Menu</span>";
bar.appendChild(chip); bar.appendChild(menuBtn);
app.insertBefore(bar,app.firstChild);

var scrim=mk("div","rm-scrim"); scrim.hidden=true;
var sheet=mk("div","rm-sheet"); sheet.id="rmsheet"; sheet.hidden=true;
sheet.setAttribute("role","dialog"); sheet.setAttribute("aria-modal","true"); sheet.setAttribute("aria-label","Room menu");
var sheetHead=mk("div","rm-sheet-head"); sheetHead.appendChild(mk("h3",null,"Menu"));
var sheetClose=mk("button","rm-x","Close"); sheetClose.type="button"; sheetClose.setAttribute("aria-label","Close menu"); sheetHead.appendChild(sheetClose);
var items=mk("div","rm-items");
var extra=mk("div","rm-extra"); extra.id="rmextra";
sheet.appendChild(sheetHead); sheet.appendChild(items); sheet.appendChild(extra);

var invite=mk("div","rm-invite"); invite.id="rminvite"; invite.hidden=true;
invite.setAttribute("role","dialog"); invite.setAttribute("aria-modal","true"); invite.setAttribute("aria-labelledby","rminvitetitle");
invite.innerHTML=
  "<h2 id=\"rminvitetitle\">Invite friends</h2>"+
  "<p class=\"rm-bigcode\" id=\"rmcodebig\" aria-live=\"polite\"></p>"+
  "<canvas id=\"rmqr\" width=\"180\" height=\"180\" role=\"img\" aria-label=\"QR code to join\"></canvas>"+
  "<p class=\"rm-linktext\" id=\"rmlink\"></p>"+
  "<div class=\"rm-row\"><button type=\"button\" class=\"btn\" id=\"rmshare\">Share</button>"+
  "<button type=\"button\" class=\"btn\" id=\"rmcopylink\">Copy link</button>"+
  "<button type=\"button\" class=\"btn\" id=\"rmcopycode\">Copy code</button></div>"+
  "<button type=\"button\" class=\"btn alt\" id=\"rminviteclose\">Done</button>"+
  "<p class=\"sr\" id=\"rmcredit\"></p>";

var strip=mk("div","rm-strip"); strip.setAttribute("role","note");
strip.appendChild(d.createTextNode("Sips are optional. Water counts. Pass any time. "));
var sa=mk("a",null,"Play responsibly"); sa.href=ROOT+"responsible.html"; strip.appendChild(sa);

body.appendChild(scrim); body.appendChild(sheet); body.appendChild(invite); body.appendChild(strip);
body.classList.add("rm-on");

/* Controls that live in the games' own markup move into the Menu (listeners are bound by id, so they keep working). */
["#custombox","details.poster-rules"].forEach(function(s){var n=q(s); if(n) extra.appendChild(n)});

/* One Invite button under the code in the lobby. */
var codeEl=q("#codebig");
var inviteBtn=mk("button","btn rm-invitebtn","Invite friends"); inviteBtn.type="button";
if(codeEl&&codeEl.parentNode) codeEl.parentNode.insertBefore(inviteBtn,codeEl.nextSibling);

/* Emoji picker: one optional chip instead of twelve buttons. */
var emojis=q("#emojis"), emoTag=null, emoChip=null, EMO_DEFAULT="😀 Pick an emoji (optional)";
if(emojis){
  emoTag=emojis.previousElementSibling&&/emoji/i.test(emojis.previousElementSibling.textContent)?emojis.previousElementSibling:null;
  emoChip=mk("button","chip rm-emo-chip",EMO_DEFAULT); emoChip.type="button"; emoChip.setAttribute("aria-expanded","false");
  emojis.parentNode.insertBefore(emoChip,emojis);
  if(emoTag) emoTag.classList.add("rm-gone");
  emoChip.addEventListener("click",function(){
    var open=!emojis.classList.contains("rm-open");
    emojis.classList.toggle("rm-open",open); emoChip.setAttribute("aria-expanded",open?"true":"false");
  });
  emojis.addEventListener("click",function(e){
    var t=e.target; if(t&&t.nodeType!==1) t=t.parentElement;
    var b=t&&t.closest?t.closest("button"):null; if(!b) return;
    setTimeout(function(){emojis.classList.remove("rm-open"); emoChip.setAttribute("aria-expanded","false"); paintEmoji()},0);
  });
}
function paintEmoji(){
  if(!emoChip||!emojis) return;
  var on=emojis.querySelector('button[aria-pressed="true"]'), t=on?on.textContent.trim():"";
  var label=(t&&!/^[·.\s]*$/.test(t))?t+" Your emoji":EMO_DEFAULT;
  if(emoChip.textContent!==label) emoChip.textContent=label;
}

/* ---------- state-driven bits ---------- */
var last="";
function refresh(){
  var st=state();
  setAttr(body,"data-rm-state",st);
  setCls(body,"rm-room",st!=="home");
  var code=roomCode(); if(chip.textContent!==(code?"Room "+code:"")) chip.textContent=code?"Room "+code:"";
  /* the one main action */
  var cand=null, list=PRIMARY[st]||[], i, el;
  for(i=0;i<list.length&&!cand;i++){el=q(list[i]); if(shown(el)) cand=el}
  if(!cand&&st==="round"&&allIn()){var rv=q(REVEAL_SEL); if(shown(rv)) cand=rv}
  qa(".rm-primary").forEach(function(n){if(n!==cand) n.classList.remove("rm-primary")});
  if(cand) setCls(cand,"rm-primary",true);
  setCls(body,"rm-has-primary",!!cand);
  /* hide the moved controls from keyboard and screen readers too */
  qa(HIDE_SEL.join(",")).forEach(function(n){
    if(n.classList.contains("rm-primary")){n.removeAttribute("tabindex");n.removeAttribute("aria-hidden");return}
    setAttr(n,"tabindex","-1"); setAttr(n,"aria-hidden","true");
  });
  qa("[data-restart]").forEach(function(n){
    if(st==="over"){n.removeAttribute("aria-hidden");qa("button",n).forEach(function(b){b.removeAttribute("tabindex")})}
    else {setAttr(n,"aria-hidden","true");qa("button",n).forEach(function(b){setAttr(b,"tabindex","-1")})}
  });
  /* Pass stays visible, but quiet */
  qa("#stage button,#table button").forEach(function(b){setCls(b,"rm-pass",/^Pass\b/.test(b.textContent.trim()))});
  paintEmoji();
  var sig=st+"|"+code; if(sig!==last){last=sig}
}
var queued=false;
function schedule(){if(queued) return; queued=true; (window.requestAnimationFrame||setTimeout)(function(){queued=false; refresh()})}
try{
  new MutationObserver(schedule).observe(app,{subtree:true,childList:true,attributes:true,attributeFilter:["class","hidden"]});
  new MutationObserver(schedule).observe(body,{attributes:true,attributeFilter:["data-rm-allin"]});
}catch(e){}

/* ---------- menu ---------- */
var lastFocus=null;
function openSheet(){
  buildMenu(); scrim.hidden=false; sheet.hidden=false; setAttr(menuBtn,"aria-expanded","true"); lastFocus=d.activeElement;
  var f=sheet.querySelector("button,input,summary"); if(f) f.focus();
}
function closeSheet(){
  if(sheet.hidden) return; sheet.hidden=true; if(invite.hidden) scrim.hidden=true; setAttr(menuBtn,"aria-expanded","false");
  if(lastFocus&&lastFocus.focus){try{lastFocus.focus()}catch(e){}}
}
function section(title){items.appendChild(mk("h4",null,title))}
function item(label,fn,cls){
  var b=mk("button","rm-item"+(cls?" "+cls:""),label); b.type="button";
  b.addEventListener("click",function(){closeSheet(); fn()});
  items.appendChild(b); return b;
}
function proxy(el){return function(){try{el.click()}catch(e){}}}
function firstAvail(sel){var l=qa(sel),i;for(i=0;i<l.length;i++){if(shown(l[i])) return l[i]}return null}
function soundOn(){return !window.TPSound||window.TPSound.enabled()}
function soundLabel(){return (soundOn()?"🔊":"🔇")+" Sound: "+(soundOn()?"on":"off")}
function buildMenu(){
  items.textContent="";
  var st=state();
  section("Invite");
  item("Invite friends…",openInvite);
  var rev=firstAvail(REVEAL_SEL);
  if(rev&&!rev.classList.contains("rm-primary")){
    section("Host");
    item(rev.textContent.trim()||"Reveal now",proxy(rev));
  }
  var emos=qa("#react [data-emo]");
  if(emos.length){
    section("React");
    var row=mk("div","rm-emorow");
    emos.forEach(function(e){
      var b=mk("button","rm-emo",e.textContent.trim()); b.type="button"; b.setAttribute("aria-label",e.getAttribute("aria-label")||"React");
      b.addEventListener("click",function(){try{e.click()}catch(x){}});
      row.appendChild(b);
    });
    items.appendChild(row);
  }
  var kicks=qa("#plist button.x");
  if(kicks.length){
    section("Players");
    kicks.forEach(function(k){
      var label=k.getAttribute("aria-label")||("Remove "+(k.parentNode?k.parentNode.textContent.replace(k.textContent,"").trim():"player"));
      item(label,proxy(k),"danger");
    });
  }
  section("Sound");
  var sb=mk("button","rm-item",soundLabel()); sb.type="button";
  sb.addEventListener("click",function(){
    if(!window.TPSound) return;
    window.TPSound.setEnabled(!soundOn());
    sb.textContent=soundLabel();
    if(soundOn()) window.TPSound.click();
  });
  items.appendChild(sb);
  var rs=null; qa("[data-restart] button").some(function(b){if(shown(b.parentNode)){rs=b;return true}return false});
  var close=firstAvail(CLOSE_SEL);
  if(rs||close){
    section("Room");
    if(rs) item(rs.textContent.trim(),proxy(rs));
    if(close) item(close.textContent.trim()||"Close room",proxy(close),/leave/i.test(close.textContent)?"":"danger");
  }
  extra.hidden=!(extra.querySelector("#custombox:not(.hide)")||extra.querySelector("details"));
}
menuBtn.addEventListener("click",function(){sheet.hidden?openSheet():closeSheet()});
sheetClose.addEventListener("click",closeSheet);

/* ---------- invite ---------- */
function loadScript(src,cb){var s=d.createElement("script");s.src=src;s.onload=function(){cb(false)};s.onerror=function(){cb(true)};d.head.appendChild(s)}
function drawQr(){
  var cv=q("#rmqr"), url=roomUrl();
  if(window.TipsyJoinQR&&typeof window.qrcode==="function"){window.TipsyJoinQR.draw(cv,url); return}
  loadScript(BASE+"qr.js?v=18",function(err){
    if(err) return;
    loadScript(BASE+"join-qr.js?v=1",function(err2){
      if(!err2&&window.TipsyJoinQR){window.TipsyJoinQR.draw(q("#rmqr"),roomUrl()); var c=q("#rmcredit"); if(c) c.textContent=window.TipsyJoinQR.credit}
    });
  });
}
function openInvite(){
  q("#rmcodebig").textContent=roomCode(); q("#rmlink").textContent=roomUrl();
  q("#rmshare").hidden=!navigator.share;
  scrim.hidden=false; invite.hidden=false; lastFocus=lastFocus||d.activeElement;
  drawQr(); var f=q("#rmshare"); (f&&!f.hidden?f:q("#rmcopylink")).focus();
}
function closeInvite(){invite.hidden=true; if(sheet.hidden) scrim.hidden=true; if(lastFocus&&lastFocus.focus){try{lastFocus.focus()}catch(e){}} lastFocus=null}
function copy(text,btn,done){
  function ok(){var old=btn.getAttribute("data-label")||btn.textContent;btn.setAttribute("data-label",old);btn.textContent=done;setTimeout(function(){btn.textContent=old},1500)}
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(ok,function(){})}
  else {var t=mk("textarea");t.value=text;t.setAttribute("readonly","");t.style.position="fixed";t.style.opacity="0";body.appendChild(t);t.select();try{d.execCommand("copy");ok()}catch(e){}body.removeChild(t)}
}
q("#rmshare").addEventListener("click",function(){
  var url=roomUrl(), code=roomCode();
  if(navigator.share){navigator.share({title:"TipsyPlay",text:"Join my room"+(code?" "+code:""),url:url}).catch(function(){})}
  else copy(url,q("#rmcopylink"),"Copied")
});
q("#rmcopylink").addEventListener("click",function(){copy(roomUrl(),this,"Copied")});
q("#rmcopycode").addEventListener("click",function(){copy(roomCode(),this,"Copied")});
q("#rminviteclose").addEventListener("click",closeInvite);
inviteBtn.addEventListener("click",function(){lastFocus=inviteBtn; openInvite()});

scrim.addEventListener("click",function(){closeInvite(); closeSheet()});
d.addEventListener("keydown",function(e){
  if(e.key==="Escape"){ if(!invite.hidden) closeInvite(); else closeSheet(); return }
  if(e.key!=="Tab") return;
  var box=!invite.hidden?invite:(!sheet.hidden?sheet:null); if(!box) return;
  var f=qa("button:not([hidden]),a[href],input,summary,[tabindex]:not([tabindex='-1'])",box).filter(function(n){return n.offsetParent!==null});
  if(!f.length) return;
  var first=f[0], lastEl=f[f.length-1];
  if(e.shiftKey&&d.activeElement===first){e.preventDefault();lastEl.focus()}
  else if(!e.shiftKey&&d.activeElement===lastEl){e.preventDefault();first.focus()}
});

refresh();
window.RoomUI={refresh:refresh,state:state,openMenu:openSheet,openInvite:openInvite};
})();
