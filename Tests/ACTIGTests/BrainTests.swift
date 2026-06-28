import XCTest
@testable import ACTIG

final class StructuredReplyParserTests: XCTestCase {
    func testPlainReplyHasNoOptions() {
        let r = StructuredReplyParser.parse("Just a normal answer.")
        XCTAssertEqual(r.text, "Just a normal answer.")
        XCTAssertTrue(r.options.isEmpty)
        XCTAssertTrue(r.suggestions.isEmpty)
    }

    func testParsesOptionsAndSuggestions() {
        let raw = """
        Here are your choices.
        <<OPTIONS>>
        - Make it red
        - Make it blue
        <<SUGGESTIONS>>
        - I'd go with blue
        """
        let r = StructuredReplyParser.parse(raw)
        XCTAssertEqual(r.text, "Here are your choices.")
        XCTAssertEqual(r.options, ["Make it red", "Make it blue"])
        XCTAssertEqual(r.suggestions, ["I'd go with blue"])
    }

    func testOptionsOnly() {
        let raw = "Pick one.\n<<OPTIONS>>\n- A\n- B"
        let r = StructuredReplyParser.parse(raw)
        XCTAssertEqual(r.options, ["A", "B"])
        XCTAssertTrue(r.suggestions.isEmpty)
    }
}

final class LanguageDetectorTests: XCTestCase {
    func testDetectsEnglish() {
        XCTAssertEqual(LanguageDetector.detect("Hello there, how are you?"), .english)
    }
    func testDetectsKorean() {
        XCTAssertEqual(LanguageDetector.detect("안녕하세요 오늘 날씨 어때요"), .korean)
    }
    func testDetectsJapanese() {
        XCTAssertEqual(LanguageDetector.detect("こんにちは、元気ですか"), .japanese)
    }
}

final class LocalEngineTests: XCTestCase {
    func testOfflineFallbackIsLocalized() {
        XCTAssertTrue(LocalEngine.offlineFallback(language: .english).contains("offline"))
        XCTAssertFalse(LocalEngine.offlineFallback(language: .korean).isEmpty)
    }

    func testLocalEngineAlwaysAvailable() {
        XCTAssertTrue(LocalEngine().isAvailable)
    }
}
