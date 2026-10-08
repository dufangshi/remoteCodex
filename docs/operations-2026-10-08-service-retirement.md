# Requested service retirement, 2026-10-08

The owner requested removing `fjjdff.umean.ca` and `hhasdf.umean.ca` from the
Relay host ingress and retiring Card Verify, VerifiableAgent/librarian,
Nanobot, the independent Responses-to-Completions proxy and Bibliotecario.
Sub2API is a separate deployment and remains running.

- Removed the custom `hhasdf.umean.ca` server block and NPM host 2 for
  `fjjdff.umean.ca`; NPM records host 2 as deleted/disabled. Disabled librarian's
  NPM host 1 (`mail.lnz-study.com`) with its generated config removed.
  External DNS records were not changed.
- Stopped the five original Card Verify containers and disabled automatic
  restart for all eleven original/v2 containers. Both project directories,
  container records, images and volumes remain. Disabled its two socat proxy
  services and panel firewall startup service.
- Removed the six VerifiableAgent containers, Nanobot container and
  Responses-to-Completions container, plus their exclusive image tags. Stopped
  and disabled Bibliotecario, including its child bridge, and removed its unit.
- Deleted `/opt/verifiableagent`, `/opt/nanobot`,
  `/opt/responses-to-completions-proxy`, `/opt/bibliotecario` and
  `/root/.nanobot`. Named/anonymous Docker data volumes remain. Shared
  `/root/.local`, `/root/.codex`, `/mnt/gdrive-ai` and `/opt/orchestration-mcp`
  were retained. No global image/volume prune was performed.

Ingress configuration, an online NPM database backup, service units and a
resource manifest are stored privately on the server under
`/opt/service-retirement-20261008T123451Z`. This is a configuration/audit backup,
not a backup of the deleted project directories. Unit files may contain secrets
and must not be copied into public logs or this repository.

NPM configuration validation passed before a graceful reload. The remaining
fourteen containers belong to Treer, LearnHouse/BayStreet, Sub2API and NPM;
their original container identities were preserved. The Rust Relay,
Engineering Review, Cloudflare Tunnel and unrelated host services remain.
Private device-preview ingress and its Relay environment setting remain enabled.

Root filesystem usage fell from approximately 75 GB (79%) to 63 GB (65%), with
approximately 34 GB available. Card Verify can be brought back explicitly from
its preserved configuration; re-enabling its restart policies and public
ingress requires a deliberate action.
