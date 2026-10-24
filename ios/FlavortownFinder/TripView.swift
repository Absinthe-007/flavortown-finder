import SwiftUI
import MapKit
import CoreLocation
import Observation

struct Checkpoint: Identifiable {
    let id = UUID()
    let coordinate: CLLocationCoordinate2D
    let miles: Double
    let eta: Date
    var state: String = "…"
    var tempF: Double?
    var rainPct: Int?
    var windMph: Double?
    var code: Int?
    var stopName: String?
    var isEnd = false
}

struct StateLeg: Identifiable {
    var id: String { state }
    let state: String
    var points: [Checkpoint]
    var miles: Double
}

/// A stop the user typed (any place) or picked (a Triple D restaurant).
struct TripStop: Identifiable, Hashable {
    let id = UUID()
    var text: String = ""
    var restaurant: Restaurant?
    var label: String { restaurant?.name ?? text }
}

struct ItineraryItem: Identifiable {
    let id = UUID()
    let label: String
    let isDDD: Bool
    let kind: Kind
    let index: Int
    let coordinate: CLLocationCoordinate2D
    let miles: Double
    let arrive: Date
    let leave: Date
    enum Kind { case start, stop, end }
}

struct AlongSpot: Identifiable {
    var id: String { restaurant.id }
    let restaurant: Restaurant
    let offMiles: Double
    let routeMile: Double
    let passBy: Date
    let leg: Int
}

@Observable
final class TripModel: NSObject, CLLocationManagerDelegate {
    var selectedTab = 0
    var fromText = ""
    var stops: [TripStop] = []
    var destination: Restaurant? { didSet { if destination != nil { destinationText = "" } } }
    var destinationText = ""
    var departAt = Date()
    var dwellMinutes = 45
    var radiusMiles = 10.0

    var isWorking = false
    var error: String?
    var polylines: [MKPolyline] = []
    var totalMiles = 0.0
    var driveSeconds = 0.0
    var itinerary: [ItineraryItem] = []
    var checkpoints: [Checkpoint] = []
    var legs: [StateLeg] = []
    var along: [AlongSpot] = []
    var tooFarOut = false
    var hasRoute: Bool { !polylines.isEmpty }

    @ObservationIgnored private let manager = CLLocationManager()
    @ObservationIgnored private var locationContinuation: CheckedContinuation<CLLocation, Error>?

    override init() {
        super.init()
        manager.delegate = self
    }

    // MARK: location
    func currentLocation() async throws -> CLLocation {
        manager.requestWhenInUseAuthorization()
        return try await withCheckedThrowingContinuation { cont in
            locationContinuation = cont
            manager.requestLocation()
        }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if let l = locations.last { locationContinuation?.resume(returning: l); locationContinuation = nil }
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        locationContinuation?.resume(throwing: error); locationContinuation = nil
    }

    func addStop(_ r: Restaurant, at index: Int? = nil) {
        let s = TripStop(text: r.name, restaurant: r)
        if let index, index <= stops.count { stops.insert(s, at: index) } else { stops.append(s) }
    }

    // MARK: resolve a place
    private func resolve(text: String, restaurant: Restaurant?) async throws -> (CLLocationCoordinate2D, String, Bool) {
        if let r = restaurant, let c = r.coordinate { return (c, r.name, true) }
        let t = text.trimmingCharacters(in: .whitespaces)
        if t.isEmpty || t == "Current Location" {
            let loc = try await currentLocation()
            return (loc.coordinate, "Your location", false)
        }
        guard let p = try await CLGeocoder().geocodeAddressString(t).first, let loc = p.location else {
            throw TripError.message("Couldn't find \u{201C}\(t)\u{201D}")
        }
        return (loc.coordinate, p.locality ?? t, false)
    }

