import Foundation

/// Operations the agent can perform on the device/app. Implemented by `AppState`
/// in production and by a mock in tests, so the tool layer is fully testable
/// without a running app.
@MainActor
protocol AgentToolContext: AnyObject {
    func openStudio(_ open: Bool)
    func spawnShape(_ name: String) -> Bool
    func cloneSelectedShape() -> Bool
    func scaleSelectedShape(_ factor: Float) -> Bool
    func deleteSelectedShape() -> Bool
    func setGestureControl(_ on: Bool)
    func setUserMuted(_ muted: Bool)
    func setAIMuted(_ muted: Bool)
    func playMusic(_ query: String) async -> Bool
    func pauseMusic()
    func skipMusic()
    func openApp(_ name: String) -> Bool
    func openSettingsPane(_ pane: String?) -> Bool
    func createReminder(_ title: String) async -> String
    func createCalendarEvent(_ title: String, at start: Date) async -> String
    func lookupContact(_ name: String) async -> String
    func todaySteps() async -> String
}

/// A single callable tool. `paramHint` documents the JSON args for the model;
/// `run` executes the call and returns a short human result for the log/reply.
struct AgentTool: Sendable {
    let name: String
    let summary: String
    let paramHint: String
    let run: @MainActor ([String: String]) async -> String
}

/// One parsed tool invocation from a model reply.
struct ToolCall: Equatable {
    let name: String
    let args: [String: String]
}

/// Parses `<<TOOL>>{"name":"…","args":{…}}` directives out of a model reply.
/// Uniform across every brain engine (Claude, Foundation Models, local), so we
/// don't depend on any one provider's native tool-calling API.
enum ToolDirectiveParser {
    static let marker = "<<TOOL>>"

    /// Returns the prose with directives stripped, plus the extracted calls.
    static func parse(_ text: String) -> (clean: String, calls: [ToolCall]) {
        guard text.contains(marker) else { return (text, []) }
        var calls: [ToolCall] = []
        var cleanLines: [String] = []

        for line in text.components(separatedBy: .newlines) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix(marker) else { cleanLines.append(line); continue }
            let json = String(trimmed.dropFirst(marker.count)).trimmingCharacters(in: .whitespaces)
            if let call = decode(json) { calls.append(call) }
        }
        let clean = cleanLines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return (clean, calls)
    }

    private static func decode(_ json: String) -> ToolCall? {
        guard let data = json.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let name = obj["name"] as? String else { return nil }
        var args: [String: String] = [:]
        if let raw = obj["args"] as? [String: Any] {
            for (k, v) in raw { args[k] = String(describing: v) }
        }
        return ToolCall(name: name, args: args)
    }
}

/// Holds the tool set and dispatches calls. The default set binds to an
/// `AgentToolContext`.
@MainActor
final class ToolRegistry {
    private(set) var tools: [String: AgentTool] = [:]

    init(tools: [AgentTool] = []) { tools.forEach { self.tools[$0.name] = $0 } }

    func register(_ tool: AgentTool) { tools[tool.name] = tool }

    /// Execute a parsed call; returns the tool's result or an error note.
    func execute(_ call: ToolCall) async -> String {
        guard let tool = tools[call.name] else { return "Unknown tool: \(call.name)." }
        return await tool.run(call.args)
    }

    /// Human-readable catalog injected into the system prompt so the model knows
    /// what it can call and how.
    var catalogForPrompt: String {
        tools.values
            .sorted { $0.name < $1.name }
            .map { "- \($0.name): \($0.summary) args: \($0.paramHint)" }
            .joined(separator: "\n")
    }

    /// Builds the production tool set bound to the given context.
    static func makeDefault(context ctx: AgentToolContext) -> ToolRegistry {
        let r = ToolRegistry()
        r.register(.init(name: "openStudio", summary: "Open or close the 3D project space.",
                         paramHint: "{\"open\":\"true|false\"}") { a in
            ctx.openStudio((a["open"] ?? "true") != "false")
            return "3D project space \((a["open"] ?? "true") != "false" ? "opened" : "closed")."
        })
        r.register(.init(name: "spawnShape", summary: "Add a 3D shape (box, sphere, cylinder, cone, plane).",
                         paramHint: "{\"kind\":\"box\"}") { a in
            ctx.spawnShape(a["kind"] ?? "box") ? "Added a \(a["kind"] ?? "box")." : "Open the 3D space first."
        })
        r.register(.init(name: "cloneShape", summary: "Clone the selected 3D object.",
                         paramHint: "{}") { _ in ctx.cloneSelectedShape() ? "Cloned." : "Nothing selected." })
        r.register(.init(name: "scaleShape", summary: "Scale the selected object by a factor.",
                         paramHint: "{\"factor\":\"1.2\"}") { a in
            ctx.scaleSelectedShape(Float(a["factor"] ?? "1") ?? 1) ? "Scaled." : "Nothing selected."
        })
        r.register(.init(name: "deleteShape", summary: "Delete the selected 3D object.",
                         paramHint: "{}") { _ in ctx.deleteSelectedShape() ? "Deleted." : "Nothing selected." })
        r.register(.init(name: "setGesture", summary: "Toggle camera hand-gesture control.",
                         paramHint: "{\"on\":\"true|false\"}") { a in
            ctx.setGestureControl((a["on"] ?? "true") != "false"); return "Gesture control updated."
        })
        r.register(.init(name: "muteUser", summary: "Mute/unmute the user's mic.",
                         paramHint: "{\"muted\":\"true|false\"}") { a in
            ctx.setUserMuted((a["muted"] ?? "true") != "false"); return "Mic updated."
        })
        r.register(.init(name: "muteAI", summary: "Mute/unmute ACTIG's voice.",
                         paramHint: "{\"muted\":\"true|false\"}") { a in
            ctx.setAIMuted((a["muted"] ?? "true") != "false"); return "Voice updated."
        })
        r.register(.init(name: "playMusic", summary: "Play a song/artist.",
                         paramHint: "{\"query\":\"…\"}") { a in
            await ctx.playMusic(a["query"] ?? "") ? "Playing \(a["query"] ?? "")." : "Couldn't play that."
        })
        r.register(.init(name: "openApp", summary: "Open another app by name.",
                         paramHint: "{\"name\":\"spotify\"}") { a in
            ctx.openApp(a["name"] ?? "") ? "Opening \(a["name"] ?? "")." : "That app isn't reachable."
        })
        r.register(.init(name: "openSettings", summary: "Open a Settings pane (wifi, bluetooth, …) or app settings.",
                         paramHint: "{\"pane\":\"wifi\"}") { a in
            ctx.openSettingsPane(a["pane"]) ? "Opening settings." : "Couldn't open settings."
        })
        r.register(.init(name: "createReminder", summary: "Create a reminder.",
                         paramHint: "{\"title\":\"…\"}") { a in await ctx.createReminder(a["title"] ?? "") })
        r.register(.init(name: "createEvent", summary: "Create a calendar event now.",
                         paramHint: "{\"title\":\"…\"}") { a in
            await ctx.createCalendarEvent(a["title"] ?? "", at: Date().addingTimeInterval(3600))
        })
        r.register(.init(name: "lookupContact", summary: "Look up a contact by name.",
                         paramHint: "{\"name\":\"…\"}") { a in await ctx.lookupContact(a["name"] ?? "") })
        r.register(.init(name: "todaySteps", summary: "Report today's step count from Health.",
                         paramHint: "{}") { _ in await ctx.todaySteps() })
        return r
    }
}
