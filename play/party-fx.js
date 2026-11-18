/* Sounds, confetti and the countdown ring for Hot Take Court and Category Countdown.
   Every sound is made here with the Web Audio API and played through TPSound.custom, so the page's mute button
   silences it, the choice is remembered, and nothing sounds before the first tap. No files, no libraries.
   The shared-screen sounds play on the device showing the shared screen (the TV, or the host's phone when there is
   no TV), so a table of phones does not play the same sound eight times. */
(function(root){
"use strict";

/* One knob for both games' loudness. 1 is the designed level. */
var VOLUME=0.6;
/* The optional lobby tune on the display is quieter still. */
var TUNE_VOLUME=0.35;

function sound(fn, vol){
  var S=root.TPSound;
  if(!S||typeof S.custom!=="function") return;
  S.custom(function(ctx, out, t){var bus=ctx.createGain(); bus.gain.value=(vol==null?VOLUME:vol); bus.connect(out); fn(ctx, bus, t)});
}
function note(c, o, t, f, dur, peak, type, glide, cutoff){
  var osc=c.createOscillator(), g=c.createGain(), lp=c.createBiquadFilter();
  osc.type=type||"sine"; osc.frequency.setValueAtTime(f, t);
  if(glide) osc.frequency.exponentialRampToValueAtTime(glide, t+dur);
  lp.type="lowpass"; lp.frequency.value=cutoff||4200; lp.Q.value=0.4;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t+Math.min(0.012, dur*0.25));
  g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
  osc.connect(lp); lp.connect(g); g.connect(o); osc.start(t); osc.stop(t+dur+0.02);
}
function puff(c, o, t, dur, peak, centre, q){
  var len=Math.max(1, Math.floor(c.sampleRate*dur)), buf=c.createBuffer(1, len, c.sampleRate), d=buf.getChannelData(0), i;
  for(i=0;i<len;i++){var k=1-i/len; d[i]=(Math.random()*2-1)*k*k}
  var src=c.createBufferSource(), f=c.createBiquadFilter(), g=c.createGain();
  src.buffer=buf; f.type="bandpass"; f.frequency.value=centre; f.Q.value=q||1;
  g.gain.setValueAtTime(Math.max(peak, 0.0002), t); g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
  src.connect(f); f.connect(g); g.connect(o); src.start(t); src.stop(t+dur+0.02);
}

/* ---------- shared ---------- */
var S={
  /* a quiet breath of air between phases */
  whoosh:function(){sound(function(c, o, t){puff(c, o, t, 0.22, 0.035, 900, 0.6)})},
  /* the last seconds of a timer */
  tick:function(){sound(function(c, o, t){note(c, o, t, 1320, 0.05, 0.03, "sine")})},
  /* it is your turn, on your phone only */
  turn:function(){sound(function(c, o, t){note(c, o, t, 659.25, 0.18, 0.085, "sine"); note(c, o, t+0.11, 880, 0.24, 0.085, "sine")})},
  /* a tap on one of your own buttons */
  click:function(){sound(function(c, o, t){puff(c, o, t, 0.02, 0.05, 2600, 1.2); note(c, o, t, 990, 0.04, 0.03, "sine")})},
  /* the drink moment */
  clink:function(){sound(function(c, o, t){puff(c, o, t, 0.012, 0.03, 6000, 2); note(c, o, t, 2489, 0.28, 0.05, "sine"); note(c, o, t, 3729, 0.18, 0.025, "sine"); note(c, o, t+0.07, 2637, 0.22, 0.03, "sine")})},
  /* an award card turning over */
  award:function(){sound(function(c, o, t){[1046.5, 1318.5, 1568].forEach(function(f, i){note(c, o, t+i*0.06, f, 0.22, 0.04, "sine")})})},
  /* the final scoreboard */
  fanfare:function(){sound(function(c, o, t){[523.25, 659.25, 783.99, 1046.5].forEach(function(f, i){note(c, o, t+i*0.12, f, 0.32, 0.08, "triangle", null, 3200)}); note(c, o, t+0.5, 1318.5, 0.45, 0.06, "sine")})}
};
/* ---------- Hot Take Court ---------- */
S.gavel=function(times){sound(function(c, o, t){for(var i=0;i<(times||1);i++){var s=t+i*0.16; note(c, o, s, 190, 0.12, 0.2, "sine", 95); puff(c, o, s, 0.05, 0.08, 520, 1.1)}})};
S.objection=function(){sound(function(c, o, t){note(c, o, t, 523.25, 0.12, 0.08, "triangle", null, 2400); note(c, o, t+0.09, 783.99, 0.2, 0.08, "triangle", null, 2400); puff(c, o, t, 0.04, 0.03, 1800, 1)})};
S.flip=function(){sound(function(c, o, t){puff(c, o, t, 0.035, 0.05, 2200, 1.4); note(c, o, t, 740, 0.06, 0.03, "sine")})};
/* result: "guilty", "not" or "hung" */
S.stamp=function(result){sound(function(c, o, t){
  note(c, o, t, 110, 0.18, 0.22, "sine", 60); puff(c, o, t, 0.08, 0.07, 300, 0.8);
  var chord=result==="not"?[523.25, 659.25, 783.99]:result==="guilty"?[440, 523.25, 659.25]:[587.33, 587.33*1.5];
  chord.forEach(function(f, i){note(c, o, t+0.08+i*0.025, f, 0.42, 0.05, "triangle", null, 2600)});
})};
/* ---------- Category Countdown ---------- */
S.count=function(go){sound(function(c, o, t){if(go){note(c, o, t, 880, 0.2, 0.08, "sine"); note(c, o, t, 1318.5, 0.2, 0.04, "sine")}else note(c, o, t, 660, 0.12, 0.06, "sine")})};
S.pop=function(){sound(function(c, o, t){note(c, o, t, 880, 0.09, 0.07, "triangle", 1180, 3000)})};
S.thud=function(){sound(function(c, o, t){note(c, o, t, 150, 0.16, 0.14, "sine", 95); puff(c, o, t, 0.06, 0.04, 260, 0.9)})};
S.ping=function(){sound(function(c, o, t){note(c, o, t, 1318.5, 0.12, 0.05, "sine")})};
S.knock=function(){sound(function(c, o, t){note(c, o, t, 523.25, 0.16, 0.07, "sine"); note(c, o, t+0.12, 392, 0.24, 0.07, "sine")})};
S.hit=function(){S.fanfare()};
S.miss=function(){sound(function(c, o, t){[392, 329.6, 261.6].forEach(function(f, i){note(c, o, t+i*0.13, f, 0.26, 0.07, "sine")})})};

/* ---------- the lobby tune (display only, off unless switched on) ---------- */
/* Four soft chords and a light pluck line, 88 bpm, scheduled one bar at a time. It obeys the mute button because
   every bar is played through TPSound.custom, and it stops the moment stopTune() is called. */
var tuneTimer=0, tuneBar=0;
var CHORDS=[[261.63, 329.63, 392], [220, 261.63, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66]];
var LINE=[[0, 784], [0.5, 659.25], [1, 523.25], [1.5, 659.25], [2, 587.33], [2.5, 523.25]];
function bar(){
  var chord=CHORDS[tuneBar%CHORDS.length], beat=60/88; tuneBar++;
  sound(function(c, o, t){
    chord.forEach(function(f){note(c, o, t, f, beat*3.8, 0.035, "sine", null, 1400)});
    LINE.forEach(function(n){note(c, o, t+n[0]*beat, n[1]*(tuneBar%2?1:0.89), beat*0.6, 0.025, "triangle", null, 2200)});
  }, TUNE_VOLUME);
}
function startTune(){if(tuneTimer) return; tuneBar=0; bar(); tuneTimer=setInterval(bar, Math.round(4*60000/88))}
function stopTune(){if(tuneTimer){clearInterval(tuneTimer); tuneTimer=0}}
function tuneOn(){return !!tuneTimer}

/* ---------- motion helpers ---------- */
function reduced(){try{return !!(root.matchMedia&&root.matchMedia("(prefers-reduced-motion: reduce)").matches)}catch(e){return false}}
function tokenColors(){
  var cs=getComputedStyle(document.documentElement), out=[];
  ["--primary","--tile-pink","--tile-green","--surface","--ink"].forEach(function(k){var v=cs.getPropertyValue(k).trim(); if(v) out.push(v)});
  return out;
}
var running=null;
/* A short burst that stops on its own in under 2 seconds. Nothing under reduced motion. */
function confetti(){
  if(reduced()||!document.body) return false;
  var colors=tokenColors(); if(!colors.length) return false;
  if(running) running.stop();
  var cv=document.createElement("canvas"), ctx=cv.getContext&&cv.getContext("2d"); if(!ctx) return false;
  var dpr=Math.min(2, root.devicePixelRatio||1), w=root.innerWidth, h=root.innerHeight;
  cv.className="px-confetti"; cv.setAttribute("aria-hidden", "true"); cv.width=Math.round(w*dpr); cv.height=Math.round(h*dpr);
  document.body.appendChild(cv); ctx.scale(dpr, dpr);
  var parts=[], i, n=Math.min(140, Math.round(w/4));
  for(i=0;i<n;i++) parts.push({x:w*(0.1+Math.random()*0.8), y:h*0.3, vx:(Math.random()-0.5)*10, vy:-(5+Math.random()*8), s:6+Math.random()*7, r:Math.random()*6.28, vr:(Math.random()-0.5)*0.4, c:colors[i%colors.length]});
  var start=0, LIFE=1700, raf=0, done=false;
  function stop(){if(done) return; done=true; if(raf) cancelAnimationFrame(raf); if(cv.parentNode) cv.parentNode.removeChild(cv); running=null}
  function frame(now){
    if(!start) start=now; var age=now-start; if(age>=LIFE){stop(); return}
    ctx.clearRect(0, 0, w, h); ctx.globalAlpha=age>LIFE-400?Math.max(0, (LIFE-age)/400):1;
    parts.forEach(function(p){p.vy+=0.32; p.vx*=0.99; p.x+=p.vx; p.y+=p.vy; p.r+=p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle=p.c; ctx.strokeStyle=colors[colors.length-1]; ctx.lineWidth=1; ctx.fillRect(-p.s/2, -p.s/3, p.s, p.s*0.66); ctx.strokeRect(-p.s/2, -p.s/3, p.s, p.s*0.66); ctx.restore()});
    raf=requestAnimationFrame(frame);
  }
  raf=requestAnimationFrame(frame); setTimeout(stop, 2000); running={stop:stop};
  return true;
}
/* A countdown ring: an SVG circle that empties, with the seconds in the middle so time never depends on colour. */
function ring(cls){
  var wrap=document.createElement("div"); wrap.className="px-ring"+(cls?" "+cls:""); wrap.setAttribute("role", "timer");
  wrap.innerHTML='<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="px-ring-bg" cx="50" cy="50" r="44"/><circle class="px-ring-fg" cx="50" cy="50" r="44" pathLength="100"/></svg><b class="px-ring-n"></b>';
  return wrap;
}
function setRing(wrap, leftMs, totalMs){
  if(!wrap) return 0;
  var left=Math.max(0, leftMs), secs=Math.ceil(left/1000), p=totalMs>0?Math.max(0, Math.min(1, left/totalMs)):0;
  wrap.style.setProperty("--p", p.toFixed(3));
  wrap.classList.toggle("hot", secs<=5&&secs>0);
  var n=wrap.querySelector(".px-ring-n"); if(n&&n.textContent!==String(secs)) n.textContent=String(secs);
  wrap.setAttribute("aria-label", secs+" seconds left");
  return secs;
}

root.PartyFX={VOLUME:VOLUME, TUNE_VOLUME:TUNE_VOLUME, sounds:S, startTune:startTune, stopTune:stopTune, tuneOn:tuneOn,
  reduced:reduced, confetti:confetti, ring:ring, setRing:setRing};
})(window);
