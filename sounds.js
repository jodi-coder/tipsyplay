(function(){
var KEY="tp_sound",ctx=null,master=null,comp=null,mutes=[];
function enabled(){try{return localStorage.getItem(KEY)!=="off"}catch(e){return true}}
function paint(btn){var on=enabled();btn.textContent=on?"🔊":"🔇";btn.setAttribute("aria-pressed",on?"false":"true");btn.setAttribute("aria-label",on?"Mute sound effects":"Unmute sound effects")}
function setEnabled(on){try{localStorage.setItem(KEY,on?"on":"off")}catch(e){}mutes.forEach(paint)}
function context(){
 var AC=window.AudioContext||window.webkitAudioContext;if(!AC)return null;
 if(!ctx){try{ctx=new AC()}catch(e){return null}
  master=ctx.createGain();master.gain.value=0.9;
  comp=ctx.createDynamicsCompressor();
  comp.threshold.value=-16;comp.knee.value=10;comp.ratio.value=10;comp.attack.value=0.002;comp.release.value=0.16;
  master.connect(comp);comp.connect(ctx.destination)}
 if(ctx.state==="suspended"){try{var p=ctx.resume();if(p&&p.catch)p.catch(function(){})}catch(e){}}
 return ctx}
function unlock(){try{context()}catch(e){}}
["pointerdown","touchstart","keydown"].forEach(function(ev){window.addEventListener(ev,unlock,{capture:true,passive:true})});
function envGain(when,peak,atk,dur){
 var g=ctx.createGain();
 g.gain.setValueAtTime(0.0001,when);
 g.gain.exponentialRampToValueAtTime(Math.max(peak,0.001),when+atk);
 g.gain.exponentialRampToValueAtTime(0.0001,when+dur);
 return g}
function tone(freq,type,when,dur,peak,slide){
 var o=ctx.createOscillator(),g=envGain(when,peak,Math.min(0.006,dur*0.2),dur);
 o.type=type||"sine";o.frequency.setValueAtTime(freq,when);
 if(slide&&slide>0)o.frequency.exponentialRampToValueAtTime(slide,when+Math.max(dur,0.02));
 o.connect(g);g.connect(master);o.start(when);o.stop(when+dur+0.03)}
function noise(when,dur,peak,f0,f1){
 var len=Math.max(1,Math.floor(ctx.sampleRate*dur)),buf=ctx.createBuffer(1,len,ctx.sampleRate),data=buf.getChannelData(0),i,k;
 for(i=0;i<len;i++){k=1-i/len;data[i]=(Math.random()*2-1)*k*k}
 var src=ctx.createBufferSource();src.buffer=buf;
 var f=ctx.createBiquadFilter();f.type="bandpass";f.Q.value=0.8;
 f.frequency.setValueAtTime(Math.max(f0,40),when);
 if(f1&&f1>0)f.frequency.exponentialRampToValueAtTime(f1,when+dur*0.75);
 var g=envGain(when,peak,0.003,dur);
 src.connect(f);f.connect(g);g.connect(master);src.start(when);src.stop(when+dur+0.02)}
function play(fn){if(!enabled())return;try{if(!context()||!master)return;fn(ctx.currentTime)}catch(e){}}
function click(){play(function(t){noise(t,0.025,0.7,1400,4200);tone(1560,"square",t,0.04,0.34,720)})}
function card(){play(function(t){noise(t,0.18,0.55,280,2600);tone(196,"sine",t,0.14,0.42,740);tone(988,"triangle",t+0.05,0.12,0.28)})}
function tick(){play(function(t){noise(t,0.018,0.4,2000,5200);tone(1760,"square",t,0.035,0.3,1100)})}
function roll(){play(function(t){noise(t,0.32,0.5,180,2000);tone(150,"sine",t,0.07,0.45,48);tone(170,"sine",t+0.09,0.07,0.4,52);tickShape(t+0.18);tone(1320,"square",t+0.26,0.1,0.36,880)})}
function tickShape(t){tone(1040,"square",t,0.04,0.22,700)}
function yes(){play(function(t){noise(t,0.04,0.65,800,3400);tone(523,"square",t,0.07,0.4,880);tone(659,"triangle",t+0.045,0.1,0.34);tone(1047,"sine",t+0.08,0.16,0.32)})}
function no(){play(function(t){noise(t,0.03,0.28,300,1400);tone(784,"sine",t,0.08,0.32,370);tone(494,"triangle",t+0.05,0.14,0.22)})}
function celebrate(){play(function(t){noise(t,0.1,0.45,500,2400);[523,659,784,1047].forEach(function(f,i){tone(f,"square",t+i*0.08,0.15,0.34);tone(f*2,"sine",t+i*0.08+0.02,0.1,0.12)})})}
function chime(){play(function(t){tone(523,"sine",t,0.14,0.36);tone(659,"sine",t+0.07,0.14,0.32);tone(784,"triangle",t+0.14,0.2,0.3)})}
function reminder(){play(function(t){tone(392,"sine",t,0.2,0.28);tone(523,"triangle",t+0.08,0.24,0.2)})}
function blip(up){play(function(t){if(up){noise(t,0.02,0.35,900,2800);tone(640,"square",t,0.08,0.36,1040)}else tone(466,"sine",t,0.09,0.3,250)})}
function bindMute(btn){
 if(!btn||btn.dataset.tpBound)return;btn.dataset.tpBound="1";mutes.push(btn);paint(btn);
 btn.addEventListener("click",function(){var on=!enabled();setEnabled(on);if(on)click()})}
window.TPSound={enabled:enabled,setEnabled:setEnabled,unlock:unlock,click:click,card:card,chime:chime,reminder:reminder,blip:blip,yes:yes,no:no,roll:roll,celebrate:celebrate,tick:tick,bindMute:bindMute};
})();
