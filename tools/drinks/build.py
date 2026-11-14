#!/usr/bin/env python3
"""Builds the drinks section: drinks/index.html, one page per type, and one page per drink.

Run from the repository root:   python3 tools/drinks/build.py

The recipes live in the data_*.py files next to this script. The pages it writes are plain static HTML,
like the rest of the site, and are committed. Each page carries the Google tag (see README.md).

Photos: put a 4:3 photo for a drink at images/drinks/<slug>.webp (or .jpg) and run this script again.
A drink with no photo shows a drawn glass instead. docs/drinks-photo-prompts.md has a prompt for every drink.
"""
import html
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from data_shots import SHOTS          # noqa: E402
from data_cocktails import COCKTAILS  # noqa: E402
from data_punches import PUNCHES      # noqa: E402
from data_frozen import FROZEN        # noqa: E402
from data_hot import HOT              # noqa: E402

SITE = "https://tipsyplay.com"
TODAY = "2026-11-14"
CSS_V = "1"
JS_V = "1"
STYLES_V = "25"   # keep in step with the other pages
SOUNDS_V = "18"
APP_V = "21"

GTAG = """<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-BHY4BXF3V3"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'G-BHY4BXF3V3');
</script>"""

# key, folder, list title, singular, page H1, lede, games that suit it
TYPES = [
    ("shots", "shots", "Shots", "shot", "Shot Recipes",
     "Twenty shots you can make at home, from layered classics to dessert shots. One at a time is the idea.",
     ["card-lottery", "category-countdown", "kings-cup", "rule-maker"], SHOTS),
    ("cocktails", "cocktails", "Cocktails", "cocktail", "Cocktail Recipes",
     "Twenty cocktails worth knowing, starting with the Canadian Caesar. Each has an alcohol-free version.",
     ["never-have-i-ever", "hot-take-court", "two-truths", "split-decision"], COCKTAILS),
    ("punches", "party-punches", "Party punches", "party punch", "Party Punch and Pitcher Recipes",
     "Twenty punches and pitchers for a group. Make one before people arrive and nobody has to play bartender.",
     ["kings-cup", "vault-traitor", "rule-maker", "never-have-i-ever"], PUNCHES),
    ("frozen", "frozen", "Frozen drinks", "frozen drink", "Frozen Drink Recipes",
     "Twenty blender drinks: slushes, daiquiris, frozen margaritas and boozy milkshakes.",
     ["slow-drip", "sketchy-guess", "category-countdown", "split-decision"], FROZEN),
    ("hot", "hot", "Hot drinks", "hot drink", "Hot Drink Recipes",
     "Twenty warm drinks for cold nights: toddies, mulled wine, spiked coffee and hot chocolate.",
     ["story-chain", "two-truths", "vault-traitor", "slow-drip"], HOT),
]
GAMES = {
    "card-lottery": "Card Lottery", "category-countdown": "Category Countdown", "kings-cup": "King's Cup",
    "rule-maker": "Rule Maker", "never-have-i-ever": "Never Have I Ever", "hot-take-court": "Hot Take Court",
    "two-truths": "Two Truths & a Twist", "split-decision": "Split Decision", "vault-traitor": "Vault Traitor",
    "slow-drip": "Slow Drip", "sketchy-guess": "Sketchy Guess", "story-chain": "Story Chain",
}
BASES = {"vodka": "Vodka", "rum": "Rum", "tequila": "Tequila", "whisky": "Whisky", "gin": "Gin",
         "wine": "Wine and bubbly", "liqueur": "Liqueur"}
GLASS_NAMES = {"shot": "Shot glass", "tall": "Tall glass", "rocks": "Rocks glass", "mug": "Mug",
               "martini": "Martini glass", "coupe": "Coupe", "wine": "Wine glass", "flute": "Flute",
               "bowl": "Punch bowl", "pitcher": "Pitcher", "hurricane": "Hurricane glass", "snifter": "Snifter"}
FEATURED = ["classic-canadian-caesar", "lemon-drop-shot", "classic-rum-punch", "strawberry-daiquiri",
            "hot-toddy", "espresso-martini"]
