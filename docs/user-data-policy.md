# User Data Export And Deletion Policy

This document records the phase-one policy for user data export, deletion, and
anonymization.

The API implementation is intentionally deferred for the first sandbox-worker
control-plane build. This deferral is explicit so release reviews can decide
whether the API must be implemented before launch.

## Current Decision

Phase one does not ship a self-service user data export API or self-service
user deletion/anonymization API.

Instead:

- Account suspension is implemented through user `status`.
- Suspended users cannot issue route tokens.
- Suspended users cannot start or restart sandboxes.
- Usage import rejects inactive users and does not reactivate them.
- Existing project, workspace, session, sandbox, usage, and audit records remain
  durable until a formal export/deletion API is implemented.

## Export Deferral

User data export is deferred until the product has a stable launch data model
for:

- users;
- projects;
- workspaces;
- sessions;
- sandbox registry entries;
- gateway credential metadata;
- harness credential metadata;
- usage ledger entries;
- audit logs;
- artifacts and workspace snapshots when persistence is enabled.

Before production launch, decide whether to implement an admin-triggered export
or keep this as an explicit launch limitation. If implemented, the export must:

- require the requesting user or an admin;
- exclude raw gateway, harness, worker, route-token, and provider secrets;
- include enough metadata to reconcile usage and billing;
- stream or chunk large artifact/snapshot references instead of loading them
  into API memory;
- audit export creation and download events.

## Deletion And Anonymization Deferral

User deletion and anonymization are deferred until retention requirements are
settled for billing, audit, gateway reconciliation, harness tasks, compute jobs,
and artifacts.

Before production launch, decide whether deletion means:

- soft-delete the user and block all product access;
- anonymize user profile fields while preserving billing/audit records;
- delete projects/workspaces/sessions after a retention window;
- revoke gateway and harness keys immediately;
- stop active sandboxes immediately;
- retain usage records with anonymized user references for accounting.

Any implementation must be forward-only and should not edit published
migrations. Add a new migration for deletion/anonymization fields if required.

## Launch Gate

Production release must either:

- implement tested export and deletion/anonymization APIs; or
- keep this documented deferral linked from release notes and customer-facing
  launch limitations.

## Related Documents

- [Remote Codex Side Execution Checklist](./remote-codex-side-execution-checklist.md)
- [Release Gates](./release-gates.md)
- [Remote Codex Branch Status](./status.md)
