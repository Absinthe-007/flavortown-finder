#!/usr/bin/env python3
"""
Flavortown Finder data builder.

1. Pulls every Diners, Drive-Ins and Dives restaurant from Wikipedia's episode list (CC BY-SA).
2. Geocodes each city (US Census gazetteer first, OpenStreetMap Nominatim fallback, cached).
3. Marks closed spots from Wikipedia's "(Closed)" tags (no paid APIs, no keys).
4. Looks for Food Network recipes credited to each restaurant (best effort, cached).
5. Writes docs/data/restaurants.json for the web app + iOS app.

Run:  python scripts/build_data.py
"""
import json, os, re, sys, time, io, zipfile, unicodedata, difflib, html
from datetime import datetime, timezone, timedelta
from pathlib import Path
import urllib.request, urllib.parse, urllib.error

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data"
OUT = ROOT / "docs" / "data" / "restaurants.json"
CACHE.mkdir(exist_ok=True)
OUT.parent.mkdir(parents=True, exist_ok=True)

UA = "FlavortownFinder/1.0 (personal DDD trip app; github.com/Absinthe-007)"
RECIPE_BUDGET = int(os.environ.get("RECIPE_BUDGET", "150"))

STATES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO",
    "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC", "Washington, D.C.": "DC", "Florida": "FL",
    "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS",
    "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI",
    "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
    "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI",
    "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT",
    "Virginia": "VA", "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
    "Puerto Rico": "PR",
}
ABBR = {v: k for k, v in STATES.items() if k != "Washington, D.C."}


def load(name, default):
    p = CACHE / name
    if p.exists():
        try:
            return json.loads(p.read_text())
        except Exception:
            pass
    return default


def save(name, obj):
    (CACHE / name).write_text(json.dumps(obj, indent=1, sort_keys=True, ensure_ascii=False))


