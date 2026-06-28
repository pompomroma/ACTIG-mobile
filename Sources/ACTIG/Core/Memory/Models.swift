import Foundation
import SwiftData

/// One line in the conversation transcript. Stores everything requirement 1
/// asks to be saved: the text, who said it, how it was entered, the language,
/// and — for assistant turns — the option prompts and recommendation
/// suggestions offered to the user.
@Model
final class ConversationTurn {
    var id: UUID
    var createdAt: Date
    var roleRaw: String
    var text: String
    var sourceRaw: String
    var languageRaw: String

    /// "Continuous adjustment / apply direction" options offered to the user
    /// (requirement 1.(3)). Stored as plain strings.
    var options: [String]
    /// Recommendation suggestions for the options above (requirement 1.(4)).
    var suggestions: [String]

    /// Optional link to a generated file in the vault.
    var vaultItemID: UUID?

    init(role: TurnRole,
         text: String,
         source: InputSource,
         language: AppLanguage,
         options: [String] = [],
         suggestions: [String] = [],
         vaultItemID: UUID? = nil) {
        self.id = UUID()
        self.createdAt = Date()
        self.roleRaw = role.rawValue
        self.text = text
        self.sourceRaw = source.rawValue
        self.languageRaw = language.rawValue
        self.options = options
        self.suggestions = suggestions
        self.vaultItemID = vaultItemID
    }

    var role: TurnRole { TurnRole(rawValue: roleRaw) ?? .system }
    var language: AppLanguage { AppLanguage(rawValue: languageRaw) ?? .english }
}

enum TurnRole: String, Codable, Sendable { case user, assistant, system }

/// A checkpoint of an agentic workflow (requirement 1: "check points latest
/// workflow"). Captures the task, the commands run, the result, timing, and the
/// success/failure explanation so a workflow can be resumed or branched.
@Model
final class WorkflowCheckpoint {
    var id: UUID
    var createdAt: Date
    var title: String
    var taskDescription: String
    var commands: [String]
    var result: String
    var statusRaw: String
    /// Estimated time-to-complete shown to the user (requirement 1.(2-4)).
    var etaSeconds: Double
    /// Human explanation of how/why it succeeded or failed (requirement 1.(2-3)).
    var explanation: String
    var isLatest: Bool

    init(title: String,
         taskDescription: String,
         commands: [String] = [],
         result: String = "",
         status: WorkflowStatus = .running,
         etaSeconds: Double = 0,
         explanation: String = "",
         isLatest: Bool = true) {
        self.id = UUID()
        self.createdAt = Date()
        self.title = title
        self.taskDescription = taskDescription
        self.commands = commands
        self.result = result
        self.statusRaw = status.rawValue
        self.etaSeconds = etaSeconds
        self.explanation = explanation
        self.isLatest = isLatest
    }

    var status: WorkflowStatus {
        get { WorkflowStatus(rawValue: statusRaw) ?? .running }
        set { statusRaw = newValue.rawValue }
    }
}

enum WorkflowStatus: String, Codable, Sendable { case running, succeeded, failed, cancelled }

/// Index record for a file the agent generated (requirement 1: "generated files
/// in any form"). The bytes live in the app-group file vault on disk; this row
/// records metadata and the relative path.
@Model
final class VaultItem {
    var id: UUID
    var createdAt: Date
    var filename: String
    var relativePath: String
    var uti: String
    var byteCount: Int
    var note: String

    init(filename: String, relativePath: String, uti: String, byteCount: Int, note: String = "") {
        self.id = UUID()
        self.createdAt = Date()
        self.filename = filename
        self.relativePath = relativePath
        self.uti = uti
        self.byteCount = byteCount
        self.note = note
    }
}
