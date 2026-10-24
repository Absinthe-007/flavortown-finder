# 🔥 Flavortown Finder

Every *Diners, Drive-Ins and Dives* restaurant (1,673 and counting), organized by state, with:

- **Open-only filter**: hides the spots marked "(Closed)" on Wikipedia's episode list. Everything else shows as **Likely open**, so call ahead.
- **Reviews in one tap**: each spot links to its Google and Yelp reviews. There are no API keys and nothing to pay for.
- **Recipes tab**: Food Network recipes matched to each restaurant, plus a one-tap recipe search for any spot.
- **Road trips with multiple stops**: start anywhere, add as many stops as you like (Triple D spots or any city/address), and reorder them. You can set how long you'll spend at each stop.
- **Triple D along the way**: every spot within 5–50 miles of your route, with the mile marker, how far off the route it is, and when you'll pass it. Tap **+ Stop** to add one to the trip in the right order.
- **Trip weather**: the forecast *for when you'll be at each point*, broken down by state, including at each stop.
- **Fun facts**: the episode, season, and air date, repeat visits, how many DDD spots the city and state have.

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

## 2. Data updates (no keys needed)

The **Refresh restaurant data** workflow runs daily. It pulls new episodes and any new "(Closed)" tags from Wikipedia, and looks for Food Network recipes. You don't have to set anything up. To run it right away, go to **Actions → Refresh restaurant data → Run workflow**.

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
3. Marks closed spots from Wikipedia's "(Closed)" tags.
4. Looks up Food Network recipes (best effort).
5. Writes `docs/data/restaurants.json`.

Run it locally with `python3 scripts/build_data.py`. It needs Python 3.10+ and has no dependencies.

Free services used by the app:

- **Routing:** OSRM / OpenStreetMap on the web; Apple Maps on iOS.
- **Weather:** Open-Meteo.
- **Map tiles:** OpenStreetMap.

None of these need keys.
