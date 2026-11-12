import Foundation
import SwiftUI
import UIKit

/// Registro local en memoria (máx. 500 líneas). Nunca sale del teléfono:
/// solo se copia al portapapeles si tú pulsas "Copiar".
@MainActor
final class DiagnosticsLog: ObservableObject {
    struct Entry: Identifiable {
        let id = UUID()
        let date: Date
        let source: String
        let message: String
    }

    @Published private(set) var entries: [Entry] = []
    private let maxEntries = 500
    private let formatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        return f
    }()

    func add(_ source: String, _ message: String) {
        entries.append(Entry(date: Date(), source: source, message: message))
        if entries.count > maxEntries {
            entries.removeFirst(entries.count - maxEntries)
        }
    }

    func line(_ e: Entry) -> String {
        "\(formatter.string(from: e.date)) [\(e.source)] \(e.message)"
    }

    var fullText: String {
        entries.map(line).joined(separator: "\n")
    }
}

struct DiagnosticsView: View {
    @EnvironmentObject var model: AppModel
    @EnvironmentObject var log: DiagnosticsLog
    @State private var copied = false

    var body: some View {
        NavigationStack {
            List {
                Section("Build") {
                    Text("Versión \(AppModel.versionString) · iOS \(UIDevice.current.systemVersion)")
                        .font(.footnote.monospaced())
                }
                Section("Volcar DOM (para parchear selectores)") {
                    ForEach(model.sessions) { session in
                        Button("Volcar \(session.platform.title)") {
                            session.dumpDOM()
                        }
                    }
                }
                Section("Registro (\(log.entries.count))") {
                    ForEach(log.entries.reversed()) { e in
                        Text(log.line(e))
                            .font(.caption2.monospaced())
                            .textSelection(.enabled)
                    }
                }
            }
            .navigationTitle("Diagnóstico")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(copied ? "Copiado" : "Copiar todo") {
                        UIPasteboard.general.string =
                            "SinReels \(AppModel.versionString) iOS \(UIDevice.current.systemVersion)\n" + log.fullText
                        copied = true
                    }
                }
            }
        }
    }
}
