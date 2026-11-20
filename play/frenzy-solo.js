(function(){
"use strict";
/* Five Letter Frenzy: the mode picker and Solo mode.
   Solo needs no network: the word list and the rules are in the page, so it works offline once loaded.
   The daily word comes from the local date, so everyone on the same date gets the same word. Stats and the day's
   progress live in localStorage. The result card shows colours and shapes only, never a letter. */
var L=window.FrenzyLogic, M=window.FrenzyModes, W=window.FRENZY_WORDS, FX=window.FrenzyFX;
var $=function(id){return document.getElementById(id)};
if(!L||!M||!W||!$("modes")) return;
L.useWords(W);
var KEY_STATS="tp_fl_solo_stats", KEY_DAILY="tp_fl_solo_daily";
var EMU=/[?&]emulator=1(?:&|$)/.test(location.search);
var g=null, typedLen=0, popAt=null, shakeAt=0, finishTimer=0;

function el(tag, cls, text){var n=document.createElement(tag); if(cls) n.className=cls; if(text!=null) n.textContent=text; return n}
function show(id, on){var n=$(id); if(n) n.classList.toggle("hide", !on)}
function reduced(){return !!(FX&&FX.reduced&&FX.reduced())}
function fx(name, a){if(FX&&typeof FX[name]==="function"){try{FX[name](a)}catch(e){}}}
function load(key){try{return JSON.parse(localStorage.getItem(key)||"null")}catch(e){return null}}
function save(key, v){try{localStorage.setItem(key, JSON.stringify(v))}catch(e){}}
function stats(){return M.cleanStats(load(KEY_STATS))}

/* ---------- stats ---------- */
function renderStats(box, s, hi){
  box.textContent="";
  if(!s.played){box.appendChild(el("p", null, "Your stats appear here after your first game.")); return}
  var row=el("div", "fl-statrow");
  [["Played", s.played], ["Win %", M.winPct(s)], ["Streak", s.streak], ["Best", s.best]].forEach(function(x){
    var d=el("div"); d.appendChild(el("b", null, String(x[1]))); d.appendChild(el("span", null, x[0])); row.appendChild(d);
  });
  box.appendChild(row);
  box.appendChild(el("p", "tag", "Guess distribution"));
  var max=Math.max.apply(null, s.dist.concat([s.lost, 1])), ul=el("ul", "fl-dist");
  s.dist.concat([s.lost]).forEach(function(n, i){
    var li=el("li"); li.appendChild(el("span", null, i<6?String(i+1):"✗"));
    var bar=el("span", "bar"+(hi===i?" me":""), String(n)); bar.style.setProperty("--w", (n/max).toFixed(3));
    bar.setAttribute("aria-label", (i<6?(i+1)+" guess"+(i?"es":""):"lost")+": "+n);
    li.appendChild(bar); ul.appendChild(li);
  });
  box.appendChild(ul);
}

/* ---------- the board ---------- */
function paintLegend(){
  var box=$("slegend"); if(box.childElementCount) return;
  [["lock","●","Right place"],["move","↗","Wrong place"],["miss","×","Not in the word"]].forEach(function(item){
    var li=el("li", "fl-key"); li.appendChild(el("span", "fl-swatch "+item[0], item[1])); li.appendChild(el("span", null, item[2])); box.appendChild(li);
  });
}
function paintGrid(typing, flipRow){
  var box=$("sgrid"); box.textContent="";
  var r, i, row, cell;
  for(r=0;r<L.MAX_GUESSES;r++){
    row=el("div", "fl-row");
    if(g.rows[r]){
      var d=g.rows[r];
      if(shakeAt&&r===g.rows.length) row.classList.add("fl-shake");
      for(i=0;i<5;i++){
        var m=d.marks[i], kind=m==="locked"?"lock":m==="moved"?"move":"miss";
        cell=el("div", "fl-tile "+kind);
        if(flipRow===r&&!reduced()){cell.classList.add("fl-flip"); cell.style.animationDelay=(i*(FX?FX.STEP_MS:120))+"ms"}
        cell.appendChild(el("span", "fl-mark", m==="locked"?"●":m==="moved"?"↗":"×"));
        cell.appendChild(el("span", "fl-letter", d.word[i].toUpperCase()));
        cell.setAttribute("aria-label", d.word[i].toUpperCase()+", "+(m==="locked"?"right place":m==="moved"?"wrong place":"not in the word"));
        row.appendChild(cell);
      }
    }else if(r===g.rows.length&&!g.done){
      if(shakeAt) row.classList.add("fl-shake");
      for(i=0;i<5;i++){
        var ch=(typing||"")[i]||"";
        cell=el("div", "fl-tile"+(ch?"":" empty"));
        if(ch&&popAt===i&&!reduced()) cell.classList.add("fl-pop");
        cell.appendChild(el("span", "fl-letter", ch.toUpperCase()));
        row.appendChild(cell);
      }
    }else for(i=0;i<5;i++) row.appendChild(el("div", "fl-tile empty", ""));
    box.appendChild(row);
  }
}

/* ---------- starting a game ---------- */
function pickRandom(){return W.answers[L.randomInt(W.answers.length)]}
function open(kind){
  window.clearTimeout(finishTimer);
  var key=M.dateKey();
  g={kind:kind, key:key, rows:[], done:false, won:false, word:""};
  if(kind==="Daily"){
    g.word=M.dailyWord(key, W.answers);
    var saved=load(KEY_DAILY);
    if(saved&&saved.key===key&&Array.isArray(saved.rows)){
      saved.rows.slice(0, L.MAX_GUESSES).forEach(function(w){
        w=L.normalize(w); if(w.length===5) g.rows.push({word:w, marks:L.markGuess(g.word, w)});
      });
      var last=g.rows[g.rows.length-1];
      g.won=!!last&&L.lockedCount(last.marks)===5;
      g.done=g.won||g.rows.length>=L.MAX_GUESSES;
    }
  }else g.word=pickRandom();
  show("modes", false); show("solo", true); show("solopick", false);
  if(g.done){showResult(true); return}
  show("soloresult", false); show("soloplay", true);
  $("solotitle").textContent=kind==="Daily"?"Daily word · "+key:"Random word";
  $("soloerr").textContent=""; $("soloinput").value=""; typedLen=0; popAt=null; shakeAt=0;
  paintLegend(); paintGrid("", -1);
  var focusIn=function(){try{$("soloinput").focus()}catch(e){}};
  if(g.rows.length===0&&FX&&typeof FX.playIntro==="function") FX.playIntro(focusIn);
  else focusIn();
}
function openPicker(){
  window.clearTimeout(finishTimer);
  g=null; show("modes", false); show("solo", true); show("solopick", true); show("soloplay", false); show("soloresult", false);
  var s=stats(), saved=load(KEY_DAILY), today=M.dateKey(), note=$("solo-daily-note");
  if(saved&&saved.key===today&&saved.done){
    note.textContent="Done for today: "+(saved.won?saved.rows.length+"/6":"X/6")+". Tap to see it again.";
  }else if(saved&&saved.key===today&&saved.rows&&saved.rows.length){
    note.textContent="In progress: "+saved.rows.length+" guess"+(saved.rows.length===1?"":"es")+" so far.";
  }else note.textContent="Today's word, the same for everyone.";
  renderStats($("solostats"), s, -1);
}

/* ---------- guessing ---------- */
function submit(raw){
  if(!g||g.done) return;
  var err=L.guessError(raw, g.rows.map(function(r){return r.word}));
  if(err){
    $("soloerr").textContent=err; fx("reject");
    if(!reduced()){shakeAt=Date.now(); paintGrid(L.normalize($("soloinput").value).slice(0, 5), -1); window.setTimeout(function(){shakeAt=0; if(g&&!g.done) paintGrid(L.normalize($("soloinput").value).slice(0, 5), -1)}, 400)}
    return;
  }
  $("soloerr").textContent="";
  var w=L.normalize(raw), marks=L.markGuess(g.word, w), solved=L.lockedCount(marks)===5;
  g.rows.push({word:w, marks:marks}); $("soloinput").value=""; typedLen=0; popAt=null; shakeAt=0;
  g.won=solved; g.done=solved||g.rows.length>=L.MAX_GUESSES;
  if(g.kind==="Daily") save(KEY_DAILY, {key:g.key, rows:g.rows.map(function(r){return r.word}), done:g.done, won:g.won});
  fx("reveal", marks); paintGrid("", g.rows.length-1);
  if(g.done){
    if(solved) fx("solved", (FX?FX.STEP_MS*4+FX.FLIP_MS:600));
    else window.setTimeout(function(){fx("outOfGuesses")}, 700);
    $("soloinput").disabled=true; $("sologuess").disabled=true;
    finishTimer=window.setTimeout(function(){
      if(solved&&FX&&typeof FX.playWin==="function"){
        FX.playWin(function(){showResult(false)});
      }else showResult(false);
    }, reduced()?0:(FX?FX.STEP_MS*4+FX.FLIP_MS+250:700));
  }
}

/* ---------- the result ---------- */
function showResult(restored){
  show("solopick", false); show("soloplay", false); show("soloresult", true);
  var s=stats(), rows=g.rows.map(function(r){return r.marks});
  /* the day's result counts once: the first time this finished game is shown, never on a replay or a reload */
  var counted=false;
  if(g.kind==="Daily"){var sv=load(KEY_DAILY); counted=!!(sv&&sv.key===g.key&&sv.counted)}
  if(!counted){
    s=M.applyResult(s, g.won, g.rows.length); save(KEY_STATS, s);
    if(g.kind==="Daily"){var cur=load(KEY_DAILY)||{key:g.key, rows:g.rows.map(function(r){return r.word}), done:true, won:g.won}; cur.counted=true; save(KEY_DAILY, cur)}
  }
  $("soloheadline").textContent=g.won?"You got it in "+g.rows.length+"!":"Out of guesses";
  var wp=$("soloword"); wp.textContent=""; wp.setAttribute("aria-label", g.word.toUpperCase());
  g.word.toUpperCase().split("").forEach(function(c, i){
    var t=el("span", "fl-wtile", c); t.setAttribute("aria-hidden", "true");
    if(!restored&&!g.won&&!reduced()){t.classList.add("fl-wflip"); t.style.animationDelay=(i*160)+"ms"}
    wp.appendChild(t);
  });
  $("soloemoji").textContent=M.emojiGrid(rows);
  renderStats($("soloresultstats"), s, g.won?g.rows.length-1:6);
  $("solonext").textContent=g.kind==="Daily"?"A new daily word arrives at midnight.":"";
  $("soloagain").textContent="Play a random word";
  $("soloshare").dataset.done="";
  if(!restored&&g.won) fx("confetti");
}
function share(){
  var text=M.shareText(g.kind, g.key, g.won, g.rows.map(function(r){return r.marks})), note=$("solonext");
  if(navigator.share){
    navigator.share({text:text}).catch(function(){});
  }else if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){note.textContent="Result copied. Paste it anywhere."}, function(){note.textContent="Couldn't copy. Select the squares above and copy them."});
  }else note.textContent="Select the squares above and copy them.";
}

