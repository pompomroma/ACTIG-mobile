import Foundation

/// Splits a model reply into prose plus the optional `<<OPTIONS>>` /
/// `<<SUGGESTIONS>>` blocks defined in ``PromptBuilder``. This is what turns a
/// free-text answer into the adjustment options (req 1.(3)) and recommendation
/// suggestions (req 1.(4)) the UI renders as tappable/speakable cards.
enum StructuredReplyParser {
    static func parse(_ raw: String) -> LLMResponse {
        let optionsMarker = "<<OPTIONS>>"
        let suggestionsMarker = "<<SUGGESTIONS>>"

        guard raw.contains(optionsMarker) || raw.contains(suggestionsMarker) else {
            return LLMResponse(text: raw.trimmingCharacters(in: .whitespacesAndNewlines))
        }

        // Prose is everything before the first marker.
        let firstMarkerRange = [optionsMarker, suggestionsMarker]
            .compactMap { raw.range(of: $0)?.lowerBound }
            .min()
        let prose = firstMarkerRange.map { String(raw[raw.startIndex..<$0]) } ?? raw

        let options = extractList(after: optionsMarker, stoppingAt: suggestionsMarker, in: raw)
        let suggestions = extractList(after: suggestionsMarker, stoppingAt: nil, in: raw)

        return LLMResponse(
            text: prose.trimmingCharacters(in: .whitespacesAndNewlines),
            options: options,
            suggestions: suggestions
        )
    }

    private static func extractList(after marker: String, stoppingAt stop: String?, in raw: String) -> [String] {
        guard let start = raw.range(of: marker)?.upperBound else { return [] }
        var slice = String(raw[start...])
        if let stop, let stopRange = slice.range(of: stop) {
            slice = String(slice[..<stopRange.lowerBound])
        }
        return slice
            .split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .compactMap { line in
                guard line.hasPrefix("-") else { return nil }
                return line.dropFirst().trimmingCharacters(in: .whitespaces)
            }
            .filter { !$0.isEmpty }
    }
}
