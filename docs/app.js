/* Flavortown Finder — vanilla JS, no build step. */
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const STATE_NAMES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "Washington, D.C.", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico" };

  const state = { all: [], meta: {}, byId: new Map(), openOnly: true, sort: "rating", q: "", region: null, me: null, shown: 60, map: null, mapLayer: null, statesGeo: null };

  // ---------- helpers
  const regionKey = (r) => (r.country === "USA" ? r.state : r.country === "Canada" ? `${r.state}, Canada` : r.country);
  const regionName = (k) => STATE_NAMES[k] || k;
  const visible = (r) => !state.openOnly || r.status !== "closed";
  const statusLabel = (r) => (r.status === "open" ? "Open" : r.status === "closed" ? (r.statusDetail === "Temporarily closed" ? "Temp closed" : "Closed") : "Unverified");
  const stars = (n) => (n == null ? "" : `<span class="stars">★ ${n.toFixed(1)}</span>`);
  const emojiFor = (r) => {
    const t = (r.cats.join(" ") + " " + r.name + " " + r.appearances.map((a) => a.title).join(" ")).toLowerCase();
    const m = [[/bbq|barbecue|smok|brisket/, "🍖"], [/pizza/, "🍕"], [/taco|mexican|burrito/, "🌮"], [/burger/, "🍔"], [/seafood|fish|crab|lobster|oyster/, "🦞"], [/breakfast|diner|pancake|brunch/, "🥞"], [/sandwich|deli|pastrami/, "🥪"], [/chicken|wing/, "🍗"], [/donut|bak|dessert|pie|sweet/, "🥧"], [/asian|ramen|noodle|thai|vietnam|sushi|chinese/, "🍜"], [/italian|pasta/, "🍝"], [/hot dog/, "🌭"]];
    for (const [re, e] of m) if (re.test(t)) return e;
    return "🍽️";
  };
  const km = (a, b, c, d) => { const R = 6371, p = Math.PI / 180, x = Math.sin(((c - a) * p) / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin(((d - b) * p) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
  const mi = (k) => k * 0.621371;
  const lastSeason = (r) => Math.max(...r.appearances.map((a) => a.season));
  const fmtTime = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const fmtDay = (d) => d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

  async function getJSON(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`${r.status} ${url.split("?")[0]}`);
    return r.json();
  }

  // ---------- data
  async function load() {
    const d = await getJSON("data/restaurants.json");
    state.all = d.restaurants;
    state.meta = d.meta;
    state.all.forEach((r) => state.byId.set(r.id, r));
    const upd = new Date(d.meta.generated);
    $("#metaLine").textContent = `${d.meta.count.toLocaleString()} spots · ${d.meta.open} verified open · updated ${upd.toLocaleDateString()}`;
    $("#toList").innerHTML = state.all.filter((r) => r.lat).map((r) => `<option value="${esc(`${r.name} — ${r.city}, ${r.state}`)}">`).join("");
    renderStates();
    renderRecipes();
    if (location.hash.startsWith("#r=")) openDetail(decodeURIComponent(location.hash.slice(3)));
  }

  // ---------- STATES TAB
  function filtered(list) {
    const q = state.q.trim().toLowerCase();
    let out = list.filter(visible);
    if (q) out = out.filter((r) => `${r.name} ${r.city} ${regionName(r.state)} ${r.cats.join(" ")} ${r.appearances.map((a) => a.title).join(" ")}`.toLowerCase().includes(q));
    const s = state.sort;
    out.sort((a, b) => {
      if (s === "rating") return (b.rating ?? -1) - (a.rating ?? -1) || (b.reviews ?? 0) - (a.reviews ?? 0) || a.name.localeCompare(b.name);
      if (s === "newest") return lastSeason(b) - lastSeason(a) || a.name.localeCompare(b.name);
      if (s === "distance" && state.me) return (a._d ?? 1e9) - (b._d ?? 1e9);
      return a.name.localeCompare(b.name);
    });
    return out;
  }

  function renderStates() {
    const searching = state.q.trim().length > 0;
    const inRegion = state.region != null;
    $("#stateGrid").hidden = inRegion || searching || state.sort === "distance";
    $("#stateHeader").hidden = !inRegion;
    if (!inRegion && !searching && state.sort !== "distance") {
      const counts = new Map();
      state.all.filter(visible).forEach((r) => {
        const k = regionKey(r);
        const c = counts.get(k) || { n: 0, open: 0, intl: r.country !== "USA" };
        c.n++; if (r.status === "open") c.open++;
        counts.set(k, c);
      });
      const us = [...counts].filter(([, c]) => !c.intl).sort((a, b) => regionName(a[0]).localeCompare(regionName(b[0])));
      const intl = [...counts].filter(([, c]) => c.intl).sort((a, b) => a[0].localeCompare(b[0]));
      const tile = ([k, c]) => `<button class="stateTile" data-region="${esc(k)}"><span class="abbr">${esc(STATE_NAMES[k] ? k : "🌎")}</span><b>${esc(regionName(k))}</b><small>${c.n} spots${c.open ? ` · ${c.open} open` : ""}</small></button>`;
      $("#stateGrid").innerHTML = `<p class="groupLabel">United States</p>${us.map(tile).join("")}${intl.length ? `<p class="groupLabel">Canada &amp; international</p>${intl.map(tile).join("")}` : ""}`;
      $("#list").innerHTML = "";
      return;
    }
    let src = inRegion ? state.all.filter((r) => regionKey(r) === state.region) : state.all;
    const rows = filtered(src);
    if (inRegion) { $("#stateTitle").textContent = regionName(state.region); $("#stateCount").textContent = `${rows.length} spots`; }
    renderList($("#list"), rows);
  }

  function itemHTML(r) {
    const thumb = r.img ? `style="background-image:url('${esc(r.img)}')"` : "";
    const dist = state.me && r._d != null ? ` · ${Math.round(mi(r._d))} mi` : "";
    return `<li class="item" data-id="${esc(r.id)}">
      <div class="thumb" ${thumb}>${r.img ? "" : emojiFor(r)}</div>
      <div class="body"><h3>${esc(r.name)}</h3>
        <div class="sub">${esc(r.city)}, ${esc(r.state)}${dist} · S${lastSeason(r)}</div>
        <div class="meta"><span class="badge ${r.status}">${statusLabel(r)}</span>${stars(r.rating)}${r.reviews ? `<span class="muted">(${r.reviews.toLocaleString()})</span>` : ""}${r.price ? `<span class="muted">${esc(r.price)}</span>` : ""}${r.recipes.length ? "<span>🍳</span>" : ""}</div>
      </div></li>`;
  }

  function renderList(el, rows, more = true) {
    if (!rows.length) { el.innerHTML = `<li class="empty">No matches. ${state.openOnly ? "Try switching off “Open only.”" : ""}</li>`; return; }
    const n = more ? state.shown : rows.length;
    el.innerHTML = rows.slice(0, n).map(itemHTML).join("") + (rows.length > n ? `<li><button class="more" data-more>Show ${Math.min(60, rows.length - n)} more of ${rows.length - n}</button></li>` : "");
  }

  // ---------- RECIPES TAB
  function renderRecipes() {
    const q = $("#rq").value.trim().toLowerCase();
    const withR = state.all.filter((r) => r.recipes.length && visible(r));
    $("#recipeNote").innerHTML = withR.length
      ? `${withR.length} Triple D spots have shared recipes on Food Network.`
      : `Recipe links fill in as the nightly data job matches Food Network recipes to restaurants. Meanwhile, search any spot below to look up its recipes on Food Network.`;
    let rows = withR;
    if (q) rows = state.all.filter(visible).filter((r) => `${r.name} ${r.city} ${r.recipes.map((x) => x.title).join(" ")}`.toLowerCase().includes(q)).sort((a, b) => b.recipes.length - a.recipes.length);
    if (!rows.length && !q) { $("#recipeList").innerHTML = ""; return; }
    $("#recipeList").innerHTML = rows.slice(0, 80).map((r) => `<li class="item" data-id="${esc(r.id)}" style="flex-direction:column;align-items:stretch">
      <div style="display:flex;gap:12px;align-items:center"><div class="thumb">${emojiFor(r)}</div><div class="body"><h3>${esc(r.name)}</h3><div class="sub">${esc(r.city)}, ${esc(r.state)}</div></div><span class="badge ${r.status}">${statusLabel(r)}</span></div>
      ${r.recipes.length ? r.recipes.map((x) => `<a class="recipe" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}<span>↗</span></a>`).join("") : `<a class="recipe" href="${fnSearch(r)}" target="_blank" rel="noopener">Search Food Network for recipes<span>↗</span></a>`}
    </li>`).join("") || `<li class="empty">No recipes match “${esc(q)}”.</li>`;
  }
  const fnSearch = (r) => `https://www.foodnetwork.com/search/${encodeURIComponent(r.name.replace(/[^A-Za-z0-9 ]/g, "").trim().toLowerCase().replace(/\s+/g, "-"))}-`;

  // ---------- DETAIL SHEET
  function openDetail(id) {
    const r = state.byId.get(id);
    if (!r) return;
    history.replaceState(null, "", `#r=${encodeURIComponent(id)}`);
    const dest = r.addr ? `${r.name}, ${r.addr}` : `${r.name}, ${r.city}, ${r.state}`;
    const facts = [...r.facts];
    if (r.cats.length) facts.push(`Google lists it as a ${r.cats[0].toLowerCase()}.`);
    if (r.reviews > 1000) facts.push(`Over ${Math.floor(r.reviews / 1000).toLocaleString()},000 Google reviews — the Flavortown effect is real.`);
    if (r.note) facts.push(`Heads up: ${r.note}.`);
    const statusLine = r.status === "open" ? `Open per Google (checked ${r.checked})` : r.status === "closed" ? (r.statusSource === "google" ? `${r.statusDetail || "Closed"} per Google (checked ${r.checked})` : "Marked closed on the episode list") : "Not verified yet — call ahead";
    $("#sheetContent").innerHTML = `
      <div class="hero" ${r.img ? `style="background-image:url('${esc(r.img)}')"` : ""}>${r.img ? "" : emojiFor(r)}</div>
      <h2>${esc(r.name)}</h2>
      <div class="muted">${esc(r.addr || `${r.city}, ${regionName(r.state)}`)}</div>
      <div class="meta" style="margin-top:8px;display:flex;gap:8px;align-items:center"><span class="badge ${r.status}">${statusLabel(r)}</span><span class="muted" style="font-size:13px">${statusLine}</span></div>
      <div class="statRow">
        <div class="stat"><b>${r.rating != null ? "★ " + r.rating.toFixed(1) : "—"}</b><small>Google rating</small></div>
        <div class="stat"><b>${r.reviews != null ? r.reviews.toLocaleString() : "—"}</b><small>reviews</small></div>
        <div class="stat"><b>${esc(r.price || "—")}</b><small>price</small></div>
      </div>
      <div class="actions">
        <button class="btn primary" data-trip="${esc(r.id)}">🚗 Route weather to here</button>
        <a class="btn" href="https://maps.apple.com/?daddr=${encodeURIComponent(dest)}" target="_blank" rel="noopener">Apple Maps</a>
        <a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}" target="_blank" rel="noopener">Directions (Google)</a>
        ${r.phone ? `<a class="btn" href="tel:${esc(r.phone.replace(/[^0-9+]/g, ""))}">📞 Call</a>` : ""}
        <a class="btn" href="${esc(r.maps || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name + " " + r.city + " " + r.state)}`)}" target="_blank" rel="noopener">Reviews &amp; hours</a>
        ${r.web ? `<a class="btn" href="${esc(r.web)}" target="_blank" rel="noopener">Website</a>` : ""}
      </div>
      <div class="card"><h4>Fun facts</h4><ul class="facts">${facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>
      <div class="card"><h4>On the show</h4>${r.appearances.map((a) => `<div class="ep"><b>S${a.season} · E${esc(a.episode)}</b> — ${esc(a.title)}<div class="muted">${esc(a.airdate)}</div></div>`).join("")}</div>
      <div class="card"><h4>Recipes</h4>${r.recipes.length ? r.recipes.map((x) => `<a class="recipe" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}<span>↗</span></a>`).join("") : `<a class="recipe" href="${fnSearch(r)}" target="_blank" rel="noopener">Search Food Network<span>↗</span></a>`}</div>
      <p class="foot">Episode data: Wikipedia (CC BY-SA). Ratings &amp; status: Google. Always call ahead — hours change.</p>`;
    $("#sheet").hidden = false;
    $(".sheetBody").scrollTop = 0;
  }
  function closeDetail() { $("#sheet").hidden = true; history.replaceState(null, "", location.pathname); }

  // ---------- MAP TAB
  function renderMap() {
    if (!window.L) { $("#map").innerHTML = `<p class="empty">Map couldn't load — check your connection.</p>`; return; }
    if (!state.map) {
      state.map = L.map("map", { zoomControl: false }).setView([39.5, -98.35], 4);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, className: "darkTiles", attribution: "© OpenStreetMap" }).addTo(state.map);
    }
    if (state.mapLayer) state.mapLayer.remove();
    state.mapLayer = L.layerGroup();
    state.all.filter(visible).filter((r) => r.lat != null).forEach((r) => {
      const jitter = r.exact ? 0 : (hash(r.id) % 1000) / 1000 * 0.03 - 0.015;
      L.marker([r.lat + jitter, r.lon - jitter], { icon: L.divIcon({ className: "", html: `<div class="pin ${r.status}"></div>`, iconSize: [10, 10] }) })
        .bindPopup(`<b>${esc(r.name)}</b><br>${esc(r.city)}, ${esc(r.state)}<br>${r.rating ? "★ " + r.rating : ""} <a href="#" data-open="${esc(r.id)}">Details</a>`)
        .addTo(state.mapLayer);
    });
    state.mapLayer.addTo(state.map);
    setTimeout(() => state.map.invalidateSize(), 50);
  }
  const hash = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };

  // ---------- TRIP TAB
  const WX = { 0: ["☀️", "Clear"], 1: ["🌤️", "Mostly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Overcast"], 45: ["🌫️", "Fog"], 48: ["🌫️", "Freezing fog"], 51: ["🌦️", "Light drizzle"], 53: ["🌦️", "Drizzle"], 55: ["🌧️", "Heavy drizzle"], 56: ["🧊", "Freezing drizzle"], 57: ["🧊", "Freezing drizzle"], 61: ["🌧️", "Light rain"], 63: ["🌧️", "Rain"], 65: ["🌧️", "Heavy rain"], 66: ["🧊", "Freezing rain"], 67: ["🧊", "Freezing rain"], 71: ["🌨️", "Light snow"], 73: ["🌨️", "Snow"], 75: ["❄️", "Heavy snow"], 77: ["🌨️", "Snow grains"], 80: ["🌦️", "Showers"], 81: ["🌧️", "Heavy showers"], 82: ["⛈️", "Violent showers"], 85: ["🌨️", "Snow showers"], 86: ["❄️", "Heavy snow showers"], 95: ["⛈️", "Thunderstorms"], 96: ["⛈️", "Storms w/ hail"], 99: ["⛈️", "Severe storms"] };
  const wx = (c) => WX[c] || ["🌡️", "—"];
  const SEVERITY = (c) => (c >= 95 ? 9 : [66, 67, 56, 57].includes(c) ? 8 : [75, 86].includes(c) ? 7 : [65, 82, 81].includes(c) ? 6 : [71, 73, 77, 85].includes(c) ? 5 : [61, 63, 80].includes(c) ? 4 : [45, 48].includes(c) ? 3 : [51, 53, 55].includes(c) ? 2 : c);

  async function geocodeText(q) {
    const m = q.match(/^\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)\s*$/);
    if (m) return { lat: +m[1], lon: +m[3], label: "Your location" };
    try {
      const n = await getJSON(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us,ca,mx&q=${encodeURIComponent(q)}`);
      if (n[0]) return { lat: +n[0].lat, lon: +n[0].lon, label: n[0].display_name.split(",").slice(0, 2).join(",") };
    } catch (_) {}
    const o = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(q.split(",")[0])}`);
    if (o.results?.[0]) return { lat: o.results[0].latitude, lon: o.results[0].longitude, label: `${o.results[0].name}, ${o.results[0].admin1 || ""}` };
    throw new Error(`Couldn't find “${q}”`);
  }

  function pip(lon, lat, geom) {
    const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
    for (const poly of polys) {
      let inside = false;
      const ring = poly[0];
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) {
        let hole = false;
        for (const h of poly.slice(1)) { let ins = false; for (let i = 0, j = h.length - 1; i < h.length; j = i++) { const [xi, yi] = h[i], [xj, yj] = h[j]; if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) ins = !ins; } if (ins) hole = true; }
        if (!hole) return true;
      }
    }
    return false;
  }
  async function stateAt(lon, lat) {
    if (!state.statesGeo) state.statesGeo = await getJSON("data/states.geojson");
    let best = null, bestD = 1e9;
    for (const f of state.statesGeo.features) if (pip(lon, lat, f.geometry)) return f.properties.name;
    // near a border/coast — snap to nearest state's vertex within ~15 km
    for (const f of state.statesGeo.features) {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const p of polys) for (let i = 0; i < p[0].length; i += 3) { const d = km(lat, lon, p[0][i][1], p[0][i][0]); if (d < bestD) { bestD = d; best = f.properties.name; } }
    }
    return bestD < 15 ? best : "Outside U.S.";
  }

  async function planTrip() {
    const out = $("#tripOut");
    const fromQ = $("#fromInput").value.trim(), toQ = $("#toInput").value.trim();
    const dest = state.all.find((r) => `${r.name} — ${r.city}, ${r.state}` === toQ) || state.all.find((r) => r.lat && r.name.toLowerCase() === toQ.toLowerCase());
    if (!fromQ) return (out.innerHTML = `<div class="alert">Enter where you're starting from (or tap 📍).</div>`);
    if (!dest) return (out.innerHTML = `<div class="alert">Pick a restaurant from the suggestions, or tap “Route weather to here” on any spot.</div>`);
    out.innerHTML = `<div class="spinner"></div><p class="muted" style="text-align:center">Mapping the drive and checking the skies…</p>`;
    try {
      const from = await geocodeText(fromQ);
      const depart = $("#departAt").value ? new Date($("#departAt").value) : new Date();
      const path = `${from.lon},${from.lat};${dest.lon},${dest.lat}?overview=full&geometries=geojson&annotations=duration,distance`;
      let route;
      for (const base of ["https://routing.openstreetmap.de/routed-car/route/v1/driving/", "https://router.project-osrm.org/route/v1/driving/"]) {
        try { route = await getJSON(base + path); if (route.routes?.length) break; } catch (_) {}
      }
      if (!route) throw new Error("routing service is busy");
      if (!route.routes?.length) throw new Error("No driving route found.");
      const rt = route.routes[0], coords = rt.geometry.coordinates, ann = rt.legs[0].annotation;
      // cumulative distance & time per vertex
      const cumD = [0], cumT = [0];
      for (let i = 0; i < ann.distance.length; i++) { cumD.push(cumD[i] + ann.distance[i]); cumT.push(cumT[i] + ann.duration[i]); }
      const totalKm = rt.distance / 1000;
      const step = Math.max(64, totalKm / 60) * 1000; // ~every 40 miles, max 60 checkpoints
      const pts = [];
      for (let target = 0, i = 0; target <= rt.distance; target += step) {
        while (i < cumD.length - 1 && cumD[i] < target) i++;
        pts.push({ lon: coords[i][0], lat: coords[i][1], km: cumD[i] / 1000, t: new Date(depart.getTime() + cumT[i] * 1000) });
      }
      const last = coords.length - 1;
      pts.push({ lon: coords[last][0], lat: coords[last][1], km: totalKm, t: new Date(depart.getTime() + rt.duration * 1000), end: true });
      for (const p of pts) p.state = await stateAt(p.lon, p.lat);

      const arrival = pts[pts.length - 1].t;
      const tooFar = (arrival - Date.now()) / 864e5 > 15.5;
      if (!tooFar) {
        for (let b = 0; b < pts.length; b += 50) {
          const chunk = pts.slice(b, b + 50);
          const url = `https://api.open-meteo.com/v1/forecast?latitude=${chunk.map((p) => p.lat.toFixed(3)).join(",")}&longitude=${chunk.map((p) => p.lon.toFixed(3)).join(",")}&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=GMT&forecast_days=16`;
          let res = await getJSON(url);
          if (!Array.isArray(res)) res = [res];
          chunk.forEach((p, k) => {
            const h = res[k].hourly, t0 = Date.parse(h.time[0] + "Z");
            const idx = Math.min(h.time.length - 1, Math.max(0, Math.round((p.t - t0) / 36e5)));
            p.temp = h.temperature_2m[idx]; p.pop = h.precipitation_probability[idx]; p.code = h.weather_code[idx]; p.wind = h.wind_speed_10m[idx];
          });
        }
      }
      // group by state in driving order
      const groups = [];
      pts.forEach((p, i) => {
        const segKm = i < pts.length - 1 ? pts[i + 1].km - p.km : 0;
        let g = groups.find((x) => x.state === p.state);
        if (!g) { g = { state: p.state, pts: [], km: 0 }; groups.push(g); }
        g.pts.push(p); g.km += segKm;
      });
      renderTrip(from, dest, rt, pts, groups, tooFar, depart);
    } catch (e) {
      out.innerHTML = `<div class="alert">Trip planning hit a pothole: ${esc(e.message)}. Try again in a moment.</div>`;
    }
  }

  function renderTrip(from, dest, rt, pts, groups, tooFar, depart) {
    const hrs = rt.duration / 3600;
    const arrival = new Date(depart.getTime() + rt.duration * 1000);
    const worst = pts.filter((p) => p.code != null).sort((a, b) => SEVERITY(b.code) - SEVERITY(a.code))[0];
    const html = [`
      <div id="tripMap"></div>
      <div class="summary">
        <div class="stat"><b>${Math.round(mi(rt.distance / 1000)).toLocaleString()} mi</b><small>distance</small></div>
        <div class="stat"><b>${Math.floor(hrs)}h ${Math.round((hrs % 1) * 60)}m</b><small>drive time</small></div>
        <div class="stat"><b>${fmtTime(arrival)}</b><small>arrive ${fmtDay(arrival)}</small></div>
      </div>`];
    if (hrs > 10) html.push(`<div class="alert">That's a ${Math.round(hrs)}-hour haul. Times assume nonstop driving — add time for stops and sleep.</div>`);
    if (tooFar) html.push(`<div class="alert">Forecasts only reach ~16 days out. Pick an earlier departure to see the weather.</div>`);
    else if (worst && SEVERITY(worst.code) >= 4) html.push(`<div class="alert">${wx(worst.code)[0]} Watch for <b>${wx(worst.code)[1].toLowerCase()}</b> near ${esc(worst.state)} around ${fmtTime(worst.t)}.</div>`);
    groups.forEach((g, gi) => {
      const temps = g.pts.map((p) => p.temp).filter((x) => x != null);
      const w = g.pts.filter((p) => p.code != null).sort((a, b) => SEVERITY(b.code) - SEVERITY(a.code))[0];
      const pop = Math.max(0, ...g.pts.map((p) => p.pop ?? 0));
      html.push(`<details class="stateWx" ${gi === 0 ? "open" : ""}><summary>
        <span class="big">${w ? wx(w.code)[0] : "🛣️"}</span>
        <div><div class="sname">${esc(g.state)}</div><div class="muted" style="font-size:13px">${Math.round(mi(g.km))} mi · ${fmtTime(g.pts[0].t)}–${fmtTime(g.pts[g.pts.length - 1].t)}</div></div>
        <div class="srange">${temps.length ? `<b>${Math.round(Math.min(...temps))}°–${Math.round(Math.max(...temps))}°F</b><br>${w ? wx(w.code)[1] : ""} · ${pop}% rain` : "—"}</div>
      </summary>
      ${g.pts.map((p) => `<div class="wxRow"><span class="muted">${fmtTime(p.t)}</span><span>${p.code != null ? wx(p.code)[0] : ""}</span><span>${p.end ? "🔥 " + esc(dest.name) : `Mile ${Math.round(mi(p.km))}`}</span><span>${p.temp != null ? `${Math.round(p.temp)}° · ${p.pop}% · ${Math.round(p.wind)} mph` : ""}</span></div>`).join("")}
      </details>`);
    });
    html.push(`<div class="actions"><a class="btn primary" href="https://maps.apple.com/?saddr=${from.lat},${from.lon}&daddr=${encodeURIComponent(dest.addr ? dest.name + ", " + dest.addr : dest.name + ", " + dest.city + ", " + dest.state)}" target="_blank" rel="noopener">Start driving in Apple Maps</a></div>
      <p class="foot">Route: OSRM / OpenStreetMap · Weather: Open-Meteo. Forecast is for when you'll be at each checkpoint.</p>`);
    $("#tripOut").innerHTML = html.join("");
    if (window.L) {
      const m = L.map("tripMap", { zoomControl: false, attributionControl: false });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { className: "darkTiles" }).addTo(m);
      const line = L.polyline(rt.geometry.coordinates.map(([x, y]) => [y, x]), { color: "#ff5a1f", weight: 4 }).addTo(m);
      const every = Math.max(1, Math.ceil(pts.length / 12));
      pts.forEach((p, i) => p.code != null && (i % every === 0 || p.end) && L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "", html: `<div style="font-size:18px">${wx(p.code)[0]}</div>`, iconSize: [20, 20] }) }).addTo(m));
      m.fitBounds(line.getBounds(), { padding: [20, 20] });
    }
  }

  // ---------- nav & events
  function show(view) {
    $$(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
    if (view === "map") renderMap();
    window.scrollTo(0, 0);
  }

  function locate() {
    return new Promise((ok, no) => navigator.geolocation ? navigator.geolocation.getCurrentPosition((p) => ok(p.coords), no, { enableHighAccuracy: false, timeout: 12000 }) : no(new Error("No GPS")));
  }

  function init() {
    const now = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4);
    $("#departAt").value = now.toISOString().slice(0, 16);
    $$(".tabs button").forEach((b) => b.addEventListener("click", () => show(b.dataset.view)));
    $("#openOnly").addEventListener("change", (e) => { state.openOnly = e.target.checked; state.shown = 60; renderStates(); renderRecipes(); if (state.map) renderMap(); });
    $("#q").addEventListener("input", (e) => { state.q = e.target.value; state.shown = 60; renderStates(); });
    $("#rq").addEventListener("input", renderRecipes);
    $("#sortChips").addEventListener("click", (e) => {
      const b = e.target.closest(".chip"); if (!b) return;
      state.sort = b.dataset.sort; $$(".chip").forEach((c) => c.classList.toggle("on", c === b)); state.shown = 60; renderStates();
    });
    $("#nearMe").addEventListener("click", async () => {
      try {
        const c = await locate();
        state.me = c; state.all.forEach((r) => (r._d = r.lat != null ? km(c.latitude, c.longitude, r.lat, r.lon) : null));
        $("#distChip").hidden = false; $("#distChip").click();
      } catch (_) { alert("Couldn't get your location. Allow location access for this site in Settings → Safari."); }
    });
    $("#stateGrid").addEventListener("click", (e) => { const t = e.target.closest("[data-region]"); if (!t) return; state.region = t.dataset.region; state.shown = 60; renderStates(); window.scrollTo(0, 0); });
    $("#backStates").addEventListener("click", () => { state.region = null; renderStates(); });
    document.addEventListener("click", (e) => {
      const more = e.target.closest("[data-more]"); if (more) { state.shown += 60; renderStates(); return; }
      const open = e.target.closest("[data-open]"); if (open) { e.preventDefault(); openDetail(open.dataset.open); return; }
      if (e.target.closest("[data-close]")) { closeDetail(); return; }
      const trip = e.target.closest("[data-trip]");
      if (trip) { const r = state.byId.get(trip.dataset.trip); $("#toInput").value = `${r.name} — ${r.city}, ${r.state}`; closeDetail(); show("trip"); if ($("#fromInput").value) planTrip(); else $("#fromInput").focus(); return; }
      const item = e.target.closest(".item[data-id]"); if (item && !e.target.closest("a")) openDetail(item.dataset.id);
    });
    $("#fromGps").addEventListener("click", async () => {
      $("#fromInput").value = "Locating…";
      try { const c = await locate(); $("#fromInput").value = `${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)}`; } catch (_) { $("#fromInput").value = ""; alert("Couldn't get your location."); }
    });
    $("#goTrip").addEventListener("click", planTrip);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
    load().catch((e) => { $("#metaLine").textContent = "Couldn't load data: " + e.message; });
  }
  init();
})();
