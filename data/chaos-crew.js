/* Chaos Crew — 60 original missions, four roles each.
   Any two roles still describe a real (imaginary) job on that mission. */
(function(global){
"use strict";
function m(id, cat, mission, roles){return {id:id, cat:cat, mission:mission, roles:roles}}
var DECK=[
m("c01","business","Open a bakery on the moon",["Crumb catcher","Dough wrangler","Floating delivery desk","Helmet cleaner"]),
m("c02","business","Run a night school for houseplants",["Sunlight scheduler","Leaf note-taker","Pot porter","Graduation ribbon tier"]),
m("c03","business","Staff a library that only lends spoons",["Spoon polisher","Borrower greeter","Drawer cartographer","Quiet return clerk"]),
m("c04","business","Launch a ferry for rubber ducks",["Current reader","Duck counter","Dock diplomat","Towel quartermaster"]),
m("c05","business","Open a repair shop for torn jokes",["Punchline stitcher","Pause timer","Audience chair setter","Notebook keeper"]),
m("c06","business","Run a hotel for lost umbrellas",["Drip manager","Tag writer","Lobby listener","Hook arranger"]),
m("c07","business","Start a studio that paints only doors",["Knob consultant","Color tester","Threshold sweeper","Welcome-mat critic"]),
m("c08","business","Operate a cinema for clouds",["Seat recliner","Sky usher","Blanket passer","Credits whisperer"]),
m("c09","business","Found a post office for compliments",["Envelope folder","Kindness sorter","Route sketcher","Stamp licker"]),
m("c10","business","Open a gym for tired statues",["Pedestal spotter","Polish coach","Rope barrier setter","Closing-time announcer"]),
m("c11","business","Run a café that serves only warm napkins",["Kettle monitor","Folding specialist","Table warmer","Receipt doodler"]),
m("c12","business","Staff a workshop that tunes echoey hallways",["Clap tester","Rug shifter","Sign hanger","Soft-shoe consultant"]),

m("c13","rescues","Rescue a parade float stuck in a polite tree",["Branch negotiator","Balloon holder","Ladder foot","Crowd shusher"]),
m("c14","rescues","Save a picnic from an overeager breeze",["Blanket anchor","Sandwich shield","Napkin chaser","Lemonade lid"]),
m("c15","rescues","Recover a kite that befriended a weather vane",["Roof whisperer","String winder","Vane apologizer","Ground waver"]),
m("c16","rescues","Free a choir robe from a very committed door",["Hinge listener","Fabric smoother","Knob turner","Hallway guard"]),
m("c17","rescues","Retrieve a wedding cake topper from a fountain",["Splash lookout","Step stone setter","Towel captain","Cheerful distraction"]),
m("c18","rescues","Escort a lost shopping cart back to its family",["Wheel inspector","Ramp spotter","Nest counter","Thank-you note"]),
m("c19","rescues","Unstick a drawbridge that wants one more minute",["Gear greeter","Rope coil","Patience timer","Boat waver"]),
m("c20","rescues","Rescue a stack of chairs from a confident toddler logic",["Stack steadier","Story teller","Corner padder","Exit clearer"]),
m("c21","rescues","Save a banner that taped itself to the moon",["Tape auditor","Pole holder","Night lookout","Cheer captain"]),
m("c22","rescues","Recover sheet music blown into a hedge maze",["Page spotter","Hedge diplomat","Turn counter","Encore folder"]),
m("c23","rescues","Free a rowboat that adopted a dock",["Knot student","Bumper placer","Tide watcher","Name painter"]),
m("c24","rescues","Retrieve a beach ball from a formal balcony",["Railing holder","Catcher below","Curtain closer","Applause editor"]),

m("c25","festivals","Run the quiet fireworks festival",["Color caller","Blanket square","Ooh conductor","Sparkle sweeper"]),
m("c26","festivals","Host a parade of extremely serious puppets",["String untangler","Route chalker","Bow tie setter","Crowd lane keeper"]),
m("c27","festivals","Stage a concert where the audience faces the sunset",["Chair aimer","Setlist whisperer","Shade bearer","Encore scout"]),
m("c28","festivals","Throw a festival for unfinished knitting",["Needle valet","Yarn detangler","Progress cheer","Snack passer"]),
m("c29","festivals","Organize a moonlit spelling bee for street signs",["Letter holder","Bell ringer","Bench arranger","Score whisperer"]),
m("c30","festivals","Host hat day for statues in the park",["Brim adjuster","Pedestal stepper","Wind blocker","Photo liner"]),
m("c31","festivals","Run a pancake parade that must stay level",["Stack steward","Syrup cap","Corner marshal","Napkin float"]),
m("c32","festivals","Stage a talent show for echoing stairwells",["Step counter","Clap coach","Sign placer","Echo judge"]),
m("c33","festivals","Hold a lantern walk with no theme but kindness",["Wick trimmer","Path lighter","Pace setter","Name greeter"]),
m("c34","festivals","Host a festival of perfectly ordinary Tuesdays",["Calendar bearer","Bench saver","Story mic","Confetti minimalist"]),
m("c35","festivals","Run a bubble parade through a library courtyard",["Wand keeper","Shh ambassador","Pop lookout","Towel station"]),
m("c36","festivals","Stage a one-block carnival for new neighbors",["Banner hanger","Welcome table","Music dial","Map folder"]),

m("c37","deliveries","Deliver a piano that insists on stairs",["Step counter","Blanket padder","Corner caller","Cheer metronome"]),
m("c38","deliveries","Move a greenhouse one garden to the left",["Pane counter","Plant encourager","Wheel chalker","Door holder"]),
m("c39","deliveries","Carry a mirror that should not see itself",["Angle guide","Cloth keeper","Turn caller","Destination waver"]),
m("c40","deliveries","Ship a crate of polite bells across town",["Straw packer","Hush monitor","Ramp setter","Address reader"]),
m("c41","deliveries","Walk a bouquet that is larger than the doorway",["Stem guide","Petal lookout","Hinge helper","Vase scout"]),
m("c42","deliveries","Deliver fog to a stage that asked nicely",["Fan director","Cue card","Edge marker","Dry-ice valet"]),
m("c43","deliveries","Move a sleepy castle one street over",["Wheel inspector","Blanket crew","Very quiet directions","Drawbridge spotter"]),
m("c44","deliveries","Carry a ladder that wants to be horizontal forever",["Rung counter","Turn caller","Head-height watch","Wall greeter"]),
m("c45","deliveries","Deliver a box of unread postcards to a pier",["Stamp checker","Bench finder","Wind shield","Ink cap"]),
m("c46","deliveries","Transport a chandelier in a very calm truck",["Crystal counter","Blanket nest","Speed whisperer","Door spotter"]),
m("c47","deliveries","Walk twelve matching lamps to a dim hall",["Cord coiler","Pair checker","Stair caller","Switch tester"]),
m("c48","deliveries","Deliver a rug that must not be stepped on mid-trip",["Corner holder","Path clearer","Roll keeper","Threshold judge"]),

m("c49","creatures","Run a lost-and-found for dragons",["Scale polisher","Tiny treasure sorter","Fireproof receptionist","Map folder"]),
m("c50","creatures","Staff a crosswalk for shy crabs",["Tide timer","Lane chalker","Cheer whisperer","Bucket valet"]),
m("c51","creatures","Open a daycare for stuffed owls",["Perch fluffer","Story reader","Button checker","Nap dimmer"]),
m("c52","creatures","Guide a flock of paper cranes to a balcony",["Fold medic","Wind reader","Rail holder","Landing counter"]),
m("c53","creatures","Host a waiting room for lost dogs' sweaters",["Tag writer","Lint roller","Bench saver","Name caller"]),
m("c54","creatures","Run a ferry for turtles who hate rushing",["Ramp setter","Shade holder","Schedule stretcher","Shell counter"]),
m("c55","creatures","Staff a salon for very dignified poodles of cloud",["Comb passer","Bow setter","Mirror tilter","Treat timer"]),
m("c56","creatures","Keep a night desk for moths who love lamps",["Shade adjuster","Porch greeter","Log writer","Dawn closer"]),
m("c57","creatures","Open a school for penguins learning umbrellas",["Handle coach","Puddle scout","Line leader","Towel station"]),
m("c58","creatures","Run a boarding gate for migrating sofas",["Cushion counter","Leg wrapper","Gate caller","Route sketcher"]),
m("c59","creatures","Staff a clinic for kites with hurt feelings",["String medic","Wind counselor","Patch holder","Sky pointer"]),
m("c60","creatures","Host a reunion for garden gnomes on lunch break",["Hat straightener","Path clearer","Name tagger","Biscuit passer"])
];
global.CREW_DECK=DECK;
if(typeof module!=="undefined" && module.exports) module.exports=DECK;
})(typeof window!=="undefined"?window:globalThis);
