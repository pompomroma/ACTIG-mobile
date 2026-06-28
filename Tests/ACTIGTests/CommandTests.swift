import XCTest
@testable import ACTIG

final class MusicQueryExtractorTests: XCTestCase {
    func testExtractsAfterPlay() {
        XCTAssertEqual(MusicQueryExtractor.extract(from: "play Bohemian Rhapsody"),
                       "Bohemian Rhapsody")
    }
    func testExtractsAfterPutOn() {
        XCTAssertEqual(MusicQueryExtractor.extract(from: "put on some jazz"), "some jazz")
    }
    func testFallsBackToWholeText() {
        XCTAssertEqual(MusicQueryExtractor.extract(from: "Bohemian Rhapsody"),
                       "Bohemian Rhapsody")
    }
}

final class LocalizedTests: XCTestCase {
    func testEnglishPassthrough() {
        XCTAssertEqual(Localized.confirm("Opening the 3D project space.", .english),
                       "Opening the 3D project space.")
    }
    func testKoreanTranslation() {
        XCTAssertEqual(Localized.confirm("Opening the 3D project space.", .korean),
                       "3D 프로젝트 공간을 엽니다.")
    }
    func testUnknownStringFallsBackToEnglish() {
        XCTAssertEqual(Localized.confirm("Totally new string", .korean), "Totally new string")
    }
}

final class AppLanguageTests: XCTestCase {
    func testRawValuesAreBCP47() {
        XCTAssertEqual(AppLanguage.english.rawValue, "en-US")
        XCTAssertEqual(AppLanguage.korean.rawValue, "ko-KR")
    }
    func testDisplayNames() {
        XCTAssertEqual(AppLanguage.japanese.displayName, "Japanese")
    }
}
