import SwiftUI

@main
struct SinReelsApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .environmentObject(model.log)
        }
    }
}

@MainActor
final class AppModel: ObservableObject {
    let log: DiagnosticsLog
    let sessions: [WebSession]
    let loadError: String?

    static var versionString: String {
        let info = Bundle.main.infoDictionary
        let v = info?["CFBundleShortVersionString"] as? String ?? "?"
        let b = info?["CFBundleVersion"] as? String ?? "?"
        return "\(v) (\(b))"
    }

    init() {
        let log = DiagnosticsLog()
        self.log = log
        do {
            // Las reglas van DENTRO del binario: cambiarlas exige recompilar e instalar.
            // No hay ajustes ni interruptor para desactivar el bloqueo (a propósito).
            let platforms = try RulesLoader.load()
            let core = try Resource.text("core", "js")
            let page = try Resource.text("page", "js")
            let engine = try FilterEngine(coreSource: core, platforms: platforms)
            sessions = platforms.map {
                WebSession(platform: $0, engine: engine, coreSource: core, pageSource: page, log: log)
            }
            loadError = nil
        } catch {
            sessions = []
            loadError = error.localizedDescription
        }
    }
}

struct RootView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        if let error = model.loadError {
            Text("No se pudieron cargar las reglas:\n\(error)")
                .padding()
        } else {
            TabView {
                ForEach(model.sessions) { session in
                    WebViewContainer(session: session)
                        .tabItem { Label(session.platform.title, systemImage: session.platform.systemImage) }
                        .tag(session.id)
                }
                DiagnosticsView()
                    .tabItem { Label("Diagnóstico", systemImage: "stethoscope") }
                    .tag("diagnostics")
            }
        }
    }
}
