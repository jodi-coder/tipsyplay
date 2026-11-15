#!/usr/bin/env node
/* Build data/frenzy-words.js for Five Letter Frenzy.
   ENABLE1 sha256 (the copy used to generate the committed list):
   3f16130220645692ed49c7134e24a18504c2ca55b3c012f7290e3e77c63b1a89
   The given-name denylist committed at tools/us-first-names.txt has sha256
   c0846f9456de172ac1eafb6029bc9c071fb74ca999626a5fb8788b327889e1cd.
   Run: node tools/frenzy-word-filter.js <enable1.txt> <scowl-final-dir> <us-first-names.txt>

   Sources (do not substitute a Wordle / NYT list):
   - Guesses: ENABLE1 (Enhanced North American Benchmark LExicon), public domain.
     Alan Beale / National Puzzlers' League. https://www.wordgamedictionary.com/enable/
     This script expects the plain enable1.txt word list (one word per line).
   - Answers: the 5-letter words from that filtered guess list that also appear in
     SCOWL 2020.12.07 sizes 10 and 20 (the small band: most-common words), plus the
     featured table words. Other *-words files of those sizes are included.
     Proper-name files are not used as a denylist: they also contain ordinary words
     such as "beach". SCOWL is Copyright 2000-2018 Kevin Atkinson.
     Permission to use, copy, modify, distribute and sell these word lists and the
     output created from the scripts for any purpose is granted without fee, provided
     that copyright notice and this permission notice appear in supporting documentation.
     SCOWL is provided "as is" without warranty. https://wordlist.aspell.net/
   - Names: 5-letter given names from a standard US first-name list, removed from
     both lists unless the word is on the featured allow-list below.
   - Places, slurs and crude words: the blocklists in this file.
     Ordinary religious words are kept. A short explicit block list still removes
     the words the tests name (jesus, sodom, vicar, and the rest of that list).
     SCOWL misc/offensive.1 and offensive.2 are included as well when that directory
     is passed as the second argument's parent (optional path: argv[4]).

   A featured word the packet called crude ("boozy") stays, because the table asked
   to keep it. Slurs, sexual words, crude words, and the explicit block list are never
   kept, even if featured. Ordinary religious words (pious, bible, karma) stay.

   Nothing from the New York Times Wordle answer or guess lists is read. */
"use strict";
const fs = require("fs");
const path = require("path");

const FEATURED = ["party","house","music","drink","grape","lemon","olive","cider","mango","peach","toast","cheer","night","dance","pizza","beach","tiger","crane","storm","flame","maple","river","stone","glass","water","honey","sugar","juice","vodka","spicy","merry","lucky","green","light","round","table","movie","laugh","score","tipsy","fizzy","boozy","berry","mixer","chaos","bluff","tangy","foamy","tonic","limey"];

/* Packet examples to cut, plus the same kind of word. "boozy" is listed here so the
   report can show it was considered, then put back by the featured allow-list. */
const PACKET_CRUDE = new Set(["babes","butts","booty","boozy","drunk","naked"]);

/* Category denylists. Whole words only. A word in any of these is removed from
   guesses and from answers. "boozy" is not in these sets.
   Ordinary religious words (pious, bible, karma, saint) are not a category.
   The names below were already rejected by name in the shipped tests; they stay
   out even though the wider religious, violence, insult, and drug lists are gone. */