/* ---------- wiring ---------- */
function wire(){
  var mute=$("mute"); if(window.TPSound&&mute){
    try{if(localStorage.getItem("tp_sound")===null) TPSound.setEnabled(false)}catch(e){}
    TPSound.bindMute(mute);
  }
  $("mode-solo").addEventListener("click", openPicker);
  $("mode-table").addEventListener("click", function(){if(window.FrenzyTable) window.FrenzyTable.start()});
  $("solo-daily").addEventListener("click", function(){open("Daily")});
  $("solo-random").addEventListener("click", function(){open("Random")});
  $("soloagain").addEventListener("click", function(){$("soloinput").disabled=false; $("sologuess").disabled=false; open("Random")});
  $("soloquit").addEventListener("click", openPicker);
  $("soloshare").addEventListener("click", share);
  $("soloform").addEventListener("submit", function(e){e.preventDefault(); submit($("soloinput").value)});
  $("soloinput").addEventListener("input", function(){
    if(!g||g.done) return;
    var t=L.normalize($("soloinput").value).slice(0, 5);
    if(t.length>typedLen){fx("type"); popAt=t.length-1} else popAt=null;
    typedLen=t.length; $("soloerr").textContent=""; paintGrid(t, -1);
  });
  if(EMU) window.__tpSolo={word:function(){return g&&g.word}, rows:function(){return g&&g.rows}, key:function(){return g&&g.key}};
}
wire();

/* ---------- which mode? ---------- */
var q=String(location.search||"");
var mode=(q.match(/[?&]mode=(solo|table|race)/)||[])[1], game=(q.match(/[?&]game=([a-z]+)/)||[])[1];
var inRoom=false; try{inRoom=!!sessionStorage.getItem("tp_fl_room")}catch(e){}
if(mode==="race"||game==="fr"){location.replace("five-letter-race.html"+(game==="fr"?q:""))}
else if(mode==="table"||/[?&](?:room|code)=[A-Za-z]{4}/i.test(q)||inRoom){if(window.FrenzyTable) window.FrenzyTable.start()}
else if(mode==="solo") openPicker();
})();
