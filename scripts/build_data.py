#!/usr/bin/env python3
"""
Flavortown Finder data builder.

1. Pulls every Diners, Drive-Ins and Dives restaurant from Wikipedia's episode list (CC BY-SA).
2. Geocodes each city (US Census gazetteer first, OpenStreetMap Nominatim fallback, cached).
3. Enriches with Google Places (open/closed, address, pin, rating, review count, price, phone)
   using GOOGLE_PLACES_API_KEY — budgeted to stay inside Google's free monthly usage caps.
4. Looks for Food Network recipes credited to each restaurant (best effort, cached).
5. Writes docs/data/restaurants.json for the web app + iOS app.

Run:  GOOGLE_PLACES_API_KEY=xxx python scripts/build_data.py
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
GOOGLE_KEY = os.environ.get("GOOGLE_PLACES_API_KEY", "").strip()
# Monthly caps sit just under Google's free tiers (5,000 Pro / 1,000 Enterprise calls per month).
G_PRO_CAP = int(os.environ.get("GOOGLE_PRO_MONTHLY_CAP") or 4500)
G_ENT_CAP = int(os.environ.get("GOOGLE_ENTERPRISE_MONTHLY_CAP") or 950)
G_ENT_DAILY = int(os.environ.get("GOOGLE_RATINGS_PER_DAY") or 32)
G_STATUS_DAYS = int(os.environ.get("GOOGLE_STATUS_REFRESH_DAYS") or 30)
G_RATING_DAYS = int(os.environ.get("GOOGLE_RATING_REFRESH_DAYS") or 60)
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


# ---------------------------------------------------------------- Google Places (New)
# Two passes, each kept under Google's free monthly caps (tracked in data/google_usage.json):
#   1. Text Search *Pro* fields (5,000 free/mo): finds the place, open/closed status, exact address + pin.
#   2. Place Details *Enterprise* fields (1,000 free/mo): rating, review count, price, phone.
SEARCH_FIELDS = "places.id,places.displayName,places.formattedAddress,places.location,places.businessStatus,places.googleMapsUri,places.primaryTypeDisplayName,places.types"
DETAIL_FIELDS = "id,businessStatus,rating,userRatingCount,priceLevel,nationalPhoneNumber,websiteUri"
STATUS_FIELDS = "id,businessStatus"
PRICE = {"PRICE_LEVEL_INEXPENSIVE": "$", "PRICE_LEVEL_MODERATE": "$$", "PRICE_LEVEL_EXPENSIVE": "$$$", "PRICE_LEVEL_VERY_EXPENSIVE": "$$$$"}
FOODISH = {"restaurant", "food", "bar", "cafe", "bakery", "meal_takeaway", "meal_delivery", "store", "food_store", "deli", "diner", "brewery", "night_club", "liquor_store", "grocery_store", "market"}


def g_req(url, fields, body=None):
    h = {"X-Goog-Api-Key": GOOGLE_KEY, "X-Goog-FieldMask": fields, "Content-Type": "application/json", "User-Agent": UA}
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=h, method="POST" if data else "GET")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def g_match(r, places):
    best, score = None, 0
    for p in places:
        nm = (p.get("displayName") or {}).get("text", "")
        s = difflib.SequenceMatcher(None, norm(r["name"]), norm(nm)).ratio()
        if norm(r["name"]) and norm(nm) and (norm(r["name"]) in norm(nm) or norm(nm) in norm(r["name"])):
            s = max(s, 0.85)
        if not FOODISH.intersection(p.get("types") or []):
            s -= 0.15
        if s > score:
            best, score = p, s
    return best if score >= 0.6 else None


def enrich_google(restaurants, cache, usage):
    if not GOOGLE_KEY:
        print("GOOGLE_PLACES_API_KEY not set — skipping Google Places enrichment")
        return
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    u = usage.setdefault(month, {"pro": 0, "ent": 0})
    today = datetime.now(timezone.utc)
    ds = today.strftime("%Y-%m-%d")
    age = lambda d: (today - datetime.strptime(d, "%Y-%m-%d").replace(tzinfo=timezone.utc)).days if d else 9999
    ent_today = 0
    stop = False

    def fail(e, what):
        nonlocal stop
        body = e.read().decode("utf-8", "replace")[:300] if hasattr(e, "read") else ""
        print(f"google {what} error {getattr(e, 'code', '')}: {body}")
        if getattr(e, "code", 0) in (400, 401, 403, 429):
            stop = True

    # Pass 1 — find new places (newest seasons first)
    todo = sorted([r for r in restaurants if r["id"] not in cache], key=lambda r: -max(a["season"] for a in r["appearances"]))
    for r in todo:
        if stop or u["pro"] >= G_PRO_CAP:
            break
        q = f"{r['name']}, {r['city']}, {ABBR.get(r['state'], r['state'])}" + ("" if r["country"] == "USA" else f", {r['country']}")
        body = {"textQuery": q, "pageSize": 5}
        if r.get("lat"):
            body["locationBias"] = {"circle": {"center": {"latitude": r["lat"], "longitude": r["lon"]}, "radius": 40000.0}}
        try:
            res = g_req("https://places.googleapis.com/v1/places:searchText", SEARCH_FIELDS, body)
            u["pro"] += 1
            m = g_match(r, res.get("places", []))
            if m:
                cache[r["id"]] = {
                    "pid": m["id"], "gname": (m.get("displayName") or {}).get("text"), "addr": m.get("formattedAddress"),
                    "lat": (m.get("location") or {}).get("latitude"), "lon": (m.get("location") or {}).get("longitude"),
                    "biz": m.get("businessStatus") or "OPERATIONAL", "maps": m.get("googleMapsUri"),
                    "type": (m.get("primaryTypeDisplayName") or {}).get("text"), "statusChecked": ds,
                }
            else:
                cache[r["id"]] = {"pid": None, "statusChecked": ds}
            time.sleep(0.1)
        except urllib.error.HTTPError as e:
            fail(e, "search")

    # Pass 2 — ratings/price/phone for open places missing them or older than G_RATING_DAYS
    need = [r for r in restaurants if (cache.get(r["id"]) or {}).get("pid") and cache[r["id"]].get("biz") != "CLOSED_PERMANENTLY"
            and age(cache[r["id"]].get("ratingChecked")) >= G_RATING_DAYS]
    need.sort(key=lambda r: (cache[r["id"]].get("ratingChecked") is not None, cache[r["id"]].get("ratingChecked") or "", -max(a["season"] for a in r["appearances"])))
    for r in need:
        if stop or u["ent"] >= G_ENT_CAP or ent_today >= G_ENT_DAILY:
            break
        c = cache[r["id"]]
        try:
            d = g_req(f"https://places.googleapis.com/v1/places/{c['pid']}", DETAIL_FIELDS)
            u["ent"] += 1; ent_today += 1
            c.update({"rating": d.get("rating"), "reviews": d.get("userRatingCount"), "price": PRICE.get(d.get("priceLevel")),
                      "phone": d.get("nationalPhoneNumber"), "web": d.get("websiteUri"),
                      "biz": d.get("businessStatus") or c.get("biz"), "ratingChecked": ds, "statusChecked": ds})
            time.sleep(0.1)
        except urllib.error.HTTPError as e:
            fail(e, "details")

    # Pass 3 — cheap status re-check (Pro fields) for anything not checked in G_STATUS_DAYS
    stale = sorted([r for r in restaurants if (cache.get(r["id"]) or {}).get("pid") and age(cache[r["id"]].get("statusChecked")) >= G_STATUS_DAYS],
                   key=lambda r: cache[r["id"]].get("statusChecked") or "")
    for r in stale:
        if stop or u["pro"] >= G_PRO_CAP:
            break
        c = cache[r["id"]]
        try:
            d = g_req(f"https://places.googleapis.com/v1/places/{c['pid']}", STATUS_FIELDS)
            u["pro"] += 1
            c["biz"] = d.get("businessStatus") or c.get("biz"); c["statusChecked"] = ds
        except urllib.error.HTTPError as e:
            if e.code == 404:  # place removed from Google — treat as closed
                c["biz"] = "CLOSED_PERMANENTLY"; c["statusChecked"] = ds
            else:
                fail(e, "status")
    print(f"google usage {month}: search/status={u['pro']}/{G_PRO_CAP}  ratings={u['ent']}/{G_ENT_CAP} (today {ent_today}); cached={len(cache)}")


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
    places = load("google_cache.json", {})
    usage = load("google_usage.json", {})
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

    enrich_google(restaurants, places, usage)
    save("google_cache.json", places)
    save("google_usage.json", usage)

    if os.environ.get("SKIP_RECIPES") != "1":
        find_recipes(restaurants, recipes)
        save("recipes_cache.json", recipes)

    by_city, by_state = {}, {}
    for r in restaurants:
        by_city[(r["city"], r["state"])] = by_city.get((r["city"], r["state"]), 0) + 1
        by_state[r["state"]] = by_state.get(r["state"], 0) + 1

    out = []
    for r in restaurants:
        g = places.get(r["id"]) or {}
        rec = (manual.get(r["id"]) or []) + (recipes.get(r["id"]) or [])
        # Google is the live source of truth; Wikipedia's "(Closed)" tag is the fallback.
        status = "closed" if r.get("wclosed") else "unknown"
        detail = None
        if g.get("pid"):
            biz = g.get("biz") or "OPERATIONAL"
            status = "open" if biz == "OPERATIONAL" else "closed"
            detail = "Temporarily closed" if biz == "CLOSED_TEMPORARILY" else ("Permanently closed" if biz == "CLOSED_PERMANENTLY" else None)
        item = {
            "id": r["id"], "name": r["name"], "city": r["city"], "state": r["state"], "country": r["country"],
            "lat": g.get("lat") or r["lat"], "lon": g.get("lon") or r["lon"], "exact": bool(g.get("lat")),
            "status": status, "statusDetail": detail, "rating": g.get("rating"), "reviews": g.get("reviews"), "price": g.get("price"),
            "cats": [g["type"]] if g.get("type") else [], "addr": g.get("addr"), "phone": g.get("phone"),
            "maps": g.get("maps"), "web": g.get("web"), "img": None, "checked": g.get("statusChecked"), "note": r.get("note"),
            "statusSource": "google" if g.get("pid") else ("wikipedia" if r.get("wclosed") else None),
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
        "sources": ["Wikipedia: List of Diners, Drive-Ins and Dives episodes (CC BY-SA 4.0)", "Google Places API", "Food Network", "US Census Gazetteer", "OpenStreetMap Nominatim"],
    }
    OUT.write_text(json.dumps({"meta": meta, "restaurants": out}, ensure_ascii=False, separators=(",", ":")))
    print(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main()
