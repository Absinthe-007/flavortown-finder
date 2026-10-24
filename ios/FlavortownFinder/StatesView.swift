import SwiftUI
import CoreLocation

enum SortMode: String, CaseIterable, Identifiable {
    case name = "A–Z", newest = "Newest"
    var id: String { rawValue }
}

struct StatesView: View {
    @Environment(DataStore.self) private var store
    @State private var query = ""

    var body: some View {
        NavigationStack {
            Group {
                if query.isEmpty {
                    List {
                        let regions = store.regions()
                        Section("United States") {
                            ForEach(regions.filter { !$0.intl }, id: \.key) { row($0) }
                        }
                        Section("Canada & international") {
                            ForEach(regions.filter { $0.intl }, id: \.key) { row($0) }
                        }
                    }
                } else {
                    RestaurantList(restaurants: store.visible.filter { matches($0) })
                }
            }
            .navigationTitle("Flavortown")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { OpenOnlyToggle() } }
            .searchable(text: $query, prompt: "Restaurant, city, or theme")
            .navigationDestination(for: String.self) { key in
                RestaurantList(restaurants: store.visible.filter { $0.regionKey == key })
                    .navigationTitle(USStates.name(key))
            }
            .navigationDestination(for: Restaurant.self) { RestaurantDetailView(r: $0) }
        }
    }

    private func row(_ r: (key: String, count: Int, open: Int, intl: Bool)) -> some View {
        NavigationLink(value: r.key) {
            HStack {
                Text(USStates.names[r.key] != nil ? r.key : "🌎").font(.title3.bold()).foregroundStyle(Color.flameGold).frame(width: 44, alignment: .leading)
                Text(USStates.name(r.key))
                Spacer()
                Text("\(r.count)\(r.open > 0 ? " · \(r.open) open" : "")").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func matches(_ r: Restaurant) -> Bool {
        let hay = "\(r.name) \(r.city) \(USStates.name(r.state)) \(r.cats.joined(separator: " ")) \(r.appearances.map(\.title).joined(separator: " "))"
        return hay.localizedCaseInsensitiveContains(query)
    }
}

struct RestaurantList: View {
    let restaurants: [Restaurant]
    @State private var sort: SortMode = .name

    var sorted: [Restaurant] {
        switch sort {
        case .name: return restaurants.sorted { $0.name < $1.name }
        case .newest: return restaurants.sorted { $0.latestSeason > $1.latestSeason }
        }
    }

    var body: some View {
        List {
            Picker("Sort", selection: $sort) { ForEach(SortMode.allCases) { Text($0.rawValue).tag($0) } }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
            if restaurants.isEmpty {
                ContentUnavailableView("No matches", systemImage: "fork.knife", description: Text("Try switching off Open only."))
            }
            ForEach(sorted) { r in
                NavigationLink(value: r) { RestaurantRow(r: r) }
            }
        }
    }
}

struct RestaurantRow: View {
    let r: Restaurant
    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: r.img.flatMap(URL.init)) { img in img.resizable().scaledToFill() } placeholder: {
                Text(r.emoji).font(.title)
            }
            .frame(width: 54, height: 54).background(Color.panel).clipShape(RoundedRectangle(cornerRadius: 10))
            VStack(alignment: .leading, spacing: 3) {
                Text(r.name).font(.headline).lineLimit(1)
                Text("\(r.city), \(r.state) · S\(r.latestSeason)").font(.caption).foregroundStyle(.secondary)
                HStack(spacing: 6) {
                    StatusBadge(r: r)
                    if let rating = r.rating { Text("★ \(rating, specifier: "%.1f")").font(.caption.bold()).foregroundStyle(.yellow) }
                    if let n = r.reviews { Text("(\(n))").font(.caption).foregroundStyle(.secondary) }
                    if let p = r.price { Text(p).font(.caption).foregroundStyle(.secondary) }
                    if !r.recipes.isEmpty { Text("🍳").font(.caption) }
                }
            }
        }
    }
}
