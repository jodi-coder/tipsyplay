/* Five Letter Frenzy: sounds, confetti and the share card. No files, no libraries.
   Every sound is made here with the Web Audio API and played through TPSound.custom, so the page's
   mute button silences it, the choice is remembered, and nothing sounds before the player's first tap.
   Nothing here touches the game's rules, scoring or Firebase. */
(function(root){
"use strict";

/* One knob for the whole game's loudness. 1 is the designed level; 0.5 is half as loud. */
var VOLUME=0.6;

/* Tile reveal timing, shared with the page so sound and motion line up. */
var STEP_MS=120, FLIP_MS=320;

function sound(fn){
  var S=root.TPSound;
  if(!S||typeof S.custom!=="function") return;
  S.custom(function(ctx, out, t){
    var bus=ctx.createGain(); bus.gain.value=VOLUME; bus.connect(out);
    fn(ctx, bus, t);
  });
}
/* One soft note: a quick fade in so it never clicks, then a smooth fade out. */
function note(ctx, out, t, freq, dur, peak, type, glideTo, cutoff){
  var o=ctx.createOscillator(), g=ctx.createGain(), f=ctx.createBiquadFilter();
  o.type=type||"sine";
  o.frequency.setValueAtTime(freq, t);
  if(glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t+dur);
  f.type="lowpass"; f.frequency.value=cutoff||4000; f.Q.value=0.4;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t+Math.min(0.012, dur*0.25));
  g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
  o.connect(f); f.connect(g); g.connect(out);
  o.start(t); o.stop(t+dur+0.02);
}
/* A breath of filtered noise, for the tick and the soft thud. */
function puff(ctx, out, t, dur, peak, centre, q){
  var len=Math.max(1, Math.floor(ctx.sampleRate*dur)), buf=ctx.createBuffer(1, len, ctx.sampleRate), d=buf.getChannelData(0), i;
  for(i=0;i<len;i++){var k=1-i/len; d[i]=(Math.random()*2-1)*k*k}
  var src=ctx.createBufferSource(), f=ctx.createBiquadFilter(), g=ctx.createGain();
  src.buffer=buf; f.type="bandpass"; f.frequency.value=centre; f.Q.value=q||1;
  g.gain.setValueAtTime(Math.max(peak, 0.0002), t);
  g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
  src.connect(f); f.connect(g); g.connect(out);
  src.start(t); src.stop(t+dur+0.02);
}

/* ---------- the sounds ---------- */
/* Typing a letter: a very quiet, short tick. */
function type(){sound(function(c, o, t){puff(c, o, t, 0.03, 0.05, 3200, 1.4); note(c, o, t, 1500, 0.035, 0.018, "sine")})}
/* One tile turning over. locked: a bright note. moved: a middle note. absent: a soft low thud. */
function tileAt(c, o, t, mark){
  if(mark==="locked"){note(c, o, t, 1046.5, 0.22, 0.12, "sine"); note(c, o, t, 2093, 0.12, 0.025, "sine")}
  else if(mark==="moved"){note(c, o, t, 659.25, 0.2, 0.1, "triangle", null, 2400)}
  else{note(c, o, t, 150, 0.16, 0.16, "sine", 95); puff(c, o, t, 0.06, 0.04, 260, 0.9)}
}
/* A whole row, one note per tile, timed to the flips. */
function reveal(marks){
  sound(function(c, o, t){(marks||[]).forEach(function(m, i){tileAt(c, o, t+i*STEP_MS/1000+FLIP_MS/2000, m)})});
}
/* A refused guess: short, low and soft. */
function reject(){sound(function(c, o, t){note(c, o, t, 146.8, 0.2, 0.07, "triangle", 130, 700); note(c, o, t+0.004, 151, 0.2, 0.05, "triangle", 134, 700)})}
/* Your turn: two light notes, a fourth apart. */
function turn(){sound(function(c, o, t){note(c, o, t, 659.25, 0.18, 0.085, "sine"); note(c, o, t+0.11, 880, 0.24, 0.085, "sine")})}
/* Solved: a short happy climb, about a second long. starts after the row has flipped. */
function solved(delayMs){
  sound(function(c, o, t){
    var s=t+(delayMs||0)/1000;
    [523.25, 659.25, 783.99, 1046.5].forEach(function(f, i){note(c, o, s+i*0.12, f, 0.3, 0.09, "triangle", null, 3200)});
    note(c, o, s+0.48, 1318.5, 0.45, 0.07, "sine");
    note(c, o, s+0.48, 659.25, 0.45, 0.04, "sine");
  });
}
/* Out of guesses: three gentle steps down, soft, never a fail horn. */
function outOfGuesses(){sound(function(c, o, t){[392, 329.6, 261.6].forEach(function(f, i){note(c, o, t+i*0.13, f, 0.26, 0.07, "sine")})})}
/* Drink moment: a short glassy clink. Two bright partials that fade fast. */
function clink(){
  sound(function(c, o, t){
    puff(c, o, t, 0.012, 0.03, 6000, 2);
    note(c, o, t, 2489, 0.28, 0.05, "sine");
    note(c, o, t, 3729, 0.18, 0.025, "sine");
    note(c, o, t+0.07, 2637, 0.22, 0.03, "sine");
  });
}

/* ---------- confetti ---------- */
function reduced(){try{return !!(root.matchMedia&&root.matchMedia("(prefers-reduced-motion: reduce)").matches)}catch(e){return false}}
/* Colours come from the theme tokens in styles.css, read at run time. */
function tokenColors(){
  var cs=getComputedStyle(document.documentElement), out=[];
  ["--primary","--tile-pink","--tile-green","--surface","--ink"].forEach(function(k){var v=cs.getPropertyValue(k).trim(); if(v) out.push(v)});
  return out;
}
var running=null;
/* A short burst from the top of the screen. Stops on its own in under 2 seconds. */
function confetti(){
  if(reduced()||!document.body) return false;
  var colors=tokenColors();
  if(!colors.length) return false;
  if(running) running.stop();
  var cv=document.createElement("canvas"), ctx=cv.getContext&&cv.getContext("2d");
  if(!ctx) return false;
  var dpr=Math.min(2, root.devicePixelRatio||1), w=root.innerWidth, h=root.innerHeight;
  cv.className="fl-confetti"; cv.setAttribute("aria-hidden", "true");
  cv.width=Math.round(w*dpr); cv.height=Math.round(h*dpr);
  document.body.appendChild(cv);
  ctx.scale(dpr, dpr);
  var parts=[], i, n=Math.min(110, Math.round(w/4));
  for(i=0;i<n;i++){
    parts.push({x:w*(0.15+Math.random()*0.7), y:h*0.28, vx:(Math.random()-0.5)*9, vy:-(5+Math.random()*7),
      s:5+Math.random()*6, r:Math.random()*6.28, vr:(Math.random()-0.5)*0.4, c:colors[i%colors.length]});
  }
  var start=0, LIFE=1700, raf=0, done=false;
  function stop(){if(done) return; done=true; if(raf) cancelAnimationFrame(raf); if(cv.parentNode) cv.parentNode.removeChild(cv); running=null}
  function frame(now){
    if(!start) start=now;
    var age=now-start;
    if(age>=LIFE){stop(); return}
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha=age>LIFE-400?Math.max(0, (LIFE-age)/400):1;
    parts.forEach(function(p){
      p.vy+=0.32; p.vx*=0.99; p.x+=p.vx; p.y+=p.vy; p.r+=p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle=p.c; ctx.strokeStyle=colors[colors.length-1]; ctx.lineWidth=1;
      ctx.fillRect(-p.s/2, -p.s/3, p.s, p.s*0.66); ctx.strokeRect(-p.s/2, -p.s/3, p.s, p.s*0.66);
      ctx.restore();
    });
    raf=requestAnimationFrame(frame);
  }
  raf=requestAnimationFrame(frame);
  setTimeout(stop, 2000); /* a hard stop, even if frames were throttled */
  running={stop:stop};
  return true;
}

/* ---------- share card ---------- */
/* rows: an array of five-mark arrays. Letters are never passed in, so they can never be drawn. */
function shareCanvas(rows, info){
  info=info||{};
  var cs=getComputedStyle(document.documentElement);
  /* every colour is a theme token; nothing is hard-coded */
  function tok(k){return cs.getPropertyValue(k).trim()}
  var C={bg:tok("--bg"), surface:tok("--surface"), ink:tok("--ink"), lock:tok("--tile-yellow"), move:tok("--tile-pink")};
  var font=getComputedStyle(document.body).fontFamily||"sans-serif";
  var cell=88, gap=12, pad=48, n=Math.max(1, rows.length);
  var W=pad*2+cell*5+gap*4, H=pad+70+n*(cell+gap)-gap+40+60+pad;
  var cv=document.createElement("canvas"); cv.width=W; cv.height=H;
  var x=cv.getContext("2d");
  x.fillStyle=C.bg; x.fillRect(0, 0, W, H);
  x.fillStyle=C.ink; x.textAlign="center"; x.textBaseline="middle";
  x.font="800 40px "+font; x.fillText("Five Letter Frenzy", W/2, pad+20);
  x.font="700 24px "+font; x.fillText(info.solved?"Solved in "+rows.length+"/"+(info.max||6):"Not solved · "+rows.length+"/"+(info.max||6), W/2, pad+58);
  rows.forEach(function(marks, r){
    (marks||[]).forEach(function(m, i){
      var cx=pad+i*(cell+gap), cy=pad+90+r*(cell+gap);
      x.fillStyle=m==="locked"?C.lock:m==="moved"?C.move:C.ink;
      x.strokeStyle=C.ink; x.lineWidth=4;
      roundRect(x, cx, cy, cell, cell, 14); x.fill(); x.stroke();
      x.fillStyle=m==="absent"?C.surface:C.ink;
      x.font="800 40px "+font;
      x.fillText(m==="locked"?"●":m==="moved"?"↗":"×", cx+cell/2, cy+cell/2+2);
    });
  });
  x.fillStyle=C.ink; x.font="800 30px "+font;
  x.fillText("tipsyplay.com", W/2, H-pad-10);
  return cv;
}
function roundRect(x, a, b, w, h, r){x.beginPath(); x.moveTo(a+r, b); x.arcTo(a+w, b, a+w, b+h, r); x.arcTo(a+w, b+h, a, b+h, r); x.arcTo(a, b+h, a, b, r); x.arcTo(a, b, a+w, b, r); x.closePath()}
/* Share the image where the phone allows it; otherwise download it. Resolves to "shared", "downloaded" or "". */
function share(rows, info){
  var cv=shareCanvas(rows, info), name="five-letter-frenzy.png", text="Five Letter Frenzy on tipsyplay.com";
  return new Promise(function(resolve){
    if(!cv.toBlob){resolve(""); return}
    cv.toBlob(function(blob){
      if(!blob){resolve(""); return}
      var file=null;
      try{file=new File([blob], name, {type:"image/png"})}catch(e){file=null}
      if(file&&navigator.canShare&&navigator.share&&navigator.canShare({files:[file]})){
        navigator.share({files:[file], title:"Five Letter Frenzy", text:text}).then(function(){resolve("shared")}, function(){resolve("")});
        return;
      }
      var a=document.createElement("a"), url=URL.createObjectURL(blob);
      a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){URL.revokeObjectURL(url)}, 4000);
      resolve("downloaded");
    }, "image/png");
  });
}

root.FrenzyFX={VOLUME:VOLUME, STEP_MS:STEP_MS, FLIP_MS:FLIP_MS, reduced:reduced,
  type:type, reveal:reveal, reject:reject, turn:turn, solved:solved, outOfGuesses:outOfGuesses, clink:clink,
  confetti:confetti, shareCanvas:shareCanvas, share:share};
})(window);
