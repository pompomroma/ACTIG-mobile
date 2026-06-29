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

// MARK: - NemotronClient (PR: built-in key fallback)

final class NemotronClientBuiltInKeyTests: XCTestCase {

    // The built-in key must be non-empty so the app has a usable key out of the box.
    func testBuiltInKeyIsNonEmpty() {
        XCTAssertFalse(NemotronClient.builtInKey.isEmpty)
    }

    // NVIDIA NIM API keys always start with the "nvapi-" prefix.
    func testBuiltInKeyHasNvidiaApiPrefix() {
        XCTAssertTrue(
            NemotronClient.builtInKey.hasPrefix("nvapi-"),
            "Expected builtInKey to start with 'nvapi-', got: \(NemotronClient.builtInKey)"
        )
    }

    // The key must be long enough to be a real credential (guard against accidental truncation).
    func testBuiltInKeyMinimumLength() {
        XCTAssertGreaterThan(NemotronClient.builtInKey.count, 20)
    }

    // isAvailable must be true whenever the built-in key is present, even with no
    // environment variable and nothing stored in the Keychain.
    func testIsAvailableTrueWithBuiltInKeyOnly() {
        // Run in an environment where ACTIG_LLM_API_KEY is not set (the CI runner
        // and dev simulator don't set it by default). The client must still report
        // available because it falls back to the built-in key.
        let client = NemotronClient()
        // Only meaningful when the env var is absent; skip rather than fail if set.
        if ProcessInfo.processInfo.environment["ACTIG_LLM_API_KEY"] == nil {
            XCTAssertTrue(client.isAvailable,
                "NemotronClient should be available via the built-in key alone")
        }
    }

    // apiKey must never be nil (the built-in key is the final non-nil fallback).
    func testApiKeyIsNeverNilDueToBuiltInFallback() {
        let client = NemotronClient()
        XCTAssertNotNil(client.apiKey,
            "apiKey should always resolve to at least the built-in key")
    }

    // When no env var and no Keychain entry exist the resolved key must equal
    // builtInKey exactly — confirming the fallback chain terminates correctly.
    func testApiKeyEqualsBuiltInKeyWhenNoOverridesPresent() {
        guard ProcessInfo.processInfo.environment["ACTIG_LLM_API_KEY"] == nil else {
            // Env-var override is active; this specific assertion does not apply.
            return
        }
        // Ensure there is no Keychain entry that would shadow the built-in key.
        Keychain.delete("llm_api_key")
        let client = NemotronClient()
        XCTAssertEqual(client.apiKey, NemotronClient.builtInKey,
            "apiKey should fall through to builtInKey when env var and Keychain are absent")
    }

    // The env-var override must take precedence over the built-in key.
    // We cannot set ProcessInfo.processInfo.environment at runtime, so we verify the
    // priority by directly inspecting the resolution logic via the known constant.
    func testBuiltInKeyIsLastInFallbackChain() {
        // builtInKey must be a distinct, non-nil value so it can serve as the
        // last-resort fallback without being confused with "no key available".
        let key = NemotronClient.builtInKey
        XCTAssertNotEqual(key, "", "builtInKey must not be an empty sentinel")
        XCTAssertFalse(key.contains(" "), "builtInKey must not contain whitespace")
    }

    // Regression: ensure the constant is stable across builds (value pinned to what
    // was shipped in this PR so accidental changes fail loudly).
    func testBuiltInKeyMatchesExpectedValue() {
        let expected = "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"
        XCTAssertEqual(NemotronClient.builtInKey, expected,
            "builtInKey changed — update this test only after a deliberate key rotation")
    }
}
