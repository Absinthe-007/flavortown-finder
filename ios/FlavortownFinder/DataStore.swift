import Foundation
import Observation

/// Loads restaurants.json from the GitHub Pages site (same data the web app uses) and caches it on disk.
@Observable
final class DataStore {
    // Change this if your GitHub username or repo name differs.
    static let dataURL = URL(string: "https://absinthe-007.github.io/flavortown-finder/data/restaurants.json")!

    var restaurants: [Restaurant] = []
    var meta: Meta?
    var openOnly = true
    var error: String?
    var isLoading = false

    private var cacheURL: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("restaurants.json")
    }

    var visible: [Restaurant] { openOnly ? restaurants.filter { !$0.isClosed } : restaurants }

    func load() async {
        if restaurants.isEmpty, let data = try? Data(contentsOf: cacheURL) { decode(data) }
        isLoading = true
        defer { isLoading = false }
        do {
            let (data, resp) = try await URLSession.shared.data(from: Self.dataURL)
            guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            decode(data)
            try? data.write(to: cacheURL)
            error = nil
        } catch {
            if restaurants.isEmpty { self.error = "Couldn't load restaurants: \(error.localizedDescription)" }
        }
    }

    private func decode(_ data: Data) {
        if let file = try? JSONDecoder().decode(DataFile.self, from: data) {
            restaurants = file.restaurants
            meta = file.meta
        }
    }

    func regions() -> [(key: String, count: Int, open: Int, intl: Bool)] {
        var dict: [String: (Int, Int, Bool)] = [:]
        for r in visible {
            var v = dict[r.regionKey] ?? (0, 0, r.country != "USA")
            v.0 += 1
            if r.isOpen { v.1 += 1 }
            dict[r.regionKey] = v
        }
        return dict.map { (key: $0.key, count: $0.value.0, open: $0.value.1, intl: $0.value.2) }
            .sorted { ($0.intl ? 1 : 0, USStates.name($0.key)) < ($1.intl ? 1 : 0, USStates.name($1.key)) }
    }
}
