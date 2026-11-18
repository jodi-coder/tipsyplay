/* Category Countdown: the shared screen. The same renderer draws the TV display and the compact version on the host's
   phone when no display is connected. It only reads the public state (cc/pub). New answer tiles pop in as they land;
   reveals are staged from the time the phase opened, in server time, so every screen stays in step. */
(function(root){
"use strict";
var FX=root.PartyFX, SND=(FX&&FX.sounds)||{};
var L=root.CountdownLogic;
function el(tag, cls, text){var n=document.createElement(tag); if(cls) n.className=cls; if(text!=null) n.textContent=text; return n}
function play(ctx, name, a){if(ctx.sounds&&SND[name]){try{SND[name](a)}catch(e){}}}
function still(){return !FX||FX.reduced()}
function nm(D, u){return (D.names&&D.names[u])||"Player"}
var PACK={mild:"Mild", spicy:"Spicy", extra:"Absurd"};
var WHY={repeat:"said a repeat", rejected:"had an answer thrown out", time:"ran out of time"};

function render(box, ctx){
  var s=box.__cc||(box.__cc={key:"", tiles:{}, outSeen:0, played:{}, lastSec:-1});
  var pub=ctx.pub, D=ctx.D;
  box.classList.add("cs"); box.classList.toggle("cs-compact", !!ctx.compact);
  if(!pub||!D){box.textContent=""; s.key=""; return}
  var key=D.round+"|"+pub.phase+"|"+(D.at||0)+"|"+(D.actor||"");
  if(s.key!==key){var first=!s.key; s.key=key; s.played={}; s.lastSec=-1; build(box, s, ctx); if(!first&&pub.phase!=="turn") play(ctx, "whoosh")}
  update(box, s, ctx);
}
function head(D, label){
  var h=el("div", "cs-head");
  h.appendChild(el("span", "cs-chip", "Round "+D.round+" of "+D.rounds));
  h.appendChild(el("span", "cs-chip", D.mode==="potato"?"Hot Potato":"Spotlight"));
  h.appendChild(el("span", "cs-chip", (PACK[D.pack]||"Mild")+" pack"));
  if(label) h.appendChild(el("span", "cs-chip cs-chip-strong", label));
  return h;
}
function catCard(D, showTarget){
  var c=el("div", "cc-cat");
  c.appendChild(el("p", "cc-cat-label", "Category"));
  c.appendChild(el("p", "cc-cat-text", D.cat?D.cat.text:""));
  if(showTarget&&D.mode==="spot"&&D.cat) c.appendChild(el("p", "cc-target", "Name "+D.cat.target));
  return c;
}
function tileGrid(s){var g=el("ul", "cc-tiles"); s.grid=g; s.tiles={}; return g}
function withRing(wrap, s, total, cls){var r=FX?FX.ring("cs-ring "+(cls||"")):el("div"); s.ring=r; s.total=total; wrap.appendChild(r); return r}
function build(box, s, ctx){
  var D=ctx.D, p=ctx.pub.phase, T=(L&&L.T)||{};
  box.textContent=""; box.setAttribute("data-phase", p);
  var wrap=el("div", "cs-stage"); box.appendChild(wrap);
  s.ring=null; s.grid=null; s.meter=null; s.count=null; s.stamp=null; s.awards=null; s.alive=null; s.flash=null; s.votes=null;
  if(p==="intro"){
    wrap.appendChild(head(D, "Get ready"));
    s.count=el("p", "cc-count"); s.count.setAttribute("aria-live", "assertive"); wrap.appendChild(s.count);
    wrap.appendChild(catCard(D, true));
    wrap.appendChild(el("p", "cs-big", D.mode==="spot"?nm(D, D.actor)+" is in the spotlight.":"One answer each, around the table. Don't repeat!"));
  }else if(p==="answer"){
    wrap.appendChild(head(D, nm(D, D.actor)+" answers"));
    wrap.appendChild(catCard(D, true));
    s.meter=el("p", "cc-meter"); wrap.appendChild(s.meter);
    withRing(wrap, s, T.answer, "cc-big-ring");
    wrap.appendChild(tileGrid(s));
  }else if(p==="cvote"){
    wrap.appendChild(head(D, "Challenge!"));
    wrap.appendChild(catCard(D, false));
    wrap.appendChild(el("p", "cs-big", D.mode==="spot"?"The table votes: keep it or throw it out?":nm(D, D.actor)+"'s answer is on trial."));
    var ul=el("ul", "cc-tiles");
    (D.voteIds||[]).forEach(function(id){var a=(D.answers||[]).filter(function(x){return x.id===id})[0]; if(a) ul.appendChild(el("li", "cc-tile flag", a.text))});
    wrap.appendChild(ul);
    s.votes=el("p", "cs-mid"); wrap.appendChild(s.votes);
    withRing(wrap, s, D.mode==="spot"?T.cvote:T.potatoVote);
  }else if(p==="turn"||p==="window"){
    wrap.appendChild(head(D, "Lap "+((D.lap||0)+1)));
    wrap.appendChild(catCard(D, false));
    var who=el("p", "cs-big");
    if(p==="turn"){who.appendChild(el("b", "cs-name", nm(D, D.actor))); who.appendChild(document.createTextNode(" — your answer!"))}
    else{var last=(D.answers||[]).filter(function(a){return a.id===D.current})[0]; who.textContent="“"+(last?last.text:"")+"” — challenge it?"}
    wrap.appendChild(who);
    withRing(wrap, s, p==="turn"?(D.turnMs||8000):T.window, p==="turn"?"cc-big-ring":"");
    s.alive=el("ul", "cc-alive"); wrap.appendChild(s.alive);
    wrap.appendChild(tileGrid(s));
  }else if(p==="result"){
    var o=D.outcome;
    wrap.appendChild(head(D, "Result"));
    wrap.appendChild(catCard(D, D.mode==="spot"));
    if(D.note) wrap.appendChild(el("p", "cs-big", D.note));
    else if(o&&o.mode==="spot"){
      s.meter=el("p", "cc-meter"); wrap.appendChild(s.meter);
      var g=tileGrid(s); wrap.appendChild(g);
      s.stamp=el("div", "cs-stamp "+(o.hit?"not":"guilty"), o.hit?"TARGET HIT!":"MISSED IT"); s.stamp.setAttribute("aria-live", "assertive"); wrap.appendChild(s.stamp);
    }else if(o&&o.mode==="potato"){
      wrap.appendChild(el("p", "cs-eyebrow", "Last one standing"));
      s.stamp=el("div", "cs-stamp not", o.winner?nm(D, o.winner):"Nobody"); wrap.appendChild(s.stamp);
      if(o.second) wrap.appendChild(el("p", "cs-mid", "Second place: "+nm(D, o.second)+" (+1). Winner +3."));
    }
    s.drinkBox=el("div", "cc-drinks"); wrap.appendChild(s.drinkBox);
  }else if(p==="end"){
    var e=D.end||{standings:[], awards:[]};
    wrap.appendChild(el("p", "cs-eyebrow", "That's the countdown"));
    var t=e.standings[0];
    wrap.appendChild(el("p", "cs-big", t?nm(D, t.uid)+" wins with "+t.score+" point"+(t.score===1?"":"s")+".":"Final scores"));
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
/* Tiles are added in place, so each new one pops in by itself and old ones don't flicker. */
function paintTiles(s, ctx, revealUpTo){
  var D=ctx.D, list=D.answers||[], n=0;
  list.forEach(function(a, i){
    var t=s.tiles[a.id];
    if(!t){
      t=el("li", "cc-tile"+(still()?"":" pop"), a.text); s.tiles[a.id]=t; s.grid.appendChild(t);
      if(!s.played["t"+a.id]){s.played["t"+a.id]=1; if(D.mode==="spot"||ctx.pub.phase==="window") play(ctx, "pop")}
    }
    var flags=((D.challenges||{})[a.id]||[]).length;
    t.classList.toggle("flag", flags>0);
    t.setAttribute("data-flags", flags?("⚑ "+flags):"");
    t.classList.toggle("out", a.status==="out");
    if(D.mode==="potato") t.setAttribute("data-who", nm(D, a.uid));
    if(revealUpTo!=null) t.classList.toggle("dim", i>=revealUpTo);
    if(a.status==="ok") n++;
  });
  return n;
}
function update(box, s, ctx){
  var D=ctx.D, pub=ctx.pub, now=ctx.now, since=now-(D.at||now), p=pub.phase;
  if(s.ring&&FX){
    var secs=FX.setRing(s.ring, pub.deadline-now, s.total||1);
    if(secs<=5&&secs>0&&secs!==s.lastSec){s.lastSec=secs; if(p!=="intro") play(ctx, "tick")}
  }
  if(s.count){
    var left=Math.max(0, Math.ceil((pub.deadline-now)/1000));
    var txt=left>0?String(left):"GO!";
    if(s.count.textContent!==txt){s.count.textContent=txt; if(!still()){s.count.classList.remove("beat"); void s.count.offsetWidth; s.count.classList.add("beat")} play(ctx, "count", left===0)}
  }
  if(s.votes) s.votes.textContent=(D.votesIn||0)+" vote"+(D.votesIn===1?"":"s")+" in";
  if(s.grid&&p!=="result") paintTiles(s, ctx);
  if(s.meter&&p==="answer"){var okN=(D.answers||[]).filter(function(a){return a.status==="ok"}).length; s.meter.textContent=okN+" / "+(D.cat?D.cat.target:0); s.meter.classList.toggle("hit", D.cat&&okN>=D.cat.target)}
  if(s.alive){
    var key=JSON.stringify([D.alive, D.out, D.actor]);
    if(s.alive.dataset.key!==key){
      s.alive.dataset.key=key; s.alive.textContent="";
      (D.order||[]).forEach(function(u){
        var on=(D.alive||[]).indexOf(u)>=0, li=el("li", (on?"":"gone")+(u===D.actor&&on?" now":""), nm(D, u));
        s.alive.appendChild(li);
      });
    }
    var outs=D.out||[];
    if(outs.length>s.outSeen){
      var last=outs[outs.length-1]; s.outSeen=outs.length;
      if(!s.flash){s.flash=el("div", "cs-flash"); s.flash.setAttribute("aria-live", "assertive"); box.querySelector(".cs-stage").appendChild(s.flash)}
      s.flash.textContent=nm(D, last.uid)+" is out — "+(WHY[last.why]||"out")+"!";
      s.flash.classList.remove("on"); void s.flash.offsetWidth; s.flash.classList.add("on");
      play(ctx, "knock");
    }
  }else s.outSeen=(D.out||[]).length;
  if(p==="result"){
    var o=D.outcome;
    if(o&&o.mode==="spot"&&s.grid){
      var total=(D.answers||[]).length, step=still()?0:Math.min(400, 2200/Math.max(1, total)), shown=still()?total:Math.min(total, Math.floor(since/step));
      var okc=paintTiles(s, ctx, shown);
      var counted=(D.answers||[]).slice(0, shown).filter(function(a){return a.status==="ok"}).length;
      s.meter.textContent=counted+" / "+o.target;
      if((still()||shown>=total)&&!s.stamp.classList.contains("on")){s.stamp.classList.add("on"); if(!s.played.st){s.played.st=1; play(ctx, o.hit?"hit":"miss"); if(o.hit&&FX) FX.confetti()}}
    }else if(o&&o.mode==="potato"&&s.stamp&&!s.stamp.classList.contains("on")){s.stamp.classList.add("on"); if(!s.played.st){s.played.st=1; play(ctx, "fanfare"); if(FX) FX.confetti()}}
    if(s.drinkBox){
      var dk=JSON.stringify([D.drinks, D.choices]);
      if(s.drinkBox.dataset.key!==dk){
        s.drinkBox.dataset.key=dk; s.drinkBox.textContent="";
        (D.drinks||[]).forEach(function(d){
          var c=(D.choices||{})[d.uid];
          var line=nm(D, d.uid)+": "+(c==="drink"?"takes a drink":c==="alt"?"does the alternative":c==="pass"?"passed":(d.what==="drink"?"take a drink or do the alternative":"do the alternative"))+" ("+d.why+")";
          s.drinkBox.appendChild(el("p", null, line));
        });
      }
    }
  }
  if(s.awards) s.awards.forEach(function(c, i){if((still()||since>=2200+i*1700)&&!c.classList.contains("on")){c.classList.add("on"); if(!s.played["a"+i]){s.played["a"+i]=1; play(ctx, "award")}}});
}
root.CountdownScreen={render:render};
})(window);