def http(url, headers=None, tries=4, binary=False):
    h = {"User-Agent": UA}
    h.update(headers or {})
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=40) as r:
                data = r.read()
                return data if binary else data.decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and i < tries - 1:
                time.sleep(5 * (i + 1))
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            if i < tries - 1:
                time.sleep(5 * (i + 1))
                continue
            raise


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = s.replace("&", " and ")
    s = re.sub(r"\b(the|restaurant|cafe|café|bar|grill|and)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


# ---------------------------------------------------------------- Wikipedia
def clean_wiki(cell):
    c = re.sub(r"<ref[^>]*/>", "", cell)
    c = re.sub(r"<ref[^>]*>.*?</ref>", "", c, flags=re.S)
    c = re.sub(r"\{\{[^{}]*\}\}", "", c)
    c = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", c)
    c = re.sub(r"<br\s*/?>", " ", c)
    c = re.sub(r"<[^>]+>", "", c)
    c = c.replace("'''", "").replace("''", "")
    c = html.unescape(c)
    return re.sub(r"\s+", " ", c).strip(" |")


def split_attr(cell):
    """'rowspan="3" | value'  -> (rowspan, value)"""
    m = re.match(r'\s*((?:[a-z]+\s*=\s*"?[^"|]*"?\s*)+)\|(?!\|)(.*)$', cell, flags=re.S)
    if m and "=" in m.group(1) and "[[" not in m.group(1):
        rs = re.search(r'rowspan\s*=\s*"?(\d+)', m.group(1))
        return (int(rs.group(1)) if rs else 1), m.group(2)
    return 1, cell


def parse_wikipedia(text):
    rows_out = []
    season = None
    for block in re.split(r"\n(?==== )", text):
        m = re.match(r"=== Season (\d+)", block)
        if not m:
            continue
        season = int(m.group(1))
        tbl = block.split("{|", 1)
        if len(tbl) < 2:
            continue
        body = tbl[1].split("\n|}", 1)[0]
        rows = body.split("\n|-")
        carry = {}  # col index -> [remaining, value]
        for row in rows:
            lines = [l for l in row.strip().split("\n") if l.startswith("|") and not l.startswith("|}")]
            if not lines:
                continue
            cells = []
            for l in lines:
                for part in re.split(r"\|\|", l[1:]):
                    cells.append(split_attr(part))
            vals = [None] * 6
            ci = 0
            for col in range(6):
                if col in carry and carry[col][0] > 0:
                    vals[col] = carry[col][1]
                    carry[col][0] -= 1
                    continue
                if ci < len(cells):
                    rs, v = cells[ci]
                    ci += 1
                    vals[col] = v
                    if rs > 1:
                        carry[col] = [rs - 1, v]
            if vals[3] is None or vals[4] is None:
                continue
            raw_name = vals[3]
            name = clean_wiki(raw_name)
            note = ""
            wclosed = bool(re.search(r"\((closed)\)", name, re.I))
            m2 = re.search(r"\s*\((Closed|CLOSED|New Locations?|New location[^)]*|Name changed[^)]*)\)\s*", name)
            if m2:
                note = "" if wclosed else m2.group(1)
                name = (name[:m2.start()] + " " + name[m2.end():]).strip()
            loc = clean_wiki(vals[4])
            if not name or not loc or name.lower() in ("restaurant", "tba"):
                continue
            rows_out.append({
                "season": season,
                "episode": clean_wiki(vals[1] or ""),
                "overall": clean_wiki(vals[0] or ""),
                "title": clean_wiki(vals[2] or ""),
                "name": name,
                "location": loc,
                "airdate": clean_wiki(vals[5] or ""),
                "wiki": bool(re.search(r"\[\[", raw_name)),
                "wclosed": wclosed, "note": note,
            })
    return rows_out


def split_location(loc):
    loc = loc.replace("Washington, D.C.", "Washington, District of Columbia")
    parts = [p.strip() for p in loc.split(",") if p.strip()]
    if len(parts) >= 2:
        last = parts[-1]
        if last in STATES:
            return ", ".join(parts[:-1]), STATES[last], "USA"
        if last.upper() in ABBR:
            return ", ".join(parts[:-1]), last.upper(), "USA"
        if last in ("Canada", "Mexico", "Italy", "England", "United Kingdom", "Cuba", "Germany", "Spain"):
            if len(parts) >= 3:
                return ", ".join(parts[:-2]), parts[-2], last
            return parts[0], last, last
        return ", ".join(parts[:-1]), last, "Other"
    if parts and parts[0] in STATES:
        return parts[0], STATES[parts[0]], "USA"
    return loc, "Unknown", "Other"


# ---------------------------------------------------------------- Geocoding
def gazetteer():
    p = CACHE / "gazetteer.json"
    if p.exists():
        return json.loads(p.read_text())
    print("downloading census gazetteer…")
    raw = http("https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_place_national.zip", binary=True)
    z = zipfile.ZipFile(io.BytesIO(raw))
    txt = z.read(z.namelist()[0]).decode("latin-1")
    g = {}
    suffix = re.compile(r"\s+(city|town|village|CDP|borough|municipality|city and borough|consolidated government.*|metro government.*|unified government.*|urban county|comunidad|zona urbana)(\s*\(balance\))?$", re.I)
    for line in txt.splitlines()[1:]:
        f = [x.strip() for x in line.split("\t")]
        if len(f) < 12:
            continue
        nm = suffix.sub("", f[3]).strip()
        g.setdefault(f"{norm(nm)}|{f[0]}", [round(float(f[10]), 5), round(float(f[11]), 5)])
    p.write_text(json.dumps(g))
    return g


def geocode(city, region, country, gaz, cache):
    key = f"{city}|{region}|{country}"
    if key in cache:
        return cache[key]
    if country == "USA":
        for c in [city] + [x.strip() for x in re.split(r"[/(),]| and ", city) if x.strip()]:
            hit = gaz.get(f"{norm(c)}|{region}")
            if hit:
                cache[key] = hit
                return hit
    bits = [city, ABBR.get(region, region), "" if country in ("Other", region) else country]
    q = ", ".join(b for b in bits if b)
    try:
        time.sleep(1.1)
        res = json.loads(http("https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": q, "format": "json", "limit": 1})))
        cache[key] = [round(float(res[0]["lat"]), 5), round(float(res[0]["lon"]), 5)] if res else None
    except Exception as e:
        print("geocode fail", q, e)
        return None
    return cache[key]


