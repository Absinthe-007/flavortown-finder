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
    var isEnd = false
}

struct StateLeg: Identifiable {
    var id: String { state }
    let state: String
    var points: [Checkpoint]
    var miles: Double
}

@Observable
final class TripModel: NSObject, CLLocationManagerDelegate {
    var selectedTab = 0
    var destination: Restaurant?
    var fromText = ""
    var departAt = Date()
    var isWorking = false
    var error: String?
    var route: MKRoute?
    var checkpoints: [Checkpoint] = []
    var legs: [StateLeg] = []
    var tooFarOut = false

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

    // MARK: plan
    @MainActor
    func plan() async {
        guard let dest = destination, let destCoord = dest.coordinate else { error = "Pick a restaurant first."; return }
        isWorking = true; error = nil; legs = []; checkpoints = []; route = nil
        defer { isWorking = false }
        do {
            let start: MKMapItem
            if fromText.trimmingCharacters(in: .whitespaces).isEmpty || fromText == "Current Location" {
                start = MKMapItem.forCurrentLocation()
            } else {
                let placemarks = try await CLGeocoder().geocodeAddressString(fromText)
                guard let p = placemarks.first else { throw TripError.message("Couldn't find “\(fromText)”") }
                start = MKMapItem(placemark: MKPlacemark(placemark: p))
            }
            let req = MKDirections.Request()
            req.source = start
            req.destination = MKMapItem(placemark: MKPlacemark(coordinate: destCoord))
            req.transportType = .automobile
            req.departureDate = departAt
            guard let r = try await MKDirections(request: req).calculate().routes.first else { throw TripError.message("No driving route found.") }
            route = r

            // Sample the polyline about every 40 miles (max 40 checkpoints so reverse-geocoding stays under Apple's limits).
            let pts = r.polyline.coordinates
            let totalM = r.distance
            let stepM = max(64_000, totalM / 40)
            var cps: [Checkpoint] = []
            var acc = 0.0, next = 0.0
            for i in 0..<pts.count {
                if i > 0 { acc += CLLocation(latitude: pts[i-1].latitude, longitude: pts[i-1].longitude).distance(from: CLLocation(latitude: pts[i].latitude, longitude: pts[i].longitude)) }
                if acc >= next {
                    let eta = departAt.addingTimeInterval(r.expectedTravelTime * acc / totalM)
                    cps.append(Checkpoint(coordinate: pts[i], miles: acc / 1609.34, eta: eta))
                    next += stepM
                }
            }
            if let last = pts.last {
                cps.append(Checkpoint(coordinate: last, miles: totalM / 1609.34, eta: departAt.addingTimeInterval(r.expectedTravelTime), isEnd: true))
            }

            // State for each checkpoint
            let geocoder = CLGeocoder()
            for i in cps.indices {
                let loc = CLLocation(latitude: cps[i].coordinate.latitude, longitude: cps[i].coordinate.longitude)
                let pm = try? await geocoder.reverseGeocodeLocation(loc).first
                cps[i].state = pm?.administrativeArea.map { USStates.name($0) } ?? (i > 0 ? cps[i-1].state : "On the road")
            }

            // Weather from Open-Meteo (free, no key) for each checkpoint at its ETA
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
        } catch {
            self.error = (error as? TripError)?.text ?? error.localizedDescription
        }
    }