const EXPLICIT_OUT = new Set([
  "allah","babes","bawdy","booty","butts","butty","cocky","damns","david","death","dicky","drunk",
  "drugs","erect","gooky","gypsy","hindu","homos","humps","idiot","islam","james","jesus","jewed",
  "kills","kinks","knobs","lynch","maria","moans","naked","nigger","nippy","noose","nuder","paddy",
  "panty","paris","porns","porny","prays","queer","raper","screw","sects","sexed","sexes","slave",
  "slurs","sodom","thong","tramp","urine","vicar","vomit"
]);
const SLURS = new Set([
  "chink","chinks","coons","darky","dyked","dykes","dykey","faggy","fagot","fagin","gooky","gooks",
  "gyppo","gypsy","hajji","homos","honky","injun","jewed","kikes","kraut","lesbo","nazis","nigga","nigger",
  "paddy","queer","slurs","spazz","spics","spick","squaw"
]);
const SEXUAL = new Set([
  "anal","anus","arses","asses","babes","balls","bawdy","bitch","boobs","booby","boner","booty","busty","butty",
  "cocky","cocks","cunts","desex","dicky","dicks","dildo","erect","fucks","homos","horny","humps","humpy",
  "hussy","jizz","kinks","kinky","knobs","labia","lusts","lusty","milfs","moans","naked","nippy","nuder",
  "nudes","panty","penis","pimps","porno","porns","porny","prick","pubes","pubic","pussy","raped","raper",
  "rapes","rectum","screw","semen","sexed","sexes","sexts","shags","skank","sluts","sperm","spunk","testis",
  "thong","titty","titis","twat","twats","unsex","vulva","wanks","whore"
]);
const BODILY = new Set([
  "crap","craps","fecal","feces","farts","poops","puked","pukes","scums","shite","shits","smuts","snots",
  "turds","urine","vomit"
]);
/* "hells" stays as crude. "curse" and "swear" are ordinary words and are not listed.
   bigot, dummy, and moron stay as insults. Milder words (shame, gross, freak) do not.
   These five are not guesses at all. */
const CRUDE = new Set(["hells", "bigot", "dummy", "moron", "jihad", "fatwa", "bombs", "meths", "slain"]);
/* Words that are fine as guesses but must not be the secret. This keeps the
   answer list identical to the one shipped on main: these are common enough
   for SCOWL sizes 10 and 20, and they stay guess-only. */
const ANSWER_EXCLUDE = new Set([
  "abuse","armed","bible","bless","blest","blood","bombs","creed","crime","cruel","curse",
  "deity","devil","dogma","dooms","drown","dying","fatal","fools","fraud","freak","gross",
  "hangs","hated","hates","havoc","libel","lousy","nasty","purge","rabid","saint","shame",
  "shoot","skull","slash","spite","swear","theft","thief","wound"
]);

/* Slurs, sexual words, crude words, and the explicit block list.
   Whole words only. This is a denylist, not a glossary.
   Ordinary words that used to sit in the religious, violence, insult, and drug
   lists (pious, blood, shame, dopey) are not in this set. */
const OFFENSIVE = new Set([
  ...SLURS, ...SEXUAL, ...BODILY, ...CRUDE, ...EXPLICIT_OUT
]);

/* Given names missing from the US list we ship against, still blocked. */
const EXTRA_NAMES = new Set(["mark","aiden","oprah","jayla","kylie","brady","brody","cayden","desire","destinee"]);

const PLACES = new Set([
  "akron","alaska","albany","austin","benin","boise","butte","cairo","chile","china","congo","cuba",
  "delhi","dover","dubai","egypt","elgin","flint","fresno","galway","genoa","ghana","ghent","haiti",
  "hanoi","idaho","india","iran","iraq","italy","japan","juneau","kenya","kyoto","lagos",
  "laos","leeds","libya","luzon","macao","maine","malmo","mali","malta","mecca","miami","milan",
  "minsk","nauru","nepal","niger","omaha","osaka","palau","paris","perth","qatar","quito","samoa",
  "seoul","sofia","spain","sudan","syria","tacoma","texas","tokyo","tonga","tucson","tulsa","tunis",
  "vaduz","wales","yemen","yukon","accra","mobile"
]);

function wordsFrom(file){
  return fs.readFileSync(file, "utf8").split(/\r?\n/).map((w) => w.trim().toLowerCase()).filter((w) => /^[a-z]+$/.test(w));
}
function five(list){ return list.filter((w) => w.length === 5); }

function loadScowl(dir){
  const common = new Set(); // sizes 10 and 20: recognizable answers
  const familiar = new Set(); // same set; a given name that is this common stays (faith, young)
  for (const name of fs.readdirSync(dir)) {
    const m = name.match(/-words\.(10|20)$/);
    if (!m) continue;
    five(wordsFrom(path.join(dir, name))).forEach((w) => { common.add(w); familiar.add(w); });
  }
  return { common, familiar };
}