    // MARK: plan
    @MainActor
    func plan(restaurants: [Restaurant]) async {
        guard destination != nil || !destinationText.trimmingCharacters(in: .whitespaces).isEmpty else { error = "Pick a destination first."; return }
        isWorking = true; error = nil; legs = []; checkpoints = []; polylines = []; itinerary = []; along = []
        defer { isWorking = false }
        do {
            var wps: [(CLLocationCoordinate2D, String, Bool)] = [try await resolve(text: fromText, restaurant: nil)]
            for s in stops where s.restaurant != nil || !s.text.trimmingCharacters(in: .whitespaces).isEmpty {
                wps.append(try await resolve(text: s.text, restaurant: s.restaurant))
            }
            wps.append(try await resolve(text: destinationText, restaurant: destination))

            // One MKDirections request per leg (Apple Maps routes A→B only)
            var routes: [MKRoute] = []
            var legStart = departAt
            for i in 0..<(wps.count - 1) {
                let req = MKDirections.Request()
                req.source = MKMapItem(placemark: MKPlacemark(coordinate: wps[i].0))
                req.destination = MKMapItem(placemark: MKPlacemark(coordinate: wps[i + 1].0))
                req.transportType = .automobile
                req.departureDate = legStart
                guard let r = try await MKDirections(request: req).calculate().routes.first else {
                    throw TripError.message("No driving route from \(wps[i].1) to \(wps[i + 1].1).")
                }
                routes.append(r)
                legStart = legStart.addingTimeInterval(r.expectedTravelTime + Double(dwellMinutes * 60))
            }
            polylines = routes.map(\.polyline)
            driveSeconds = routes.reduce(0) { $0 + $1.expectedTravelTime }
            let dwell = Double(dwellMinutes * 60)

            // Flatten all legs into one list of (coordinate, meters from start, time, leg)
            var flat: [(c: CLLocationCoordinate2D, m: Double, t: Date, leg: Int)] = []
            var items: [ItineraryItem] = [ItineraryItem(label: wps[0].1, isDDD: wps[0].2, kind: .start, index: 0, coordinate: wps[0].0, miles: 0, arrive: departAt, leave: departAt)]
            var meters = 0.0
            var clock = departAt
            for (k, r) in routes.enumerated() {
                let pts = r.polyline.coordinates
                var acc = 0.0
                for (i, c) in pts.enumerated() {
                    if i > 0 { acc += CLLocation(latitude: pts[i-1].latitude, longitude: pts[i-1].longitude).distance(from: CLLocation(latitude: c.latitude, longitude: c.longitude)) }
                    let frac = r.distance > 0 ? min(1, acc / r.distance) : 0
                    flat.append((c, meters + acc, clock.addingTimeInterval(r.expectedTravelTime * frac), k))
                }
                meters += r.distance
                let arrive = clock.addingTimeInterval(r.expectedTravelTime)
                let isEnd = k == routes.count - 1
                let leave = isEnd ? arrive : arrive.addingTimeInterval(dwell)
                let w = wps[k + 1]
                items.append(ItineraryItem(label: w.1, isDDD: w.2, kind: isEnd ? .end : .stop, index: k + 1, coordinate: w.0, miles: meters / 1609.34, arrive: arrive, leave: leave))
                clock = leave
            }
            itinerary = items
            totalMiles = meters / 1609.34

            // Weather checkpoints ~ every 40 mi (max 40) + each stop
            let stepM = max(64_000, meters / 40)
            var cps: [Checkpoint] = []
            var next = 0.0
            for f in flat where f.m >= next {
                cps.append(Checkpoint(coordinate: f.c, miles: f.m / 1609.34, eta: f.t))
                next += stepM
            }
            for it in items.dropFirst() {
                cps.append(Checkpoint(coordinate: it.coordinate, miles: it.miles, eta: it.arrive, stopName: it.label, isEnd: it.kind == .end))
            }
            cps.sort { $0.miles < $1.miles }

            let geocoder = CLGeocoder()
            for i in cps.indices {
                let loc = CLLocation(latitude: cps[i].coordinate.latitude, longitude: cps[i].coordinate.longitude)
                let pm = try? await geocoder.reverseGeocodeLocation(loc).first
                cps[i].state = pm?.administrativeArea.map { USStates.name($0) } ?? (i > 0 ? cps[i-1].state : "On the road")
            }
            tooFarOut = (cps.last?.eta.timeIntervalSinceNow ?? 0) > 15.5 * 86_400
            if !tooFarOut { cps = try await fillWeather(cps) }
            checkpoints = cps

            var out: [StateLeg] = []
            for (i, c) in cps.enumerated() {
                let seg = i + 1 < cps.count ? cps[i + 1].miles - c.miles : 0
                if let idx = out.firstIndex(where: { $0.state == c.state }) { out[idx].points.append(c); out[idx].miles += seg }
                else { out.append(StateLeg(state: c.state, points: [c], miles: seg)) }
            }
            legs = out

            // Triple D spots within radius of the route
            var sampled: [(lat: Double, lon: Double, m: Double, t: Date, leg: Int)] = []
            var lastM = -1e9
            for f in flat where f.m - lastM >= 2000 { sampled.append((f.c.latitude, f.c.longitude, f.m, f.t, f.leg)); lastM = f.m }
            let radiusKm = radiusMiles * 1.609
            let chosen = Set(stops.compactMap { $0.restaurant?.id } + [destination?.id].compactMap { $0 })
            guard let minLat = sampled.map(\.lat).min(), let maxLat = sampled.map(\.lat).max(),
                  let minLon = sampled.map(\.lon).min(), let maxLon = sampled.map(\.lon).max() else { return }
            let pad = radiusKm / 80
            var found: [AlongSpot] = []
            for r in restaurants where !chosen.contains(r.id) {
                guard let lat = r.lat, let lon = r.lon,
                      lat > minLat - pad, lat < maxLat + pad, lon > minLon - pad * 1.6, lon < maxLon + pad * 1.6 else { continue }
                var best = Double.greatestFiniteMagnitude
                var at = sampled[0]
                for p in sampled {
                    let x = (p.lon - lon) * cos((lat + p.lat) / 2 * .pi / 180), y = p.lat - lat
                    let d = (x * x + y * y).squareRoot() * 111.195
                    if d < best { best = d; at = p }
                }
                if best <= radiusKm {
                    found.append(AlongSpot(restaurant: r, offMiles: best / 1.609, routeMile: at.m / 1609.34, passBy: at.t, leg: at.leg))
                }
            }
            along = found.sorted { $0.routeMile < $1.routeMile }
        } catch {
            self.error = (error as? TripError)?.text ?? error.localizedDescription
        }
    }

