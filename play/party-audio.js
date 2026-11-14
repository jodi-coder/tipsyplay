/* Shared party effects. Web Audio only: no samples, no audio files.
   One bus of short one-shot cues. There is no background music, no ambience and no spoken announcer.
   Sound follows the single site-wide switch (TPSound / localStorage "tp_sound") and never starts before the player's
   first tap, key press or touch (browsers block it, and a context made earlier would release queued sounds all at once).
   King's Cup and Never Have I Ever use these cues. */
(function(global){
"use strict";
var tapped=false;
["pointerdown","touchstart","keydown"].forEach(function(ev){
  try{global.addEventListener(ev,function(){tapped=true},{capture:true,passive:true})}catch(e){}
});
function soundOn(){try{return !global.TPSound||global.TPSound.enabled()}catch(e){return true}}
function blank(){return {sfx:0.7,muteSfx:false}}
function load(key){
  var m=blank();
  try{var raw=JSON.parse(localStorage.getItem(key||"tp_party_mix")||"null"); if(raw&&typeof raw.sfx==="number") m.sfx=Math.max(0,Math.min(1,raw.sfx))}catch(e){}
  return m;
}
function create(opts){
  opts=opts||{};
  var mix=opts.mix||load(opts.key||"tp_party_mix");
  var audio=null, sfxGain;
  function hype(){try{return opts.hype?+opts.hype()||0:0}catch(e){return 0}}
  function save(){try{if(opts.key) localStorage.setItem(opts.key, JSON.stringify({sfx:mix.sfx}))}catch(e){}}
  function ensure(){
    if(!tapped) return null;
    var AC=global.AudioContext||global.webkitAudioContext;
    if(!AC) return null;
    if(!audio){
      try{audio=new AC()}catch(e){return null}
      var master=audio.createGain(); master.gain.value=0.5;
      var comp=audio.createDynamicsCompressor();
      comp.threshold.value=-16; comp.knee.value=8; comp.ratio.value=6; comp.attack.value=0.01; comp.release.value=0.2;
      master.connect(comp); comp.connect(audio.destination);
      sfxGain=audio.createGain(); sfxGain.connect(master);
      apply();
    }
    if(audio.state==="suspended"){try{var p=audio.resume(); if(p&&p.catch) p.catch(function(){})}catch(e){}}
    return audio;
  }
  function apply(){
    if(!sfxGain||!audio) return;
    sfxGain.gain.setTargetAtTime((mix.muteSfx||!soundOn())?0.0001:mix.sfx, audio.currentTime, 0.03);
  }
  try{global.addEventListener("tp-sound-change",apply)}catch(e){}
  function env(when, peak, dur){
    var g=audio.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(peak,0.001), when+Math.min(0.02, dur*0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, when+Math.max(dur,0.05));
    return g;
  }
  function dest(pan){
    try{
      var p=audio.createStereoPanner();
      p.pan.value=(typeof pan==="number")?Math.max(-1,Math.min(1,pan)):(Math.random()*1.2-0.6);
      p.connect(sfxGain); return p;
    }catch(e){return sfxGain}
  }
  function tone(freq, type, when, dur, peak, slide, target){
    var o=audio.createOscillator(), g=env(when, peak, dur);
    o.type=type; o.frequency.setValueAtTime(Math.max(freq,40), when);
    if(slide&&slide>0) o.frequency.exponentialRampToValueAtTime(Math.max(slide,40), when+Math.max(dur,0.05));
    o.connect(g); g.connect(target||dest()); o.start(when); o.stop(when+dur+0.05);
  }
  function noise(when, dur, peak, f0, f1, kind, target){
    var len=Math.max(1, Math.floor(audio.sampleRate*dur));
    var buf=audio.createBuffer(1, len, audio.sampleRate), data=buf.getChannelData(0), i;
    for(i=0;i<len;i++) data[i]=(Math.random()*2-1)*(1-i/len);
    var src=audio.createBufferSource(); src.buffer=buf;
    var f=audio.createBiquadFilter();
    f.type=kind||"bandpass"; f.Q.value=0.7;
    f.frequency.setValueAtTime(Math.max(f0,50), when);
    if(f1&&f1>0) f.frequency.exponentialRampToValueAtTime(Math.max(f1,50), when+dur*0.8);
    var g=env(when, peak, dur);
    src.connect(f); f.connect(g); g.connect(target||dest()); src.start(when); src.stop(when+dur+0.03);
  }
  /* Peaks are about 35% lower than before and the long tails are shorter.
     Removed: gulp, pour, heavyPour, can, cheers, awkward (drinking sounds and cues nothing used).
     Replaced: sting (now a short soft pop), cupPour (now a soft two-note chime). */
  function cue(name, level, pan){
    if(!soundOn()||mix.muteSfx||!ensure()) return;
    if(name==="tick"){tone(1040,"sine",audio.currentTime,0.03,0.04,0,dest(pan)); return}
    var t=audio.currentTime, j=0.85+Math.random()*0.3;
    var bus=dest(pan);
    if(name==="flip"){noise(t,0.09*j,0.3,400,2400,null,bus); tone(180+Math.random()*40,"sine",t,0.08,0.2,700,bus)}
    else if(name==="shuffle"){var k; for(k=0;k<4;k++) noise(t+k*0.045,0.05,0.22,300,1800,null,bus)}
    else if(name==="whoosh"){noise(t,0.16*j,0.22,1600,300,"lowpass",bus)}
    else if(name==="clink"){tone(1800+Math.random()*400,"sine",t,0.14,0.2,0,bus); tone(2400,"triangle",t+0.02,0.09,0.08,0,bus)}
    else if(name==="crack"){noise(t,0.07,0.38,800,3000,null,bus); tone(90,"sine",t,0.08,0.22,40,bus)}
    else if(name==="ice"){var n; for(n=0;n<3;n++) tone(2200+Math.random()*800,"square",t+n*0.045,0.03,0.07,0,bus)}
    else if(name==="cupPour"){tone(660,"sine",t,0.18,0.2,0,bus); tone(880,"sine",t+0.09,0.22,0.17,0,bus)}
    else if(name==="sting"){tone(520,"sine",t,0.12,0.22,300,bus); tone(780,"triangle",t+0.02,0.1,0.12,0,bus); noise(t,0.05,0.14,700,2400,null,bus)}
    else if(name==="cheer"){noise(t,0.26,0.22,800,2500,null,bus); tone(523,"triangle",t,0.12,0.14,0,bus); tone(659,"triangle",t+0.07,0.12,0.12,0,bus); tone(784,"sine",t+0.14,0.16,0.11,0,bus)}
    else if(name==="ooh"){tone(440,"sine",t,0.26,0.15,660,bus); tone(554,"sine",t+0.04,0.22,0.08,0,bus)}
    else if(name==="gasp"){noise(t,0.14,0.26,1200,3000,null,bus); tone(880,"sine",t,0.09,0.13,1400,bus)}
    else if(name==="boo"){tone(196,"triangle",t,0.28,0.14,110,bus); noise(t,0.2,0.14,200,600,null,bus)}
    else if(name==="applause"){var a; for(a=0;a<6;a++) noise(t+a*0.04,0.045,0.18,1000,4000,null,bus)}
    else if(name==="laugh"){var q; for(q=0;q<3;q++){noise(t+q*0.085,0.06,0.2,600,1800,null,bus); tone(300+q*20,"triangle",t+q*0.085,0.07,0.08,0,bus)}}
    else if(name==="chant"){tone(196,"square",t,0.1,0.14,0,bus); tone(196,"square",t+0.17,0.1,0.14,0,bus); tone(262,"square",t+0.34,0.13,0.13,0,bus)}
    else if(name==="crickets"){var c; for(c=0;c<3;c++) tone(3200+Math.random()*400,"sine",t+c*0.15,0.045,0.05,3600,bus)}
    else if(name==="payoff"){tone(523,"triangle",t,0.13,0.22,0,bus); tone(659,"triangle",t+0.1,0.15,0.2,0,bus); tone(784,"sine",t+0.2,0.2,0.22,0,bus); tone(1046,"sine",t+0.32,0.3,0.18,0,bus)}
  }
  /* Kept so the games' existing calls still work. There is no music and no spoken line any more. */
  function say(){}
  function startMusic(){}
  function stopMusic(){}
  function duck(){}
  function unlock(){ensure()}
  return {mix:mix, save:save, apply:apply, cue:cue, say:say, startMusic:startMusic, stopMusic:stopMusic, unlock:unlock, duck:duck};
}
global.PartyAudio={blank:blank, load:load, create:create};
})(window);
