import Foundation
import CoreLocation

struct DataFile: Codable {
    let meta: Meta
    let restaurants: [Restaurant]
}

struct Meta: Codable {
    let generated: String
    let count: Int
    let open: Int
    let closed: Int
    let withRecipes: Int
}

struct Appearance: Codable, Hashable {
    let season: Int
    let episode: String
    let title: String
    let airdate: String
}

struct Recipe: Codable, Hashable {
    let title: String
    let url: String
}

struct Restaurant: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let city: String
    let state: String
    let country: String
    let lat: Double?
    let lon: Double?
    let status: String          // open | closed | unknown
    let rating: Double?
    let reviews: Int?
    let price: String?
    let cats: [String]
    let addr: String?
    let phone: String?
    let maps: String?
    let web: String?
    let statusDetail: String?
    let img: String?
    let checked: String?
    let note: String?
    let appearances: [Appearance]
    let recipes: [Recipe]
    let facts: [String]

    var coordinate: CLLocationCoordinate2D? {
        guard let lat, let lon else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }
    var isOpen: Bool { status == "open" }
    var isClosed: Bool { status == "closed" }
    var statusLabel: String { isOpen ? "Open" : isClosed ? "Closed" : "Likely open" }
    var latestSeason: Int { appearances.map(\.season).max() ?? 0 }
    var regionKey: String {
        country == "USA" ? state : (country == "Canada" ? "\(state), Canada" : country)
    }
    var displayAddress: String { addr ?? "\(city), \(state)" }

    var emoji: String {
        let t = (cats.joined(separator: " ") + " " + name + " " + appearances.map(\.title).joined(separator: " ")).lowercased()
        let table: [(String, String)] = [("bbq", "🍖"), ("barbecue", "🍖"), ("pizza", "🍕"), ("taco", "🌮"), ("mexican", "🌮"),
                                         ("burger", "🍔"), ("seafood", "🦞"), ("fish", "🦞"), ("breakfast", "🥞"), ("diner", "🥞"),
                                         ("sandwich", "🥪"), ("deli", "🥪"), ("chicken", "🍗"), ("donut", "🍩"), ("pie", "🥧"),
                                         ("ramen", "🍜"), ("noodle", "🍜"), ("italian", "🍝"), ("pasta", "🍝")]
        return table.first { t.contains($0.0) }?.1 ?? "🍽️"
    }
}

enum USStates {
    static let names: [String: String] = [
        "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
        "CT": "Connecticut", "DE": "Delaware", "DC": "Washington, D.C.", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii",
        "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
        "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
        "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
        "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
        "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
        "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
        "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming", "PR": "Puerto Rico",
    ]
    static func name(_ key: String) -> String { names[key] ?? key }
}
