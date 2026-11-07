/* Local room QR. Uses play/qr.js (Kazuhiko Arase, MIT), in the page.
   No image is fetched from a QR website. No camera permission. */
(function(global){
"use strict";
var CREDIT="QR Code is a registered trademark of DENSO WAVE INCORPORATED. Generated on this device. Generator © 2009 Kazuhiko Arase, MIT License.";
function inviteUrl(origin, path, code, game){
  if(global.PosterLogic && global.PosterLogic.inviteUrl) return global.PosterLogic.inviteUrl(origin, path, code, game);
  var host="", base, local;
  try{host=new URL(origin).host}catch(e){host=String(origin||"").replace(/^https?:\/\//,"").split("/")[0]}
  local=/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
  base=local?String(origin||"").replace(/\/$/,"")+path:"https://tipsyplay.com"+path;
  return base+"?room="+code+"&game="+game;
}
function pageInvite(path, code, game){
  var origin=(global.location && global.location.origin) || "https://tipsyplay.com";
  return inviteUrl(origin, path, code, game);
}
function draw(canvas, url){
  if(!canvas || !url || typeof global.qrcode!=="function") return false;
  var qr=global.qrcode(0, "M");
  qr.addData(url, "Byte");
  qr.make();
  var n=qr.getModuleCount(), quiet=4, cells=n+quiet*2;
  var scale=Math.max(3, Math.floor(180/cells));
  var px=cells*scale;
  canvas.width=px;
  canvas.height=px;
  var ctx=canvas.getContext("2d");
  if(!ctx) return false;
  ctx.fillStyle="#ffffff";
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle="#000000";
  var r, c;
  for(r=0;r<n;r++){
    for(c=0;c<n;c++){
      if(qr.isDark(r, c)) ctx.fillRect((c+quiet)*scale, (r+quiet)*scale, scale, scale);
    }
  }
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "QR code to join. "+url);
  return true;
}
function readRoom(search){
  var raw=search==null?(global.location?global.location.search:"") : String(search);
  var m=raw.match(/[?&](?:room|code)=([A-Za-z]{4})/i);
  return m?m[1].toUpperCase():"";
}
function stash(gameKey, search){
  var code=readRoom(search);
  if(!code || !global.sessionStorage) return code;
  try{global.sessionStorage.setItem("tp_invite_"+gameKey, code)}catch(e){}
  return code;
}
function prefill(inputId, gameKey){
  var code=stash(gameKey);
  if(!code && global.sessionStorage){
    try{code=global.sessionStorage.getItem("tp_invite_"+gameKey)||""}catch(e){code=""}
  }
  var input=global.document && global.document.getElementById(inputId);
  if(input && code && !input.value) input.value=code;
  return code||"";
}
function mount(opts){
  opts=opts||{};
  var canvas=opts.canvas;
  var url=opts.url||"";
  if(canvas) draw(canvas, url);
  if(opts.link) opts.link.textContent=url;
  if(opts.codeEl && opts.code) opts.codeEl.textContent=opts.code;
  if(opts.creditEl) opts.creditEl.textContent=CREDIT;
  return url;
}
global.TipsyJoinQR={
  credit:CREDIT,
  inviteUrl:inviteUrl,
  pageInvite:pageInvite,
  draw:draw,
  readRoom:readRoom,
  stash:stash,
  prefill:prefill,
  mount:mount
};
if(typeof module!=="undefined" && module.exports) module.exports=global.TipsyJoinQR;
})(typeof window!=="undefined"?window:globalThis);
