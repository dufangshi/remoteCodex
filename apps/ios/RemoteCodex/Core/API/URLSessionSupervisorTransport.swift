import Foundation

final class URLSessionSupervisorTransport: SupervisorHTTPTransport {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func request(_ request: SupervisorHTTPRequest) async throws -> SupervisorHTTPResponse {
        var urlRequest = URLRequest(url: request.url)
        urlRequest.httpMethod = request.method
        urlRequest.httpBody = request.body
        if let contentType = request.contentType {
            urlRequest.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        if let bearerToken = request.bearerToken?.trimmedNonEmpty {
            urlRequest.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: urlRequest)
        let httpResponse = response as? HTTPURLResponse
        return SupervisorHTTPResponse(
            statusCode: httpResponse?.statusCode ?? 0,
            body: data,
            headers: httpResponse?.allHeaderFields.reduce(into: [String: String]()) { partial, item in
                if let key = item.key as? String, let value = item.value as? String {
                    partial[key] = value
                }
            } ?? [:]
        )
    }
}
