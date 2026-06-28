import Foundation

/// Lightweight confirmation localizer for the deterministic command replies.
/// For anything richer, the brain handles translation; this just keeps short
/// system confirmations in the user's language (req 1).
enum Localized {
    /// Known short confirmations mapped per language. Falls back to the English
    /// string so new phrases still work before translations are added.
    private static let table: [String: [AppLanguage: String]] = [
        "Opening the 3D project space.": [
            .korean: "3D 프로젝트 공간을 엽니다.",
            .japanese: "3Dプロジェクト空間を開きます。",
            .chinese: "正在打开3D项目空间。"
        ],
        "Closing the 3D project space.": [
            .korean: "3D 프로젝트 공간을 닫습니다.",
            .japanese: "3Dプロジェクト空間を閉じます。",
            .chinese: "正在关闭3D项目空间。"
        ],
        "Camera gesture control is off.": [
            .korean: "카메라 제스처 제어를 껐습니다.",
            .japanese: "カメラのジェスチャー操作をオフにしました。",
            .chinese: "已关闭摄像头手势控制。"
        ],
        "Camera gesture control is on.": [
            .korean: "카메라 제스처 제어를 켰습니다.",
            .japanese: "カメラのジェスチャー操作をオンにしました。",
            .chinese: "已开启摄像头手势控制。"
        ]
    ]

    static func confirm(_ english: String, _ language: AppLanguage) -> String {
        if language == .english { return english }
        return table[english]?[language] ?? english
    }
}
