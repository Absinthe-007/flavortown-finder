import SwiftUI
import MapKit

struct MapTabView: View {
    @Environment(DataStore.self) private var store
    @State private var position: MapCameraPosition = .region(MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 39.5, longitude: -98.35),
        span: MKCoordinateSpan(latitudeDelta: 30, longitudeDelta: 40)))
    @State private var selected: Restaurant?

    var body: some View {
        NavigationStack {
            Map(position: $position) {
                UserAnnotation()
                ForEach(store.visible.filter { $0.coordinate != nil }) { r in
                    Annotation(r.name, coordinate: r.coordinate!, anchor: .center) {
                        Circle()
                            .fill(r.isOpen ? Color.green : r.isClosed ? Color.red : Color.flameGold)
                            .frame(width: 10, height: 10)
                            .overlay(Circle().stroke(.white, lineWidth: 1.5))
                            .onTapGesture { selected = r }
                    }
                    .annotationTitles(.hidden)
                }
            }
            .mapControls { MapUserLocationButton(); MapCompass() }
            .navigationTitle("Map")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { OpenOnlyToggle() } }
            .sheet(item: $selected) { r in
                NavigationStack { RestaurantDetailView(r: r) }.presentationDetents([.medium, .large])
            }
        }
    }
}

struct RecipesView: View {
    @Environment(DataStore.self) private var store
    @State private var query = ""

    var rows: [Restaurant] {
        let withRecipes = store.visible.filter { !$0.recipes.isEmpty }
        guard !query.isEmpty else { return withRecipes }
        return store.visible.filter {
            "\($0.name) \($0.city) \($0.recipes.map(\.title).joined(separator: " "))".localizedCaseInsensitiveContains(query)
        }.sorted { $0.recipes.count > $1.recipes.count }
    }

    var body: some View {
        NavigationStack {
            List {
                if rows.isEmpty && query.isEmpty {
                    Text("Recipe links fill in as the nightly data job matches Food Network recipes to restaurants. Search any spot to look up its recipes.")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                ForEach(rows.prefix(150)) { r in
                    Section {
                        NavigationLink(value: r) { RestaurantRow(r: r) }
                        ForEach(r.recipes, id: \.self) { rec in
                            if let u = URL(string: rec.url) { Link(destination: u) { Label(rec.title, systemImage: "book") } }
                        }
                    }
                }
            }
            .navigationTitle("Recipes")
            .searchable(text: $query, prompt: "Recipe or restaurant")
            .navigationDestination(for: Restaurant.self) { RestaurantDetailView(r: $0) }
        }
    }
}