TILES = ["t-yellow", "t-pink", "t-green"]

e = html.escape


def frac(x):
    whole = int(x)
    rest = round(x - whole, 2)
    marks = {0.0: "", 0.25: "¼", 0.5: "½", 0.75: "¾"}
    if rest not in marks:
        return ("%g" % x)
    return (str(whole) if whole else "") + marks[rest] or "0"


SOLID = re.compile(r"^(sugar\b|ice\b|frozen |cubed |strawberries|raspberries|green grapes|fresh or frozen|pineapple chunks|vanilla ice cream)")


def ingredient(text):
    """'1.5 oz vodka' -> '1½ oz (45 ml) vodka'; '2 cups juice' -> '2 cups (500 ml) juice'."""
    m = re.match(r"^(\d+(?:\.\d+)?) (oz|cups?) (.*)$", text)
    if not m:
        return text
    n, unit, rest = float(m.group(1)), m.group(2), m.group(3)
    if unit == "oz":
        ml = n * 30
        ml = int(ml) if ml == int(ml) else int(ml)  # 22.5 -> 22, 7.5 -> 7
        return "%s oz (%d ml) %s" % (frac(n), ml, rest)
    if SOLID.match(rest):  # ice, fruit and ice cream are measured by the cup, not by volume of liquid
        return "%s %s %s" % (frac(n), "cup" if n <= 1 else "cups", rest)
    ml = {0.25: 60, 0.75: 175}.get(n, int(round(n * 250)))
    metric = ("%g L" % (ml / 1000)) if ml >= 1000 else ("%d ml" % ml)
    return "%s %s (%s) %s" % (frac(n), "cup" if n <= 1 else "cups", metric, rest)


# ---------- drawn glasses (shown until a photo exists) ----------
GLASSES = {
    "shot": ("M40 28H80L74 96H46Z", "", 22),
    "rocks": ("M28 40H92L86 98H34Z", "", 24),
    "tall": ("M40 16H80L76 102H44Z", "", 16),
    "martini": ("M20 24H100L60 68Z", '<path class="l" d="M60 68V100M42 100H78"/>', 18),
    "coupe": ("M22 32Q22 66 60 66Q98 66 98 32Z", '<path class="l" d="M60 66V100M42 100H78"/>', 22),
    "wine": ("M38 14H82Q90 60 60 66Q30 60 38 14Z", '<path class="l" d="M60 66V100M42 100H78"/>', 40),
    "flute": ("M47 12H73Q76 60 60 70Q44 60 47 12Z", '<path class="l" d="M60 70V100M44 100H76"/>', 18),
    "hurricane": ("M44 12H76Q86 38 70 54Q64 64 72 76Q72 84 60 84Q48 84 48 76Q56 64 50 54Q34 38 44 12Z",
                  '<path class="l" d="M60 84V100M44 100H76"/>', 14),
    "mug": ("M28 36H78V92Q78 100 70 100H36Q28 100 28 92Z",
            '<path class="l" d="M78 48Q100 48 100 66Q100 84 78 84"/><path class="l" d="M42 26Q38 20 42 14M58 26Q54 20 58 14"/>', 16),
    "pitcher": ("M34 22H82L78 100H40ZM34 22L26 16", '<path class="l" d="M81 38Q104 40 102 62Q100 80 79 82"/>', 22),
    "bowl": ("M14 42Q14 92 60 92Q106 92 106 42Z", '<path class="l" d="M44 92L40 102H80L76 92"/>', 22),
}
GLASSES["snifter"] = GLASSES["wine"]


def glass_svg(glass, liq, cls="dk-glass"):
    body, extra, level = GLASSES[glass]
    return ('<svg class="%s" viewBox="0 0 120 120" aria-hidden="true" focusable="false">'
            '<path class="g" d="%s"/><path d="%s" style="fill:%s;clip-path:inset(%d%% 0 0 0)"/>'
            '<path class="l" d="%s"/>%s</svg>') % (cls, body, body, liq, level, body, extra)


