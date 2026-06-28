import XCTest
@testable import ACTIG

final class ToolDirectiveParserTests: XCTestCase {
    func testPlainTextHasNoCalls() {
        let (clean, calls) = ToolDirectiveParser.parse("Sure, here you go.")
        XCTAssertEqual(clean, "Sure, here you go.")
        XCTAssertTrue(calls.isEmpty)
    }

    func testParsesSingleCall() {
        let raw = """
        Playing that now.
        <<TOOL>>{"name":"playMusic","args":{"query":"daft punk"}}
        """
        let (clean, calls) = ToolDirectiveParser.parse(raw)
        XCTAssertEqual(clean, "Playing that now.")
        XCTAssertEqual(calls.count, 1)
        XCTAssertEqual(calls.first, ToolCall(name: "playMusic", args: ["query": "daft punk"]))
    }

    func testParsesMultipleCalls() {
        let raw = """
        On it.
        <<TOOL>>{"name":"openStudio","args":{"open":"true"}}
        <<TOOL>>{"name":"spawnShape","args":{"kind":"sphere"}}
        """
        let (_, calls) = ToolDirectiveParser.parse(raw)
        XCTAssertEqual(calls.count, 2)
        XCTAssertEqual(calls[0].name, "openStudio")
        XCTAssertEqual(calls[1].args["kind"], "sphere")
    }

    func testIgnoresMalformedDirective() {
        let (_, calls) = ToolDirectiveParser.parse("<<TOOL>>not json")
        XCTAssertTrue(calls.isEmpty)
    }
}

/// Minimal mock so the registry can be exercised without a running app.
@MainActor
private final class MockToolContext: AgentToolContext {
    var log: [String] = []
    func openStudio(_ open: Bool) { log.append("openStudio:\(open)") }
    func spawnShape(_ name: String) -> Bool { log.append("spawn:\(name)"); return true }
    func cloneSelectedShape() -> Bool { true }
    func scaleSelectedShape(_ factor: Float) -> Bool { true }
    func deleteSelectedShape() -> Bool { true }
    func setGestureControl(_ on: Bool) { log.append("gesture:\(on)") }
    func setUserMuted(_ muted: Bool) {}
    func setAIMuted(_ muted: Bool) {}
    func playMusic(_ query: String) async -> Bool { log.append("music:\(query)"); return true }
    func pauseMusic() {}
    func skipMusic() {}
    func openApp(_ name: String) -> Bool { log.append("app:\(name)"); return true }
    func openSettingsPane(_ pane: String?) -> Bool { true }
    func createReminder(_ title: String) async -> String { "Reminder added: \(title)." }
    func createCalendarEvent(_ title: String, at start: Date) async -> String { "Event scheduled: \(title)." }
    func lookupContact(_ name: String) async -> String { "\(name): 555" }
    func todaySteps() async -> String { "0 steps" }
}

@MainActor
final class ToolRegistryTests: XCTestCase {
    func testDispatchesPlayMusic() async {
        let ctx = MockToolContext()
        let registry = ToolRegistry.makeDefault(context: ctx)
        let result = await registry.execute(ToolCall(name: "playMusic", args: ["query": "jazz"]))
        XCTAssertEqual(result, "Playing jazz.")
        XCTAssertTrue(ctx.log.contains("music:jazz"))
    }

    func testUnknownToolReports() async {
        let registry = ToolRegistry.makeDefault(context: MockToolContext())
        let result = await registry.execute(ToolCall(name: "doesNotExist", args: [:]))
        XCTAssertTrue(result.contains("Unknown tool"))
    }

    func testCreateReminderFlows() async {
        let registry = ToolRegistry.makeDefault(context: MockToolContext())
        let result = await registry.execute(ToolCall(name: "createReminder", args: ["title": "Call mom"]))
        XCTAssertEqual(result, "Reminder added: Call mom.")
    }

    func testCatalogListsTools() {
        let catalog = ToolRegistry.makeDefault(context: MockToolContext()).catalogForPrompt
        XCTAssertTrue(catalog.contains("playMusic"))
        XCTAssertTrue(catalog.contains("openStudio"))
    }
}

@MainActor
final class LLMRouterEngineTests: XCTestCase {
    /// A stub engine to verify router fallback order without network/model.
    private final class StubEngine: BrainEngine, @unchecked Sendable {
        let available: Bool
        let reply: String
        let shouldThrow: Bool
        init(available: Bool, reply: String, shouldThrow: Bool = false) {
            self.available = available; self.reply = reply; self.shouldThrow = shouldThrow
        }
        var isAvailable: Bool { available }
        func complete(messages: [LLMMessage], language: AppLanguage) async throws -> LLMResponse {
            if shouldThrow { throw BrainError.noEngineAvailable }
            return LLMResponse(text: reply)
        }
    }

    func testFallsBackToLocalWhenCloudUnavailable() async throws {
        let cloud = StubEngine(available: false, reply: "cloud")
        let local = StubEngine(available: true, reply: "local")
        let router = LLMRouter(cloud: cloud, onDevice: [local])
        let r = try await router.complete(messages: [], language: .english)
        XCTAssertEqual(r.text, "local")
    }

    func testCloudPreferredWhenAvailable() async throws {
        let cloud = StubEngine(available: true, reply: "cloud")
        let local = StubEngine(available: true, reply: "local")
        let router = LLMRouter(cloud: cloud, onDevice: [local])
        let r = try await router.complete(messages: [], language: .english)
        XCTAssertEqual(r.text, "cloud")
    }

    func testPreferLocalSkipsCloud() async throws {
        let cloud = StubEngine(available: true, reply: "cloud")
        let local = StubEngine(available: true, reply: "local")
        let router = LLMRouter(cloud: cloud, onDevice: [local])
        router.preferLocal = true
        let r = try await router.complete(messages: [], language: .english)
        XCTAssertEqual(r.text, "local")
    }

    func testChainContinuesPastThrowingEngine() async throws {
        let cloud = StubEngine(available: true, reply: "cloud", shouldThrow: true)
        let local = StubEngine(available: true, reply: "local")
        let router = LLMRouter(cloud: cloud, onDevice: [local])
        let r = try await router.complete(messages: [], language: .english)
        XCTAssertEqual(r.text, "local")
    }
}
