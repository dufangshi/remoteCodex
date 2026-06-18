# Android Connection Flow And State Restoration

This document defines the desired Android connection, relay device management,
and launch restoration model. It is the product contract for the next Android
connection-flow refactor.

## Goals

- First launch must start from a clean mode-selection page.
- Local, server, and relay modes must have separate, understandable steps.
- Relay account login and relay backend-device selection must be separate
  concepts.
- A user who is already connected through relay must be able to return to the
  relay device list, create another device, switch devices, or revoke devices
  without re-registering or re-selecting the connection mode.
- The app must remember connection state, login state, selected device,
  last workspace, and last thread so reopening the app returns to the most
  useful previous context.
- Any destructive or identity-changing action must use explicit language:
  changing device, changing account, changing mode, or disconnecting should not
  be hidden behind one ambiguous "Change" button.

## Concepts

The Android app should treat these as separate layers:

- **Connection mode**: `Intranet`, `Server`, or `Relay`.
- **Endpoint**: the supervisor URL for direct modes, or the relay base URL for
  relay mode.
- **Account session**: server admin token for server mode, or relay account
  token for relay mode.
- **Relay backend device**: the private supervisor/backend registered under a
  relay account and addressed by `relayDeviceId`.
- **Workspace context**: the last opened workspace for the selected supervisor
  or selected relay backend device.
- **Thread context**: the last opened thread inside that workspace/backend.

The current bug comes from collapsing mode, account, and device into one setup
screen. The app must preserve relay account state while letting users change
or manage relay devices.

## Route Model

Use a route/state model equivalent to:

```kotlin
sealed interface ConnectionRoute {
    data object ModeSelect : ConnectionRoute
    data object ServerAuth : ConnectionRoute
    data object RelayAuth : ConnectionRoute
    data object RelayDevices : ConnectionRoute
    data object ConnectionSettings : ConnectionRoute
    data object WorkspaceHome : ConnectionRoute
    data class ThreadDetail(val threadId: String) : ConnectionRoute
}
```

The exact implementation can use Compose navigation, activity state, or a
single state holder, but the user-facing behavior must match these route
boundaries.

## First Launch

When no usable saved state exists, open:

```text
ConnectionModeSelect
```

The mode-selection page should be visually clean and only ask for the transport
choice:

```text
Connect Remote Codex

[Intranet]
[Server]
[Relay]

URL
[Next]
```

Rules:

- Do not show username/password fields on the initial mode picker.
- Do not show relay device management on the initial mode picker.
- Keep the last typed URL per mode when possible.
- `Back` exits the app from this screen.

## Intranet Mode

Flow:

```text
ConnectionModeSelect
  -> WorkspaceHome
```

Behavior:

- The app stores `mode = Intranet` and the chosen direct supervisor URL.
- No login form is shown unless the backend reports auth is required.
- A failed health check should show retry plus connection settings, not erase
  saved state automatically.

## Server Mode

Flow:

```text
ConnectionModeSelect
  -> ServerAuth
  -> WorkspaceHome
```

`ServerAuth` fields:

- URL, inherited from the mode-selection step and editable.
- Username.
- Password.
- `Sign in`.
- `Back`.

On successful login, store:

```text
mode = Server
serverBaseUrl
serverAuthToken
```

Server mode does not use relay device management.

## Relay Mode

Relay mode has two required phases: relay account authentication and relay
backend-device management.

Flow:

```text
ConnectionModeSelect
  -> RelayAuth
  -> RelayDevices
  -> WorkspaceHome
```

### Relay Auth

`RelayAuth` should be a dedicated account page:

```text
Relay Account

Relay URL

[Sign in] [Register]

Identifier / Email
Username
Password

[Sign in] or [Create account]
[Back]
```

Rules:

- `Sign in` uses `/relay/auth/login`.
- `Register` uses `/relay/auth/register`.
- Login/register success stores the relay account token.
- Login/register success does not create or select a backend device by itself.
- After success, navigate to `RelayDevices`.

Store:

```text
mode = Relay
relayBaseUrl
relayAuthToken
relayUser
```

### Relay Devices

`RelayDevices` is a first-class page. It is not a transient section inside the
login form.

Required content:

```text
Relay Devices

Account: <username or email>
Relay: <relay base URL>

Devices:
[Device A] Online    Last heartbeat ...
[Device B] Offline   Last seen ...
[Device C] Online    Last heartbeat ...

[Refresh]
[Create device]
```