def photo_for(slug):
    for ext in ("webp", "jpg", "jpeg", "png"):
        if os.path.exists(os.path.join(ROOT, "images", "drinks", slug + "." + ext)):
            return "images/drinks/%s.%s" % (slug, ext)
    return None


class Drink:
    def __init__(self, row, type_row, index):
        (self.slug, self.name, self.base, self.glass, self.liq, self.mins, self.serves, self.blurb,
         ings, steps, self.na, self.look) = row
        self.ings = [ingredient(i) for i in ings.split("|")]
        self.steps = steps.split("|")
        self.tkey, self.tdir, self.tlabel, self.tsingular = type_row[0], type_row[1], type_row[2], type_row[3]
        pool = type_row[6]
        self.games = [pool[index % len(pool)], pool[(index + 1) % len(pool)]]
        self.tile = TILES[index % 3]
        self.photo = photo_for(self.slug)
        self.url = "%s/drinks/%s.html" % (SITE, self.slug)

    @property
    def makes(self):
        if self.tkey == "shots":
            return "Makes %d shot%s" % (self.serves, "" if self.serves == 1 else "s")
        return "Serves %d" % self.serves

    def time(self):
        return "%d min" % self.mins

    def thumb(self, root):
        if self.photo:
            return ('<span class="dk-thumb"><img src="%s%s" width="1200" height="900" alt="" loading="lazy" decoding="async"></span>'
                    % (root, self.photo))
        return '<span class="dk-thumb %s">%s</span>' % (self.tile, glass_svg(self.glass, self.liq))

    def card(self, root):
        return ('<a class="dk-card" href="%sdrinks/%s.html" data-base="%s" data-name="%s">%s'
                '<span class="dk-body"><b>%s</b><span>%s</span><span class="dk-meta">%s · %s</span></span></a>'
                % (root, self.slug, self.base, e(self.name.lower()), self.thumb(root), e(self.name), e(self.blurb),
                   self.time(), self.makes))


def load():
    drinks, by_type = [], {}
    for t in TYPES:
        rows = [Drink(r, t, i) for i, r in enumerate(t[7])]
        by_type[t[0]] = rows
        drinks += rows
    slugs = [d.slug for d in drinks]
    assert len(slugs) == len(set(slugs)), "duplicate slug"
    for t in TYPES:
        assert len(by_type[t[0]]) == 20, t[0]
    return drinks, by_type


# ---------- page shell ----------
def head(root, title, desc, canonical, ld, og_image=None):
    img = og_image or (SITE + "/images/og-image.jpg")
    return ("""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
%s
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#7CC8FF">
<meta name="description" content="%s">
<title>%s</title>
<link rel="canonical" href="%s">
<meta property="og:type" content="website"><meta property="og:site_name" content="TipsyPlay"><meta property="og:title" content="%s"><meta property="og:description" content="%s"><meta property="og:url" content="%s"><meta property="og:image" content="%s">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="%s"><meta name="twitter:description" content="%s"><meta name="twitter:image" content="%s">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="TipsyPlay">
<link rel="manifest" href="%smanifest.webmanifest">
<link rel="apple-touch-icon" href="%sicons/apple-touch-icon.png">
<link rel="stylesheet" href="%sstyles.css?v=%s">
<link rel="stylesheet" href="%sdrinks/drinks.css?v=%s">
<script type="application/ld+json">%s</script>
</head>
<body data-root="%s" class="drinks no-tabs">
<header class="top"><a class="logo" href="%sindex.html">Tipsy<span>Play</span></a><nav><a href="%sgames/">Games</a><a href="%sdrinks/" aria-current="page">Drinks</a><a href="%sblog/">Blog</a><a href="%sresponsible.html">Play responsibly</a></nav></header>
<main>
""" % (GTAG, e(desc), e(title), canonical, e(title), e(desc), canonical, img, e(title), e(desc), img,
       root, root, root, STYLES_V, root, CSS_V, json.dumps(ld, ensure_ascii=False), root, root, root, root, root, root))


