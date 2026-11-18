/* Hot Take Court: the shared screen. The same renderer draws the TV display (play/display.html) and the compact
   version on the host's phone when no display is connected. It only reads the public state (hc/pub).
   Reveals are staged from the time the phase opened, measured in server time, so every screen stays in step. */
(function(root){
"use strict";
var FX=root.PartyFX, SND=(FX&&FX.sounds)||{};
var L=root.CourtLogic;
function el(tag, cls, text){var n=document.createElement(tag); if(cls) n.className=cls; if(text!=null) n.textContent=text; return n}
function play(ctx, name, a){if(ctx.sounds&&SND[name]){try{SND[name](a)}catch(e){}}}
function still(){return !FX||FX.reduced()}
function nm(D, u){return (D.names&&D.names[u])||"Player"}
var PACK={mild:"Mild", spicy:"Spicy", extra:"Absurd"};
var VERDICT={guilty:"GUILTY", not:"NOT GUILTY", hung:"HUNG JURY"};

/* stage timing inside the verdict phase, in ms after it opened (scaled from the logic's own timers) */
function cardAt(i){var T=(L&&L.T)||{verdictCard:700}; return T.verdictCard*(i+1)}
function stampAt(n){var T=(L&&L.T)||{verdictCard:700, verdictBase:2200}; return T.verdictCard*(n+1)+Math.round(T.verdictBase*0.15)}

function render(box, ctx){
  var s=box.__cs||(box.__cs={key:"", seen:{}, played:{}, lastSec:-1});
  var pub=ctx.pub, D=ctx.D;
  box.classList.add("cs"); box.classList.toggle("cs-compact", !!ctx.compact);
  if(!pub||!D){box.textContent=""; s.key=""; return}
  /* rebuild only when the phase or the case changes; updates within a phase (votes in, objections) are painted in place */
  var key=D.caseNo+"|"+(D.cases||0)+"|"+pub.phase+"|"+(D.at||0);
  if(s.key!==key){
    var first=!s.key; s.key=key; s.played={}; s.lastSec=-1;
    build(box, s, ctx);
    if(!first) play(ctx, "whoosh");
  }
  update(box, s, ctx);
}
function head(D, label){
  var h=el("div", "cs-head");
  h.appendChild(el("span", "cs-chip", "Case "+D.caseNo+" of "+D.cases));
  h.appendChild(el("span", "cs-chip", (PACK[D.pack]||"Mild")+" pack"));
  if(label) h.appendChild(el("span", "cs-chip cs-chip-strong", label));
  return h;
}
function caseFile(D, open){
  var f=el("div", "cs-file"+(open?" open":""));
  var tab=el("div", "cs-file-tab", "CASE FILE #"+String(D.caseNo).padStart(3, "0"));
  f.appendChild(tab);
  f.appendChild(el("p", "cs-file-title", "The Table vs. "+nm(D, D.defendant)));
  if(open&&D.take) f.appendChild(el("p", "cs-take", "“"+D.take+"”"));
  else f.appendChild(el("p", "cs-file-sealed", "Sealed until the Defendant picks a case."));
  return f;
}
function withRing(box, s, total){var r=FX?FX.ring("cs-ring"):el("div"); s.ring=r; s.total=total; box.appendChild(r); return r}

function build(box, s, ctx){
  var D=ctx.D, p=ctx.pub.phase, T=(L&&L.T)||{};
  box.textContent=""; box.setAttribute("data-phase", p);
  var wrap=el("div", "cs-stage"); box.appendChild(wrap);
  s.ring=null; s.cards=null; s.stamp=null; s.awards=null; s.flash=null;
  if(p==="case"){
    wrap.appendChild(head(D, "New case"));
    wrap.appendChild(caseFile(D, false));
    wrap.appendChild(el("p", "cs-big", nm(D, D.defendant)+" is choosing a hot take to defend."));
    withRing(wrap, s, T.caseMs);
  }else if(p==="opening"||p==="prosecution"){
    var speaker=p==="opening"?D.defendant:D.prosecutor;
    wrap.appendChild(head(D, p==="opening"?"Opening argument":"The prosecution"));
    wrap.appendChild(caseFile(D, true));
    var who=el("p", "cs-big"); who.appendChild(el("b", "cs-name", nm(D, speaker)));
    who.appendChild(document.createTextNode(p==="opening"?" argues for it, out loud.":" argues against it."));
    wrap.appendChild(who);
    withRing(wrap, s, p==="opening"?T.opening:T.prosecution);
    s.flash=el("div", "cs-flash"); s.flash.setAttribute("aria-live", "assertive"); wrap.appendChild(s.flash);
    s.seenObj={}; (D.objections||[]).forEach(function(u){s.seenObj[u]=1});
  }else if(p==="deliberation"){
    wrap.appendChild(head(D, "Deliberation"));
    wrap.appendChild(caseFile(D, true));
    wrap.appendChild(el("p", "cs-big", "The jury is out."));
    s.votes=el("p", "cs-mid"); wrap.appendChild(s.votes);
    withRing(wrap, s, T.deliberation);
  }else if(p==="verdict"){
    var v=D.verdict||{cards:[], result:"hung"};
    wrap.appendChild(head(D, "The verdict"));
    wrap.appendChild(el("p", "cs-mid", "The Table vs. "+nm(D, D.defendant)));
    var row=el("div", "cs-cards"); s.cards=[];
    if(!v.cards.length) row.appendChild(el("p", "cs-mid", "No votes were cast."));
    v.cards.forEach(function(c){
      var card=el("div", "cs-card");
      var back=el("div", "cs-card-back", "?"), front=el("div", "cs-card-front "+(c.v==="g"?"g":"n"));
      front.appendChild(el("b", null, c.v==="g"?"GUILTY":"NOT GUILTY")); front.appendChild(el("span", null, nm(D, c.uid)));
      card.appendChild(back); card.appendChild(front); row.appendChild(card); s.cards.push(card);
    });
    wrap.appendChild(row);
    s.stamp=el("div", "cs-stamp "+v.result, VERDICT[v.result]); s.stamp.setAttribute("aria-live", "assertive");
    wrap.appendChild(s.stamp);
  }else if(p==="sentencing"){
    var vv=D.verdict||{};
    wrap.appendChild(head(D, "Sentencing"));
    if(vv.result==="guilty"){
      wrap.appendChild(el("p", "cs-big", nm(D, D.defendant)+" was found guilty."));
      wrap.appendChild(el("p", "cs-mid", "The jury picks a sentence. "+nm(D, D.defendant)+" can take a drink instead, or Pass."));
      var ol=el("ol", "cs-sentences"); (D.sentenceOptions||[]).forEach(function(t){ol.appendChild(el("li", null, t))}); wrap.appendChild(ol);
    }else{
      wrap.appendChild(el("p", "cs-big", nm(D, D.defendant)+" walks free."));
      wrap.appendChild(el("p", "cs-mid", "The prosecutor, "+nm(D, D.prosecutor)+", can take a drink, "+(D.pose||"do a quick pose")+", or Pass."));
    }
    withRing(wrap, s, T.sentencing);
  }else if(p==="scores"){
    wrap.appendChild(head(D, "Case closed"));
    wrap.appendChild(el("p", "cs-big", outcomeLine(D)));
    wrap.appendChild(board(D));
  }else if(p==="end"){
    var e=D.end||{standings:[], awards:[]};
    wrap.appendChild(el("p", "cs-eyebrow", "Court is adjourned"));
    var top=e.standings[0];
    wrap.appendChild(el("p", "cs-big", top?nm(D, top.uid)+" wins with "+top.score+" point"+(top.score===1?"":"s")+".":"Final scores"));
    wrap.appendChild(board(D, e.standings));
    var aw=el("div", "cs-awards"); s.awards=[];
    e.awards.forEach(function(a){
      var c=el("div", "cs-award"); c.appendChild(el("p", "cs-award-title", a.title));
      c.appendChild(el("p", "cs-award-who", a.uids.map(function(u){return nm(D, u)}).join(" & ")));
      c.appendChild(el("p", "cs-award-line", a.line)); aw.appendChild(c); s.awards.push(c);
    });
    wrap.appendChild(aw);
    play(ctx, "fanfare"); if(FX) FX.confetti();
  }
}
function outcomeLine(D){
  if(D.note) return D.note;
  var v=D.verdict, o=D.outcome;
  if(!v) return "Case closed.";
  if(v.result==="hung") return "Hung jury. Nobody drinks.";
  if(!o) return VERDICT[v.result]+".";
  var who=nm(D, o.uid);
  if(o.what==="drink") return who+" takes a drink.";
  if(o.what==="alt") return v.result==="guilty"?who+"'s sentence: "+o.sentence:who+" will "+(o.pose||"do a quick pose")+".";
  return who+" passed. No penalty.";
}
function board(D, standings){
  var list=standings||Object.keys(D.scores||{}).map(function(u){return {uid:u, score:D.scores[u]}}).sort(function(a,b){return b.score-a.score});
  var max=Math.max(1, Math.max.apply(null, list.map(function(r){return r.score}).concat([1])));
  var ol=el("ol", "cs-board");
  list.forEach(function(r){
    var li=el("li"); li.appendChild(el("span", "cs-board-name", nm(D, r.uid)));
    var bar=el("span", "cs-board-bar"); bar.style.setProperty("--w", (r.score/max).toFixed(3)); li.appendChild(bar);
    li.appendChild(el("b", "cs-board-score", String(r.score))); ol.appendChild(li);
  });
  return ol;
}
function update(box, s, ctx){
  var D=ctx.D, pub=ctx.pub, now=ctx.now, since=now-(D.at||now), p=pub.phase;
  if(s.ring&&FX){
    var secs=FX.setRing(s.ring, pub.deadline-now, s.total||1);
    if(secs<=3&&secs>0&&secs!==s.lastSec){s.lastSec=secs; play(ctx, "tick")}
  }
  if(s.votes) s.votes.textContent=D.votesIn+" of "+(D.jurors||[]).length+" votes in";
  if(s.flash){
    (D.objections||[]).forEach(function(u){
      if(s.seenObj[u]) return; s.seenObj[u]=1;
      s.flash.textContent="OBJECTION! — "+nm(D, u);
      s.flash.classList.remove("on"); void s.flash.offsetWidth; s.flash.classList.add("on");
      play(ctx, "objection");
    });
  }
  if(s.cards){
    var n=s.cards.length, all=still();
    s.cards.forEach(function(c, i){
      if((all||since>=cardAt(i))&&!c.classList.contains("up")){c.classList.add("up"); if(!s.played["c"+i]){s.played["c"+i]=1; play(ctx, "flip")}}
    });
    if((all||since>=stampAt(n))&&!s.stamp.classList.contains("on")){
      s.stamp.classList.add("on");
      if(!s.played.stamp){s.played.stamp=1; play(ctx, "gavel", 2); var r=(D.verdict||{}).result; setTimeout(function(){play(ctx, "stamp", r)}, 280)}
    }
  }
  if(s.awards){
    s.awards.forEach(function(c, i){
      if((still()||since>=2200+i*1700)&&!c.classList.contains("on")){c.classList.add("on"); if(!s.played["a"+i]){s.played["a"+i]=1; play(ctx, "award")}}
    });
  }
}
root.CourtScreen={render:render, outcomeLine:outcomeLine, stampAt:stampAt, cardAt:cardAt};
})(window);
