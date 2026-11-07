/* Vibe Checkpoint — 60 original hypotheticals.
   Scales always run 1 (least into it) to 5 (most into it). */
(function(global){
"use strict";
function card(id, cat, q, scale){
  return {id:id, cat:cat, q:q, scale:scale};
}
var low=["Absolutely not","Mostly worried","Curious","Pretty delighted","Sign me up"];
var DECK=[
card("v01","hospitality","A hotel offers a complimentary goose concierge. How delighted are you?",["Absolutely not","Mostly worried","Curious","Pretty delighted","Goose VIP"]),
card("v02","hospitality","Your doorbell announces visitors like a wrestling entrance. How much do you love this?",["Please no","A little much","Depends on the guest","I would laugh","Every visit deserves it"]),
card("v03","hospitality","Every elevator ride includes a polite robot asking about your soup opinions. How welcome is this?",["Leave me be","Only on short rides","Mildly charming","I have soup thoughts","I came for this"]),
card("v04","hospitality","The cloakroom hands you a cape labeled for the evening. How into it are you?",["No capes","Only if it has pockets","I would try it on","Happy to swish","I arrived for the cape"]),
card("v05","hospitality","A café names your order after a cloud you describe. How much do you want this?",["Just the coffee","Once, as a joke","I would play along","I like the ritual","I would prepare notes"]),
card("v06","hospitality","The host provides a compliment booth that is optional and unmanned. How do you feel?",["Skip it","Embarrassed nearby","I might peek","I would leave one","I would visit twice"]),
card("v07","hospitality","Your room key is a smooth stone that glows near the right door. How delighted are you?",["Ordinary keys please","Worried I would lose it","Neat if it works","I want the glow","This is the whole trip"]),
card("v08","hospitality","A lobby pianist takes one polite request, then returns to rain sounds. How welcome is that?",["Silence only","Fine in the background","I might request","I hope someone does","I already know the song"]),
card("v09","hospitality","Breakfast includes a tiny flag that marks the pastry you seemed to look at. How into it are you?",["Too seen","A bit odd","Curious once","Sweet, honestly","Plant the flag"]),
card("v10","hospitality","The waiting room issues a paper crown to whoever has been kindest to the desk. How do you feel?",["No crowns","Only if it is a joke","I would clap for them","I would want to qualify","I am campaigning kindly"]),
card("v11","hospitality","A museum lends you a whisper-guide who only shares the weird labels. How welcome is this?",["I will read myself","Maybe later","One gallery","Stay with me","Do the whole building"]),
card("v12","hospitality","Check-out is a high-five from a bell that learned your name. How delighted are you?",["Please whisper","A nod is enough","One high-five","I would smile all day","Encore at the taxi"]),

card("v13","fame","A pigeon with a press pass follows you for one afternoon. How into this are you?", low),
card("v14","fame","The group chat awards you a weekly trophy that is just a sticker. How much do you want it?",["Ignore stickers","Only if I earned it","I would laugh","I would put it on","I am training for it"]),
card("v15","fame","A local newsletter writes two kind sentences about your shoes. How do you feel?",["Please don't","A little exposed","Charmed and shy","I would send it to family","Frame the clipping"]),
card("v16","fame","You are named honorary captain of a parade that is four people long. How delighted are you?", low),
card("v17","fame","A bakery writes your nickname on a bun that is not for sale, only for display. How into it are you?",["Leave the bun","Embarrassing window","I would go look","I would visit with friends","I would pose"]),
card("v18","fame","Strangers on a walk start a brief, sincere golf clap when you hold a door. How welcome is that?",["Too much","Once is funny","I can handle it","I would clap back","I would seek doors"]),
card("v19","fame","Your anecdote is added to a street mural as one small speech bubble. How do you feel?",["No murals","Only if I approve","Curious to see it","Proud and tiny","I would bring people"]),
card("v20","fame","A podcast about ordinary errands asks you to describe buying stamps. How into this are you?", low),
card("v21","fame","The office plant is given your name for a week because you watered it. How delighted are you?",["It has a name","A bit silly","I would allow it","I would make a badge","We share the name"]),
card("v22","fame","You trend, locally, for returning a shopping cart all the way. How do you feel?",["Let it fade","One text is enough","I would screenshot","I would retell it","I would do a tour"]),
card("v23","fame","A choir of three sings your coffee order, then stops. How welcome is the performance?",["Hard no","Only on Friday","I would blush and stay","I would tip the choir","Book them weekly"]),
card("v24","fame","You are interviewed by a child with a cardboard microphone about your hat. How into it are you?", low),

card("v25","upgrades","Every light switch also offers a compliment you can decline. How much do you love this?",["No talking walls","Rarely","Sometimes at night","I would use it","Install them all"]),
card("v26","upgrades","Your stairs play a soft note for each step, like a quiet piano. How delighted are you?", low),
card("v27","upgrades","The fridge can display one rotating drawing from a friend. How welcome is that?",["Keep it plain","Only on the side","I would allow one","Change it weekly","Cover the door"]),
card("v28","upgrades","A hallway mirror shows you yesterday's best posture for three seconds. How into it are you?",["Skip the mirror","A little uncanny","Useful once","I would practice","I want the replay"]),
card("v29","upgrades","Your washing machine texts a haiku when the load is done. How do you feel?",["Just buzz","Short is fine","I would read it","I would collect them","Publish the chapbook"]),
card("v30","upgrades","The shower can dim like a planetarium if you ask. How delighted are you?", low),
card("v31","upgrades","A kitchen drawer is reserved for found nice rocks, labeled by the house. How into this are you?",["No rocks","One rock max","A small tray","I already do this","Museum hours"]),
card("v32","upgrades","Your coat hooks introduce themselves when a guest arrives. How welcome is that?",["Silent hooks","Once, then stop","Charming if brief","I would name them","They host the party"]),
card("v33","upgrades","The thermostat offers a story about the weather instead of a number. How do you feel?",["Give me digits","A subtitle is enough","I would listen once","Read it each morning","More lore please"]),
card("v34","upgrades","Windowsills come with a tiny bench for a stuffed audience. How delighted are you?", low),
card("v35","upgrades","The doorbell camera only saves waves, never anything else. How into this feature are you?",["No camera","Waves are okay","I would check sometimes","I would wave back later","Wave archive forever"]),
card("v36","upgrades","A ceiling corner is painted as a permanent sunset you can look at. How much do you want it?", low),

card("v37","robots","A bookshelf robot reshelves only the book you just praised. How welcome is this?",["I will shelve","Helpful if asked","Yes for hardcovers","We are a team","Promote the robot"]),
card("v38","robots","A garden robot apologizes to weeds before you decide their fate. How do you feel?", low),
card("v39","robots","Your alarm clock is a small robot that negotiates a five-minute story. How into it are you?",["No negotiation","One snooze max","I would hear the pitch","Tell the story","Hire it full time"]),
card("v40","robots","A hallway robot offers stickers to anyone carrying groceries. How delighted are you?", low),
card("v41","robots","The dishwasher robot names each plate like a sports recap. How welcome is the broadcast?",["Silence","Volume low","Funny once","Play it nightly","I want season stats"]),
card("v42","robots","A desk robot slides you water and never comments on your tabs. How into this are you?",["I can reach","Only the water","Yes, no comments","Essential coworker","We share the desk"]),
card("v43","robots","A park robot collects lost gloves and writes hopeful descriptions. How do you feel?", low),
card("v44","robots","Your umbrella robot reminds you it exists by clearing its throat, once. How welcome is that?",["I will forget anyway","Once is perfect","I would thank it","We walk together","It may throat-clear daily"]),
card("v45","robots","A library robot leads you to a book adjacent to the one you wanted. How into the detour are you?",["Wrong book","Only if I am early","I would glance","Trust the adjacent","Follow it all afternoon"]),
card("v46","robots","A kitchen robot high-fives the toaster when the toast is correct. How delighted are you?", low),
card("v47","robots","A bus-stop robot rates the clouds while you wait, with no ads. How do you feel?",["Just the bus","Quiet ratings","I would listen","I would compare notes","Ask for the lightning round"]),
card("v48","robots","A recycling robot applauds with soft plastic hands when you sort right. How into it are you?", low),

card("v49","errands","You must deliver a moon to a nightstand two streets away. How delighted are you to try?",["Too large","Worried about corners","I would plan a route","Happy to escort it","This is my calling"]),
card("v50","errands","The grocery list is only vibes: green, crunchy, triumphant. How into this shop are you?", low),
card("v51","errands","You are asked to return a library book that is also a very polite bat. How do you feel?",["Call someone else","Careful and brief","I can do one block","I would chat with it","We take the scenic route"]),
card("v52","errands","Your job is to walk a balloon bouquet to a person who just tried. How welcome is the task?", low),
card("v53","errands","You deliver soup across town, and the soup must not know it is soup. How into the mission are you?",["Too fragile","I would walk slowly","Curious constraints","I accept","I bring a decoy ladle"]),
card("v54","errands","A friend asks you to pick up silence from a quiet shop. How delighted are you?",["That is not a product","I would text instead","I would try the shop","I know the brand","I will gift-wrap it"]),
card("v55","errands","You transport a cake shaped like a successful Tuesday. How do you feel about the carry?", low),
card("v56","errands","The post office asks you to mail a compliment with no name on it. How into this are you?",["Too vague","I would if it's kind","Yes, one sentence","I have a stack ready","I start a route"]),
card("v57","errands","You retrieve a kite from a tree that is showing off. How welcome is the errand?", low),
card("v58","errands","Someone needs a spare chair delivered by you, dramatically but slowly. How delighted are you?",["Chairs are heavy","Fine if it is close","I would add a ribbon","Procession energy","I hum a march"]),
card("v59","errands","You are sent to buy a map that only shows places to sit. How into this purchase are you?", low),
card("v60","errands","Your task is to escort a shy lamp to a room that needs it. How do you feel?",["Lamps are easy","I would pad the corners","Gentle mission accepted","I would introduce it","We dim-test on arrival"])
];
global.VIBE_DECK=DECK;
if(typeof module!=="undefined" && module.exports) module.exports=DECK;
})(typeof window!=="undefined"?window:globalThis);
