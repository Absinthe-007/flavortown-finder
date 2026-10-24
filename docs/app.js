/* Flavortown Finder — vanilla JS, no build step. */
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const STATE_NAMES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "Washington, D.C.", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico" };

  const state = { all: [], meta: {}, byId: new Map(), openOnly: true, sort: "name", q: "", region: null, me: null, shown: 60, map: null, mapLayer: null, statesGeo: null };

  // ---------- helpers
  const regionKey = (r) => (r.country === "USA" ? r.state : r.country === "Canada" ? `${r.state}, Canada` : r.country);
  const regionName = (k) => STATE_NAMES[k] || k;
  const visible = (r) => !state.openOnly || r.status !== "closed";
  const statusLabel = (r) => (r.status === "open" ? "Open" : r.status === "closed" ? "Closed" : "Likely open");
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
    $("#metaLine").textContent = `${d.meta.count.toLocaleString()} spots · ${d.meta.closed} marked closed · updated ${upd.toLocaleDateString()}`;
    $("#toList").innerHTML = state.all.filter((r) => r.lat && visible(r)).map((r) => `<option value="${esc(`${r.name} — ${r.city}, ${r.state}`)}">`).join("");
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
    if (r.note) facts.push(`Heads up: ${r.note}.`);
    const statusLine = r.status === "closed" ? "Marked closed on the episode list" : "Not marked closed on the episode list — call ahead";
    const q = encodeURIComponent(`${r.name} ${r.city} ${r.state}`);
    $("#sheetContent").innerHTML = `
      <div class="hero" ${r.img ? `style="background-image:url('${esc(r.img)}')"` : ""}>${r.img ? "" : emojiFor(r)}</div>
      <h2>${esc(r.name)}</h2>
      <div class="muted">${esc(r.addr || `${r.city}, ${regionName(r.state)}`)}</div>
      <div class="meta" style="margin-top:8px;display:flex;gap:8px;align-items:center"><span class="badge ${r.status}">${statusLabel(r)}</span><span class="muted" style="font-size:13px">${statusLine}</span></div>
      <div class="actions">
        <button class="btn primary" data-trip="${esc(r.id)}">🚗 Plan a trip here</button>
        <button class="btn" style="grid-column:1/-1" data-asstop="${esc(r.id)}">＋ Add as a stop on my trip</button>
        <a class="btn" href="https://maps.apple.com/?daddr=${encodeURIComponent(dest)}" target="_blank" rel="noopener">Apple Maps</a>
        <a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}" target="_blank" rel="noopener">Directions (Google)</a>
        ${r.phone ? `<a class="btn" href="tel:${esc(r.phone.replace(/[^0-9+]/g, ""))}">📞 Call</a>` : ""}
        <a class="btn" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">⭐ Google reviews</a>
        <a class="btn" href="https://www.yelp.com/search?find_desc=${encodeURIComponent(r.name)}&find_loc=${encodeURIComponent(r.city + ", " + r.state)}" target="_blank" rel="noopener">⭐ Yelp reviews</a>
      </div>
      <div class="card"><h4>Fun facts</h4><ul class="facts">${facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>
      <div class="card"><h4>On the show</h4>${r.appearances.map((a) => `<div class="ep"><b>S${a.season} · E${esc(a.episode)}</b> — ${esc(a.title)}<div class="muted">${esc(a.airdate)}</div></div>`).join("")}</div>
      <div class="card"><h4>Recipes</h4>${r.recipes.length ? r.recipes.map((x) => `<a class="recipe" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}<span>↗</span></a>`).join("") : `<a class="recipe" href="${fnSearch(r)}" target="_blank" rel="noopener">Search Food Network<span>↗</span></a>`}</div>
      <p class="foot">Episode data: Wikipedia (CC BY-SA). Closed tags: Wikipedia episode list. Always call ahead — hours change.</p>`;
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

  // ---- multi-stop helpers
  const dddLabel = (r) => `${r.name} — ${r.city}, ${r.state}`;
  const findDDD = (txt) => state.all.find((r) => r.lat != null && dddLabel(r) === txt.trim());

  function stopInputs() { return $$("#stops input"); }
  function renderStopRows(values) {
    $("#stops").innerHTML = values.map((v, i) => `<div class="stopRow" data-i="${i}">
      <span class="num">${i + 1}</span>
      <input value="${esc(v)}" placeholder="Stop ${i + 1}: Triple D spot or any place" list="toList" autocomplete="off">
      <button type="button" data-move="-1" title="Move up" ${i === 0 ? "disabled" : ""}>↑</button>
      <button type="button" data-move="1" title="Move down" ${i === values.length - 1 ? "disabled" : ""}>↓</button>
      <button type="button" data-remove title="Remove">✕</button></div>`).join("");
  }
  const stopValues = () => stopInputs().map((i) => i.value);
  function addStop(value = "", index = null) {
    const v = stopValues();
    if (index == null || index > v.length) v.push(value); else v.splice(index, 0, value);
    renderStopRows(v);
    if (!value) stopInputs()[index ?? v.length - 1]?.focus();
  }

  async function resolvePlace(txt) {
    const r = findDDD(txt);
    if (r) return { lat: r.lat, lon: r.lon, label: r.name, ddd: r };
    const g = await geocodeText(txt);
    return { ...g, label: g.label || txt };
  }

  async function osrm(points) {
    const path = points.map((p) => `${p.lon},${p.lat}`).join(";") + "?overview=full&geometries=geojson&annotations=duration,distance";
    for (const base of ["https://routing.openstreetmap.de/routed-car/route/v1/driving/", "https://router.project-osrm.org/route/v1/driving/"]) {
      try { const r = await getJSON(base + path); if (r.routes?.length) return r.routes[0]; } catch (_) {}
    }
    throw new Error("the routing service is busy or couldn't find a driving route");
  }

  // fast planar distance (km) good enough for "within N miles of the route"
  const flatKm = (lat1, lon1, lat2, lon2) => { const x = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180), y = lat2 - lat1; return Math.sqrt(x * x + y * y) * 111.195; };

  function dddAlongRoute(coords, cumD, radiusKm, exclude) {
    // decimate route to ~2 km spacing
    const pts = [];
    for (let i = 0, last = -1e9; i < coords.length; i++) if (cumD[i] - last >= 2000 || i === coords.length - 1) { pts.push([coords[i][1], coords[i][0], cumD[i], i]); last = cumD[i]; }
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    for (const [la, lo] of pts) { minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la); minLon = Math.min(minLon, lo); maxLon = Math.max(maxLon, lo); }
    const pad = radiusKm / 80;
    const out = [];
    for (const r of state.all) {
      if (r.lat == null || !visible(r) || exclude.has(r.id)) continue;
      if (r.lat < minLat - pad || r.lat > maxLat + pad || r.lon < minLon - pad * 1.6 || r.lon > maxLon + pad * 1.6) continue;
      let best = 1e9, at = null;
      for (const p of pts) { const d = flatKm(r.lat, r.lon, p[0], p[1]); if (d < best) { best = d; at = p; } }
      if (best <= radiusKm) out.push({ r, offKm: best, routeM: at[2], vtx: at[3] });
    }
    return out.sort((a, b) => a.routeM - b.routeM);
  }

  async function planTrip() {
    const out = $("#tripOut");
    const fromQ = $("#fromInput").value.trim(), toQ = $("#toInput").value.trim();
    const stopsQ = stopValues().map((v) => v.trim()).filter(Boolean);
    if (!fromQ) return (out.innerHTML = `<div class="alert">Enter where you're starting from (or tap 📍).</div>`);
    if (!toQ) return (out.innerHTML = `<div class="alert">Enter a destination — any Triple D spot, city, or address.</div>`);
    out.innerHTML = `<div class="spinner"></div><p class="muted" style="text-align:center">Mapping ${stopsQ.length ? stopsQ.length + 2 + " stops" : "the drive"} and checking the skies…</p>`;
    try {
      const wps = [];
      for (const q of [fromQ, ...stopsQ, toQ]) wps.push(await resolvePlace(q));
      if (wps.length > 25) throw new Error("that's more than 23 stops");
      const depart = $("#departAt").value ? new Date($("#departAt").value) : new Date();
      const dwellS = (+$("#dwell").value || 0) * 60;
      const radiusKm = (+$("#radius").value || 25) * 1.609;
      const rt = await osrm(wps);
      const coords = rt.geometry.coordinates;

      // cumulative distance/time per vertex, adding dwell time after each intermediate stop
      const ann = { distance: [], duration: [] };
      const legEndVertex = [];
      rt.legs.forEach((leg) => { ann.distance.push(...leg.annotation.distance); ann.duration.push(...leg.annotation.duration); legEndVertex.push(ann.distance.length); });
      const n = Math.min(coords.length - 1, ann.distance.length);
      const cumD = [0], cumT = [0];
      let li = 0;
      for (let i = 0; i < n; i++) {
        let t = cumT[i] + ann.duration[i];
        cumD.push(cumD[i] + ann.distance[i]);
        if (li < legEndVertex.length - 1 && i + 1 === legEndVertex[li]) { t += dwellS; li++; }
        cumT.push(t);
      }
      while (cumD.length < coords.length) { cumD.push(cumD[cumD.length - 1]); cumT.push(cumT[cumT.length - 1]); }
      const totalM = cumD[cumD.length - 1];
      const totalDwell = dwellS * Math.max(0, wps.length - 2);

      // waypoint timeline
      const itin = wps.map((w, i) => {
        const v = i === 0 ? 0 : Math.min(legEndVertex[i - 1], coords.length - 1);
        const arrive = new Date(depart.getTime() + (cumT[v] - (i > 0 && i < wps.length - 1 ? dwellS : 0)) * 1000);
        return { ...w, kind: i === 0 ? "s" : i === wps.length - 1 ? "e" : "m", n: i, km: cumD[v] / 1000, arrive, leave: new Date(arrive.getTime() + (i > 0 && i < wps.length - 1 ? dwellS * 1000 : 0)), vtx: v };
      });

      // weather checkpoints ~ every 40 mi, plus every stop
      const step = Math.max(64000, totalM / 55);
      const pts = [];
      for (let target = 0, i = 0; target <= totalM; target += step) {
        while (i < cumD.length - 1 && cumD[i] < target) i++;
        pts.push({ lon: coords[i][0], lat: coords[i][1], km: cumD[i] / 1000, t: new Date(depart.getTime() + cumT[i] * 1000) });
      }
      itin.slice(1).forEach((w) => pts.push({ lon: w.lon, lat: w.lat, km: w.km, t: w.arrive, stop: w.label, end: w.kind === "e", n: w.n }));
      pts.sort((a, b) => a.km - b.km || (a.stop ? 1 : -1));
      for (const p of pts) p.state = await stateAt(p.lon, p.lat);

      const tooFar = (pts[pts.length - 1].t - Date.now()) / 864e5 > 15.5;
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
      const groups = [];
      pts.forEach((p, i) => {
        const segKm = i < pts.length - 1 ? pts[i + 1].km - p.km : 0;
        let g = groups.find((x) => x.state === p.state);
        if (!g) { g = { state: p.state, pts: [], km: 0 }; groups.push(g); }
        g.pts.push(p); g.km += segKm;
      });

      const exclude = new Set(wps.filter((w) => w.ddd).map((w) => w.ddd.id));
      const along = dddAlongRoute(coords, cumD, radiusKm, exclude).map((x) => ({ ...x, pass: new Date(depart.getTime() + cumT[x.vtx] * 1000), leg: legEndVertex.findIndex((e) => x.vtx <= e) }));
      state.trip = { wps, itin, legEndVertex };
      renderTrip({ rt, itin, pts, groups, tooFar, depart, totalM, totalDwell, along, radiusMi: +$("#radius").value });
    } catch (e) {
      out.innerHTML = `<div class="alert">Trip planning hit a pothole: ${esc(e.message)}. Check each stop and try again.</div>`;
    }
  }

  function renderTrip({ rt, itin, pts, groups, tooFar, depart, totalM, totalDwell, along, radiusMi }) {
    const driveH = rt.duration / 3600;
    const arrival = itin[itin.length - 1].arrive;
    const worst = pts.filter((p) => p.code != null).sort((a, b) => SEVERITY(b.code) - SEVERITY(a.code))[0];
    const hm = (h) => `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m`;
    const html = [`
      <div id="tripMap"></div>
      <div class="summary">
        <div class="stat"><b>${Math.round(mi(totalM / 1000)).toLocaleString()} mi</b><small>${itin.length - 2 ? itin.length - 2 + " stop" + (itin.length > 3 ? "s" : "") : "nonstop"}</small></div>
        <div class="stat"><b>${hm(driveH)}</b><small>driving${totalDwell ? ` + ${hm(totalDwell / 3600)} stops` : ""}</small></div>
        <div class="stat"><b>${fmtTime(arrival)}</b><small>arrive ${fmtDay(arrival)}</small></div>
      </div>`];
    if (driveH > 10) html.push(`<div class="alert">That's ${Math.round(driveH)} hours behind the wheel. Times don't include sleep — consider an overnight stop.</div>`);
    if (tooFar) html.push(`<div class="alert">Forecasts only reach ~16 days out. Pick an earlier departure to see the weather.</div>`);
    else if (worst && SEVERITY(worst.code) >= 4) html.push(`<div class="alert">${wx(worst.code)[0]} Watch for <b>${wx(worst.code)[1].toLowerCase()}</b> near ${esc(worst.state)} around ${fmtTime(worst.t)}.</div>`);

    // itinerary
    html.push(`<div class="card"><h4>Itinerary</h4><ul class="itin">${itin.map((w) => {
      const p = pts.find((x) => x.n === w.n);
      return `<li><span class="dot ${w.kind}">${w.kind === "s" ? "A" : w.kind === "e" ? "🏁" : w.n}</span>
        <div><b>${esc(w.ddd ? "🔥 " + w.label : w.label)}</b><div class="muted" style="font-size:12px">${w.kind === "s" ? "Start" : `Mile ${Math.round(mi(w.km))}`}${p && p.temp != null ? ` · ${wx(p.code)[0]} ${Math.round(p.temp)}°F` : ""}</div></div>
        <span class="when">${w.kind === "s" ? `Leave ${fmtTime(w.leave)}` : w.kind === "e" ? `Arrive ${fmtTime(w.arrive)}` : `${fmtTime(w.arrive)}–${fmtTime(w.leave)}`}<br>${fmtDay(w.kind === "s" ? w.leave : w.arrive)}</span></li>`;
    }).join("")}</ul></div>`);

    // Triple D on the way
    html.push(`<div class="card"><h4>🔥 Triple D on your route · ${along.length} within ${radiusMi} mi</h4>${along.length ? along.slice(0, 80).map((x, i) => `
      <div class="onRoute" ${i >= 8 ? "hidden" : ""}><div class="thumb" style="width:40px;height:40px;border-radius:10px;background:var(--panel2);display:grid;place-items:center;font-size:20px">${emojiFor(x.r)}</div>
        <div class="body" data-open="${esc(x.r.id)}"><b>${esc(x.r.name)}</b><small>${esc(x.r.city)}, ${esc(x.r.state)} · mile ${Math.round(mi(x.routeM / 1000))} · ${x.offKm < 1.6 ? "right on the way" : `${Math.round(mi(x.offKm))} mi off route`}${x.r.rating ? ` · ★ ${x.r.rating.toFixed(1)}` : ""}</small><br><small>Pass by ~${fmtTime(x.pass)} · <span class="badge ${x.r.status}">${statusLabel(x.r)}</span></small></div>
        <button class="add" data-addstop="${esc(x.r.id)}" data-leg="${x.leg}">＋ Stop</button></div>`).join("") + (along.length > 8 ? `<button class="more" data-showall>Show all ${Math.min(along.length, 80)} spots on the way</button>` : "") + (along.length > 80 ? `<p class="muted">Showing the first 80 — narrow the distance to see fewer.</p>` : "") : `<p class="muted">None within ${radiusMi} miles. Try a wider distance.</p>`}</div>`);

    // weather by state
    groups.forEach((g, gi) => {
      const temps = g.pts.map((p) => p.temp).filter((x) => x != null);
      const w = g.pts.filter((p) => p.code != null).sort((a, b) => SEVERITY(b.code) - SEVERITY(a.code))[0];
      const pop = Math.max(0, ...g.pts.map((p) => p.pop ?? 0));
      html.push(`<details class="stateWx" ${gi === 0 ? "open" : ""}><summary>
        <span class="big">${w ? wx(w.code)[0] : "🛣️"}</span>
        <div><div class="sname">${esc(g.state)}</div><div class="muted" style="font-size:13px">${Math.round(mi(g.km))} mi · ${fmtTime(g.pts[0].t)}–${fmtTime(g.pts[g.pts.length - 1].t)}</div></div>
        <div class="srange">${temps.length ? `<b>${Math.round(Math.min(...temps))}°–${Math.round(Math.max(...temps))}°F</b><br>${w ? wx(w.code)[1] : ""} · ${pop}% rain` : "—"}</div>
      </summary>
      ${g.pts.map((p) => `<div class="wxRow"><span class="muted">${fmtTime(p.t)}</span><span>${p.code != null ? wx(p.code)[0] : ""}</span><span>${p.stop ? (p.end ? "🏁 " : "📍 ") + esc(p.stop) : `Mile ${Math.round(mi(p.km))}`}</span><span>${p.temp != null ? `${Math.round(p.temp)}° · ${p.pop}% · ${Math.round(p.wind)} mph` : ""}</span></div>`).join("")}
      </details>`);
    });

    const enc = (w) => (w.ddd ? `${w.ddd.name}, ${w.ddd.addr || w.ddd.city + ", " + w.ddd.state}` : `${w.lat},${w.lon}`);
    const mids = itin.slice(1, -1);
    const gmaps = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(`${itin[0].lat},${itin[0].lon}`)}&destination=${encodeURIComponent(enc(itin[itin.length - 1]))}${mids.length ? `&waypoints=${encodeURIComponent(mids.map(enc).join("|"))}` : ""}&travelmode=driving`;
    const nextStop = itin[1];
    html.push(`<div class="actions"><a class="btn primary" href="${gmaps}" target="_blank" rel="noopener">Navigate all stops in Google Maps</a>
      <a class="btn" style="grid-column:1/-1" href="https://maps.apple.com/?saddr=${itin[0].lat},${itin[0].lon}&daddr=${encodeURIComponent(enc(nextStop))}" target="_blank" rel="noopener">Apple Maps to ${esc(nextStop.label)}</a></div>
      <p class="foot">Route: OSRM / OpenStreetMap · Weather: Open-Meteo. Forecast is for when you'll be at each checkpoint.</p>`);
    $("#tripOut").innerHTML = html.join("");

    if (window.L) {
      const m = L.map("tripMap", { zoomControl: false, attributionControl: false });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { className: "darkTiles" }).addTo(m);
      const line = L.polyline(rt.geometry.coordinates.map(([x, y]) => [y, x]), { color: "#ff5a1f", weight: 4 }).addTo(m);
      along.slice(0, 150).forEach((x) => L.marker([x.r.lat, x.r.lon], { icon: L.divIcon({ className: "", html: `<div class="dddPin">🔥</div>`, iconSize: [18, 18] }) })
        .bindPopup(`<b>${esc(x.r.name)}</b><br>${esc(x.r.city)}, ${esc(x.r.state)}${x.r.rating ? "<br>★ " + x.r.rating : ""}<br><a href="#" data-open="${esc(x.r.id)}">Details</a> · <a href="#" data-addstop="${esc(x.r.id)}" data-leg="${x.leg}">Add stop</a>`).addTo(m));
      const every = Math.max(1, Math.ceil(pts.length / 10));
      pts.forEach((p, i) => p.code != null && !p.stop && i % every === 0 && L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "", html: `<div style="font-size:16px">${wx(p.code)[0]}</div>`, iconSize: [18, 18] }) }).addTo(m));
      itin.forEach((w) => L.marker([w.lat, w.lon], { zIndexOffset: 1000, icon: L.divIcon({ className: "", html: `<div class="wpPin" style="background:${w.kind === "s" ? "#4a8cff" : w.kind === "e" ? "#3ecf6e" : "#ff5a1f"}">${w.kind === "s" ? "A" : w.kind === "e" ? "B" : w.n}</div>`, iconSize: [22, 22] }) }).addTo(m));
      m.fitBounds(line.getBounds(), { padding: [20, 20] });
    }
  }

  function addStopFromRoute(id, leg) {
    const r = state.byId.get(id); if (!r) return;
    const idx = Math.max(0, Math.min(+leg || 0, stopValues().length));
    addStop(dddLabel(r), idx);
    window.scrollTo({ top: 0, behavior: "smooth" });
    planTrip();
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
      const all = e.target.closest("[data-showall]"); if (all) { all.parentElement.querySelectorAll(".onRoute[hidden]").forEach((x) => (x.hidden = false)); all.remove(); return; }
      const more = e.target.closest("[data-more]"); if (more) { state.shown += 60; renderStates(); return; }
      const open = e.target.closest("[data-open]"); if (open) { e.preventDefault(); openDetail(open.dataset.open); return; }
      if (e.target.closest("[data-close]")) { closeDetail(); return; }
      const trip = e.target.closest("[data-trip]");
      if (trip) { const r = state.byId.get(trip.dataset.trip); $("#toInput").value = dddLabel(r); closeDetail(); show("trip"); if ($("#fromInput").value) planTrip(); else $("#fromInput").focus(); return; }
      const asStop = e.target.closest("[data-asstop]");
      if (asStop) { const r = state.byId.get(asStop.dataset.asstop); addStop(dddLabel(r)); closeDetail(); show("trip"); return; }
      const addS = e.target.closest("[data-addstop]");
      if (addS) { e.preventDefault(); addStopFromRoute(addS.dataset.addstop, addS.dataset.leg); return; }
      const mv = e.target.closest("[data-move]");
      if (mv) { const v = stopValues(), i = +mv.closest(".stopRow").dataset.i, j = i + +mv.dataset.move; [v[i], v[j]] = [v[j], v[i]]; renderStopRows(v); return; }
      const rm = e.target.closest("[data-remove]");
      if (rm) { const v = stopValues(); v.splice(+rm.closest(".stopRow").dataset.i, 1); renderStopRows(v); return; }
      const item = e.target.closest(".item[data-id]"); if (item && !e.target.closest("a")) openDetail(item.dataset.id);
    });
    $("#fromGps").addEventListener("click", async () => {
      $("#fromInput").value = "Locating…";
      try { const c = await locate(); $("#fromInput").value = `${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)}`; } catch (_) { $("#fromInput").value = ""; alert("Couldn't get your location."); }
    });
    $("#goTrip").addEventListener("click", planTrip);
    $("#addStop").addEventListener("click", () => addStop());
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
    load().catch((e) => { $("#metaLine").textContent = "Couldn't load data: " + e.message; });
  }
  init();
})();