# ---------------------------------------------------------------- Food Network recipes (best effort)
def find_recipes(restaurants, cache):
    """Searches Food Network for recipes credited 'Courtesy of <restaurant>'.
    Food Network blocks many datacenter IPs; on the first 403 we stop and keep the cache."""
    done = 0
    for r in sorted(restaurants, key=lambda r: r["id"] in cache):
        if done >= RECIPE_BUDGET:
            break
        if r["id"] in cache:
            continue
        q = urllib.parse.quote(re.sub(r"[^A-Za-z0-9 ]", "", r["name"]).strip().replace(" ", "-").lower())
        try:
            page = http(f"https://www.foodnetwork.com/search/{q}-", {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15"}, tries=1)
        except urllib.error.HTTPError as e:
            print("food network blocked:", e.code, "- recipe search skipped this run")
            break
        except Exception:
            break
        hits = []
        for blk in re.findall(r'm-MediaBlock__a-Headline.*?</section>|m-MediaBlock__a-Headline.*?m-MediaBlock__a-Headline', page, flags=re.S)[:30]:
            link = re.search(r'href="(?:https?:)?//www\.foodnetwork\.com(/recipes/[^"]+)"', blk)
            title = re.search(r'<span class="m-MediaBlock__a-HeadlineText">([^<]+)', blk)
            cred = re.search(r"Courtesy of ([^<]+)", blk)
            if link and title and cred:
                c = norm(cred.group(1))
                if c and (c in norm(r["name"]) or norm(r["name"]) in c or difflib.SequenceMatcher(None, c, norm(r["name"])).ratio() > 0.8):
                    hits.append({"title": html.unescape(title.group(1).strip()), "url": "https://www.foodnetwork.com" + link.group(1)})
        cache[r["id"]] = hits
        done += 1
        time.sleep(1.5)
    print(f"recipe lookups this run: {done}")


# ---------------------------------------------------------------- Fun facts
def fun_facts(r, by_city, by_state, total_states):
    f = []
    first = min(r["appearances"], key=lambda a: (a["season"], int(a["episode"]) if a["episode"].isdigit() else 0))
    f.append(f"Guy first rolled in during Season {first['season']}, Episode {first['episode']}: “{first['title']}”" + (f" (aired {first['airdate']})." if first["airdate"] else "."))
    if len(r["appearances"]) > 1:
        f.append(f"Made the cut {len(r['appearances'])} times — it shows up in {len(r['appearances'])} different episodes.")
    n_city = by_city[(r["city"], r["state"])]
    if n_city > 1:
        f.append(f"One of {n_city} Triple D joints in {r['city']} — a legit Flavortown hot spot.")
    else:
        f.append(f"The only Triple D stop in {r['city']}, so it carries the whole town's Flavortown flag.")
    if r["country"] == "USA":
        us = sorted((v for k, v in by_state.items() if k in ABBR), reverse=True)
        rank = us.index(by_state[r["state"]]) + 1
        f.append(f"{ABBR.get(r['state'], r['state'])} has {by_state[r['state']]} DDD features — #{rank} in the country for Guy visits.")
    yrs = re.search(r"(19|20)\d\d", first["airdate"] or "")
    if yrs:
        age = datetime.now().year - int(yrs.group(0))
        if age >= 10:
            f.append(f"Its episode first aired {age} years ago — still a road-trip classic.")
    if r.get("wiki"):
        f.append("Famous enough to have its own Wikipedia article.")
    return f


# ---------------------------------------------------------------- main
def main():
    print("fetching Wikipedia episode list…")
    wt = http("https://en.wikipedia.org/w/index.php?title=List_of_Diners,_Drive-Ins_and_Dives_episodes&action=raw")
    rows = parse_wikipedia(wt)
    print("rows parsed:", len(rows))

    gaz = gazetteer()
    gcache = load("geocache.json", {})
    recipes = load("recipes_cache.json", {})
    manual = load("recipes_manual.json", {})

    grouped = {}
    for row in rows:
        city, region, country = split_location(row["location"])
        key = slug(f"{norm(row['name'])}-{city}-{region}")
        r = grouped.setdefault(key, {"id": key, "name": row["name"], "city": city, "state": region, "country": country,
                                     "wiki": row["wiki"], "appearances": []})
        r["wiki"] = r["wiki"] or row["wiki"]
        r["wclosed"] = r.get("wclosed", False) or row["wclosed"]
        if row["note"]:
            r["note"] = row["note"]
        r["appearances"].append({k: row[k] for k in ("season", "episode", "overall", "title", "airdate")})
    restaurants = list(grouped.values())
    print("unique restaurants:", len(restaurants))

    for r in restaurants:
        ll = geocode(r["city"], r["state"], r["country"], gaz, gcache)
        r["lat"], r["lon"] = (ll or [None, None])
    save("geocache.json", gcache)


    if os.environ.get("SKIP_RECIPES") != "1":
        find_recipes(restaurants, recipes)
        save("recipes_cache.json", recipes)

    by_city, by_state = {}, {}
    for r in restaurants:
        by_city[(r["city"], r["state"])] = by_city.get((r["city"], r["state"]), 0) + 1
        by_state[r["state"]] = by_state.get(r["state"], 0) + 1

    out = []
    for r in restaurants:
        rec = (manual.get(r["id"]) or []) + (recipes.get(r["id"]) or [])
        item = {
            "id": r["id"], "name": r["name"], "city": r["city"], "state": r["state"], "country": r["country"],
            "lat": r["lat"], "lon": r["lon"], "exact": False,
            "status": "closed" if r.get("wclosed") else "unknown", "cats": [], "note": r.get("note"),
            "statusSource": "wikipedia" if r.get("wclosed") else None,
            "appearances": sorted(r["appearances"], key=lambda a: a["season"]),
            "recipes": rec, "facts": fun_facts(r, by_city, by_state, len(by_state)),
        }
        out.append(item)
    out.sort(key=lambda x: (x["state"], x["city"], x["name"]))
    meta = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "count": len(out),
        "open": sum(1 for o in out if o["status"] == "open"),
        "closed": sum(1 for o in out if o["status"] == "closed"),
        "withRecipes": sum(1 for o in out if o["recipes"]),
        "sources": ["Wikipedia: List of Diners, Drive-Ins and Dives episodes (CC BY-SA 4.0)", "Food Network", "US Census Gazetteer", "OpenStreetMap Nominatim"],
    }
    OUT.write_text(json.dumps({"meta": meta, "restaurants": out}, ensure_ascii=False, separators=(",", ":")))
    print(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main()