    private func fillWeather(_ input: [Checkpoint]) async throws -> [Checkpoint] {
        var cps = input
        struct Hourly: Decodable { let time: [String]; let temperature_2m: [Double?]; let precipitation_probability: [Int?]; let weather_code: [Int?]; let wind_speed_10m: [Double?] }
        struct Resp: Decodable { let hourly: Hourly }
        let fmt = DateFormatter(); fmt.dateFormat = "yyyy-MM-dd'T'HH:mm"; fmt.timeZone = TimeZone(identifier: "GMT")
        for start in stride(from: 0, to: cps.count, by: 50) {
            let idxs = Array(start..<min(start + 50, cps.count))
            let lats = idxs.map { String(format: "%.3f", cps[$0].coordinate.latitude) }.joined(separator: ",")
            let lons = idxs.map { String(format: "%.3f", cps[$0].coordinate.longitude) }.joined(separator: ",")
            let url = URL(string: "https://api.open-meteo.com/v1/forecast?latitude=\(lats)&longitude=\(lons)&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=GMT&forecast_days=16")!
            let (data, _) = try await URLSession.shared.data(from: url)
            let list: [Resp] = idxs.count == 1 ? [try JSONDecoder().decode(Resp.self, from: data)] : try JSONDecoder().decode([Resp].self, from: data)
            for (k, i) in idxs.enumerated() where k < list.count {
                let h = list[k].hourly
                guard let t0 = h.time.first.flatMap(fmt.date) else { continue }
                let idx = min(h.time.count - 1, max(0, Int((cps[i].eta.timeIntervalSince(t0) / 3600).rounded())))
                cps[i].tempF = h.temperature_2m[idx]; cps[i].rainPct = h.precipitation_probability[idx]
                cps[i].code = h.weather_code[idx]; cps[i].windMph = h.wind_speed_10m[idx]
            }
        }
        return cps
    }
}

enum TripError: Error { case message(String); var text: String { if case .message(let s) = self { return s }; return "" } }

extension MKPolyline {
    var coordinates: [CLLocationCoordinate2D] {
        var c = [CLLocationCoordinate2D](repeating: kCLLocationCoordinate2DInvalid, count: pointCount)
        getCoordinates(&c, range: NSRange(location: 0, length: pointCount))
        return c
    }
}

