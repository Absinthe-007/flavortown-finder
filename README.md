# 🔥 Flavortown Finder

Every *Diners, Drive-Ins and Dives* restaurant (1,673 and counting), organized by state, with:

- **Open-only filter**: hides closed spots (permanently or temporarily). Google's live status wins; Wikipedia's "(Closed)" tags are the fallback.
- **Google ratings, review counts, price, phone, exact address, and website**
- **Recipes tab**: Food Network recipes matched to each restaurant, plus a one-tap recipe search for any spot.
- **Road trips with multiple stops**: start anywhere, add as many stops as you like (Triple D spots or any city/address), and reorder them. You can set how long you'll spend at each stop.
- **Triple D along the way**: every spot within 5–50 miles of your route, with the mile marker, how far off the route it is, and when you'll pass it. Tap **+ Stop** to add one to the trip in the right order.
- **Trip weather**: the forecast *for when you'll be at each point*, broken down by state, including at each stop.
- **Fun facts**: the episode, season, and air date, repeat visits, how many DDD spots the city and state have, and Google's restaurant type.

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

## 2. Turn on Google Places (ratings and open/closed)

1. Go to https://console.cloud.google.com, create a project (e.g. "flavortown"), and attach a billing account. Google requires a card on file even for the free tier.
2. **APIs & Services → Library**: search for **Places API (New)** and click **Enable**.
3. **APIs & Services → Credentials → Create credentials → API key**. Then **Edit API key → API restrictions → Restrict key → Places API (New)** → Save.
4. Optional but smart: **Billing → Budgets & alerts**, add a $1 budget so you get an email if anything ever costs money.
5. In the GitHub repo, go to **Settings → Secrets and variables → Actions → New repository secret**. Name it `GOOGLE_PLACES_API_KEY` and paste the key.
6. **Actions → Refresh restaurant data → Run workflow.**

### What it costs: $0 if you leave the defaults

Google gives free calls every month for each Places pricing tier. The job tracks its own usage in `data/google_usage.json` and stops before it reaches either cap:

| What | Google tier | Free per month | Job's cap |
|---|---|---|---|
| Find each spot, open/closed status, exact address and pin | Text Search / Details **Pro** | 5,000 | 4,500 |
| Rating, review count, price, phone, website | Place Details **Enterprise** | 1,000 | 950 (32 a day) |

- **Day 1:** every restaurant (all 1,673) gets matched to Google with its open/closed status and exact map pin.
- **Ratings** fill in at about 32 a day, open spots first, newest seasons first. All of them should be filled in within about 2 months, and each one is refreshed every 60 days after that.
- **Open/closed** is re-checked every 30 days.

You can tune these under **Settings → Variables**: `GOOGLE_PRO_MONTHLY_CAP`, `GOOGLE_ENTERPRISE_MONTHLY_CAP`, and `GOOGLE_RATINGS_PER_DAY`. If you raise `GOOGLE_RATINGS_PER_DAY` to 200, ratings fill in about a week. That goes past the free 1,000 a month, and Google charges about $20 per 1,000 rating lookups beyond it, so roughly $14 total.

> Google's Maps Platform terms limit how long you may store Places data (place IDs can be kept indefinitely; most other fields are meant to be refreshed rather than stored long-term) and ask that you show Google attribution. The app shows "Ratings & status: Google" on every restaurant and the job refreshes data on a rolling 30/60-day cycle, which is a reasonable personal-project setup. If you ever make this a commercial app, review https://cloud.google.com/maps-platform/terms first.

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
3. Adds Google Places data (incremental, kept inside the free monthly caps).
4. Looks up Food Network recipes (best effort).
5. Writes `docs/data/restaurants.json`.

Run it locally with `GOOGLE_PLACES_API_KEY=... python3 scripts/build_data.py`. It needs Python 3.10+ and has no dependencies.

Free services used by the app:

- **Routing:** OSRM / OpenStreetMap on the web; Apple Maps on iOS.
- **Weather:** Open-Meteo.
- **Map tiles:** OpenStreetMap.

None of these need keys.
