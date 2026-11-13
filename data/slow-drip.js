/* Slow Drip phrases. Common sayings, everyday things, place names and film titles only:
   no song lyrics and no long quotes. Each phrase has 10 to 25 letters (tests/drip-logic.test.js checks this).
   A phrase is used once per game before any repeats. */
(function(global){
"use strict";
var PHRASES={
  "Common Sayings":[
    "Piece of cake",
    "Break the ice",
    "Better late than never",
    "Once in a blue moon",
    "The more the merrier",
    "Easier said than done",
    "Actions speak louder",
    "Back to square one",
    "Hit the nail on the head"
  ],
  "Food & Drink":[
    "Grilled cheese sandwich",
    "Chips and guacamole",
    "Espresso martini",
    "Chocolate chip cookies",
    "Spaghetti and meatballs",
    "Frozen margarita",
    "Pepperoni pizza",
    "Loaded potato skins",
    "Sticky toffee pudding"
  ],
  "Things at a Party":[
    "Paper party hats",
    "Karaoke machine",
    "Disposable cups",
    "Bluetooth speaker",
    "Birthday candles",
    "Folding chairs",
    "Confetti cannon",
    "String of fairy lights",
    "Last slice of pizza"
  ],
  "Famous Places":[
    "Statue of Liberty",
    "Golden Gate Bridge",
    "Great Wall of China",
    "Sydney Opera House",
    "Leaning Tower of Pisa",
    "Buckingham Palace",
    "Niagara Falls",
    "Mount Kilimanjaro",
    "Great Barrier Reef"
  ],
  "Movie Titles":[
    "Back to the Future",
    "The Wizard of Oz",
    "Jurassic Park",
    "Finding Nemo",
    "The Lion King",
    "Groundhog Day",
    "Raiders of the Lost Ark",
    "The Princess Bride",
    "Night at the Museum"
  ]
};
var LIST=[];
Object.keys(PHRASES).forEach(function(cat){PHRASES[cat].forEach(function(p){LIST.push({cat:cat, text:p})})});
var api={categories:PHRASES, list:LIST};
global.SlowDripData=api;
if(typeof module!=="undefined"&&module.exports) module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
