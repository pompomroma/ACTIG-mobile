import Foundation
import EventKit
import Contacts
#if canImport(HealthKit)
import HealthKit
#endif

/// Permission-gated access to the user's personal data the OS *does* expose
/// (req 19): Reminders & Calendar (EventKit), Contacts, and Health reads.
/// Every entry point goes through the system permission prompt — ACTIG cannot
/// and does not bypass them.
@MainActor
final class PersonalDataController {
    private let eventStore = EKEventStore()
    private let contactStore = CNContactStore()
    #if canImport(HealthKit)
    private let healthStore = HKHealthStore()
    #endif

    // MARK: Reminders

    /// Create a reminder. Returns a short result string for the agent log.
    func createReminder(title: String, dueText: String? = nil) async -> String {
        guard await requestReminders() else { return "Reminders permission denied." }
        let reminder = EKReminder(eventStore: eventStore)
        reminder.title = title
        reminder.calendar = eventStore.defaultCalendarForNewReminders()
        do {
            try eventStore.save(reminder, commit: true)
            return "Reminder added: \(title)."
        } catch {
            return "Couldn't add reminder: \(error.localizedDescription)"
        }
    }

    // MARK: Calendar

    func createEvent(title: String, start: Date, durationMinutes: Int = 60) async -> String {
        guard await requestCalendar() else { return "Calendar permission denied." }
        let event = EKEvent(eventStore: eventStore)
        event.title = title
        event.startDate = start
        event.endDate = start.addingTimeInterval(TimeInterval(durationMinutes * 60))
        event.calendar = eventStore.defaultCalendarForNewEvents
        do {
            try eventStore.save(event, span: .thisEvent)
            return "Event scheduled: \(title)."
        } catch {
            return "Couldn't schedule event: \(error.localizedDescription)"
        }
    }

    // MARK: Contacts

    func lookupContact(name: String) async -> String {
        guard await requestContacts() else { return "Contacts permission denied." }
        let predicate = CNContact.predicateForContacts(matchingName: name)
        let keys = [CNContactGivenNameKey, CNContactFamilyNameKey,
                    CNContactPhoneNumbersKey] as [CNKeyDescriptor]
        do {
            let matches = try contactStore.unifiedContacts(matching: predicate, keysToFetch: keys)
            guard let c = matches.first else { return "No contact named \(name)." }
            let phone = c.phoneNumbers.first?.value.stringValue ?? "no number"
            return "\(c.givenName) \(c.familyName): \(phone)"
        } catch {
            return "Contact lookup failed: \(error.localizedDescription)"
        }
    }

    // MARK: Health (read)

    func todayStepCount() async -> String {
        #if canImport(HealthKit)
        guard HKHealthStore.isHealthDataAvailable() else { return "Health data unavailable." }
        let stepType = HKQuantityType(.stepCount)
        do {
            try await healthStore.requestAuthorization(toShare: [], read: [stepType])
        } catch {
            return "Health permission denied."
        }
        return await withCheckedContinuation { continuation in
            let start = Calendar.current.startOfDay(for: Date())
            let predicate = HKQuery.predicateForSamples(withStart: start, end: Date())
            let query = HKStatisticsQuery(quantityType: stepType, quantitySamplePredicate: predicate,
                                          options: .cumulativeSum) { _, stats, _ in
                let steps = stats?.sumQuantity()?.doubleValue(for: .count()) ?? 0
                continuation.resume(returning: "You've taken \(Int(steps)) steps today.")
            }
            healthStore.execute(query)
        }
        #else
        return "Health is not available on this build."
        #endif
    }

    // MARK: Permission helpers

    private func requestReminders() async -> Bool {
        if #available(iOS 17.0, *) {
            return (try? await eventStore.requestFullAccessToReminders()) ?? false
        }
        return await withCheckedContinuation { c in
            eventStore.requestAccess(to: .reminder) { ok, _ in c.resume(returning: ok) }
        }
    }

    private func requestCalendar() async -> Bool {
        if #available(iOS 17.0, *) {
            return (try? await eventStore.requestFullAccessToEvents()) ?? false
        }
        return await withCheckedContinuation { c in
            eventStore.requestAccess(to: .event) { ok, _ in c.resume(returning: ok) }
        }
    }

    private func requestContacts() async -> Bool {
        await withCheckedContinuation { c in
            contactStore.requestAccess(for: .contacts) { ok, _ in c.resume(returning: ok) }
        }
    }
}