Each device row should show:

- Device name.
- Online/offline status.
- Last heartbeat or last seen time when available.
- Created time when available.
- Whether it is the currently selected device.
- `Connect` action.
- `Revoke` action.

Optional future action:

- `Rename`, if the backend exposes it.

Create-device flow:

```text
Create Relay Device

Device name
[Create]
```

After creation, show the one-time token and backend command:

```text
REMOTE_CODEX_RELAY_SERVER_URL=<relay ws url> \
REMOTE_CODEX_RELAY_AGENT_TOKEN=<one-time token> \
remote-codex relay-supervisor

[Copy command]
[Done]
```

Rules:

- The full token is only shown immediately after device creation.
- Closing the token notice returns to the device list.
- The device remains visible after the token notice is closed.
- Refreshing devices must not clear the relay auth token.
- Revoking a selected device clears only `relaySelectedDeviceId`, not relay
  account login state.

Connect-device behavior:

- If the device is online, save `relaySelectedDeviceId` and enter
  `WorkspaceHome`.
- If the device is offline, show a warning:

```text
Device is offline. You can save it, but workspaces will not load until the
backend connects.

[Save anyway]
[Cancel]
```

After device selection, store:

```text
mode = Relay
relayBaseUrl
relayAuthToken
relaySelectedDeviceId
```

## Workspace And Thread Restoration

The Android app must remember the user's last useful work context.

Persist at least:

```kotlin
data class SavedNavigationState(
    val lastMode: SupervisorConnectionMode,
    val lastRelayDeviceId: String?,
    val lastWorkspaceIdByConnectionKey: Map<String, String>,
    val lastThreadIdByConnectionKey: Map<String, String>,
    val lastRouteByConnectionKey: Map<String, LastRoute>,
)

sealed interface LastRoute {
    data object WorkspaceHome : LastRoute
    data class ThreadDetail(val threadId: String) : LastRoute
}
```

The connection key should distinguish at least:

```text
Intranet:<baseUrl>
Server:<baseUrl>
Relay:<relayBaseUrl>:<relayDeviceId>
```

Restoration rules:

- If the user exits from a thread detail screen, reopening the app should return
  to that same thread when the same connection and device are still valid.
- If the user exits from a workspace screen under a selected device, reopening
  should return to that workspace/home context for the same selected device.
- If the saved thread no longer exists, fall back to that connection's
  workspace/home.
- If the saved workspace no longer exists, fall back to the supervisor's
  workspace list.
- If the saved relay device is offline, keep the selected device but show a
  recoverable connection state with `Retry`, `Manage devices`, and `Change
  account`.
- If the relay auth token is invalid, navigate to `RelayAuth` while preserving
  the relay URL.
- If there is a valid relay token but no selected device, navigate to
  `RelayDevices`.

## Launch Decision Tree

On app startup:

1. No saved mode:
   - Open `ConnectionModeSelect`.

2. Saved intranet mode:
   - Try health/session check.
   - If valid, restore last route for `Intranet:<baseUrl>`.
   - If invalid, show connection error with `Retry` and `Connection settings`.

3. Saved server mode:
   - If `serverAuthToken` exists, validate session.
   - If valid, restore last route for `Server:<baseUrl>`.
   - If invalid, open `ServerAuth` with the saved URL.

4. Saved relay mode with valid relay token and selected device:
   - Validate relay session.
   - Try device-forwarded health/session check.
   - If valid, restore last route for
     `Relay:<relayBaseUrl>:<relaySelectedDeviceId>`.
   - If the device is offline or unreachable, show a recoverable state with:
     `Retry`, `Manage devices`, `Change account`, and `Change mode`.

5. Saved relay mode with valid relay token but no selected device:
   - Open `RelayDevices`.

6. Saved relay mode with invalid relay token:
   - Open `RelayAuth` with the saved relay URL.

The app should not clear saved login/device state merely because a network
request fails once.

## Workspace Screen Connection Entry

Replace broad "Change" behavior with a connection settings route.

From `WorkspaceHome` or `ThreadDetail`, the user should have a clear
`Connection` entry. For relay mode, this opens:

```text
Connection

Mode: Relay
Relay URL: ...
Account: ...
Device: ...

[Manage devices]
[Change account]
[Change mode]
[Disconnect]
```

Actions:

- `Manage devices`: navigate to `RelayDevices` and preserve relay auth.
- `Change account`: clear relay auth token and relay user, preserve relay URL,
  navigate to `RelayAuth`.
- `Change mode`: navigate to `ConnectionModeSelect`, preserving known URLs.
- `Disconnect`: clear the active connection and selected route, then navigate
  to `ConnectionModeSelect`.

For server mode:

```text
Connection

Mode: Server
Server URL: ...
Account: admin

[Re-authenticate]
[Change mode]
[Disconnect]
```

For intranet mode:

```text
Connection

Mode: Intranet
URL: ...

[Edit URL]
[Change mode]
[Disconnect]
```

## Back Behavior

Back navigation should be route-aware:

- `ThreadDetail`:
  - Back returns to `WorkspaceHome` or previous screen.
  - Exiting the app from this route persists the current thread id.

- `WorkspaceHome`:
  - Back exits the app.
  - Exiting persists the current workspace/home context.

- `ConnectionSettings`:
  - Back returns to the previous workspace/thread route.

- `RelayDevices`:
  - If there is a selected relay device and the user came from workspace/thread,
    back returns to that route.
  - If there is no selected relay device, back returns to `RelayAuth`.

- `RelayAuth`:
  - Back returns to `ConnectionModeSelect`.

- `ServerAuth`:
  - Back returns to `ConnectionModeSelect`.

- `ConnectionModeSelect`:
  - Back exits the app.

## Storage Model

The app should avoid one overloaded config blob. At minimum, persist:

```kotlin
data class SavedConnectionState(
    val mode: SupervisorConnectionMode?,
    val baseUrlByMode: Map<SupervisorConnectionMode, String>,
    val serverAuthToken: String?,
    val relayAuthToken: String?,
    val relayUserId: String?,
    val relayUsername: String?,
    val relaySelectedDeviceId: String?,
    val lastWorkspaceByConnectionKey: Map<String, String>,
    val lastThreadByConnectionKey: Map<String, String>,
    val lastRouteByConnectionKey: Map<String, LastRoute>,
)
```

Security notes:

- Auth tokens should move to Android Keystore-backed storage before release.
- Until then, shared preferences are acceptable only for local debug builds.
- Device tokens returned by relay device creation must not be persisted in full
  after the one-time display is dismissed.
- Relay account tokens and selected backend device ids are different state and
  must not be cleared together unless the user explicitly disconnects.

## Implementation Slices

Implement this refactor in small slices:

1. Split the existing setup screen into route-level UI functions:
   - `ConnectionModeSelectScreen`
   - `ServerAuthScreen`
   - `RelayAuthScreen`
   - `RelayDeviceManagerScreen`
   - `ConnectionSettingsScreen`

2. Introduce a route state holder:
   - Start with an in-memory `ConnectionRoute`.
   - Persist enough state to restore after process death.

3. Change the workspace `Change` action:
   - Replace it with `Connection`.
   - Open `ConnectionSettingsScreen`.
   - Do not clear relay auth or selected device by default.

4. Make `RelayDeviceManagerScreen` reusable:
   - Enter it after relay login/register.
   - Enter it from workspace/thread through `Connection > Manage devices`.
   - Allow create, refresh, connect, and revoke without forcing re-login.

5. Add restoration state:
   - Persist last workspace and last thread per connection key.
   - On thread open, update `lastThreadByConnectionKey`.
   - On workspace/home open, update `lastWorkspaceByConnectionKey`.
   - On app launch, run the launch decision tree above.

6. Harden error states:
   - Network failures should offer retry and management actions.
   - Token invalidation should route to auth.
   - Missing/deleted workspace/thread should fall back to the nearest valid
     parent screen.

## Acceptance Criteria

- Fresh install opens a clean three-mode selection page.
- Choosing relay opens relay login/register before any device UI.
- Relay login/register success opens device management, not workspace directly
  unless a deliberate later auto-enter setting is added.
- From workspace/thread in relay mode, the user can open connection settings
  and manage devices without re-registering or reselecting mode.
- A user can create a second relay device after already connecting one.
- A user can switch between relay devices from the device list.
- A user can revoke a device without losing relay account login state.
- App restart restores the last thread when the user exited from a thread and
  the thread still exists.
- App restart restores the last workspace/home for the selected device when the
  user exited from workspace.
- Offline relay devices show a recoverable state with `Manage devices`.
- Invalid relay tokens route to relay auth while preserving the relay URL.
