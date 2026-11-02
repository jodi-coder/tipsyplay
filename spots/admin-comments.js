(function(){
var uidEl=document.getElementById("uid");
var stateEl=document.getElementById("state");
var msgEl=document.getElementById("msg");
var listEl=document.getElementById("list");
var pageInput=document.getElementById("page");
var db=null,authObj=null,uid=null,ref,get,remove,onValue;

function say(t){msgEl.textContent=t||""}
function stamp(ts){
 if(typeof ts!=="number")return "";
 try{return new Date(ts).toLocaleString()}catch(e){return ""}
}
function article(page,id,v){
 var art=document.createElement("article");
 art.className="comment";
 var head=document.createElement("p");
 head.className="comment-name";
 var strong=document.createElement("strong");
 strong.textContent=(v&&v.name)||"Guest";
 var time=document.createElement("time");
 time.textContent=stamp(v&&v.ts);
 head.appendChild(strong);
 head.appendChild(document.createTextNode(" · "+page));
 head.appendChild(time);
 var body=document.createElement("p");
 body.textContent=(v&&v.text)||"";
 var del=document.createElement("button");
 del.type="button";
 del.className="btn alt";
 del.textContent="Delete";
 del.addEventListener("click",function(){
  del.disabled=true;
  remove(ref(db,"comments/"+page+"/"+id)).then(function(){art.remove();say("Deleted.")}).catch(function(){
   del.disabled=false;
   say("Delete failed. Set admins/"+uid+" to true in the Firebase console, then reload.");
  });
 });
 art.appendChild(head);
 art.appendChild(body);
 art.appendChild(del);
 listEl.appendChild(art);
}
function clearList(){while(listEl.firstChild)listEl.removeChild(listEl.firstChild)}
function showPage(page,data){
 clearList();
 var rows=[];
 Object.keys(data||{}).forEach(function(id){
  var v=data[id]||{};
  rows.push({id:id,v:v,ts:typeof v.ts==="number"?v.ts:0});
 });
 rows.sort(function(a,b){return b.ts-a.ts});
 rows.forEach(function(r){article(page,r.id,r.v)});
 if(!rows.length)say("No comments on that page.");
}
function showAll(data){
 clearList();
 var n=0;
 Object.keys(data||{}).forEach(function(page){
  var bucket=data[page]||{};
  Object.keys(bucket).forEach(function(id){
   n++;
   article(page,id,bucket[id]||{});
  });
 });
 say(n?n+" comment"+(n===1?"":"s")+".":"No comments yet.");
}
async function boot(){
 var base="https://www.gstatic.com/firebasejs/12.4.0/";
 var appMod=await import(base+"firebase-app.js");
 var authMod=await import(base+"firebase-auth.js");
 var dbMod=await import(base+"firebase-database.js");
 var cfg=await import("/firebase-config.js?v=12");
 var app=appMod.initializeApp(cfg.firebaseConfig);
 authObj=authMod.getAuth(app);
 db=dbMod.getDatabase(app);
 ref=dbMod.ref;get=dbMod.get;remove=dbMod.remove;onValue=dbMod.onValue;
 if(authObj.authStateReady)await authObj.authStateReady();
 var cred=await authMod.signInAnonymously(authObj);
 await cred.user.getIdToken();
 uid=cred.user.uid;
 uidEl.textContent=uid;
 var adminSnap=await get(ref(db,"admins/"+uid));
 stateEl.textContent=adminSnap.exists()?"This uid is an admin. Deletes should work.":"This uid is not an admin yet. In Realtime Database, set admins/"+uid+" to true, then reload.";
} 
document.getElementById("load").addEventListener("click",function(){
 var page=String(pageInput.value||"").trim();
 if(!/^[a-z0-9][a-z0-9_-]{0,80}$/.test(page)){say("Use a page id like canada-cities__london-ontario.");return}
 say("Loading…");
 get(ref(db,"comments/"+page)).then(function(snap){showPage(page,snap.val())}).catch(function(){say("Couldn't read comments. Publish the database rules first.")});
});
document.getElementById("all").addEventListener("click",function(){
 say("Loading…");
 get(ref(db,"comments")).then(function(snap){showAll(snap.val())}).catch(function(){say("Couldn't read comments. Publish the database rules first.")});
});
document.getElementById("reports").addEventListener("click",function(){
 say("Loading reports…");
 get(ref(db,"reports")).then(function(snap){
  clearList();
  var data=snap.val()||{},n=0;
  Object.keys(data).forEach(function(page){
   Object.keys(data[page]||{}).forEach(function(id){
    n++;
    var art=document.createElement("article");
    art.className="comment";
    var p=document.createElement("p");
    p.textContent=page+" / "+id+" reported by "+Object.keys(data[page][id]||{}).length+" account"+(Object.keys(data[page][id]||{}).length===1?"":"s");
    art.appendChild(p);
    listEl.appendChild(art);
   });
  });
  say(n?n+" reported comment"+(n===1?"":"s")+".":"No reports.");
 }).catch(function(){say("Reports are visible only after admins/"+uid+" is true and the rules are published.")});
});
boot().catch(function(){stateEl.textContent="Sign-in failed. Check the connection and anonymous auth."});
})();
