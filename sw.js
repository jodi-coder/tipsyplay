const CACHE="tipsyplay-v10";
const FILES=["./","index.html","library.html","favourites.html","settings.html","responsible.html","about.html","contact.html","privacy.html","terms.html","robots.txt","sitemap.xml","games/index.html","games/never-have-i-ever.html","play/never-have-i-ever.html","play/nhie-game.js","play/party.html","play/party.js","play/join.html","play/join.js","firebase-config.js","data/nhie.js","data/nhie.json","styles.css","app.js","sounds.js","manifest.webmanifest","icons/icon-192.png","icons/icon-512.png","icons/apple-touch-icon.png","images/hero-beer-pong.webp","images/hero-beer-pong.jpg","images/friends-card-game.webp","images/friends-card-game.jpg","images/friends-phones.webp","images/friends-phones.jpg","images/og-image.jpg","spots/index.html","spots/spots.css","spots/comments.js","spots/canada-cities/index.html","spots/usa-cities/index.html","spots/canada-universities/index.html","spots/usa-universities/index.html"];
function isFirebase(url){return /firebaseio\.com|firebasedatabase\.app|firebaseapp\.com|googleapis\.com|gstatic\.com\/firebasejs|identitytoolkit|securetoken/i.test(url)}
function isSpotImage(url){return /\/images\/spots\//.test(url)}
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
 if(e.request.method!=="GET")return;
 if(isFirebase(e.request.url)||isSpotImage(e.request.url))return;
 e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request).then(res=>{const cp=res.clone();caches.open(CACHE).then(c=>c.put(e.request,cp));return res}).catch(()=>caches.match("index.html"))));
});
