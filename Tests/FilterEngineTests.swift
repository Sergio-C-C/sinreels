import JavaScriptCore
import XCTest
@testable import SinReels

/// Corre los MISMOS casos (Tests/cases.json) que tools/check.mjs en Node,
/// pero a través de JavaScriptCore, igual que en la app.
final class FilterEngineTests: XCTestCase {
    private struct Case: Decodable {
        let platform: String
        let url: String
        let action: String
        let to: String?
    }

    private func makeEngine() throws -> (FilterEngine, [PlatformConfig]) {
        let platforms = try RulesLoader.load(from: .main)
        let core = try Resource.text("core", "js", bundle: .main)
        return (try FilterEngine(coreSource: core, platforms: platforms), platforms)
    }

    func testSharedCases() throws {
        let (engine, _) = try makeEngine()
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "cases", withExtension: "json"))
        let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: url))
        XCTAssertGreaterThan(cases.count, 10)

        for c in cases {
            let target = try XCTUnwrap(URL(string: c.url), c.url)
            let decision = engine.decide(platformID: c.platform, url: target)
            switch decision {
            case .allow:
                XCTAssertEqual(c.action, "allow", c.url)
            case .redirect(let to):
                XCTAssertEqual(c.action, "redirect", c.url)
                XCTAssertEqual(to.absoluteString, c.to, c.url)
            case .block(let fallback):
                XCTAssertEqual(c.action, "block", c.url)
                if let expected = c.to { XCTAssertEqual(fallback?.absoluteString, expected, c.url) }
            case .external:
                XCTAssertEqual(c.action, "external", c.url)
            }
        }
    }

    func testDataStoresAreUniquePerPlatform() throws {
        let (_, platforms) = try makeEngine()
        XCTAssertEqual(Set(platforms.map(\.dataStoreID)).count, platforms.count)
        XCTAssertEqual(Set(platforms.map(\.id)).count, platforms.count)
    }

    func testPageScriptEvaluatesWithoutSyntaxErrors() throws {
        let platforms = try RulesLoader.load(from: .main)
        let core = try Resource.text("core", "js", bundle: .main)
        let page = try Resource.text("page", "js", bundle: .main)
        let ctx = try XCTUnwrap(JSContext())
        var error: String?
        ctx.exceptionHandler = { _, e in error = e?.toString() }
        // Solo definimos (sin llamar a start, que necesita DOM): comprueba sintaxis.
        ctx.evaluateScript(core + "\n;\n" + page)
        XCTAssertNil(error)
        XCTAssertFalse(ctx.objectForKeyedSubscript("SinReelsPage").isUndefined)
        for p in platforms {
            let css = ctx.evaluateScript("SinReelsPage.buildCSS(\(p.rawJSON))")?.toString() ?? ""
            XCTAssertTrue(css.contains("display: none !important"), p.id)
        }
        XCTAssertNil(error)
    }
}
