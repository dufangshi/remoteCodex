import Foundation

@MainActor
extension ThreadDetailViewModel {
    func startEventStream() {
        screenWantsEventStream = true
        openEventStream(refreshAfterOpen: false)
    }

    func stopEventStream() {
        screenWantsEventStream = false
        closeCurrentEventStream()
    }

    func suspendRealtimeForBackground() {
        sceneAllowsEventStream = false
        closeCurrentEventStream()
    }

    func resumeRealtimeAfterForeground() {
        sceneAllowsEventStream = true
        guard screenWantsEventStream else { return }
        Task { await refresh() }
        openEventStream(refreshAfterOpen: true)
    }

    private func openEventStream(refreshAfterOpen: Bool) {
        guard screenWantsEventStream, sceneAllowsEventStream, eventStreamTask == nil else { return }
        reconnectTask?.cancel()
        reconnectTask = nil
        refreshAfterNextSocketOpen = refreshAfterNextSocketOpen || refreshAfterOpen
        eventStreamGeneration += 1
        let generation = eventStreamGeneration
        let socketClient = environment.eventStreamFactory(connection)
        eventSocketClient = socketClient
        eventStreamTask = Task { [weak self] in
            let stream = socketClient.threadEvents { state in
                Task { @MainActor [weak self] in
                    await self?.handleSocketState(state)
                }
            }
            for await event in stream {
                await self?.consume(event: event)
            }
            await MainActor.run {
                self?.handleEventStreamFinished(generation: generation)
            }
        }
    }

    private func closeCurrentEventStream() {
        reconnectTask?.cancel()
        reconnectTask = nil
        eventStreamGeneration += 1
        eventStreamTask?.cancel()
        eventStreamTask = nil
        eventSocketClient?.close()
        eventSocketClient = nil
        reconnectAttempt = 0
        refreshAfterNextSocketOpen = false
        socketState = .closed
    }

    private func handleSocketState(_ state: SupervisorSocketState) async {
        socketState = state
        guard state == .open else { return }
        reconnectAttempt = 0
        if refreshAfterNextSocketOpen {
            refreshAfterNextSocketOpen = false
            await refresh()
        }
    }

    private func handleEventStreamFinished(generation: Int) {
        guard generation == eventStreamGeneration else { return }
        eventStreamTask = nil
        eventSocketClient = nil
        guard screenWantsEventStream, sceneAllowsEventStream else { return }
        scheduleEventStreamReconnect()
    }

    private func scheduleEventStreamReconnect() {
        guard reconnectTask == nil else { return }
        reconnectAttempt += 1
        let attempt = reconnectAttempt
        let delay = eventReconnectDelayNanoseconds(attempt)
        refreshAfterNextSocketOpen = true
        reconnectTask = Task { [weak self] in
            if delay > 0 {
                try? await Task.sleep(nanoseconds: delay)
            }
            await MainActor.run {
                guard let self, self.screenWantsEventStream, self.sceneAllowsEventStream else { return }
                self.reconnectTask = nil
                self.openEventStream(refreshAfterOpen: true)
            }
        }
    }
}
