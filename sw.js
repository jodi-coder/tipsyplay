const CACHE="tipsyplay-v27";
const V="17";
function ver(path){return path+"?v="+V}
const FILES=["./","index.html","library.html","favourites.html","settings.html","responsible.html","about.html","contact.html","privacy.html","terms.html","robots.txt","sitemap.xml","games/index.html","games/card/","games/quick/","games/for-two/","games/big-groups/","games/no-props/","games/never-have-i-ever.html","play/never-have-i-ever.html","play/party.html","play/join.html","data/nhie.json","manifest.webmanifest","icons/icon-192.png","icons/icon-512.png","icons/apple-touch-icon.png","images/hero-beer-pong.webp","images/hero-beer-pong.jpg","images/friends-card-game.webp","images/friends-card-game.jpg","images/friends-phones.webp","images/friends-phones.jpg","images/og-image.jpg","spots/index.html","spots/canada-cities/index.html","spots/usa-cities/index.html","spots/canada-universities/index.html","spots/usa-universities/index.html","styles.css?v=18","styles.css?v=19","app.js?v=18",ver("sounds.js"),ver("firebase-config.js"),ver("data/nhie.js"),ver("play/nhie-game.js"),ver("play/party.js"),"play/join.js?v=19","play/multi.js?v=24",ver("data/party-games.js"),"play/kings-cup.js?v=24",ver("play/party-audio.js"),ver("play/nhie-party.js"),ver("data/nhie-packs.js"),"play/most-likely.js?v=24",ver("play/qr.js"),ver("data/most-likely-packs.js"),"play/join-qr.js?v=1","play/poster-logic.js?v=1","play/poster-party.js?v=4","fonts/anton-latin.woff2","fonts/anton-latin-ext.woff2","fonts/outfit-latin.woff2","fonts/outfit-latin-ext.woff2","play/poster.css?v=1","play/nhie-party.js?v=27","data/split-decision.js?v=1","data/vibe-checkpoint.js?v=1","data/chaos-crew.js?v=1","games/split-decision.html","games/vibe-checkpoint.html","games/chaos-crew.html","games/kings-cup.html","games/story-chain.html","games/whos-most-likely.html","games/hot-take-court.html","games/card-lottery.html","games/cup-toss.html","games/category-countdown.html","games/two-truths.html","games/sketchy-guess.html","games/rule-maker.html","play/story-chain.html","play/whos-most-likely.html","play/hot-take-court.html","play/card-lottery.html","play/cup-toss.html","play/category-countdown.html","play/two-truths.html","play/sketchy-guess.html","play/rule-maker.html",ver("spots/spots.css"),ver("spots/comments.js"),ver("spots/admin-comments.js")];
function isFirebase(url){return /firebaseio\.com|firebasedatabase\.app|firebaseapp\.com|googleapis\.com|gstatic\.com\/firebasejs|identitytoolkit|securetoken/i.test(url)}
function isAnalytics(url){return /googletagmanager\.com|google-analytics\.com|analytics\.google\.com/i.test(url)}
function isSpotImage(url){return /\/images\/spots\//.test(url)}
function isHTML(req){
 if(req.mode==="navigate")return true;
 var accept=req.headers.get("accept")||"";
 var path="";
 try{path=new URL(req.url).pathname}catch(e){return false}
 return accept.indexOf("text/html")!==-1||/\.html$/.test(path)||/\/$/.test(path);
}
function versioned(req){try{return new URL(req.url).searchParams.has("v")}catch(e){return false}}
function put(req,res){if(res&&res.ok){var copy=res.clone();caches.open(CACHE).then(function(c){c.put(req,copy)})}return res}
self.addEventListener("install",function(e){e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(FILES)}).then(function(){return self.skipWaiting()}))});
self.addEventListener("activate",function(e){e.waitUntil(caches.keys().then(function(keys){return Promise.all(keys.filter(function(k){return k!==CACHE}).map(function(k){return caches.delete(k)}))}).then(function(){return self.clients.claim()}))});
self.addEventListener("fetch",function(e){
 if(e.request.method!=="GET")return;
 if(isFirebase(e.request.url)||isSpotImage(e.request.url)||isAnalytics(e.request.url))return;
 var url;try{url=new URL(e.request.url)}catch(err){return}
 if(url.origin!==self.location.origin)return;
 if(url.pathname.endsWith("/sw.js"))return;
 if(isHTML(e.request)){
  e.respondWith(fetch(e.request).then(function(res){return put(e.request,res)}).catch(function(){return caches.match(e.request).then(function(r){return r||caches.match("index.html")})}));
  return;
 }
 var ignore=versioned(e.request)?false:true;
 e.respondWith(caches.match(e.request,{ignoreSearch:ignore}).then(function(hit){
  if(hit)return hit;
  return fetch(e.request).then(function(res){return put(e.request,res)}).catch(function(){return caches.match(e.request,{ignoreSearch:ignore})});
 }));
});
