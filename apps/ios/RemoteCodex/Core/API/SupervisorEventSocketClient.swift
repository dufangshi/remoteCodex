import Foundation

enum SupervisorSocketState: Equatable {
    case connecting
    case open
    case closed
    case failed(String)
}

protocol SupervisorThreadEventStreaming: AnyObject, Sendable {
    func threadEvents(onState: @escaping (SupervisorSocketState) -> Void) -> AsyncStream<SupervisorThreadEvent>
    func close()
}

struct SupervisorThreadEvent: Equatable {
    var type: String
    var threadId: String
    var timestamp: String?
    var payload: [String: JSONValue]
    var eventId: String?
    var cursor: String?
    var sequence: Int64?
}

final class SupervisorEventSocketClient: NSObject, SupervisorThreadEventStreaming, URLSessionWebSocketDelegate, @unchecked Sendable {
    private let config: SupervisorConnectionConfig
    private var session: URLSession?
    private var task: URLSessionWebSocketTask?
    private var continuation: AsyncStream<SupervisorThreadEvent>.Continuation?
    private var stateHandler: ((SupervisorSocketState) -> Void)?

    init(config: SupervisorConnectionConfig) {
        self.config = config
        super.init()
    }

    func threadEvents(onState: @escaping (SupervisorSocketState) -> Void = { _ in }) -> AsyncStream<SupervisorThreadEvent> {
        AsyncStream { continuation in
            self.continuation = continuation
            stateHandler = onState
            connect()
            continuation.onTermination = { [weak self] _ in
                self?.close()
            }
        }
    }

    func close() {
        task?.cancel(with: .normalClosure, reason: Data("iOS thread detail closed".utf8))
        task = nil
        session?.invalidateAndCancel()
        session = nil
        continuation?.finish()
        stateHandler?(.closed)
    }

    func urlSession(
        _: URLSession,
        webSocketTask _: URLSessionWebSocketTask,
        didOpenWithProtocol _: String?
    ) {
        stateHandler?(.open)
    }

    func urlSession(
        _: URLSession,
        webSocketTask _: URLSessionWebSocketTask,
        didCloseWith _: URLSessionWebSocketTask.CloseCode,
        reason _: Data?
    ) {
        stateHandler?(.closed)
        continuation?.finish()
    }

    private func connect() {
        guard let url = URL(string: config.webSocketURL()) else {
            stateHandler?(.failed("Invalid WebSocket URL."))
            continuation?.finish()
            return
        }
        stateHandler?(.connecting)
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        var request = URLRequest(url: url)
        if let token = config.authToken?.trimmedNonEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let task = session.webSocketTask(with: request)
        self.session = session
        self.task = task
        task.resume()
        receiveNext()
    }

    private func receiveNext() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case let .success(message):
                if let event = parseSupervisorThreadEvent(message.textValue) {
                    continuation?.yield(event)
                }
                receiveNext()
            case let .failure(error):
                stateHandler?(.failed(error.localizedDescription))
                continuation?.finish()
            }
        }
    }
}

func parseSupervisorThreadEvent(_ rawMessage: String) -> SupervisorThreadEvent? {
    guard let data = rawMessage.data(using: .utf8),
          let envelope = try? JSONDecoder().decode(SupervisorThreadEventEnvelope.self, from: data),
          envelope.type.hasPrefix("thread."),
          let threadId = envelope.threadId?.trimmedNonEmpty,
          let payload = envelope.payload,
          !payload.isEmpty
    else {
        return nil
    }
    return SupervisorThreadEvent(
        type: envelope.type,
        threadId: threadId,
        timestamp: envelope.timestamp,
        payload: payload,
        eventId: envelope.eventId ?? envelope.id,
        cursor: envelope.cursor,
        sequence: envelope.sequence
    )
}

private struct SupervisorThreadEventEnvelope: Decodable {
    var type: String
    var threadId: String?
    var timestamp: String?
    var payload: [String: JSONValue]?
    var eventId: String?
    var id: String?
    var cursor: String?
    var sequence: Int64?
}

private extension URLSessionWebSocketTask.Message {
    var textValue: String {
        switch self {
        case let .string(text):
            text
        case let .data(data):
            String(data: data, encoding: .utf8) ?? ""
        @unknown default:
            ""
        }
    }
}
