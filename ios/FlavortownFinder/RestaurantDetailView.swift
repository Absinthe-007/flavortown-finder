import SwiftUI
import MapKit

struct RestaurantDetailView: View {
    let r: Restaurant
    @Environment(TripModel.self) private var trip
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss

    var facts: [String] {
        var f = r.facts
        if let t = r.cats.first { f.append("Google lists it as a \(t.lowercased()).") }
        if let n = r.reviews, n > 1000 { f.append("Over \(n / 1000),000 Google reviews — the Flavortown effect is real.") }
        if let note = r.note { f.append("Heads up: \(note).") }
        return f
    }

    var statusLine: String {
        switch r.status {
        case "open": return "Open per Google (checked \(r.checked ?? "recently"))"
        case "closed": return r.checked != nil ? "\(r.statusDetail ?? "Closed") per Google (checked \(r.checked!))" : "Marked closed on the episode list"
        default: return "Not verified yet — call ahead"
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                AsyncImage(url: r.img.flatMap(URL.init)) { img in img.resizable().scaledToFill() } placeholder: {
                    Text(r.emoji).font(.system(size: 64))
                }
                .frame(maxWidth: .infinity).frame(height: 190).background(Color.panel).clipShape(RoundedRectangle(cornerRadius: 16))

                VStack(alignment: .leading, spacing: 4) {
                    Text(r.name).font(.largeTitle.bold())
                    Text(r.displayAddress).foregroundStyle(.secondary)
                    HStack { StatusBadge(r: r); Text(statusLine).font(.caption).foregroundStyle(.secondary) }
                }

                HStack(spacing: 8) {
                    stat(r.rating.map { String(format: "★ %.1f", $0) } ?? "—", "Google rating")
                    stat(r.reviews.map { "\($0)" } ?? "—", "reviews")
                    stat(r.price ?? "—", "price")
                }

                Button {
                    trip.destination = r
                    trip.selectedTab = 3
                    dismiss()
                } label: {
                    Label("Plan a trip here", systemImage: "car.fill").frame(maxWidth: .infinity).padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
                Button {
                    trip.addStop(r)
                    trip.selectedTab = 3
                    dismiss()
                } label: {
                    Label("Add as a stop on my trip", systemImage: "plus.circle").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)

                HStack {
                    Button("Directions") { openInMaps() }.buttonStyle(.bordered).frame(maxWidth: .infinity)
                    if let phone = r.phone, let url = URL(string: "tel:" + phone.filter { "0123456789+".contains($0) }) {
                        Button("Call") { openURL(url) }.buttonStyle(.bordered).frame(maxWidth: .infinity)
                    }
                    if let m = r.maps, let url = URL(string: m) {
                        Button("Reviews") { openURL(url) }.buttonStyle(.bordered).frame(maxWidth: .infinity)
                    }
                }

                card("Fun facts") {
                    ForEach(facts, id: \.self) { Label($0, systemImage: "flame.fill").font(.subheadline) }
                }
                card("On the show") {
                    ForEach(r.appearances, id: \.self) { a in
                        VStack(alignment: .leading) {
                            Text("S\(a.season) · E\(a.episode) — \(a.title)").font(.subheadline.bold())
                            Text(a.airdate).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                card("Recipes") {
                    if r.recipes.isEmpty {
                        Link("Search Food Network ↗", destination: foodNetworkSearch)
                    } else {
                        ForEach(r.recipes, id: \.self) { rec in
                            if let u = URL(string: rec.url) { Link("\(rec.title) ↗", destination: u) }
                        }
                    }
                }
                Text("Episode data: Wikipedia (CC BY-SA). Ratings & status: Google. Hours change — call ahead.")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            .padding()
        }
        .navigationBarTitleDisplayMode(.inline)
    }

    var foodNetworkSearch: URL {
        let slug = r.name.filter { $0.isLetter || $0.isNumber || $0 == " " }.lowercased().split(separator: " ").joined(separator: "-")
        return URL(string: "https://www.foodnetwork.com/search/\(slug)-")!
    }

    func openInMaps() {
        guard let c = r.coordinate else { return }
        let item = MKMapItem(placemark: MKPlacemark(coordinate: c))
        item.name = r.name
        item.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDriving])
    }

    func stat(_ value: String, _ label: String) -> some View {
        VStack { Text(value).font(.headline); Text(label).font(.caption2).foregroundStyle(.secondary) }
            .frame(maxWidth: .infinity).padding(10).background(Color.panel, in: RoundedRectangle(cornerRadius: 12))
    }

    func card<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased()).font(.caption.bold()).foregroundStyle(Color.flameGold)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding().background(Color.panel, in: RoundedRectangle(cornerRadius: 16))
    }
}
