(function(){
var KEY="tp_sound",ctx=null,master=null,mutes=[];
function enabled(){try{return localStorage.getItem(KEY)!=="off"}catch(e){return true}}
function paint(btn){var on=enabled();btn.textContent=on?"🔊":"🔇";btn.setAttribute("aria-pressed",on?"false":"true");btn.setAttribute("aria-label",on?"Mute sound effects":"Unmute sound effects")}
function setEnabled(on){try{localStorage.setItem(KEY,on?"on":"off")}catch(e){}mutes.forEach(paint)}
function context(){
 var AC=window.AudioContext||window.webkitAudioContext;if(!AC)return null;
 if(!ctx){try{ctx=new AC()}catch(e){return null}
  master=ctx.createGain();master.gain.value=0.4;master.connect(ctx.destination)}
 if(ctx.state==="suspended"){try{var p=ctx.resume();if(p&&p.catch)p.catch(function(){})}catch(e){}}
 return ctx}
function unlock(){try{context()}catch(e){}}
["pointerdown","touchstart","keydown"].forEach(function(ev){window.addEventListener(ev,unlock,{capture:true,passive:true})});
function tone(c,freq,type,when,dur,peak,slideTo){
 var o=c.createOscillator(),g=c.createGain(),atk=Math.min(0.012,dur*0.35);
 o.type=type||"sine";o.frequency.setValueAtTime(freq,when);
 if(slideTo&&slideTo>0)o.frequency.exponentialRampToValueAtTime(slideTo,when+dur);
 g.gain.setValueAtTime(0.0001,when);
 g.gain.exponentialRampToValueAtTime(Math.max(peak,0.0002),when+atk);
 g.gain.exponentialRampToValueAtTime(0.0001,when+dur);
 o.connect(g);g.connect(master);o.start(when);o.stop(when+dur+0.03)}
function play(fn){if(!enabled())return;try{var c=context();if(!c||!master)return;fn(c,c.currentTime)}catch(e){}}
function click(){play(function(c,t){tone(c,1320,"sine",t,0.035,0.12)})}
function card(){play(function(c,t){
 var len=Math.max(1,Math.floor(c.sampleRate*0.16)),buf=c.createBuffer(1,len,c.sampleRate),data=buf.getChannelData(0),i;
 for(i=0;i<len;i++){var env=1-i/len;data[i]=(Math.random()*2-1)*env*env}
 var src=c.createBufferSource();src.buffer=buf;
 var filter=c.createBiquadFilter();filter.type="bandpass";filter.Q.value=0.6;
 filter.frequency.setValueAtTime(280,t);filter.frequency.exponentialRampToValueAtTime(1600,t+0.12);
 var g=c.createGain();g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(0.2,t+0.03);g.gain.exponentialRampToValueAtTime(0.0001,t+0.16);
 src.connect(filter);filter.connect(g);g.connect(master);src.start(t);src.stop(t+0.17);
 tone(c,640,"sine",t+0.04,0.1,0.16,240)})}
function chime(){play(function(c,t){tone(c,523.25,"sine",t,0.22,0.14);tone(c,659.25,"sine",t+0.09,0.22,0.14);tone(c,783.99,"sine",t+0.18,0.28,0.16)})}
function reminder(){play(function(c,t){tone(c,392,"sine",t,0.34,0.09);tone(c,523.25,"triangle",t+0.1,0.4,0.07)})}
function blip(up){play(function(c,t){if(up)tone(c,620,"sine",t,0.1,0.15,980);else tone(c,466,"sine",t,0.11,0.13,280)})}
function yes(){play(function(c,t){tone(c,523.25,"sine",t,0.09,0.14,880);tone(c,659.25,"triangle",t+0.07,0.12,0.11);tone(c,1046.5,"sine",t+0.12,0.16,0.09)})}
function no(){play(function(c,t){tone(c,784,"sine",t,0.1,0.1,494);tone(c,523.25,"triangle",t+0.08,0.2,0.08,392)})}
function noise(c,t,dur,peak,f0,f1){
 var len=Math.max(1,Math.floor(c.sampleRate*dur)),buf=c.createBuffer(1,len,c.sampleRate),data=buf.getChannelData(0),i;
 for(i=0;i<len;i++){var env=1-i/len;data[i]=(Math.random()*2-1)*env*env}
 var src=c.createBufferSource();src.buffer=buf;
 var filter=c.createBiquadFilter();filter.type="bandpass";filter.Q.value=0.7;
 filter.frequency.setValueAtTime(f0,t);filter.frequency.exponentialRampToValueAtTime(f1,t+dur*0.85);
 var g=c.createGain();g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(peak,t+0.04);g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
 src.connect(filter);filter.connect(g);g.connect(master);src.start(t);src.stop(t+dur+0.02)}
function roll(){play(function(c,t){noise(c,t,0.42,0.16,220,1400);tone(c,160,"sine",t,0.09,0.18,52);tone(c,150,"sine",t+0.16,0.09,0.16,48);tone(c,142,"sine",t+0.32,0.12,0.18,46)})}
function celebrate(){play(function(c,t){tone(c,523.25,"sine",t,0.2,0.12);tone(c,659.25,"sine",t+0.12,0.2,0.12);tone(c,783.99,"sine",t+0.24,0.22,0.13);tone(c,1046.5,"triangle",t+0.36,0.28,0.12);tone(c,783.99,"sine",t+0.5,0.16,0.08);tone(c,1046.5,"sine",t+0.62,0.36,0.1)})}
function bindMute(btn){
 if(!btn||btn.dataset.tpBound)return;btn.dataset.tpBound="1";mutes.push(btn);paint(btn);
 btn.addEventListener("click",function(){var on=!enabled();setEnabled(on);if(on)click()})}
window.TPSound={enabled:enabled,setEnabled:setEnabled,unlock:unlock,click:click,card:card,chime:chime,reminder:reminder,blip:blip,yes:yes,no:no,roll:roll,celebrate:celebrate,bindMute:bindMute};
})();