def foot(root, script=False):
    js = '<script src="%sdrinks/drinks.js?v=%s"></script>' % (root, JS_V) if script else ""
    return ("""<section class="dk-resp"><div class="na"><b>Drink responsibly.</b> You must be of legal drinking age in your location. Drinking is always optional, every recipe here has an alcohol-free version, and nobody should drink and drive. <a href="%sresponsible.html">Read the house rules</a>.</div></section>
</main>
<footer class="site-foot" data-keep>
<nav aria-label="Footer"><a href="%sgames/">Games</a><a href="%sdrinks/">Drinks</a><a href="%sblog/">Blog</a><a href="%sabout.html">About</a><a href="%scontact.html">Contact</a><a href="%sprivacy.html">Privacy</a><a href="%sterms.html">Terms</a></nav>
<p>© TipsyPlay</p>
</footer>
<script src="%ssounds.js?v=%s"></script><script src="%sapp.js?v=%s"></script>%s
</body>
</html>
""" % (root, root, root, root, root, root, root, root, root, SOUNDS_V, root, APP_V, js))


def crumbs_ld(items):
    return {"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": u} for i, (n, u) in enumerate(items)]}


def type_chips(root, current=None):
    out = ['<nav class="chips dk-types" aria-label="Drink types">']
    for t in TYPES:
        cur = ' aria-current="true"' if t[0] == current else ""
        out.append('<a class="chip" href="%sdrinks/%s/"%s>%s</a>' % (root, t[1], cur, e(t[2])))
    out.append("</nav>")
    return "".join(out)


# ---------- pages ----------
def recipe_page(d, by_type):
    root = "../"
    title = "%s Recipe | TipsyPlay" % d.name
    desc = "%s Ingredients, steps and an alcohol-free version." % d.blurb
    type_url = "%s/drinks/%s/" % (SITE, d.tdir)
    recipe = {
        "@type": "Recipe", "name": d.name, "description": d.blurb, "url": d.url,
        "recipeCategory": d.tsingular.capitalize(), "keywords": "%s, %s, drink recipe" % (d.name.lower(), d.tsingular),
        "recipeYield": d.makes.replace("Makes ", "").replace("Serves ", "") + ("" if d.tkey == "shots" else " servings"),
        "totalTime": "PT%dM" % d.mins, "recipeIngredient": d.ings,
        "recipeInstructions": [{"@type": "HowToStep", "text": s} for s in d.steps],
        "author": {"@type": "Organization", "name": "TipsyPlay", "url": SITE + "/"},
    }
    og = None
    if d.photo:
        og = "%s/%s" % (SITE, d.photo)
        recipe["image"] = [og]
    ld = {"@context": "https://schema.org", "@graph": [
        crumbs_ld([("Home", SITE + "/"), ("Drinks", SITE + "/drinks/"), (d.tlabel, type_url), (d.name, d.url)]), recipe]}
    if d.photo:
        hero = ('<figure class="dk-hero"><img src="%s%s" width="1200" height="900" alt="%s" decoding="async"></figure>'
                % (root, d.photo, e(d.name + ": " + d.look)))
    else:
        hero = '<figure class="dk-hero dk-drawn %s">%s</figure>' % (d.tile, glass_svg(d.glass, d.liq, "dk-glass big"))
    siblings = by_type[d.tkey]
    i = siblings.index(d)
    more = [siblings[(i + k) % len(siblings)] for k in (1, 2, 3, 4)]
    games = "".join('<a class="chip" href="%sgames/%s.html">%s</a>' % (root, g, e(GAMES[g])) for g in d.games)
    body = """<section class="entry" id="top">
<p class="crumbs"><a href="%sindex.html">Home</a> / <a href="./">Drinks</a> / <a href="%s/">%s</a></p>
<h1>%s</h1>
<p class="lede">%s</p>
<div class="tags"><span class="tag">⏱ %s</span><span class="tag">%s</span><span class="tag">%s</span><span class="tag">%s</span></div>
%s
</section>
<section class="dk-recipe">
<div class="card"><h2>Ingredients</h2>
<ul class="dk-ings">
%s
</ul></div>
<div class="card"><h2>How to make it</h2>
<ol class="dk-steps">
%s
</ol></div>
<div class="card"><h2>Make it alcohol-free</h2>
<p>%s</p></div>
<div class="card"><h2>Good with these games</h2>
<p>Pour it, then start a room. Drinking is optional in every game.</p>
<div class="chips">%s</div></div>
</section>
<section class="dk-more">
<h2>More %s</h2>
<div class="dk-grid">
%s
</div>
<a class="more" href="%s/">See all %s →</a>
</section>
""" % (root, d.tdir, e(d.tlabel), e(d.name), e(d.blurb), d.time(), d.makes, GLASS_NAMES[d.glass], BASES[d.base], hero,
       "\n".join("<li>%s</li>" % e(x) for x in d.ings), "\n".join("<li>%s</li>" % e(x) for x in d.steps),
       e(d.na), games, e(d.tlabel.lower()), "\n".join(m.card(root) for m in more), d.tdir, e(d.tlabel.lower()))
    return head(root, title, desc, d.url, ld, og) + body + foot(root)


