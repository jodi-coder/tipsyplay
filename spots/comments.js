(function(){
var root=document.getElementById("comments");
if(!root)return;
var page=root.getAttribute("data-page")||"";
var listEl=document.getElementById("comment-list");
var moreBtn=document.getElementById("comment-more");
var msgEl=document.getElementById("comment-msg");
var form=document.getElementById("comment-form");
var STEP=8,limit=STEP,sending=false,uid=null,db=null,stop=null;
var BAD=/\b(fuck|fucking|fucked|fucker|shit|shitty|bullshit|bitch|bastard|asshole|dick|cock|cunt|pussy|slut|whore|nigger|nigga|faggot|fag|retard|retarded|kike|spic|chink|tranny)\b/i;
var ref,query,orderByChild,limitToLast,onValue,update,set,push,serverTimestamp,getAuth,signInAnonymously,getDatabase,initializeApp,authObj;

function say(text){if(msgEl)msgEl.textContent=text||""}
function clean(s){return String(s||"").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200D\uFEFF]/g,"").trim()}
function bad(s){return BAD.test(s)}
function stamp(ts){
 if(typeof ts!=="number")return "";
 try{return new Date(ts).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}catch(e){return ""}
}
function paint(rows){
 while(listEl.firstChild)listEl.removeChild(listEl.firstChild);
 rows.forEach(function(c){
  var art=document.createElement("article");
  art.className="comment";
  var head=document.createElement("p");
  head.className="comment-name";
  var strong=document.createElement("strong");
  strong.textContent=c.name||"Guest";
  var time=document.createElement("time");
  if(typeof c.ts==="number")time.dateTime=new Date(c.ts).toISOString();
  time.textContent=stamp(c.ts);
  head.appendChild(strong);
  head.appendChild(time);
  var body=document.createElement("p");
  body.textContent=c.text||"";
  var report=document.createElement("button");
  report.type="button";
  report.className="btn alt";
  report.textContent="Report";
  report.addEventListener("click",function(){reportComment(c.id,report)});
  art.appendChild(head);
  art.appendChild(body);
  art.appendChild(report);
  listEl.appendChild(art);
 });
}
function rowsFromSnap(snap){
 var rows=[];
 snap.forEach(function(child){
  var v=child.val()||{};
  rows.push({id:child.key,name:String(v.name||""),text:String(v.text||""),ts:typeof v.ts==="number"?v.ts:0});
 });
 rows.sort(function(a,b){return b.ts-a.ts});
 return rows;
}
async function ensureUser(){
 if(authObj.currentUser){uid=authObj.currentUser.uid;await authObj.currentUser.getIdToken();return}
 var cred=await signInAnonymously(authObj);
 await cred.user.getIdToken();
 uid=cred.user.uid;
}
function listen(){
 if(stop)stop();
 var q=query(ref(db,"comments/"+page),orderByChild("ts"),limitToLast(limit));
 stop=onValue(q,function(snap){
  var rows=rowsFromSnap(snap);
  paint(rows);
  if(moreBtn)moreBtn.classList.toggle("hide",rows.length<limit);
 },function(){
  say("Comments aren't open yet. The site owner still needs to publish the database rules.");
 });
}
async function reportComment(id,btn){
 if(!id||!btn||btn.disabled)return;
 btn.disabled=true;
 try{
  await ensureUser();
  await set(ref(db,"reports/"+page+"/"+id+"/"+uid),true);
  btn.textContent="Reported";
 }catch(e){
  btn.disabled=false;
  say("Report didn't send. Try again once comments are open.");
 }
}
async function boot(){
 if(!/^[a-z0-9][a-z0-9_-]{0,80}$/.test(page)){say("This page can't take comments.");return}
 var base="https://www.gstatic.com/firebasejs/12.4.0/";
 var appMod=await import(base+"firebase-app.js");
 var authMod=await import(base+"firebase-auth.js");
 var dbMod=await import(base+"firebase-database.js");
 var cfg=await import("/firebase-config.js?v=11");
 initializeApp=appMod.initializeApp;
 getAuth=authMod.getAuth;
 signInAnonymously=authMod.signInAnonymously;
 getDatabase=dbMod.getDatabase;
 ref=dbMod.ref;
 query=dbMod.query;
 orderByChild=dbMod.orderByChild;
 limitToLast=dbMod.limitToLast;
 onValue=dbMod.onValue;
 update=dbMod.update;
 set=dbMod.set;
 push=dbMod.push;
 serverTimestamp=dbMod.serverTimestamp;
 var app=initializeApp(cfg.firebaseConfig);
 authObj=getAuth(app);
 db=getDatabase(app);
 if(authObj.authStateReady)await authObj.authStateReady();
 try{await ensureUser()}catch(e){say("Comments need a connection and anonymous sign-in.")}
 listen();
}
if(form){
 form.addEventListener("submit",function(e){
  e.preventDefault();
  if(sending)return;
  var name=clean(form.elements.namedItem("name").value).replace(/\s+/g," ");
  var text=clean(form.elements.namedItem("text").value);
  if(name.length<1||name.length>24){say("Name needs 1 to 24 characters.");return}
  if(text.length<1||text.length>500){say("Comment needs 1 to 500 characters.");return}
  if(bad(name)||bad(text)){say("Please rephrase that. Comments stay friendly.");return}
  sending=true;
  say("Posting…");
  ensureUser().then(function(){
   var id=push(ref(db,"comments/"+page)).key;
   var updates={};
   updates["comments/"+page+"/"+id]={name:name,text:text,ts:serverTimestamp(),uid:uid};
   updates["users/"+uid+"/lastComment"]=serverTimestamp();
   return update(ref(db),updates);
  }).then(function(){
   form.elements.namedItem("text").value="";
   say("Posted. You can comment again in 30 seconds.");
   setTimeout(function(){sending=false;say("")},30000);
  }).catch(function(){
   sending=false;
   say("That didn't post. Wait 30 seconds between comments, or the owner still needs to publish the database rules.");
  });
 });
}
if(moreBtn){
 moreBtn.addEventListener("click",function(){
  limit+=STEP;
  if(db)listen();
 });
}
if(window.__TP_SEED_ONLY){
 paint(window.__TP_SEED_COMMENTS||[]);
 return;
}
boot().catch(function(){say("Comments need a connection.")});
})();