enum Weather {
    private static let table: [Int: (String, String)] = [
        0: ("☀️", "Clear"), 1: ("🌤️", "Mostly clear"), 2: ("⛅", "Partly cloudy"), 3: ("☁️", "Overcast"),
        45: ("🌫️", "Fog"), 48: ("🌫️", "Freezing fog"), 51: ("🌦️", "Light drizzle"), 53: ("🌦️", "Drizzle"), 55: ("🌧️", "Heavy drizzle"),
        56: ("🧊", "Freezing drizzle"), 57: ("🧊", "Freezing drizzle"), 61: ("🌧️", "Light rain"), 63: ("🌧️", "Rain"), 65: ("🌧️", "Heavy rain"),
        66: ("🧊", "Freezing rain"), 67: ("🧊", "Freezing rain"), 71: ("🌨️", "Light snow"), 73: ("🌨️", "Snow"), 75: ("❄️", "Heavy snow"),
        77: ("🌨️", "Snow grains"), 80: ("🌦️", "Showers"), 81: ("🌧️", "Heavy showers"), 82: ("⛈️", "Violent showers"),
        85: ("🌨️", "Snow showers"), 86: ("❄️", "Heavy snow showers"), 95: ("⛈️", "Thunderstorms"), 96: ("⛈️", "Storms with hail"), 99: ("⛈️", "Severe storms"),
    ]
    static func symbol(_ code: Int?) -> String { code.flatMap { table[$0]?.0 } ?? "🌡️" }
    static func text(_ code: Int?) -> String { code.flatMap { table[$0]?.1 } ?? "—" }
    static func severity(_ c: Int?) -> Int {
        guard let c else { return -1 }
        if c >= 95 { return 9 }; if [56, 57, 66, 67].contains(c) { return 8 }; if [75, 86].contains(c) { return 7 }
        if [65, 81, 82].contains(c) { return 6 }; if [71, 73, 77, 85].contains(c) { return 5 }; if [61, 63, 80].contains(c) { return 4 }
        if [45, 48].contains(c) { return 3 }; if [51, 53, 55].contains(c) { return 2 }; return c
    }
}

struct TripView: View {
    @Environment(TripModel.self) private var trip
    @Environment(DataStore.self) private var store
    @State private var picking: PickTarget?
    @State private var showAllAlong = false

    enum PickTarget: Identifiable {
        case destination, stop(Int), newStop
        var id: String {
            switch self {
            case .destination: return "d"
            case .stop(let i): return "s\(i)"
            case .newStop: return "n"
            }
        }
    }

