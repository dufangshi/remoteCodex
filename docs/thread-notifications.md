# Thread notifications and browser tab status

## Behavior

Open **Relay account → Thread notifications → Enable notifications** in each
browser that should receive updates. Browser permission requires an explicit
click. The setting belongs to the Relay account, and includes every device the
account owns; it is independent of Supervisor settings and currently open tabs.
Devices and threads shared *to* that account are excluded. Ownership here means
the device's Relay owner, including threads created on that device by a guest.

Notifications report a **completed or failed turn**, regardless of its provider.
Token streaming, tool progress, interruption and uncertain/recovering states do
not send notifications. A queued follow-up may already be working by the time a
previous turn's notification arrives. Notices contain a generic outcome and the
thread URL, without prompts, responses, thread titles or workspace names.

Clicking a notification focuses a tab already showing the same device/thread
path, ignoring query strings and fragments. Otherwise it opens a new tab. The
worker asks tabs for their live route: `WindowClient.url` can retain an older URL
after SPA navigation. A closed or unresponsive tab cannot reliably be focused;
after a short route-response timeout a new tab is the fallback.

Thread tabs use both a title prefix and favicon:

| State | Title | Favicon |
| --- | --- | --- |
| Working | `◌ Working · <title>` | Amber ring |
| Completed, unread | `● Unread · <title>` | Blue dot |
| Read, idle | `✓ Idle · <title>` | Gray dot |

Failed turns also say `Failed`; recovering threads say `Checking status` rather
than claiming completion. Read markers advance only when the thread page is
visible and focused after completion. They persist in this browser's local
storage and synchronize between its tabs. Other browsers have independent read
markers. Running state always takes precedence over older unread completions.
Tab status works for local Supervisor pages too and needs no push permission.

## Delivery and retention

1. Supervisor persists a completion notice in its existing `kv` store, in the
   same transaction as the completed turn. Connected Supervisors retry pending
   notices over their authenticated Relay tunnel every heartbeat.
2. Relay determines the device owner from its authenticated device record. It
   atomically records the event and fans out to that owner's active browser
   subscriptions, then acknowledges the turn to remove the device's notice.
3. A background Relay worker encrypts each payload with Web Push `aes128gcm`,
   signs VAPID, and sends it to the browser's push service. Browser pages do not
   need to stay open or maintain a connection to each Supervisor.
4. Relay deduplicates by device/turn. Pending deliveries retry with backoff for
   up to 24 hours. Expired notices are discarded; a new subscription does not
   receive older events. HTTP 404/410 removes a defunct subscription. A network
   ambiguity or process crash after acceptance can still cause redelivery;
   notification tags coalesce repeated deliveries of the same turn.

Relay SQLite contains `relay_push_subscriptions`, `relay_push_events` and
`relay_push_deliveries`. Supervisor needs no additional table. Relay generates
its VAPID key pair once in `relay_settings`; include this database in backups to
preserve subscriptions. The private VAPID key is never returned by the API.

Subscriptions are bound to both the account and its authenticated login session.
Signing out, revoking the session, expiry, or disabling the account stops further
delivery. Re-enabling after login binds the browser subscription to the current
session/account and drops old pending deliveries. Disabling in the browser
removes its Relay subscription and unsubscribes from the push service. Messages
already accepted by a push service cannot be recalled.

Endpoints must be HTTPS URLs for supported browser push services (Google FCM,
Mozilla, Apple or Windows). Arbitrary endpoints and redirects are rejected, so
subscription registration cannot turn the Relay into an HTTP proxy.

## Browser and deployment requirements

- HTTPS, Service Workers, Push API and notification permission are required
  (localhost is suitable for development). On iOS/iPadOS, install the site on
  the Home Screen before enabling Web Push.
- Allow Remote Codex notifications in both browser and operating system settings.
  Focus/Do Not Disturb, power/network restrictions and push-service policies can
  delay or suppress display. Delivery after fully quitting a browser is outside
  this feature's guarantee.
- Deploy the updated Relay and Web assets together; update each Supervisor whose
  completions should generate events. Existing devices continue to work with an
  older Relay, but notifications require the new Relay handler.
- No push vendor API key or extra hosted service is required. The Relay must be
  able to reach browser push endpoints over outbound HTTPS.

## Validation

The focused Rust regressions exercise cross-device owner-only fan-out, share
exclusion, deduplication, session revocation, event expiry, payload encryption
round-trip and subscription endpoint restrictions. Runtime interaction tests
check durable outbox read/ACK and that passive inbox messages produce no notice.

Vitest covers current SPA-route matching and focus/new-tab policy, plus persistent
background unread state. `e2e/notifications.spec.ts` uses an isolated real Relay
and fake-harness Supervisor with built Web assets. It exercises account enable/
disable, encrypted thread access, completion persistence/ACK, tab read state and
Chromium's Service Worker push dispatcher. Only browser vendor subscription
creation is mocked: automated Chromium has no vendor push credentials. This is
not a live FCM/APNs delivery test or an OS notification click test.

Build `cargo build -p remote-codex` and
`pnpm --filter @remote-codex/supervisor-web build` first. Run the spec with explicit
isolated `E2E_API_PORT`, `E2E_WEB_PORT`, `E2E_DATABASE_URL`, `E2E_WORKSPACE_ROOT`
and `--project=desktop-chromium`, following the focused-e2e skill.
