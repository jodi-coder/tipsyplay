/* Shared party synth. Web Audio only: no samples, no audio files.
   Buses: music (host loop + room tone), sfx (panned), voice (host announcer).
   Music ducks under SFX and speech. King's Cup and Never Have I Ever use the loop.
   Who's Most Likely uses the mlt* one-shots. Those cues do not start the loop. */
(function(global){
"use strict";
function blank(){return {music:0.7,sfx:0.9,voice:0.85,muteMusic:false,muteSfx:false,muteVoice:false}}
function load(key){
  var m=blank();
  try{var raw=JSON.parse(localStorage.getItem(key)||"null"); if(raw) m=Object.assign(m, raw)}catch(e){}
  return m;
}
function create(opts){
  opts=opts||{};
  var mix=opts.mix||load(opts.key||"tp_party_mix");
  var audio=null, musicGain, sfxGain, timer=0, nextTime=0, stepN=0, duckUntil=0, ambience=false, ambienceSrc=null;
  function host(){try{return opts.host?!!opts.host():true}catch(e){return false}}
  function hype(){try{return opts.hype?+opts.hype()||0:0}catch(e){return 0}}
  function save(){try{if(opts.key) localStorage.setItem(opts.key, JSON.stringify(mix))}catch(e){}}
  function ensure(){
    var AC=global.AudioContext||global.webkitAudioContext;
    if(!AC) return null;
    if(!audio){
      try{audio=new AC()}catch(e){return null}
      var master=audio.createGain(); master.gain.value=0.9;
      var comp=audio.createDynamicsCompressor();
      comp.threshold.value=-14; comp.knee.value=8; comp.ratio.value=6; comp.attack.value=0.01; comp.release.value=0.2;
      master.connect(comp); comp.connect(audio.destination);
      musicGain=audio.createGain(); sfxGain=audio.createGain();
      musicGain.connect(master); sfxGain.connect(master);
      apply();
    }
    if(audio.state==="suspended"){try{var p=audio.resume(); if(p&&p.catch) p.catch(function(){})}catch(e){}}
    return audio;
  }
  function musicLevel(){return mix.muteMusic?0.0001:Math.max(mix.music,0.0001)}
  function apply(){
    if(!musicGain||!audio) return;
    var now=audio.currentTime;
    musicGain.gain.setTargetAtTime(mix.muteMusic?0.0001:mix.music, now, 0.03);
    sfxGain.gain.setTargetAtTime(mix.muteSfx?0.0001:mix.sfx, now, 0.03);
  }
  function duck(seconds){
    if(!audio||!musicGain||mix.muteMusic) return;
    var now=audio.currentTime;
    musicGain.gain.setTargetAtTime(Math.max(musicLevel()*0.35,0.0001), now, 0.02);
    duckUntil=now+seconds;
  }
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
  function cue(name, level, pan){
    if(!ensure()||mix.muteSfx) return;
    if(name==="tick"){tone(1040,"sine",audio.currentTime,0.035,0.045,0,dest(pan)); return}
    duck(0.45);
    var t=audio.currentTime, j=0.85+Math.random()*0.3, L=level==null?Math.max(0,Math.min(1,hype()/4)):level;
    var bus=dest(pan);
    if(name==="flip"){noise(t,0.12*j,0.45,400,2400,null,bus); tone(180+Math.random()*40,"sine",t,0.1,0.3,700,bus)}
    else if(name==="shuffle"){var k; for(k=0;k<5;k++) noise(t+k*0.05,0.06,0.35,300,1800,null,bus)}
    else if(name==="whoosh"){noise(t,0.28*j,0.4,1600,240,"lowpass",bus)}
    else if(name==="gulp"){tone(180,"sine",t,0.12*j,0.4,70,bus); noise(t,0.08,0.2,200,600,null,bus)}
    else if(name==="clink"){tone(1800+Math.random()*400,"sine",t,0.18,0.28,0,bus); tone(2400,"triangle",t+0.02,0.12,0.12,0,bus)}
    else if(name==="crack"){noise(t,0.09,0.6,800,3000,null,bus); tone(90,"sine",t,0.1,0.35,40,bus)}
    else if(name==="pour"){noise(t,0.35*j,0.35,500,900,"lowpass",bus)}
    else if(name==="can"){noise(t,0.05,0.45,2000,5000,"highpass",bus); tone(540,"square",t,0.08,0.2,220,bus); tone(880,"sine",t+0.06,0.12,0.16,0,bus)}
    else if(name==="ice"){var n; for(n=0;n<3;n++) tone(2200+Math.random()*800,"square",t+n*0.05,0.04,0.12,0,bus)}
    else if(name==="cheers"){tone(1600,"sine",t,0.16,0.3,0,bus); tone(2100,"sine",t+0.08,0.18,0.25,0,bus)}
    else if(name==="cupPour"){noise(t,0.3+L*0.7,0.3+L*0.35,280,700,"lowpass",bus); tone(90+L*40,"sine",t,0.4,0.2,0,bus)}
    else if(name==="heavyPour"){noise(t,1.1,0.55,180,500,"lowpass",bus); tone(55,"sawtooth",t,0.8,0.18,40,bus)}
    else if(name==="sting"){tone(220,"sawtooth",t,0.45,0.28,70,bus); tone(277,"square",t,0.4,0.18,80,bus); tone(330,"triangle",t+0.05,0.5,0.16,0,bus); noise(t,0.2,0.4,100,800,null,bus)}
    else if(name==="cheer"){noise(t,0.35,0.35,800,2500,null,bus); tone(523,"square",t,0.15,0.2,0,bus); tone(659,"square",t+0.08,0.15,0.18,0,bus); tone(784,"triangle",t+0.16,0.2,0.16,0,bus)}
    else if(name==="ooh"){tone(440,"sine",t,0.35,0.22,660,bus); tone(554,"sine",t+0.05,0.3,0.12,0,bus)}
    else if(name==="gasp"){noise(t,0.18,0.4,1200,3000,null,bus); tone(880,"sine",t,0.12,0.2,1400,bus)}
    else if(name==="boo"){tone(196,"sawtooth",t,0.4,0.22,110,bus); noise(t,0.3,0.25,200,600,null,bus)}
    else if(name==="applause"){var a; for(a=0;a<8;a++) noise(t+a*0.04,0.05,0.28,1000,4000,null,bus)}
    else if(name==="laugh"){var q; for(q=0;q<4;q++){noise(t+q*0.09,0.07,0.3,600,1800,null,bus); tone(300+q*20,"triangle",t+q*0.09,0.08,0.12,0,bus)}}
    else if(name==="chant"){tone(196,"square",t,0.12,0.25,0,bus); tone(196,"square",t+0.2,0.12,0.25,0,bus); tone(262,"square",t+0.4,0.16,0.22,0,bus)}
    else if(name==="crickets"){var c; for(c=0;c<5;c++) tone(3200+Math.random()*400,"sine",t+c*0.16,0.05,0.08,3600,bus)}
    else if(name==="awkward"){noise(t,0.7,0.08,180,320,"lowpass",bus); tone(98,"sine",t,0.6,0.05,0,bus)}
    else if(name==="payoff"){tone(523,"triangle",t,0.16,0.32,0,bus); tone(659,"triangle",t+0.12,0.18,0.3,0,bus); tone(784,"sine",t+0.24,0.26,0.34,0,bus); tone(1046,"sine",t+0.38,0.42,0.28,0,bus); noise(t+0.36,0.18,0.22,700,2200,null,bus)}
    else if(name==="mltJoin"||name==="mltVote"||name==="mltRound"||name==="mltSuspense"||name==="mltWin"||name==="mltTie"||name==="mltNone"||name==="mltTwist"||name==="mltFinale"){
      var mb=dest(0);
      if(name==="mltJoin"){noise(t,0.05,0.42,180,900,"lowpass",mb); tone(523,"triangle",t+0.04,0.08,0.26,0,mb); tone(659,"triangle",t+0.12,0.09,0.24,0,mb); tone(784,"sine",t+0.2,0.14,0.22,0,mb); noise(t+0.18,0.06,0.16,1800,4200,"highpass",mb)}
      else if(name==="mltVote"){noise(t,0.028,0.38,1600,3600,"highpass",mb); tone(740,"square",t,0.045,0.18,0,mb); tone(988,"sine",t+0.05,0.08,0.14,0,mb)}
      else if(name==="mltRound"){noise(t,0.08,0.22,400,1600,null,mb); tone(392,"triangle",t,0.09,0.24,0,mb); tone(523,"triangle",t+0.09,0.1,0.26,0,mb); tone(659,"sine",t+0.18,0.16,0.24,0,mb)}
      else if(name==="mltSuspense"){duck(1.05); tone(196,"sine",t,0.92,0.2,880,mb); tone(247,"triangle",t,0.92,0.12,1046,mb); tone(330,"sine",t+0.16,0.1,0.1,0,mb); tone(392,"square",t+0.32,0.09,0.12,0,mb); tone(494,"square",t+0.46,0.08,0.14,0,mb); tone(587,"square",t+0.58,0.08,0.16,0,mb); tone(740,"triangle",t+0.7,0.09,0.2,0,mb); tone(880,"sine",t+0.82,0.1,0.22,0,mb); noise(t+0.7,0.22,0.22,280,1600,"lowpass",mb)}
      else if(name==="mltWin"){noise(t,0.06,0.36,700,2800,null,mb); tone(523,"square",t,0.09,0.3,0,mb); tone(659,"square",t+0.09,0.09,0.28,0,mb); tone(784,"triangle",t+0.18,0.12,0.3,0,mb); tone(1046,"sine",t+0.3,0.24,0.32,0,mb)}
      else if(name==="mltTie"){tone(440,"triangle",t,0.16,0.26,0,mb); tone(554,"triangle",t,0.16,0.2,0,mb); tone(659,"sine",t+0.14,0.2,0.24,0,mb); tone(880,"sine",t+0.14,0.2,0.16,0,mb)}
      else if(name==="mltNone"){tone(494,"sine",t,0.12,0.16,392,mb); tone(349,"triangle",t+0.1,0.18,0.12,0,mb)}
      else if(name==="mltTwist"){tone(880,"sawtooth",t,0.18,0.16,220,mb); tone(660,"triangle",t+0.08,0.14,0.12,0,mb); noise(t,0.12,0.2,900,2200,null,mb)}
      else if(name==="mltFinale"){noise(t,0.12,0.32,500,2400,null,mb); tone(523,"square",t,0.1,0.26,0,mb); tone(659,"square",t+0.1,0.1,0.26,0,mb); tone(784,"triangle",t+0.2,0.12,0.28,0,mb); tone(1046,"sine",t+0.32,0.22,0.3,0,mb); tone(1318,"sine",t+0.46,0.28,0.18,0,mb); noise(t+0.3,0.2,0.22,800,3000,null,mb)}
    }
  }
  function say(line){
    if(!host()||mix.muteVoice||!line||!global.speechSynthesis||!global.SpeechSynthesisUtterance) return;
    try{
      var u=new global.SpeechSynthesisUtterance(line);
      u.rate=1.08; u.pitch=1.12; u.volume=Math.max(0, Math.min(1, mix.voice));
      u.onstart=function(){duck(1.4)};
      global.speechSynthesis.cancel();
      global.speechSynthesis.speak(u);
    }catch(e){}
  }
  function startAmbience(){
    if(!audio||ambience) return;
    ambience=true;
    try{
      var len=audio.sampleRate*2, buf=audio.createBuffer(1, len, audio.sampleRate), data=buf.getChannelData(0), i;
      for(i=0;i<len;i++) data[i]=Math.random()*2-1;
      var src=audio.createBufferSource(); src.buffer=buf; src.loop=true;
      var f=audio.createBiquadFilter(); f.type="lowpass"; f.frequency.value=420;
      var g=audio.createGain(); g.gain.value=0.035;
      src.connect(f); f.connect(g); g.connect(musicGain); ambienceSrc=src; src.start();
    }catch(e){ambience=false; ambienceSrc=null}
  }
  function stopMusic(){
    if(timer){clearInterval(timer); timer=0}
    if(ambienceSrc){try{ambienceSrc.stop()}catch(e){} ambienceSrc=null}
    ambience=false; nextTime=0; stepN=0; duckUntil=0;
  }
  function startMusic(){
    if(!host()||!ensure()) return;
    startAmbience();
    if(timer) return;
    nextTime=audio.currentTime+0.05; stepN=0;
    var bpm0=opts.bpm||108, per=opts.hypePer==null?8:opts.hypePer;
    timer=setInterval(function(){
      if(!audio) return;
      var bpm=bpm0+hype()*per;
      var eighth=60/bpm/2;
      if(nextTime<audio.currentTime-0.5) nextTime=audio.currentTime;
      var guard=0;
      while(nextTime<audio.currentTime+0.22&&guard<8){
        guard++;
        var s=stepN%8;
        if(s%2===0) noise(nextTime,0.03,0.12,5000,8000,"highpass",musicGain);
        if(s===0||s===4) tone(150,"sine",nextTime,0.12,0.45,48,musicGain);
        if(s===2||s===6) noise(nextTime,0.1,0.22,1800,4000,null,musicGain);
        if(s%2===0) tone(55*(s===4?1.5:1),"square",nextTime,0.12,0.18,0,musicGain);
        if(s===0){
          tone(262,"triangle",nextTime,0.14,0.08+hype()*0.02,0,musicGain);
          tone(330,"triangle",nextTime,0.14,0.06,0,musicGain);
          if(opts.pulse){try{opts.pulse()}catch(e){}}
        }
        nextTime+=eighth; stepN++;
      }
      if(duckUntil&&audio.currentTime>duckUntil){duckUntil=0; musicGain.gain.setTargetAtTime(musicLevel(), audio.currentTime, 0.08)}
    }, 40);
  }
  function unlock(){ensure()}
  return {mix:mix, save:save, apply:apply, cue:cue, say:say, startMusic:startMusic, stopMusic:stopMusic, unlock:unlock, duck:duck};
}
global.PartyAudio={blank:blank, load:load, create:create};
})(window);
