import SwiftUI

/// Text + voice conversation surface (req 2). Renders the transcript including
/// the assistant's option prompts (req 1.(3)) and recommendation suggestions
/// (req 1.(4)) as tappable cards, and offers a mic button for voice input and a
/// text field for typed input — full parity (req 14).
struct ChatView: View {
    @Environment(AppState.self) private var app
    @State private var draft = ""
    @FocusState private var inputFocused: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            ForEach(app.transcript) { turn in
                                TurnBubble(turn: turn) { choice in
                                    Task { await app.submit(choice, source: .text) }
                                }
                                .id(turn.id)
                            }
                        }
                        .padding()
                    }
                    .onChange(of: app.transcript.count) {
                        if let last = app.transcript.last {
                            withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                        }
                    }
                }

                inputBar
            }
            .navigationTitle(Strings.appName)
            .navigationBarTitleDisplayMode(.inline)
            .background(Color.black.ignoresSafeArea())
        }
    }

    private var inputBar: some View {
        HStack(spacing: 10) {
            TextField("Message ACTIG…", text: $draft, axis: .vertical)
                .textFieldStyle(.plain)
                .padding(10)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
                .focused($inputFocused)
                .onSubmit(send)

            HoloButton(systemImage: "mic.fill", size: 44) {
                Task { await app.handleWake() }
            }

            HoloButton(systemImage: "arrow.up", tint: Holo.accent, size: 44) {
                send()
            }
        }
        .padding(.horizontal)
        .padding(.bottom, 90) // clear the floating HUD
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        Task { await app.submit(text, source: .text) }
    }
}

/// One transcript row with its options/suggestions.
private struct TurnBubble: View {
    let turn: ConversationTurn
    let onChoose: (String) -> Void

    var isUser: Bool { turn.role == .user }

    var body: some View {
        VStack(alignment: isUser ? .trailing : .leading, spacing: 6) {
            Text(turn.text)
                .padding(12)
                .foregroundStyle(isUser ? Color.black : Color.white)
                .background(
                    isUser ? AnyShapeStyle(Holo.accent) : AnyShapeStyle(.ultraThinMaterial),
                    in: RoundedRectangle(cornerRadius: 16)
                )
                .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)

            if !turn.options.isEmpty {
                ChoiceChips(title: "Options", items: turn.options, tint: Holo.primary, onChoose: onChoose)
            }
            if !turn.suggestions.isEmpty {
                ChoiceChips(title: "Suggested", items: turn.suggestions, tint: Holo.accent, onChoose: onChoose)
            }
        }
    }
}

private struct ChoiceChips: View {
    let title: String
    let items: [String]
    let tint: Color
    let onChoose: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased())
                .font(.caption2.weight(.bold))
                .foregroundStyle(tint)
            FlexWrap(items: items) { item in
                Button(item) { onChoose(item) }
                    .font(.caption)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(.ultraThinMaterial, in: Capsule())
                    .overlay(Capsule().stroke(tint.opacity(0.6), lineWidth: 1))
                    .foregroundStyle(.white)
            }
        }
    }
}

/// Minimal wrapping layout for chips (avoids a third-party dependency).
private struct FlexWrap<Item: Hashable, Content: View>: View {
    let items: [Item]
    @ViewBuilder let content: (Item) -> Content

    var body: some View {
        // Simple vertical stack of rows; good enough for short option lists.
        VStack(alignment: .leading, spacing: 6) {
            ForEach(items, id: \.self) { content($0) }
        }
    }
}