    private func fillWeather(_ input: [Checkpoint]) async throws -> [Checkpoint] {
        var cps = input
        struct Hourly: Decodable { let time: [String]; let temperature_2m: [Double?]; let precipitation_probability: [Int?]; let weather_code: [Int?]; let wind_speed_10m: [Double?] }
        struct Resp: Decodable { let hourly: Hourly }
        let lats = cps.map { String(format: "%.3f", $0.coordinate.latitude) }.joined(separator: ",")
        let lons = cps.map { String(format: "%.3f", $0.coordinate.longitude) }.joined(separator: ",")
        let url = URL(string: "https://api.open-meteo.com/v1/forecast?latitude=\(lats)&longitude=\(lons)&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=GMT&forecast_days=16")!
        let (data, _) = try await URLSession.shared.data(from: url)
        let list: [Resp] = cps.count == 1 ? [try JSONDecoder().decode(Resp.self, from: data)] : try JSONDecoder().decode([Resp].self, from: data)
        let fmt = DateFormatter(); fmt.dateFormat = "yyyy-MM-dd'T'HH:mm"; fmt.timeZone = TimeZone(identifier: "GMT")
        for i in cps.indices where i < list.count {
            let h = list[i].hourly
            guard let t0 = h.time.first.flatMap(fmt.date) else { continue }
            let idx = min(h.time.count - 1, max(0, Int((cps[i].eta.timeIntervalSince(t0) / 3600).rounded())))
            cps[i].tempF = h.temperature_2m[idx]; cps[i].rainPct = h.precipitation_probability[idx]
            cps[i].code = h.weather_code[idx]; cps[i].windMph = h.wind_speed_10m[idx]
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
    @State private var showPicker = false

    var body: some View {
        @Bindable var trip = trip
        NavigationStack {
            Form {
                Section("Trip") {
                    HStack {
                        TextField("Start: city, address, or ZIP", text: $trip.fromText)
                        Button { trip.fromText = "Current Location" } label: { Image(systemName: "location.fill") }
                    }
                    Button { showPicker = true } label: {
                        HStack { Text("Headed to"); Spacer(); Text(trip.destination?.name ?? "Pick a spot").foregroundStyle(.secondary) }
                    }
                    DatePicker("Leaving", selection: $trip.departAt, in: Date()...)
                    Button { Task { await trip.plan() } } label: {
                        HStack { Spacer(); if trip.isWorking { ProgressView() } else { Text("Get route weather").bold() }; Spacer() }
                    }
                    .disabled(trip.destination == nil || trip.isWorking)
                }
                if let err = trip.error { Section { Text(err).foregroundStyle(.red) } }
                if let r = trip.route { summary(r) }
                ForEach(trip.legs) { leg in legSection(leg) }
            }
            .navigationTitle("Trip weather")
            .sheet(isPresented: $showPicker) { DestinationPicker(isPresented: $showPicker) }
        }
    }

    @ViewBuilder func summary(_ r: MKRoute) -> some View {
        Section {
            Map { MapPolyline(r.polyline).stroke(Color.flame, lineWidth: 4)
                ForEach(trip.checkpoints.enumerated().filter { $0.offset % max(1, trip.checkpoints.count / 10) == 0 || $0.element.isEnd }.map { $0.element }) { c in
                    Annotation("", coordinate: c.coordinate) { Text(Weather.symbol(c.code)) }
                }
            }
            .frame(height: 230).listRowInsets(EdgeInsets())
            HStack {
                Label("\(Int(r.distance / 1609.34)) mi", systemImage: "road.lanes")
                Spacer()
                Label("\(Int(r.expectedTravelTime / 3600))h \(Int(r.expectedTravelTime.truncatingRemainder(dividingBy: 3600) / 60))m", systemImage: "clock")
                Spacer()
                Text("Arrive \(trip.departAt.addingTimeInterval(r.expectedTravelTime).formatted(date: .omitted, time: .shortened))")
            }.font(.subheadline)
            if trip.tooFarOut { Text("Forecasts only reach about 16 days out — choose an earlier departure.").foregroundStyle(.orange) }
            if let worst = trip.checkpoints.max(by: { Weather.severity($0.code) < Weather.severity($1.code) }), Weather.severity(worst.code) >= 4 {
                Text("\(Weather.symbol(worst.code)) Watch for \(Weather.text(worst.code).lowercased()) in \(worst.state) around \(worst.eta.formatted(date: .omitted, time: .shortened)).")
                    .foregroundStyle(.orange)
            }
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
                        Text(c.isEnd ? "🔥 \(trip.destination?.name ?? "")" : "Mile \(Int(c.miles))").lineLimit(1)
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
    @Environment(TripModel.self) private var trip
    @Binding var isPresented: Bool
    @State private var q = ""
    var body: some View {
        NavigationStack {
            List(store.visible.filter { $0.coordinate != nil && (q.isEmpty || "\($0.name) \($0.city) \($0.state)".localizedCaseInsensitiveContains(q)) }.prefix(200)) { r in
                Button { trip.destination = r; isPresented = false } label: { RestaurantRow(r: r) }.buttonStyle(.plain)
            }
            .searchable(text: $q, prompt: "Search Triple D spots")
            .navigationTitle("Headed to")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { isPresented = false } } }
        }
    }
}