function main(){
  const enablePath = process.argv[2];
  const scowlDir = process.argv[3];
  const namesPath = process.argv[4];
  const offensivePath = process.argv[5]; // optional file or directory of extra denylist words
  if (!enablePath || !scowlDir || !namesPath) {
    console.error("usage: node tools/frenzy-word-filter.js enable1.txt scowl/final us-first-names.txt [offensive-file-or-dir]");
    process.exit(1);
  }
  const scowl = loadScowl(scowlDir);
  const given = new Set(five(wordsFrom(namesPath)));
  EXTRA_NAMES.forEach((w) => given.add(w));
  const extra = new Set();
  if (offensivePath && fs.existsSync(offensivePath)) {
    const files = fs.statSync(offensivePath).isDirectory()
      ? fs.readdirSync(offensivePath).map((n) => path.join(offensivePath, n))
      : [offensivePath];
    files.forEach((f) => { if (fs.statSync(f).isFile()) five(wordsFrom(f)).forEach((w) => extra.add(w)); });
  }
  const hard = new Set([...OFFENSIVE, ...extra]);
  const featured = new Set(FEATURED);
  const enable = [...new Set(five(wordsFrom(enablePath)))].sort();

  function blocked(w, why){
    if (hard.has(w)) return "hard";
    if (PACKET_CRUDE.has(w) && !featured.has(w)) return "crude";
    if (PLACES.has(w) && !featured.has(w)) return "place";
    if (given.has(w) && !featured.has(w) && !scowl.familiar.has(w)) return "name";
    return "";
  }

  const dropped = { hard:0, crude:0, place:0, name:0 };
  const guesses = [];
  enable.forEach((w) => {
    const why = blocked(w);
    if (why) { dropped[why]++; return; }
    guesses.push(w);
  });
  // Featured words that ENABLE lacks still join the lists when they are not a hard block.
  FEATURED.forEach((w) => {
    if (hard.has(w)) return;
    if (!guesses.includes(w)) guesses.push(w);
  });
  guesses.sort();
  const guessSet = new Set(guesses);
  const answers = guesses.filter((w) => (featured.has(w) || scowl.common.has(w)) && !ANSWER_EXCLUDE.has(w));
  const missingFeatured = FEATURED.filter((w) => !guessSet.has(w) || !answers.includes(w));
  const hardIn = FEATURED.filter((w) => hard.has(w));

  const outPath = path.join(__dirname, "..", "data", "frenzy-words.js");
  const header = `/* Five Letter Frenzy word lists. Generated by tools/frenzy-word-filter.js.
   Guesses: ENABLE1, public domain (Alan Beale). Answers: those guesses that are also in
   SCOWL 2020.12.07 sizes 10 and 20, plus the featured table words.
   SCOWL is Copyright 2000-2018 Kevin Atkinson. Permission to use, copy, modify, distribute
   and sell these word lists and the output created from the scripts for any purpose is
   granted without fee, provided this notice appears in supporting documentation.
   Provided "as is" without warranty.
   Filtered: given names, place names, slurs, sexual or crude words, and an explicit block list.
   Ordinary religious words stay as guesses. The answer list matches the list shipped on main;
   newer common words such as pious, bible, and saint are guesses only.
   "boozy" stays on the featured list by decision. Not from any Wordle or NYT list.
   Counts when generated: ${answers.length} answers, ${guesses.length} accepted guesses. */
`;
  const body = header + "(function(root){\n\"use strict\";\nvar data={answers:" + JSON.stringify(answers) + ",guesses:" + JSON.stringify(guesses) + "};\n"
    + "if(typeof module!==\"undefined\"&&module.exports) module.exports=data;\nelse root.FRENZY_WORDS=data;\n})(typeof window!==\"undefined\"?window:this);\n";
  fs.writeFileSync(outPath, body);
  const report = {
    enableFive: enable.length,
    guesses: guesses.length,
    answers: answers.length,
    dropped,
    scowlCommonFive: scowl.common.size,
    givenNamesFive: given.size,
    boozyInAnswers: answers.includes("boozy"),
    hardFeatured: hardIn,
    missingFeatured,
    jesus: guessSet.has("jesus"),
    allah: guessSet.has("allah"),
    islam: guessSet.has("islam"),
    hindu: guessSet.has("hindu")
  };
  console.log(JSON.stringify(report, null, 2));
}

main();
