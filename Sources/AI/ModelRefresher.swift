import Foundation

// MARK: - Automatic model refresh
//
// Shortly after launch and then once an hour, refreshes the model list of every enabled provider with
// autoRefresh whose last successful refresh is older than Settings "modelRefreshHours" (default 24; 0 turns
// the automatic refresh off). Failures are recorded on the provider (lastCheck) and retried on a later tick.
@MainActor
final class ModelRefresher {
    private unowned let service: AIService
    private var timer: Timer?
    private var lastAttempt: [String: Date] = [:]

    init(service: AIService) { self.service = service }

    func start() {
        guard timer == nil else { return }
        let first = Timer(timeInterval: 5, repeats: false) { [weak self] _ in Task { @MainActor in self?.tick() } }
        RunLoop.main.add(first, forMode: .common)
        let t = Timer(timeInterval: 3600, repeats: true) { [weak self] _ in Task { @MainActor in self?.tick() } }
        t.tolerance = 300
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    func tick() {
        let hours = Settings.double("modelRefreshHours")
        guard hours > 0 else { return }
        let maxAge = hours * 3600
        let now = Date()
        for p in service.providers where p.enabled && p.autoRefresh {
            let age = now.timeIntervalSince1970 - p.lastRefresh / 1000
            // After a failure, wait at least an hour (one tick) before trying the same provider again.
            if age < maxAge { continue }
            if let last = lastAttempt[p.id], now.timeIntervalSince(last) < 3000 { continue }
            lastAttempt[p.id] = now
            let id = p.id
            Task { await service.refresh(id, asker: nil) }
        }
    }
}
