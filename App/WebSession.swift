import SwiftUI
import UIKit
import WebKit

/// Un WKWebView por plataforma, vivo durante toda la app (no se recrea al cambiar de pestaña).
@MainActor
final class WebSession: NSObject, ObservableObject, Identifiable, WKNavigationDelegate, WKUIDelegate {
    let id: String
    let platform: PlatformConfig
    let webView: WKWebView
    private let engine: FilterEngine
    private let log: DiagnosticsLog

    init(platform: PlatformConfig, engine: FilterEngine, coreSource: String, pageSource: String, log: DiagnosticsLog) {
        self.id = platform.id
        self.platform = platform
        self.engine = engine
        self.log = log

        let config = WKWebViewConfiguration()
        // Sesión persistente y separada por plataforma (iOS 17+). Nada se sincroniza fuera del teléfono.
        config.websiteDataStore = WKWebsiteDataStore(forIdentifier: platform.dataStoreID)
        config.allowsInlineMediaPlayback = true
        // Sin autoplay: los vídeos solo arrancan si tú tocas. Menos enganche.
        config.mediaTypesRequiringUserActionForPlayback = .all
        if platform.userAgentMode == "safari" {
            config.applicationNameForUserAgent = WebSession.safariApplicationName()
        }

        let controller = WKUserContentController()
        let source = ScriptFactory.pageScript(core: coreSource, page: pageSource, platformJSON: platform.rawJSON)
        controller.addUserScript(WKUserScript(source: source,
                                              injectionTime: .atDocumentStart,
                                              forMainFrameOnly: true,
                                              in: .defaultClient))
        config.userContentController = controller

        webView = WKWebView(frame: .zero, configuration: config)
        super.init()

        controller.add(WeakMessageHandler(self), contentWorld: .defaultClient, name: "sinreels")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        if #available(iOS 16.4, *) { webView.isInspectable = true }

        log.add(platform.id, "inicio → \(platform.startURL.absoluteString)")
        webView.load(URLRequest(url: platform.startURL))
    }

    /// Igual que Safari: "Version/<iOS> Mobile/15E148 Safari/604.1".
    /// Google suele rechazar el login en WebViews; con este sufijo el UA es idéntico al de Safari.
    static func safariApplicationName() -> String {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        return "Version/\(v.majorVersion).\(v.minorVersion) Mobile/15E148 Safari/604.1"
    }

    func dumpDOM() {
        webView.evaluateJavaScript("SinReelsPage.dump()", in: nil, in: .defaultClient) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let value):
                self.log.add(self.platform.id, "DOM:\n\(value)")
            case .failure(let error):
                self.log.add(self.platform.id, "DOM error: \(error.localizedDescription)")
            }
        }
    }

    func handleScriptMessage(_ body: Any) {
        guard let dict = body as? [String: Any], let type = dict["type"] as? String else { return }
        switch type {
        case "ready":
            log.add(platform.id, "js listo \(dict["url"] ?? "") UA=\(dict["ua"] ?? "")")
        case "blocked":
            log.add(platform.id, "js \(dict["action"] ?? "") vía \(dict["via"] ?? "") \(dict["url"] ?? "") → \(dict["to"] ?? "-") regla=\(dict["rule"] ?? "-")")
        case "hidden":
            log.add(platform.id, "ocultados(JS)=\(dict["count"] ?? 0) en \(dict["url"] ?? "")")
        default:
            break
        }
    }

    // MARK: - Capa 1: bloqueo por URL (cargas completas y redirecciones del servidor)

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .allow }
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        guard isMainFrame else { return .allow }

        switch engine.decide(platformID: platform.id, url: url) {
        case .allow:
            return .allow
        case .redirect(let target):
            log.add(platform.id, "nativo redirect \(url.absoluteString) → \(target.absoluteString)")
            DispatchQueue.main.async { webView.load(URLRequest(url: target)) }
            return .cancel
        case .block(let fallback):
            log.add(platform.id, "nativo bloqueo \(url.absoluteString)")
            if webView.url == nil, let fallback {
                DispatchQueue.main.async { webView.load(URLRequest(url: fallback)) }
            }
            return .cancel
        case .external:
            log.add(platform.id, "externo \(url.absoluteString)")
            // Con completionHandler explícito se elige la variante síncrona (la otra exige await).
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
            return .cancel
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let ns = error as NSError
        // -999 = cancelada (normal cuando nosotros bloqueamos). 102 = carga interrumpida por política.
        if ns.code == NSURLErrorCancelled || ns.code == 102 { return }
        log.add(platform.id, "error de carga \(ns.domain) \(ns.code): \(ns.localizedDescription)")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        log.add(platform.id, "proceso web terminado; recargando")
        webView.reload()
    }

    // Enlaces con target=_blank / window.open: se abren en la misma vista (pasan por las reglas).
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil {
            webView.load(navigationAction.request)
        }
        return nil
    }
}

/// Evita el ciclo de retención WKUserContentController → handler.
final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var session: WebSession?

    init(_ session: WebSession) {
        self.session = session
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let body = message.body
        MainActor.assumeIsolated {
            session?.handleScriptMessage(body)
        }
    }
}

enum ScriptFactory {
    /// core.js + page.js + arranque con las reglas de la plataforma, en un solo script.
    static func pageScript(core: String, page: String, platformJSON: String) -> String {
        core + "\n;\n" + page + "\n;\nSinReelsPage.start(" + platformJSON + ");\n"
    }
}

/// Contenedor que re-aloja el WKWebView persistente si SwiftUI recrea la vista.
struct WebViewContainer: UIViewRepresentable {
    let session: WebSession

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        attach(to: container)
        return container
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        if session.webView.superview !== uiView { attach(to: uiView) }
    }

    private func attach(to container: UIView) {
        let wv = session.webView
        wv.removeFromSuperview()
        wv.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(wv)
        NSLayoutConstraint.activate([
            wv.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            wv.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            wv.topAnchor.constraint(equalTo: container.topAnchor),
            wv.bottomAnchor.constraint(equalTo: container.bottomAnchor)
        ])
    }
}
