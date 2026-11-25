#!/usr/bin/env python3
"""Writes llms.txt and llms-full.txt at the site root from the pages themselves.

Run from the repository root after adding or renaming a game, drink type or blog post:
    python3 tools/seo/build_llms.py
llms.txt is the short map (llmstxt.org format). llms-full.txt adds each game's rules as plain text,
so an assistant can answer "how do you play X" without crawling every page.
"""
import html, json, os, re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SITE = "https://tipsyplay.com"


def read(p):
    return open(os.path.join(ROOT, p), encoding="utf-8").read()


def text(fragment):
    fragment = re.sub(r"<(script|style)\b.*?</\1>", "", fragment, flags=re.S)
    fragment = re.sub(r"<li[^>]*>", "\n- ", fragment)
    fragment = re.sub(r"</(p|h2|h3|li|ol|ul|div)>", "\n", fragment)
    t = html.unescape(re.sub(r"<[^>]+>", "", fragment))
    return "\n".join(l.strip() for l in t.split("\n") if l.strip())


def meta(s, name):
    m = re.search(r'<meta name="%s" content="([^"]*)"' % name, s)
    return html.unescape(m.group(1)) if m else ""


def ld_items(s):
    out = []
    for b in re.findall(r'<script type="application/ld\+json">(.*?)</script>', s, re.S):
        j = json.loads(b)
        out += j.get("@graph", [j])
    return out


UI_LINES = re.compile(r"^(Host Game|Join|Play|Join with code|You must be of legal drinking age in your location\.|Party game · .*|Word game · .*)$")


def rules_text(s):
    """The page's descriptive sections only: the SEO block when the game runs in-page, otherwise the cards after the hero."""
    main = s[s.index("<main"):s.index("</main>")]
    seo = re.findall(r'<section id="seo-about[^"]*"[^>]*>(.*?)</section>', main, re.S) or \
        re.findall(r'<section class="band-ink"[^>]*>(.*?)</section>', main, re.S)
    if seo:
        body = "\n".join(text(x) for x in seo)
    else:
        body = text(re.sub(r'<section class="entry".*?</section>', "", main, count=1, flags=re.S))
    return "\n".join(l for l in body.split("\n") if not UI_LINES.match(l))


def games():
    order = re.findall(r'<a class="gc [^"]*" href="games/([a-z-]+)\.html"', read("index.html"))
    rows = []
    for slug in order:
        s = read("games/%s.html" % slug)
        vg = next(i for i in ld_items(s) if i.get("@type") == "VideoGame")
        n = vg["numberOfPlayers"]
        rows.append(dict(slug=slug, name=vg["name"], url=vg["url"], desc=meta(s, "description"),
                         players="%d–%d players" % (n["minValue"], n["maxValue"]), body=rules_text(s)))
    return rows


def drinks():
    s = read("drinks/index.html")
    types = re.findall(r'<a class="dk-type" href="([a-z-]+)/">.*?<b>([^<]+)</b><span>([^<]*)</span>', s, re.S)
    return [(html.unescape(n), "%s/drinks/%s/" % (SITE, d), html.unescape(ex)) for d, n, ex in types]


def posts():
    rows = []
    for f in sorted(os.listdir(os.path.join(ROOT, "blog"))):
        if not f.endswith(".html") or f == "index.html":
            continue
        s = read("blog/" + f)
        h1 = text(re.search(r"<h1[^>]*>(.*?)</h1>", s, re.S).group(1))
        rows.append((h1, "%s/blog/%s" % (SITE, f), meta(s, "description")))
    return rows


INTRO = """# TipsyPlay

> TipsyPlay (tipsyplay.com) is a free website of party games and drinking games for adults that runs in a phone's browser, with no app download and no account. One person hosts a room and gets a short code; friends join on their own phones. Every game has a non-alcoholic way to play, drinking is always optional, and there is no chugging, racing or stacking penalties. Players must be of legal drinking age in their location.

Key facts:
- Price: free. No sign-up; online rooms use anonymous sign-in.
- Players: 1 to 12 depending on the game. Each game page lists its player count.
- Devices: any phone or computer with a modern browser. Some games can also show a board on a TV.
- Responsible play: one small optional drink at most per turn, or a non-alcoholic alternative (points, poses, tallies). Passing is always fine. House rules: """ + SITE + """/responsible.html
- Also on the site: 100 drink recipes, each with an alcohol-free version, and guides for planning a game night.
"""


def build():
    g, d, b = games(), drinks(), posts()
    short = [INTRO, "## Games", ""]
    short += ["- [%s](%s): %s (%s)" % (x["name"], x["url"], x["desc"], x["players"]) for x in g]
    short += ["- [All games](%s/games/): the full list with filters for quick games, games for 2, big groups, no props and card games" % SITE, ""]
    short += ["## Drink recipes", "", "- [All 100 drinks](%s/drinks/): shots, cocktails, party punches, frozen and hot drinks, each with an alcohol-free version" % SITE]
    short += ["- [%s](%s): includes %s" % (n, u, ex) for n, u, ex in d] + [""]
    short += ["## Guides", ""] + ["- [%s](%s): %s" % (t, u, ds) for t, u, ds in b] + [""]
    short += ["## About", "",
              "- [Play responsibly](%s/responsible.html): the house code every game follows" % SITE,
              "- [About TipsyPlay](%s/about.html)" % SITE,
              "- [Privacy](%s/privacy.html): what is stored on the device and how anonymous rooms work" % SITE, "",
              "## Optional", "",
              "- [Full game rules](%s/llms-full.txt): every game's setup, rules and no-drink option as plain text" % SITE,
              "- [Sitemap](%s/sitemap.xml)" % SITE, ""]
    full = [INTRO, "This file holds the rules of every TipsyPlay game as plain text. Each section is taken from the game's page.", ""]
    for x in g:
        full += ["## %s" % x["name"], "", "URL: %s" % x["url"], "Players: %s" % x["players"], "Summary: %s" % x["desc"], "", x["body"], ""]
    open(os.path.join(ROOT, "llms.txt"), "w", encoding="utf-8").write("\n".join(short))
    open(os.path.join(ROOT, "llms-full.txt"), "w", encoding="utf-8").write("\n".join(full))
    print("llms.txt: %d games, %d drink types, %d guides; llms-full.txt %d KB" %
          (len(g), len(d), len(b), os.path.getsize(os.path.join(ROOT, "llms-full.txt")) // 1024))


if __name__ == "__main__":
    build()
