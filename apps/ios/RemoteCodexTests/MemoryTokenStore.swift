@testable import RemoteCodex

final class MemoryTokenStore: TokenStore {
    private var storage: [String: String] = [:]

    func readToken(account: String) throws -> String? {
        storage[account]
    }

    func writeToken(_ token: String, account: String) throws {
        storage[account] = token
    }

    func deleteToken(account: String) throws {
        storage.removeValue(forKey: account)
    }
}
