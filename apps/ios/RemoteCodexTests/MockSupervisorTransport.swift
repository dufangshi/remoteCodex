import Foundation
@testable import RemoteCodex

final class MockSupervisorTransport: SupervisorHTTPTransport {
    var requests: [SupervisorHTTPRequest] = []
    var handler: (SupervisorHTTPRequest) throws -> SupervisorHTTPResponse = { _ in
        SupervisorHTTPResponse(statusCode: 200, body: Data("{}".utf8), headers: [:])
    }

    func request(_ request: SupervisorHTTPRequest) async throws -> SupervisorHTTPResponse {
        requests.append(request)
        return try handler(request)
    }
}
