/* On-screen keyboard for Five Letter Frenzy (Solo, Table and Race).
   It types into each mode's own guess box and submits its own form, so the game code is unchanged:
   every key fires the box's "input" event (which paints the letters onto the board) and Enter submits the form.
   Keys take the best colour each letter has earned on the player's own board: green, then yellow, then grey.
   On touch screens the system keyboard is switched off (inputmode="none") and the box is hidden; the board shows the letters. */
(function(){
"use strict";
var d=document;
var touch=false;
try{touch=window.matchMedia("(hover: none) and (pointer: coarse)").matches}catch(e){}
var ROWS=["qwertyuiop","asdfghjkl","+zxcvbnm-"];
var RANK={miss:1,move:2,lock:3};
var SAY={lock:"right place",move:"in the word, wrong place",miss:"not in the word"};

function key(ch){
  var b=d.createElement("button"); b.type="button"; b.className="fl-kb-key";
  if(ch==="+"){b.dataset.k="enter"; b.className+=" wide"; b.textContent="Enter"}
  else if(ch==="-"){b.dataset.k="back"; b.className+=" wide"; b.textContent="⌫"; b.setAttribute("aria-label","Delete letter")}
  else{b.dataset.k=ch; b.textContent=ch.toUpperCase(); b.setAttribute("aria-label",ch.toUpperCase())}
  return b;
}

function attach(formId,inputId,gridId){
  var form=d.getElementById(formId), input=d.getElementById(inputId), grid=d.getElementById(gridId);
  if(!form||!input||!grid||form.querySelector(".fl-kb")) return;
  var kb=d.createElement("div"); kb.className="fl-kb"; kb.setAttribute("role","group"); kb.setAttribute("aria-label","Keyboard");
  var letters={};
  ROWS.forEach(function(row){
    var r=d.createElement("div"); r.className="fl-kb-row";
    row.split("").forEach(function(ch){var b=key(ch); if(ch!=="+"&&ch!=="-") letters[ch]=b; r.appendChild(b)});
    kb.appendChild(r);
  });
  form.appendChild(kb);
  if(touch){d.body.classList.add("fl-kb-touch"); input.setAttribute("inputmode","none")}

  // Keep the caret in the guess box on computers, so a physical keyboard still works after a click.
  kb.addEventListener("mousedown",function(e){e.preventDefault()});
  kb.addEventListener("click",function(e){
    var t=e.target; if(t&&t.nodeType!==1) t=t.parentElement;
    var b=t&&t.closest?t.closest(".fl-kb-key"):null;
    if(!b||input.disabled||input.readOnly) return;
    var k=b.dataset.k, v=input.value.replace(/[^a-z]/gi,"");
    if(k==="enter"){
      if(form.requestSubmit) form.requestSubmit();
      else form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));
      return;
    }
    if(k==="back") input.value=v.slice(0,-1);
    else if(v.length<5) input.value=v+k;
    else return;
    input.dispatchEvent(new Event("input",{bubbles:true}));
  });

  function paint(){
    var best={};
    var tiles=grid.querySelectorAll(".fl-tile.lock,.fl-tile.move,.fl-tile.miss");
    for(var i=0;i<tiles.length;i++){
      var t=tiles[i], src=t.querySelector(".fl-letter")||t;
      var l=(src.textContent||"").replace(/[^a-z]/gi,"").toLowerCase().slice(-1);
      if(!l) continue;
      var s=t.classList.contains("lock")?"lock":t.classList.contains("move")?"move":"miss";
      if(!best[l]||RANK[s]>RANK[best[l]]) best[l]=s;
    }
    Object.keys(letters).forEach(function(ch){
      var b=letters[ch], s=best[ch]||"";
      if(b.dataset.s===s) return;
      b.dataset.s=s; b.classList.remove("lock","move","miss"); if(s) b.classList.add(s);
      b.setAttribute("aria-label",ch.toUpperCase()+(s?", "+SAY[s]:""));
    });
  }
  new MutationObserver(paint).observe(grid,{childList:true,subtree:true,attributes:true,attributeFilter:["class"]});
  paint();
}

window.TipsyFrenzyKeys={attach:attach};
attach("soloform","soloinput","sgrid");
attach("guessform","guess","grid");
})();
