import Foundation
import Security

// MARK: - API keys in the Keychain
//
// Generic passwords, service "dev.danielgabbay.clipboard-monitor.ai", account = provider id. A key is read only
// when a request needs it and is never logged, cached, written to disk by us or sent to the page.
enum AIKeychain {
    static let service = "dev.danielgabbay.clipboard-monitor.ai"

    private static func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    /// Adds or replaces the key. Returns nil on success, else a readable error (never containing the key).
    @discardableResult
    static func save(_ key: String, account: String, label: String) -> String? {
        let data = Data(key.utf8)
        var status = SecItemUpdate(query(account) as CFDictionary,
                                   [kSecValueData as String: data, kSecAttrLabel as String: label] as CFDictionary)
        if status == errSecItemNotFound {
            var add = query(account)
            add[kSecValueData as String] = data
            add[kSecAttrLabel as String] = label
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            status = SecItemAdd(add as CFDictionary, nil)
        }
        return status == errSecSuccess ? nil : message(status)
    }

    static func read(account: String) -> String? {
        var q = query(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Whether an item exists, checked through its attributes only (the secret is not read).
    static func exists(account: String) -> Bool {
        var q = query(account)
        q[kSecReturnAttributes as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        return SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess
    }

    static func delete(account: String) {
        SecItemDelete(query(account) as CFDictionary)
    }

    static func message(_ status: OSStatus) -> String {
        let text = SecCopyErrorMessageString(status, nil) as String? ?? "error"
        return "Keychain: \(text) (\(status))"
    }

    /// "…" + last 4 characters, the only part of a key the page ever sees.
    static func hint(_ key: String) -> String { "…" + String(key.suffix(4)) }
}