    var body: some View {
        @Bindable var trip = trip
        NavigationStack {
            Form {
                Section("Route") {
                    HStack {
                        Image(systemName: "a.circle.fill").foregroundStyle(.blue)
                        TextField("Start: city, address, or ZIP", text: $trip.fromText)
                        Button { trip.fromText = "Current Location" } label: { Image(systemName: "location.fill") }
                    }
                    ForEach($trip.stops) { $stop in
                        HStack {
                            Image(systemName: "\((trip.stops.firstIndex(of: stop) ?? 0) + 1).circle.fill").foregroundStyle(Color.flame)
                            if let r = stop.restaurant {
                                Text("🔥 \(r.name)").lineLimit(1)
                                Spacer()
                                Button { stop.restaurant = nil; stop.text = "" } label: { Image(systemName: "pencil") }.buttonStyle(.borderless)
                            } else {
                                TextField("Any place", text: $stop.text)
                                Button { if let i = trip.stops.firstIndex(of: stop) { picking = .stop(i) } } label: { Image(systemName: "flame") }.buttonStyle(.borderless)
                            }
                        }
                    }
                    .onDelete { trip.stops.remove(atOffsets: $0) }
                    .onMove { trip.stops.move(fromOffsets: $0, toOffset: $1) }
                    Menu {
                        Button("Add a Triple D spot") { picking = .newStop }
                        Button("Add any place") { trip.stops.append(TripStop()) }
                    } label: { Label("Add a stop", systemImage: "plus.circle") }
                    HStack {
                        Image(systemName: "flag.checkered").foregroundStyle(.green)
                        if let d = trip.destination {
                            Text("🔥 \(d.name)").lineLimit(1); Spacer()
                            Button { trip.destination = nil } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.borderless)
                        } else {
                            TextField("Destination: any place", text: $trip.destinationText)
                            Button { picking = .destination } label: { Image(systemName: "flame") }.buttonStyle(.borderless)
                        }
                    }
                }
                Section("Timing") {
                    DatePicker("Leaving", selection: $trip.departAt, in: Date()...)
                    Picker("Time at each stop", selection: $trip.dwellMinutes) {
                        Text("None").tag(0); Text("30 min").tag(30); Text("45 min").tag(45); Text("1 hr").tag(60); Text("1.5 hr").tag(90); Text("2 hr").tag(120)
                    }
                    Picker("Triple D within", selection: $trip.radiusMiles) {
                        Text("5 mi").tag(5.0); Text("10 mi").tag(10.0); Text("25 mi").tag(25.0); Text("50 mi").tag(50.0)
                    }
                    Button { Task { await trip.plan(restaurants: store.visible) } } label: {
                        HStack { Spacer(); if trip.isWorking { ProgressView() } else { Text("Plan trip").bold() }; Spacer() }
                    }
                    .disabled(trip.isWorking)
                }
                if let err = trip.error { Section { Text(err).foregroundStyle(.red) } }
                if trip.hasRoute {
                    summarySection
                    itinerarySection
                    alongSection
                    ForEach(trip.legs) { leg in legSection(leg) }
                }
            }
            .navigationTitle("Trip")
            .navigationDestination(for: Restaurant.self) { RestaurantDetailView(r: $0) }
            .toolbar { EditButton() }
            .sheet(item: $picking) { target in
                DestinationPicker { r in
                    switch target {
                    case .destination: trip.destination = r
                    case .stop(let i): if i < trip.stops.count { trip.stops[i].restaurant = r; trip.stops[i].text = r.name }
                    case .newStop: trip.addStop(r)
                    }
                    picking = nil
                }
            }
        }
    }

    var summarySection: some View {
        Section {
            Map {
                ForEach(Array(trip.polylines.enumerated()), id: \.offset) { _, p in MapPolyline(p).stroke(Color.flame, lineWidth: 4) }
                ForEach(trip.along.prefix(100).filter { $0.restaurant.coordinate != nil }) { a in
                    Annotation("", coordinate: a.restaurant.coordinate!) { Text("🔥").font(.caption) }
                }
                ForEach(trip.itinerary) { it in
                    Annotation("", coordinate: it.coordinate) {
                        Text(it.kind == .start ? "A" : it.kind == .end ? "B" : "\(it.index)")
                            .font(.caption2.bold()).foregroundStyle(.white).frame(width: 22, height: 22)
                            .background(it.kind == .start ? Color.blue : it.kind == .end ? Color.green : Color.flame, in: Circle())
                    }
                }
            }
            .frame(height: 240).listRowInsets(EdgeInsets())
            HStack {
                Label("\(Int(trip.totalMiles)) mi", systemImage: "road.lanes")
                Spacer()
                Label("\(Int(trip.driveSeconds / 3600))h \(Int(trip.driveSeconds.truncatingRemainder(dividingBy: 3600) / 60))m", systemImage: "clock")
                Spacer()
                if let end = trip.itinerary.last { Text("Arrive \(end.arrive.formatted(date: .omitted, time: .shortened))") }
            }.font(.subheadline)
            if trip.driveSeconds > 10 * 3600 { Text("That's \(Int(trip.driveSeconds / 3600)) hours of driving — consider an overnight stop.").foregroundStyle(.orange) }
            if trip.tooFarOut { Text("Forecasts only reach about 16 days out — choose an earlier departure.").foregroundStyle(.orange) }
            if let worst = trip.checkpoints.max(by: { Weather.severity($0.code) < Weather.severity($1.code) }), Weather.severity(worst.code) >= 4 {
                Text("\(Weather.symbol(worst.code)) Watch for \(Weather.text(worst.code).lowercased()) in \(worst.state) around \(worst.eta.formatted(date: .omitted, time: .shortened)).")
                    .foregroundStyle(.orange)
            }
            if let url = googleMapsURL { Link(destination: url) { Label("Navigate all stops in Google Maps", systemImage: "arrow.triangle.turn.up.right.diamond") } }
        }
    }

    var googleMapsURL: URL? {
        guard let first = trip.itinerary.first, let last = trip.itinerary.last else { return nil }
        let f = { (c: CLLocationCoordinate2D) in "\(c.latitude),\(c.longitude)" }
        var comps = URLComponents(string: "https://www.google.com/maps/dir/")!
        comps.queryItems = [URLQueryItem(name: "api", value: "1"), URLQueryItem(name: "origin", value: f(first.coordinate)),
                            URLQueryItem(name: "destination", value: f(last.coordinate)), URLQueryItem(name: "travelmode", value: "driving")]
        let mids = trip.itinerary.dropFirst().dropLast().map { f($0.coordinate) }
        if !mids.isEmpty { comps.queryItems?.append(URLQueryItem(name: "waypoints", value: mids.joined(separator: "|"))) }
        return comps.url
    }

    var itinerarySection: some View {
        Section("Itinerary") {
            ForEach(trip.itinerary) { it in
                HStack {
                    Text(it.kind == .start ? "A" : it.kind == .end ? "🏁" : "\(it.index)").font(.caption.bold()).frame(width: 24)
                    VStack(alignment: .leading) {
                        Text((it.isDDD ? "🔥 " : "") + it.label).font(.subheadline.bold()).lineLimit(1)
                        Text(it.kind == .start ? "Start" : "Mile \(Int(it.miles))").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text(it.kind == .start ? "Leave \(it.leave.formatted(date: .omitted, time: .shortened))"
                         : it.kind == .end ? "Arrive \(it.arrive.formatted(date: .omitted, time: .shortened))"
                         : "\(it.arrive.formatted(date: .omitted, time: .shortened))–\(it.leave.formatted(date: .omitted, time: .shortened))")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    var alongSection: some View {
        Section("🔥 Triple D on your route (\(trip.along.count) within \(Int(trip.radiusMiles)) mi)") {
            if trip.along.isEmpty { Text("None nearby — try a wider distance.").foregroundStyle(.secondary) }
            ForEach(showAllAlong ? Array(trip.along.prefix(100)) : Array(trip.along.prefix(8))) { a in
                HStack {
                    NavigationLink(value: a.restaurant) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(a.restaurant.name).font(.subheadline.bold()).lineLimit(1)
                            Text("\(a.restaurant.city), \(a.restaurant.state) · mile \(Int(a.routeMile)) · \(a.offMiles < 1 ? "on the way" : "\(Int(a.offMiles)) mi off")\(a.restaurant.rating.map { String(format: " · ★ %.1f", $0) } ?? "")")
                                .font(.caption).foregroundStyle(.secondary)
                            Text("Pass by ~\(a.passBy.formatted(date: .omitted, time: .shortened))").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    Button("+ Stop") {
                        trip.addStop(a.restaurant, at: min(a.leg, trip.stops.count))
                        Task { await trip.plan(restaurants: store.visible) }
                    }
                    .buttonStyle(.bordered).tint(Color.flame)
                }
            }
            if trip.along.count > 8 && !showAllAlong { Button("Show all \(min(trip.along.count, 100))") { showAllAlong = true } }
        }
    }

    func legSection(_ leg: StateLeg) -> some View {
        let temps = leg.points.compactMap(\.tempF)
        let worst = leg.points.max { Weather.severity($0.code) < Weather.severity($1.code) }
        let rain = leg.points.compactMap(\.rainPct).max() ?? 0
        return Section {
            DisclosureGroup {
                ForEach(leg.points) { c in
                    HStack {
                        Text(c.eta.formatted(date: .omitted, time: .shortened)).foregroundStyle(.secondary).frame(width: 72, alignment: .leading)
                        Text(Weather.symbol(c.code))
                        Text(c.stopName.map { (c.isEnd ? "🏁 " : "📍 ") + $0 } ?? "Mile \(Int(c.miles))").lineLimit(1)
                        Spacer()
                        if let t = c.tempF { Text("\(Int(t))° · \(c.rainPct ?? 0)% · \(Int(c.windMph ?? 0)) mph").font(.caption) }
                    }.font(.subheadline)
                }
            } label: {
                HStack {
                    Text(Weather.symbol(worst?.code)).font(.title)
                    VStack(alignment: .leading) {
                        Text(leg.state).font(.headline)
                        Text("\(Int(leg.miles)) mi · \(leg.points.first!.eta.formatted(date: .omitted, time: .shortened))–\(leg.points.last!.eta.formatted(date: .omitted, time: .shortened))")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if let lo = temps.min(), let hi = temps.max() {
                        VStack(alignment: .trailing) {
                            Text("\(Int(lo))°–\(Int(hi))°F").bold()
                            Text("\(Weather.text(worst?.code)) · \(rain)% rain").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }
}

struct DestinationPicker: View {
    @Environment(DataStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let onPick: (Restaurant) -> Void
    @State private var q = ""
    var body: some View {
        NavigationStack {
            List(store.visible.filter { $0.coordinate != nil && (q.isEmpty || "\($0.name) \($0.city) \($0.state)".localizedCaseInsensitiveContains(q)) }.prefix(200)) { r in
                Button { onPick(r) } label: { RestaurantRow(r: r) }.buttonStyle(.plain)
            }
            .searchable(text: $q, prompt: "Search Triple D spots")
            .navigationTitle("Pick a Triple D spot")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}
