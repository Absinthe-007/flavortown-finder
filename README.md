# 🔥 Flavortown Finder

Every *Diners, Drive-Ins and Dives* restaurant (1,673 and counting), organized by state, with:

- **Open-only filter**: hides closed spots. Yelp's live status wins; Wikipedia's "(Closed)" tags are the fallback.
- **Yelp ratings, review counts, price, phone, and address**
- **Recipes tab**: Food Network recipes matched to each restaurant, plus a one-tap recipe search for any spot.
- **Trip weather**: drive from anywhere to a Triple D spot and see the forecast *for when you'll be there*, broken down by state.
- **Fun facts**: the episode, season, and air date, repeat visits, how many DDD spots the city and state have, and Yelp categories.

There are two front ends that read the same data file:

| | Web app (iPhone home screen) | Native iOS app |
|---|---|---|
| Folder | `docs/` | `ios/` |
| Cost | Free | $99/yr Apple Developer account (free for 7-day personal installs) |
| Needs | Nothing | A Mac with Xcode 15+ |
| Install | Safari → Share → **Add to Home Screen** | Build and run from Xcode |

## 1. Put it on GitHub (5 min)

1. Create a new **public** repo, `Absinthe-007/flavortown-finder`, and upload everything in this folder.
2. **Settings → Pages**: Source = *Deploy from a branch*, Branch = `main`, Folder = `/docs` → Save.
3. Your app will be live at **https://absinthe-007.github.io/flavortown-finder/**.
4. On your iPhone, open that link in **Safari** → Share → **Add to Home Screen**. It now opens full-screen like a real app.

## 2. Turn on Yelp (ratings and open/closed)

1. Go to https://www.yelp.com/developers/v3/manage_app, create an app, and copy the **API Key**.
2. In the repo, go to **Settings → Secrets and variables → Actions → New repository secret**. Name it `YELP_API_KEY` and paste the key as the value.
3. **Actions → Refresh restaurant data → Run workflow.**

The job runs **daily** and spends at most **280 Yelp calls per run**. That fits Yelp's free trial (about 300 calls a day), so all ~1,500 U.S. spots get verified in about 6 days. After that, each spot is re-checked every 30 days.

> 💸 **Cost heads-up:** Yelp's trial lasts 30 days. After that, Yelp's API is paid (plans start around $229/mo, or roughly $8 per 1,000 calls). To stay free after the trial, either stop the workflow (the app keeps the last data) or set the repo variable `YELP_DAILY_BUDGET` to something small like `50`. The status for each spot is cached in `data/yelp_cache.json`, so nothing is lost.

You can tune these under **Settings → Variables**: `YELP_DAILY_BUDGET` (default 280) and `YELP_REFRESH_DAYS` (default 30).

## 3. Recipes

The nightly job searches Food Network for recipes credited "Courtesy of <restaurant>". Food Network sometimes blocks automated requests; when that happens, the job skips recipes for that run and tries again the next day. Until a match is found, every restaurant has a **Search Food Network** button.

To add a recipe by hand, edit `data/recipes_manual.json`:

```json
{ "parkettedrivein-lexington-ky": [ { "title": "Kentucky Poor Boy", "url": "https://www.foodnetwork.com/recipes/..." } ] }
```

The key is the restaurant `id` (shown in the URL after `#r=` when you open a spot in the web app).

## 4. Native iOS app (optional)

```bash
brew install xcodegen
cd ios && xcodegen generate && open FlavortownFinder.xcodeproj
```

Pick your Team under *Signing & Capabilities*, plug in your iPhone, and press ▶. If you don't want XcodeGen, create a new iOS App project in Xcode (SwiftUI, iOS 17) named FlavortownFinder and drag the `.swift` files in.

The iOS app uses Apple Maps routing (`MKDirections`) and Apple's reverse geocoding for state lines, plus Open-Meteo for the weather. It loads data from the GitHub Pages URL in `DataStore.swift`. Change that URL if your repo name is different.

## How the data works

`scripts/build_data.py` does the following:

1. Pulls every episode and restaurant from Wikipedia's *List of Diners, Drive-Ins and Dives episodes* (CC BY-SA).
2. Geocodes each city with the U.S. Census gazetteer, falling back to OpenStreetMap.
3. Adds Yelp data (incremental and budgeted).
4. Looks up Food Network recipes (best effort).
5. Writes `docs/data/restaurants.json`.

Run it locally with `YELP_API_KEY=... python3 scripts/build_data.py`. It needs Python 3.10+ and has no dependencies.

Free services used by the app:

- **Routing:** OSRM / OpenStreetMap on the web; Apple Maps on iOS.
- **Weather:** Open-Meteo.
- **Map tiles:** OpenStreetMap.

None of these need keys.
