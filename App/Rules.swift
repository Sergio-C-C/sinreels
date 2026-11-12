import Foundation

/// Lo mínimo que Swift necesita de cada plataforma. El resto de rules.json
/// se pasa tal cual (rawJSON) a JavaScript, para que haya UNA sola fuente de verdad.
struct PlatformConfig: Identifiable {
    let id: String
    let title: String
    let systemImage: String
    let startURL: URL
    let dataStoreID: UUID
    let userAgentMode: String
    let rawJSON: String
}

enum RulesError: Error, LocalizedError {
    case missingFile(String)
    case invalid(String)

    var errorDescription: String? {
        switch self {
        case .missingFile(let name): return "Falta el recurso \(name) en el bundle"
        case .invalid(let why): return "Reglas inválidas: \(why)"
        }
    }
}

enum Resource {
    static func text(_ name: String, _ ext: String, bundle: Bundle = .main) throws -> String {
        guard let url = bundle.url(forResource: name, withExtension: ext) else {
            throw RulesError.missingFile("\(name).\(ext)")
        }
        return try String(contentsOf: url, encoding: .utf8)
    }
}

enum RulesLoader {
    static func load(from bundle: Bundle = .main) throws -> [PlatformConfig] {
        guard let url = bundle.url(forResource: "rules", withExtension: "json") else {
            throw RulesError.missingFile("rules.json")
        }
        return try parse(Data(contentsOf: url))
    }

    static func parse(_ data: Data) throws -> [PlatformConfig] {
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let platforms = root["platforms"] as? [[String: Any]] else {
            throw RulesError.invalid("falta la lista 'platforms'")
        }
        return try platforms.map { (p: [String: Any]) -> PlatformConfig in
            guard let id = p["id"] as? String,
                  let title = p["title"] as? String,
                  let startString = p["startURL"] as? String,
                  let start = URL(string: startString),
                  let storeString = p["dataStoreID"] as? String,
                  let store = UUID(uuidString: storeString) else {
                throw RulesError.invalid("plataforma incompleta: \(p["id"] ?? "?")")
            }
            let raw = try JSONSerialization.data(withJSONObject: p)
            return PlatformConfig(
                id: id,
                title: title,
                systemImage: p["systemImage"] as? String ?? "globe",
                startURL: start,
                dataStoreID: store,
                userAgentMode: p["userAgent"] as? String ?? "default",
                rawJSON: String(decoding: raw, as: UTF8.self)
            )
        }
    }
}
