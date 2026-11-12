import Foundation
import JavaScriptCore

enum FilterDecision: Equatable {
    case allow
    case redirect(URL)
    case block(fallback: URL?)
    case external
}

/// Capa 1 (WKNavigationDelegate). Ejecuta el MISMO core.js que corre en la página
/// y en los tests de Node, vía JavaScriptCore, para que las reglas no diverjan.
final class FilterEngine {
    private let context: JSContext
    private let decideFunction: JSValue
    private var platformValues: [String: JSValue] = [:]
    private(set) var lastError: String?

    init(coreSource: String, platforms: [PlatformConfig]) throws {
        guard let ctx = JSContext() else { throw RulesError.invalid("no se pudo crear JSContext") }
        context = ctx
        var captured: String?
        ctx.exceptionHandler = { _, exception in
            captured = exception?.toString()
        }
        ctx.evaluateScript(coreSource)
        if let e = captured { throw RulesError.invalid("core.js: \(e)") }

        guard let core = ctx.objectForKeyedSubscript("SinReelsCore"), !core.isUndefined,
              let fn = core.objectForKeyedSubscript("decide"), !fn.isUndefined,
              let parse = ctx.objectForKeyedSubscript("JSON")?.objectForKeyedSubscript("parse") else {
            throw RulesError.invalid("core.js no expone SinReelsCore.decide")
        }
        decideFunction = fn

        for p in platforms {
            guard let value = parse.call(withArguments: [p.rawJSON]), !value.isUndefined else {
                throw RulesError.invalid("JSON de \(p.id) no parsea en JS")
            }
            platformValues[p.id] = value
        }
        if let e = captured { throw RulesError.invalid("core.js: \(e)") }

        ctx.exceptionHandler = { [weak self] _, exception in
            self?.lastError = exception?.toString()
        }
    }

    func decide(platformID: String, url: URL) -> FilterDecision {
        guard let platform = platformValues[platformID],
              let result = decideFunction.call(withArguments: [platform, url.absoluteString]),
              let dict = result.toDictionary() as? [String: Any],
              let action = dict["action"] as? String else {
            // Ante un error interno dejamos pasar y queda registrado en Diagnóstico.
            return .allow
        }
        let to = (dict["to"] as? String).flatMap(URL.init(string:))
        switch action {
        case "redirect":
            if let to { return .redirect(to) }
            return .block(fallback: nil)
        case "block":
            return .block(fallback: to)
        case "external":
            return .external
        default:
            return .allow
        }
    }
}
