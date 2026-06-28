import SwiftUI
import SwiftData

/// Browses everything ACTIG saved (req 1): the conversation transcript and the
/// workflow checkpoints with their results, ETA, and success/failure
/// explanations.
struct HistoryView: View {
    @Query(sort: \WorkflowCheckpoint.createdAt, order: .reverse)
    private var checkpoints: [WorkflowCheckpoint]

    @Query(sort: \VaultItem.createdAt, order: .reverse)
    private var files: [VaultItem]

    var body: some View {
        NavigationStack {
            List {
                Section("Latest workflow") {
                    if let latest = checkpoints.first {
                        CheckpointRow(checkpoint: latest)
                    } else {
                        Text("No workflows yet.").foregroundStyle(.secondary)
                    }
                }
                Section("Workflow checkpoints") {
                    ForEach(checkpoints) { CheckpointRow(checkpoint: $0) }
                }
                Section("Generated files") {
                    if files.isEmpty {
                        Text("No files generated yet.").foregroundStyle(.secondary)
                    }
                    ForEach(files) { file in
                        VStack(alignment: .leading) {
                            Text(file.filename).font(.body)
                            Text("\(file.byteCount) bytes · \(file.uti)")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .navigationTitle("History")
        }
    }
}

private struct CheckpointRow: View {
    let checkpoint: WorkflowCheckpoint

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(checkpoint.title).font(.headline)
                Spacer()
                statusBadge
            }
            if checkpoint.etaSeconds > 0 {
                Text("ETA ~\(Int(checkpoint.etaSeconds))s").font(.caption).foregroundStyle(.secondary)
            }
            if !checkpoint.explanation.isEmpty {
                Text(checkpoint.explanation).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var statusBadge: some View {
        Text(checkpoint.status.rawValue)
            .font(.caption2.weight(.bold))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.2), in: Capsule())
            .foregroundStyle(color)
    }

    private var color: Color {
        switch checkpoint.status {
        case .succeeded: .green
        case .failed: Holo.danger
        case .cancelled: .gray
        case .running: Holo.primary
        }
    }
}
