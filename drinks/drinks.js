/* Drinks section: the "Made with" filter on a type page and the name search on the drinks hub.
   Both pages list every drink in the HTML, so they read fine with scripts off. */
(function(){
var count=document.getElementById("dkcount");
function say(n){if(count)count.textContent=n+" drink"+(n===1?"":"s")}

var bases=document.getElementById("bases"),grid=document.getElementById("dkgrid");
if(bases&&grid){
 var cards=[].slice.call(grid.querySelectorAll(".dk-card"));
 bases.addEventListener("click",function(e){
  var b=e.target.closest?e.target.closest("button[data-base]"):null;if(!b)return;
  var want=b.getAttribute("data-base"),n=0;
  [].forEach.call(bases.querySelectorAll("button"),function(x){x.setAttribute("aria-pressed",x===b?"true":"false")});
  cards.forEach(function(c){var ok=want==="all"||c.getAttribute("data-base")===want;c.hidden=!ok;if(ok)n++});
  say(n);
 });
}

var box=document.getElementById("dksearch"),az=document.getElementById("dkaz");
if(box&&az){
 var rows=[].slice.call(az.querySelectorAll("li"));
 box.addEventListener("input",function(){
  var q=box.value.trim().toLowerCase(),n=0;
  rows.forEach(function(r){var ok=!q||r.getAttribute("data-name").indexOf(q)!==-1;r.hidden=!ok;if(ok)n++});
  say(n);
 });
}
})();
