import Foundation
import XCTest

extension RemoteCodexUITests {
    static func writeLiveWorkspaceFileFixture(rootPath: String) throws {
        let root = URL(fileURLWithPath: rootPath)
        let sourceDirectory = root.appendingPathComponent("Sources", isDirectory: true)
        try FileManager.default.createDirectory(at: sourceDirectory, withIntermediateDirectories: true)
        let chunks = (0 ..< 900).map { index in
            "IOS_WORKSPACE_PREVIEW_MARKER line \(index) abcdefghijklmnopqrstuvwxyz\n"
        }
        try chunks.joined().write(
            to: sourceDirectory.appendingPathComponent("Long.txt"),
            atomically: true,
            encoding: .utf8
        )
        try "IOS_WORKSPACE_EDIT_ORIGINAL\n".write(
            to: sourceDirectory.appendingPathComponent("Editable.txt"),
            atomically: true,
            encoding: .utf8
        )
        try Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=")!
            .write(to: sourceDirectory.appendingPathComponent("Preview.png"), options: [.atomic])
    }

    static func assertLiveWorkspaceFilesRoundTrip(baseURL: URL, workspaceId: String) async throws {
        let tree = try await liveWorkspaceJSON(baseURL: baseURL, workspaceId: workspaceId, endpoint: "tree")
        XCTAssertTrue(String(describing: tree).contains("Long.txt"))

        let firstPreview = try await liveWorkspaceJSON(
            baseURL: baseURL,
            workspaceId: workspaceId,
            endpoint: "preview",
            query: ["path": "Sources/Long.txt", "offset": "0", "limit": "64"]
        )
        XCTAssertEqual(firstPreview["truncated"] as? Bool, true)
        XCTAssertTrue((firstPreview["content"] as? String)?.contains("IOS_WORKSPACE_PREVIEW_MARKER") == true)
        let nextOffset = firstPreview["nextOffset"] as? Int ?? 0
        XCTAssertGreaterThan(nextOffset, 0)

        let secondPreview = try await liveWorkspaceJSON(
            baseURL: baseURL,
            workspaceId: workspaceId,
            endpoint: "preview",
            query: ["path": "Sources/Long.txt", "offset": "\(nextOffset)", "limit": "64"]
        )
        XCTAssertEqual(secondPreview["path"] as? String, "Sources/Long.txt")

        let raw = try await liveWorkspaceData(
            baseURL: baseURL,
            workspaceId: workspaceId,
            endpoint: "raw",
            query: ["path": "Sources/Long.txt"]
        )
        XCTAssertTrue(String(data: raw, encoding: .utf8)?.contains("IOS_WORKSPACE_PREVIEW_MARKER") == true)

        let download = try await liveWorkspaceData(
            baseURL: baseURL,
            workspaceId: workspaceId,
            endpoint: "download",
            query: ["path": "Sources/Long.txt"]
        )
        XCTAssertEqual(raw, download)

        let upload = try await uploadLiveWorkspaceFile(
            baseURL: baseURL,
            workspaceId: workspaceId,
            path: "Sources/ios-upload.txt",
            filename: "ios-upload.txt",
            content: "IOS_WORKSPACE_UPLOAD_MARKER\n"
        )
        XCTAssertTrue(String(describing: upload).contains("ios-upload.txt"))

        let uploadedPreview = try await liveWorkspaceJSON(
            baseURL: baseURL,
            workspaceId: workspaceId,
            endpoint: "preview",
            query: ["path": "Sources/ios-upload.txt"]
        )
        XCTAssertEqual(uploadedPreview["content"] as? String, "IOS_WORKSPACE_UPLOAD_MARKER\n")
    }

    private static func liveWorkspaceJSON(
        baseURL: URL,
        workspaceId: String,
        endpoint: String,
        query: [String: String] = [:]
    ) async throws -> [String: Any] {
        let data = try await liveWorkspaceData(baseURL: baseURL, workspaceId: workspaceId, endpoint: endpoint, query: query)
        let object = try JSONSerialization.jsonObject(with: data)
        guard let dictionary = object as? [String: Any] else {
            throw NSError(
                domain: "RemoteCodexUITests",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Workspace file response was not a JSON object."]
            )
        }
        return dictionary
    }

    private static func liveWorkspaceData(
        baseURL: URL,
        workspaceId: String,
        endpoint: String,
        query: [String: String] = [:]
    ) async throws -> Data {
        var components = URLComponents(
            url: baseURL.appendingPathComponent("api/workspaces/\(workspaceId)/files/\(endpoint)"),
            resolvingAgainstBaseURL: false
        )!
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        let (data, response) = try await liveFileURLSession.data(from: components.url!)
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ... 299).contains(statusCode) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw NSError(
                domain: "RemoteCodexUITests",
                code: statusCode,
                userInfo: [NSLocalizedDescriptionKey: "Workspace files \(endpoint) failed: \(text)"]
            )
        }
        return data
    }

    private static func uploadLiveWorkspaceFile(
        baseURL: URL,
        workspaceId: String,
        path: String,
        filename: String,
        content: String
    ) async throws -> [String: Any] {
        let boundary = "RemoteCodexBoundary-\(UUID().uuidString)"
        var body = Data()
        body.appendMultipartField(name: "path", value: path, boundary: boundary)
        body.appendMultipartFile(
            fieldName: "file",
            filename: filename,
            contentType: "text/plain",
            bytes: Data(content.utf8),
            boundary: boundary
        )
        body.append(Data("--\(boundary)--\r\n".utf8))

        var request = URLRequest(
            url: baseURL.appendingPathComponent("api/workspaces/\(workspaceId)/files/upload")
        )
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        let (data, response) = try await liveFileURLSession.data(for: request)
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ... 299).contains(statusCode) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw NSError(
                domain: "RemoteCodexUITests",
                code: statusCode,
                userInfo: [NSLocalizedDescriptionKey: "Workspace upload failed: \(text)"]
            )
        }
        let object = try JSONSerialization.jsonObject(with: data)
        guard let dictionary = object as? [String: Any] else {
            throw NSError(
                domain: "RemoteCodexUITests",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Workspace upload response was not a JSON object."]
            )
        }
        return dictionary
    }

    private static var liveFileURLSession: URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        return URLSession(configuration: configuration)
    }
}

private extension Data {
    mutating func appendMultipartField(name: String, value: String, boundary: String) {
        append(Data("--\(boundary)\r\n".utf8))
        append(Data("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".utf8))
        append(Data("\(value)\r\n".utf8))
    }

    mutating func appendMultipartFile(
        fieldName: String,
        filename: String,
        contentType: String,
        bytes: Data,
        boundary: String
    ) {
        append(Data("--\(boundary)\r\n".utf8))
        append(Data("Content-Disposition: form-data; name=\"\(fieldName)\"; filename=\"\(filename)\"\r\n".utf8))
        append(Data("Content-Type: \(contentType)\r\n\r\n".utf8))
        append(bytes)
        append(Data("\r\n".utf8))
    }
}