def type_page(t, rows):
    root = "../../"
    key, tdir, label, singular, h1, lede = t[:6]
    url = "%s/drinks/%s/" % (SITE, tdir)
    title = "%s: 20 to Make at Home | TipsyPlay" % h1
    ld = {"@context": "https://schema.org", "@graph": [
        crumbs_ld([("Home", SITE + "/"), ("Drinks", SITE + "/drinks/"), (label, url)]),
        {"@type": "ItemList", "name": h1, "numberOfItems": len(rows), "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": d.name, "url": d.url} for i, d in enumerate(rows)]}]}
    bases = [b for b in BASES if any(d.base == b for d in rows)]
    chips = ""
    if len(bases) > 1:
        chips = ('<p class="tag" id="baselabel">Made with</p><div class="chips" id="bases" role="group" aria-labelledby="baselabel">'
                 '<button type="button" class="chip" data-base="all" aria-pressed="true">All</button>%s</div>'
                 % "".join('<button type="button" class="chip" data-base="%s" aria-pressed="false">%s</button>' % (b, BASES[b]) for b in bases))
    body = """<section class="entry" id="top">
<p class="crumbs"><a href="%sindex.html">Home</a> / <a href="../">Drinks</a></p>
<h1>%s</h1>
<p class="lede">%s</p>
<p class="age"><strong>You must be of legal drinking age in your location.</strong></p>
%s
%s
</section>
<section class="dk-list">
<p class="dk-count" id="dkcount" aria-live="polite">%d drinks</p>
<div class="dk-grid" id="dkgrid">
%s
</div>
</section>
""" % (root, e(h1), e(lede), type_chips(root, key), chips, len(rows), "\n".join(d.card(root) for d in rows))
    return head(root, title, lede, url, ld) + body + foot(root, script=True)


