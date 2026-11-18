/* Category Countdown content. All original. Each category is [text, difficulty, target]:
   difficulty e (easy), m (medium) or h (hard); target is how many answers Spotlight asks for.
   Packs: mild, spicy (bolder grown-up topics, never sexual or hateful) and extra (shown as "Absurd"). */
(function(root){
"use strict";
var RAW={
mild:[
["Things in a fridge","e",6],["Breakfast foods","e",6],["Animals with four legs","e",7],["Things at a beach","e",6],["Colors","e",8],
["Fruits","e",7],["Things you find in a kitchen","e",7],["Pizza toppings","e",6],["Sports played with a ball","e",6],["Things that are round","e",6],
["Musical instruments","e",6],["Things in a school","e",6],["Vegetables","e",7],["Board games","m",4],["Things that fly","e",6],
["Ice cream flavors","e",6],["Things in a bathroom","e",6],["Farm animals","e",6],["Things you wear on your feet","m",5],["Things that are yellow","e",6],
["Desserts","e",6],["Things at a birthday party","e",6],["Ocean animals","e",6],["Things in a park","e",6],["Jobs in a hospital","m",5],
["Things with wheels","e",6],["Breakfast cereals or toppings","m",5],["Things in a garden","e",6],["Things you pack for a trip","e",6],["Weather words","m",5],
["Things that are cold","e",6],["Kitchen tools","m",5],["Types of shoes","m",5],["Things in an office","e",6],["Things that make noise","e",6],
["Sandwich fillings","e",6],["Things in a toolbox","m",5],["Pets people keep","e",6],["Things you can bake","e",6],["Things in the sky","e",5],
["Things at a wedding","m",5],["Hobbies","e",6],["Things that are sticky","m",5],["Things in a car","e",6],["Snacks at a movie","e",5],
["Things that come in pairs","m",5],["Things in a forest","e",6],["Things that are soft","e",6],["Camping gear","m",5],["Things with buttons","m",5],
["Things you do on a rainy day","e",6],["Things at a zoo","e",6],["Things that are sweet","e",6],["Breakfast drinks","m",4],["Insects","m",5],
["Things in a bedroom","e",6],["Things at a fair","m",5],["Things that grow","m",5],["Cheeses","h",4],["Things that are green","e",6],
["Winter clothes","e",5],["Things in a supermarket","e",7],["Shapes","m",5],["Things on a playground","m",5],["Breeds of dog","h",4],
["Spices and herbs","h",4],["Words that rhyme with cat","m",6],["Things that melt","m",5],["Pasta shapes","h",4],["Famous landmarks","m",4]
],
spicy:[
["Excuses for leaving a party early","e",6],["Things you lie about on a first date","m",5],["Hangover cures people swear by","m",5],["Reasons to cancel plans","e",6],["Things you hide when guests come over","e",6],
["Bad roommate habits","e",6],["Things that ruin a group chat","m",5],["Excuses for being late","e",6],["Things people do at a bad party","m",5],["Red flags on a first date","e",6],
["Things you regret buying","m",5],["Things you say to end a phone call","m",5],["Annoying office habits","e",6],["Things people pretend to like","e",6],["Things you do when nobody's watching","e",6],
["Cocktail ingredients","m",5],["Things that happen at a wedding reception","m",5],["Reasons to go home early","e",6],["Embarrassing things to do at work","m",5],["Things people overshare online","e",6],
["Things that go wrong at karaoke","m",5],["Things you blame on the dog","m",5],["Breakup excuses","m",5],["Things you do on a lazy Sunday","e",6],["Signs a party is over","e",6],
["Things that are awkward at a family dinner","m",5],["Things people fight about on vacation","m",5],["Ways to avoid small talk","m",5],["Things you shouldn't say at a job interview","m",5],["Signs your friend is lying","m",5],
["Late-night snacks","e",6],["Things you find in a messy car","e",6],["Ways to get out of a boring meeting","m",5],["Things that are worse when you're tired","m",5],["Reasons to text an ex (bad ones)","m",4],
["Things you only do on your birthday","m",4],["Things that cost too much at a bar","m",5],["Bad gifts","e",6],["Things people do after midnight","m",5],["Things that make you an adult","m",5],
["Ways to say you're drunk without saying drunk","h",4],["Things that happen on a road trip","e",6],["Group chat names","h",3],["Things your parents said that came true","m",4],["Ways to fake being sick","m",5],
["Things you'd do with a free day off work","e",6],["Reasons a date might end early","m",5],["Things you see at a music festival","m",5],["Things people complain about at brunch","m",5],["Questions you shouldn't ask a coworker","m",4],
["Things that make a good pub quiz team","h",3],["Ways to win an argument","m",4],["Things people lose on a night out","e",6],["Morning-after regrets","m",5],["Things that keep you up at night","m",5],
["Bad pickup lines (clean ones)","h",3],["Signs you're getting old","e",6],["Things you only buy when drunk shopping online","m",4],["Ways to annoy a bartender","m",4],["Things that get stolen at parties","m",4],
["Things you do to look busy at work","m",5],["Things that happen in a group photo","m",5],["Ways to say no politely","m",5],["Reasons to leave a group chat","m",4],["Things you pretend to understand","m",5],
["Mocktail ingredients","m",5],["Things on a bad dating profile","m",5],["Things that ruin a vacation","m",5],["Ways to celebrate a promotion","m",5],["Things people brag about","e",6]
],
extra:[
["Things a ghost would complain about","m",4],["Jobs for a retired superhero","m",4],["Things a cat would put on a résumé","m",4],["Names for a pet rock","m",5],["Things you'd find in a wizard's fridge","m",4],
["Rejected flavors of ice cream","m",4],["Things a pirate would put on a grocery list","m",4],["Excuses a dragon would make","h",3],["Things a robot would do on vacation","m",4],["Things a toddler would ban if they ran the country","m",4],
["Names for a very slow racehorse","m",4],["Things an alien would misunderstand about Earth","m",4],["Things a vampire packs for the beach","m",4],["Rejected superhero powers","m",4],["Things your houseplants gossip about","m",4],
["Things a penguin would complain about","m",4],["Terrible names for a restaurant","m",4],["Things that should come with a warning label","m",4],["Things a goldfish forgets","e",5],["Hobbies for a bored giant","m",4],
["Things found in a dragon's laundry","h",3],["Bad advice from a fortune cookie","m",4],["Things a sandwich would say if it could talk","m",4],["Things a snowman worries about","m",4],["Jobs that shouldn't exist","m",4],
["Things a mermaid would buy online","m",4],["Things your pillow knows about you","m",4],["Rejected Olympic sports","m",4],["Things a T. rex struggles with","e",5],["Words a duck would use","h",3],
["Things a time traveler would forget to pack","m",4],["Things a medieval knight would hate about today","m",4],["Things that would be weird to whisper","m",5],["Things a squirrel would steal","e",5],["Names for a haunted house","m",4],
["Things a cloud would do on its day off","m",4],["Terrible slogans for a gym","h",3],["Things a sloth would rush for","m",3],["Things in a superhero's junk drawer","m",4],["Rejected theme park rides","m",4],
["Things a wizard would be bad at","m",4],["Things your fridge thinks about at night","m",4],["Weird things to collect","m",5],["Things a parrot shouldn't repeat","m",4],["Things a giraffe can't do","e",5],
["Things a sock does after it disappears","m",4],["Rejected names for a planet","m",4],["Things a zombie would order at a café","m",4],["Things a baby would invent","m",4],["Jobs for a dog","e",5],
["Things you'd find in a giant's pocket","m",4],["Things a lighthouse gets lonely about","h",3],["Things a mummy would wear to a party","m",4],["Things a toaster dreams about","m",4],["Silly laws a cat would pass","m",4],
["Things a unicorn would be annoyed by","m",4],["Things that would be terrifying if they were huge","e",6],["Things a cowboy would put in a smoothie","m",4],["Things a fish would put on a dating profile","m",4],["Rejected crayon colors","m",4],
["Things a witch would sell at a yard sale","m",4],["Things a bear would do in a hotel","m",4],["Things that would make a terrible pet","e",6],["Things a burrito would worry about","m",4],["Things an owl stays up thinking about","m",4],
["Weird things to say to a mirror","m",4],["Things a pigeon would report to headquarters","m",4],["Things a knight's horse complains about","m",4],["Things that would be odd to find in a library","e",5],["Things a moon would say to the sun","h",3]
]
};
var LIST=[];
Object.keys(RAW).forEach(function(pack){RAW[pack].forEach(function(c){LIST.push({pack:pack, text:c[0], d:c[1]==="e"?"easy":c[1]==="m"?"medium":"hard", target:c[2]})})});
var api={list:LIST, packs:["mild","spicy","extra"], packName:{mild:"Mild", spicy:"Spicy", extra:"Absurd"},
  alts:["hold a statue pose for 5 seconds","do your best animal impression","do a 5-second victory dance","give the table a slow, dramatic bow","talk like a robot for your next turn","do 5 slow-motion jumping jacks"]};
root.CountdownData=api;
if(typeof module!=="undefined"&&module.exports) module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
