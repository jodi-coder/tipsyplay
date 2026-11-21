const CACHE="tipsyplay-v67";
const V="18";
function ver(path){return path+"?v="+V}
const FILES=["./","index.html","library.html","favourites.html","settings.html","responsible.html","about.html","contact.html","privacy.html","terms.html","robots.txt","sitemap.xml","games/index.html","drinks/index.html","drinks/drinks.css?v=2","drinks/drinks.js?v=1","games/card/","games/quick/","games/for-two/","games/big-groups/","games/no-props/","games/never-have-i-ever.html","play/never-have-i-ever.html","play/party.html","play/join.html","data/nhie.json","manifest.webmanifest","icons/icon-192.png","icons/icon-512.png","icons/apple-touch-icon.png","images/hero-beer-pong.webp","images/hero-phones-nan.webp","images/hero-phones-nan.jpg","images/hero-beer-pong.jpg","images/friends-card-game.webp","images/friends-card-game.jpg","images/friends-phones.webp","images/friends-phones.jpg","images/og-image.jpg","spots/index.html","spots/canada-cities/index.html","spots/usa-cities/index.html","spots/canada-universities/index.html","spots/usa-universities/index.html","styles.css?v=29","home.css?v=15","home.js?v=1","app.js?v=22","sounds.js?v=18","firebase-config.js?v=17",ver("data/nhie.js"),ver("play/nhie-game.js"),"play/party.js?v=35","play/join.js?v=23","play/multi.js?v=28","data/party-games.js?v=19","play/kings-cup.js?v=32","play/kings-cup.css?v=3","play/party-audio.js?v=19","data/nhie-packs.js?v=20","data/nhie-likely.js?v=3","play/qr.js?v=18","play/join-qr.js?v=1","play/room-ui.js?v=4","play/poster-logic.js?v=3","play/split-fx.js?v=1","play/poster-party.js?v=11","fonts/bricolage-grotesque-latin-opsz-normal.woff2","play/poster.css?v=7","play/nhie-party.js?v=37","data/split-decision.js?v=1","games/split-decision.html","games/vault-traitor.html","play/vault-traitor.js?v=4","play/vault-logic.js?v=2","games/punchline-duel.html","play/quiplash-party.js?v=2","play/quiplash-logic.js?v=1","data/quiplash.js?v=1","games/odd-word-out.html","play/mole-party.js?v=2","play/mole-logic.js?v=1","data/mole.js?v=1","games/five-letter-frenzy.html","play/frenzy-party.js?v=4","play/frenzy-modes.js?v=1","play/frenzy-solo.js?v=1","play/frenzy-race.js?v=1","games/five-letter-race.html","play/frenzy-fx.js?v=1","sounds.js?v=19","play/frenzy-logic.js?v=2","data/frenzy-words.js?v=4","games/slow-drip.html","play/slow-drip.html","play/slow-drip.js?v=2","play/drip-logic.js?v=1","data/slow-drip.js?v=2","games/kings-cup.html","games/story-chain.html","games/hot-take-court.html","games/card-lottery.html","games/category-countdown.html","games/two-truths.html","games/sketchy-guess.html","games/rule-maker.html","play/story-chain.html","play/hot-take-court.html","play/display.html","play/display.js?v=1","play/party-fx.js?v=1","play/party-games.css?v=1","data/court.js?v=1","play/court-logic.js?v=1","play/court-screen.js?v=1","play/court-party.js?v=1","data/countdown.js?v=1","play/countdown-logic.js?v=1","play/countdown-screen.js?v=1","play/countdown-party.js?v=1","play/card-lottery.html","play/category-countdown.html","play/two-truths.html","play/sketchy-guess.html","play/rule-maker.html","spots/spots.css?v=17","spots/comments.js?v=17","spots/admin-comments.js?v=17"];
function isFirebase(url){return /firebaseio\.com|firebasedatabase\.app|firebaseapp\.com|googleapis\.com|gstatic\.com\/firebasejs|identitytoolkit|securetoken/i.test(url)}
function isAnalytics(url){return /googletagmanager\.com|google-analytics\.com|analytics\.google\.com/i.test(url)}
function isSpotImage(url){return /\/images\/spots\//.test(url)}
/* Split Decision clips and stills load on demand and are never cached here. */
function isVideo(url){return /\/assets\/video\//.test(url)}
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
 if(isFirebase(e.request.url)||isSpotImage(e.request.url)||isVideo(e.request.url)||isAnalytics(e.request.url))return;
 var url;try{url=new URL(e.request.url)}catch(err){return}
 if(url.origin!==self.location.origin)return;
 if(url.pathname.endsWith("/sw.js"))return;
 if(url.pathname.endsWith("/frenzy-word.php"))return;
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
