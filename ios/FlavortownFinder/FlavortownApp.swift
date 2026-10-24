import SwiftUI

extension Color {
    static let flame = Color(red: 1.0, green: 0.35, blue: 0.12)
    static let flameGold = Color(red: 1.0, green: 0.69, blue: 0.13)
    static let panel = Color(red: 0.13, green: 0.11, blue: 0.09)
}

@main
struct FlavortownApp: App {
    @State private var store = DataStore()
    @State private var trip = TripModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(trip)
                .preferredColorScheme(.dark)
                .tint(.flame)
                .task { await store.load() }
        }
    }
}

struct RootView: View {
    @Environment(DataStore.self) private var store
    @Environment(TripModel.self) private var trip

    var body: some View {
        @Bindable var trip = trip
        TabView(selection: $trip.selectedTab) {
            StatesView().tabItem { Label("States", systemImage: "map") }.tag(0)
            MapTabView().tabItem { Label("Map", systemImage: "mappin.and.ellipse") }.tag(1)
            RecipesView().tabItem { Label("Recipes", systemImage: "frying.pan") }.tag(2)
            TripView().tabItem { Label("Trip", systemImage: "car.fill") }.tag(3)
        }
        .overlay {
            if let err = store.error { ContentUnavailableView("No data", systemImage: "wifi.slash", description: Text(err)) }
        }
    }
}

struct OpenOnlyToggle: View {
    @Environment(DataStore.self) private var store
    var body: some View {
        @Bindable var store = store
        Toggle(isOn: $store.openOnly) { Text("Open only").font(.caption) }
            .toggleStyle(.switch)
            .tint(.green)
            .fixedSize()
    }
}

struct StatusBadge: View {
    let r: Restaurant
    var body: some View {
        Text(r.statusLabel.uppercased())
            .font(.caption2.bold())
            .padding(.horizontal, 8).padding(.vertical, 2)
            .background(color.opacity(0.18), in: Capsule())
            .foregroundStyle(color)
    }
    var color: Color { r.isOpen ? .green : r.isClosed ? .red : .gray }
}