def hub_page(drinks, by_type):
    root = "../"
    url = SITE + "/drinks/"
    title = "Drink Recipes for Game Night: Shots, Cocktails and Punch | TipsyPlay"
    desc = "100 drink recipes for game night: shots, cocktails, party punches, frozen drinks and hot drinks. Each one has an alcohol-free version."
    by_slug = {d.slug: d for d in drinks}
    ld = {"@context": "https://schema.org", "@graph": [
        crumbs_ld([("Home", SITE + "/"), ("Drinks", url)]),
        {"@type": "ItemList", "name": "Drink types", "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "name": t[2], "url": "%s/drinks/%s/" % (SITE, t[1])}
            for i, t in enumerate(TYPES)]}]}
    tiles = []
    for i, t in enumerate(TYPES):
        first = by_type[t[0]][0]
        tiles.append('<a class="pick dk-type" href="%s/"><span class="tile %s">%s</span>'
                     '<span class="pick-body"><b>%s</b><span>%d recipes · %s</span></span>'
                     '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4.5l7.5 7.5L9 19.5"/></svg></a>'
                     % (t[1], TILES[i % 3], glass_svg(first.glass if t[0] != "cocktails" else "martini", first.liq),
                        e(t[2]), len(by_type[t[0]]), e(", ".join(d.name for d in by_type[t[0]][:3]))))
    az = sorted(drinks, key=lambda d: d.name.lower())
    body = """<section class="entry" id="top">
<p class="crumbs"><a href="%sindex.html">Home</a></p>
<h1>Drink Recipes for Game Night</h1>
<p class="lede">100 drinks you can make at home, sorted by type. Every recipe has an alcohol-free version.</p>
<p class="age"><strong>You must be of legal drinking age in your location.</strong></p>
</section>
<section class="dk-sec" id="types">
<h2>Pick a type</h2>
<div class="picks">
%s
</div>
</section>
<section class="dk-sec" id="popular">
<h2>Popular right now</h2>
<div class="dk-grid">
%s
</div>
</section>
<section class="dk-sec" id="all">
<h2>All 100 drinks</h2>
<label class="dk-search" for="dksearch">Search by name</label>
<input id="dksearch" type="search" placeholder="Caesar, mojito, toddy" autocomplete="off">
<p class="dk-count" id="dkcount" aria-live="polite">100 drinks</p>
<ul class="dk-az" id="dkaz">
%s
</ul>
</section>
""" % (root, "\n".join(tiles), "\n".join(by_slug[s].card(root) for s in FEATURED),
       "\n".join('<li data-name="%s"><a href="%s.html">%s</a> <span>%s</span></li>' % (e(d.name.lower()), d.slug, e(d.name), e(d.tlabel)) for d in az))
    return head(root, title, desc, url, ld) + body + foot(root, script=True)


def write(rel, text):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def update_sitemap(drinks):
    path = os.path.join(ROOT, "sitemap.xml")
    lines = [l for l in open(path, encoding="utf-8").read().split("\n") if "/drinks/" not in l]
    new = ["  <url><loc>%s/drinks/</loc><lastmod>%s</lastmod></url>" % (SITE, TODAY)]
    new += ["  <url><loc>%s/drinks/%s/</loc><lastmod>%s</lastmod></url>" % (SITE, t[1], TODAY) for t in TYPES]
    new += ["  <url><loc>%s</loc><lastmod>%s</lastmod></url>" % (d.url, TODAY) for d in drinks]
    at = lines.index("</urlset>")
    open(path, "w", encoding="utf-8").write("\n".join(lines[:at] + new + lines[at:]))


def photo_prompts(drinks, by_type):
    out = ["# Photo prompts for the drinks section", "",
           "Each drink shows a drawn glass until it has a photo. To add one:", "",
           "1. Generate or take a landscape 4:3 photo (1200 × 900 is ideal). Paste the prompt below into an image tool.",
           "2. Save it as `images/drinks/<file name>.webp` (or `.jpg`), using the file name shown for that drink.",
           "3. Run `python3 tools/drinks/build.py` and commit. The photo replaces the drawing on every page.", "",
           "AI photos should show only the drink. Check each one for garbled text, extra garnishes that are not in the recipe, and brand labels before using it.", ""]
    for t in TYPES:
        out += ["## " + t[2], ""]
        for d in by_type[t[0]]:
            have = " (photo added)" if d.photo else ""
            out += ["### %s%s" % (d.name, have), "File name: `%s.webp`" % d.slug, "",
                    "> Photorealistic drink photograph of a %s: %s. Sitting on a light wooden table at a relaxed house party, "
                    "soft warm evening light, shallow depth of field, softly blurred background, shot at a slight angle from the front. "
                    "No people, no hands, no text, no logos, no brand labels. Landscape 4:3." % (d.name, d.look), ""]
    write("docs/drinks-photo-prompts.md", "\n".join(out))


def main():
    drinks, by_type = load()
    write("drinks/index.html", hub_page(drinks, by_type))
    for t in TYPES:
        write("drinks/%s/index.html" % t[1], type_page(t, by_type[t[0]]))
    for d in drinks:
        write("drinks/%s.html" % d.slug, recipe_page(d, by_type))
    update_sitemap(drinks)
    photo_prompts(drinks, by_type)
    print("wrote %d recipe pages, %d type pages, 1 hub; %d with photos" % (len(drinks), len(TYPES), sum(1 for d in drinks if d.photo)))


if __name__ == "__main__":
    main()
