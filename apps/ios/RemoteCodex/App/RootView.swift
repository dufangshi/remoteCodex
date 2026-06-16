import SwiftUI

struct RootView: View {
    let environment: AppEnvironment
    @State private var route: AppRoute
    @State private var connection: SupervisorConnectionConfig?
    @State private var themeMode: ThemeMode

    init(environment: AppEnvironment) {
        self.environment = environment
        let savedConnection = environment.settingsStore.readSupervisorConnection()
        let savedRoute = environment.settingsStore.readLastRoute(for: savedConnection)
        _connection = State(initialValue: savedConnection)
        _route = State(initialValue: savedConnection == nil ? .connection : savedRoute.appRoute)
        _themeMode = State(initialValue: environment.settingsStore.readThemeMode())
    }

    var body: some View {
        NavigationStack {
            switch route {
            case .connection:
                ConnectionScreen(environment: environment) { config in
                    connection = config
                    route = .home
                }
            case .home:
                if let connection {
                    HomeScreen(
                        environment: environment,
                        connection: connection,
                        onOpenWorkspace: { workspaceId in
                            environment.settingsStore.writeLastRoute(.workspaceDetail(workspaceId), for: connection)
                            route = .workspaceDetail(workspaceId)
                        },
                        onOpenThread: { threadId in
                            environment.settingsStore.writeLastRoute(.threadDetail(threadId), for: connection)
                            route = .threadDetail(threadId)
                        },
                        onChangeConnection: {
                            environment.settingsStore.clearSupervisorConnection()
                            self.connection = nil
                            route = .connection
                        },
                        onThemeModeSelected: { mode in
                            themeMode = mode
                        }
                    )
                } else {
                    ConnectionScreen(environment: environment) { config in
                        connection = config
                        route = .home
                    }
                }
            case let .workspaceDetail(workspaceId):
                if let connection {
                    WorkspaceDetailScreen(
                        environment: environment,
                        connection: connection,
                        workspaceId: workspaceId,
                        onOpenThread: { threadId in
                            environment.settingsStore.writeLastRoute(.threadDetail(threadId), for: connection)
                            route = .threadDetail(threadId)
                        }
                    )
                } else {
                    PlaceholderScreen(title: "Workspace", subtitle: workspaceId)
                }
            case let .threadDetail(threadId):
                if let connection {
                    ThreadDetailScreen(
                        environment: environment,
                        connection: connection,
                        threadId: threadId,
                        onClose: {
                            environment.settingsStore.writeLastRoute(.home, for: connection)
                            route = .home
                        },
                        onOpenThread: { nextThreadId in
                            environment.settingsStore.writeLastRoute(.threadDetail(nextThreadId), for: connection)
                            route = .threadDetail(nextThreadId)
                        },
                        onOpenWorkspace: { workspaceId in
                            environment.settingsStore.writeLastRoute(.workspaceDetail(workspaceId), for: connection)
                            route = .workspaceDetail(workspaceId)
                        }
                    )
                } else {
                    PlaceholderScreen(title: "Thread", subtitle: threadId)
                }
            }
        }
        .preferredColorScheme(themeMode.colorScheme)
    }
}

private extension SavedAppRoute {
    var appRoute: AppRoute {
        switch self {
        case .home:
            .home
        case let .workspaceDetail(workspaceId):
            .workspaceDetail(workspaceId)
        case let .threadDetail(threadId):
            .threadDetail(threadId)
        }
    }
}

private extension ThemeMode {
    var colorScheme: ColorScheme? {
        switch self {
        case .system:
            nil
        case .light:
            .light
        case .dark:
            .dark
        }
    }
}

private struct PlaceholderScreen: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: 12) {
            Text(title).font(.title.bold())
            Text(subtitle).foregroundStyle(.secondary)
        }
        .padding()
    }
}
