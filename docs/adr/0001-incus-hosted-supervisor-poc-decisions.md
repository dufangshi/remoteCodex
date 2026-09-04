# ADR 0001: Incus hosted supervisor PoC defaults

Status: Accepted for PoC

Date: 2026-07-10

## Context

The phased implementation plan leaves several product and security decisions open before code can establish a stable provider boundary. These defaults are intentionally narrow enough for the current relay host, while preserving an upgrade path for multi-host scheduling and user-managed credentials.

## Decisions

1. A hosted VM's relay device is owned directly by its assigned relay user. The relay admin is recorded separately as the creator.
2. The PoC credential mode is a per-user OpenAI Platform API key submitted once through an admin-only secret field. The relay database stores only an opaque credential reference. Personal ChatGPT `auth.json` files are not copied between users.
3. Initial VM size is 1 vCPU, 1536 MiB RAM, and a 10 GiB root disk. The production host is limited to one running hosted VM during the PoC.
4. Idle timeout is 600 seconds after the latest meaningful user activity and only when no turn is active. Graceful shutdown is allowed 120 seconds before an admin-only force-stop recovery action becomes available.
5. Deleting a hosted VM deletes its provider instance, snapshots created for that instance, relay device, and credential reference. There is no default retained recovery snapshot containing credentials.
6. Runtime egress starts deny-by-default and allows the relay origin, OpenAI API/auth endpoints, GitHub HTTPS endpoints, and npm registry endpoints. Changes to this allowlist require an audited host policy update.
7. Incus is an optional relay capability. Missing configuration, timeout, host-agent failure, or Incus failure must not fail relay startup, relay health, ordinary device creation, grants/shares, or existing tunnel forwarding.
8. Incus and its Unix socket remain native to the Ubuntu host. The relay container never receives the Incus socket. A restricted host agent is the only Incus management principal.
9. Host-agent and relay deployments are independent. Neither deployment workflow stops or rolls back the other service.

## Consequences

- The first UI can offer only one resource preset and API-key credential setup.
- A future user-self-service credential flow can be added without changing VM ownership.
- Capacity is deliberately limited until real VM memory, disk, wake latency, and E2E measurements exist.
- Provider DTOs and routes must remain additive and optional for existing web and mobile clients.
- Phase 1 must prove the fail-open behavior before any Incus installation or production connection is attempted.
