# Device monitoring

`GET /api/device/metrics` returns a camelCase `DeviceMetricsDto`. The device
Supervisor collects CPU and memory locally, and the relay forwards the endpoint
through normal authenticated transport. Owners and device-scoped grants may read
it; thread/workspace-scoped grants cannot inspect the host.

CPU percentages use native counter differences through `sysinfo`, shared between
readers. First use, and reopening after a pause longer than 15 seconds, warm the
counter for one second. `sampleWindowMs` describes the averaging interval.
Basic readings cache for two seconds; optional hardware sensors cache for ten.
There is no always-running collector when nobody is viewing the device.

Memory uses native total and available physical RAM in bytes; used memory is
total minus available, including reclaimable memory according to the OS. Swap
or the page file is separate. WSL reports the Linux VM rather than Windows host
RAM. Containers expose OS-visible CPU/RAM plus available cgroup limits separately.

| System  | CPU and RAM                             | Optional GPU/power sources                                                                                                             |
| ------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Linux   | Native system counters, per logical CPU | NVIDIA driver; DRM utilization/VRAM and hwmon GPU watts; RAPL CPU package energy deltas                                                |
| Windows | Native system counters, per logical CPU | NVIDIA driver; WDDM engine counters (busiest engine per adapter); CPU package watts from an existing LibreHardwareMonitor WMI provider |
| macOS   | Native system counters, per logical CPU | IORegistry GPU utilization; `powermetrics` CPU/GPU watts if accessible                                                                 |
| WSL     | Linux VM counters, per logical CPU      | WSL NVIDIA driver where supported; host power is usually unavailable                                                                   |

Power is measured watts, never thermal design power or an estimate from CPU
utilization. Package/board readings can include more than CPU/GPU compute units;
they are not total device power and must not be added to estimate wall power.
Unsupported, malformed, permission-denied or timed-out sensor readings are null,
with a reason. Zero remains a valid measured value. RAPL collects only package
domains and handles one counter wrap; long gaps re-prime rather than guess wraps.
The app does not install drivers, change sensor permissions or ask for a password.
macOS can use an already-authorized noninteractive `sudo -n` for powermetrics.

The Web button appears in the mobile topbar and desktop icon rail above Settings,
remaining visible when the chat sidebar is collapsed. Opening it shows
per-core bars, used/total RAM, swap and available GPU/power readings. A failed or
stale sample replaces button percentages with dashes; the details retain the last
sample with its age. Hidden browser tabs pause polling. Older Supervisors display
an update instruction instead of fabricated zeroes.

Validation covers Linux native samples against `/proc/stat` and `/proc/meminfo`,
concurrent reader caching, the isolated HTTP endpoint, relay scope restrictions,
and Windows/macOS/NVIDIA provider fixtures. Browser regressions cover both desktop
and mobile (including 320px width), details, keyboard dismissal and stale samples.
Sensor availability on real hardware remains conditional on its drivers and access.

# Turn progress indicator

Running turns retain three animated dots. `Last progress · Ns ago` shows the age
of the last received text, plan, tool, context, subagent, request or turn/usage
event for that turn. Socket pings, polling, expanding history and rerendering do
not reset it. Initial/reloaded views fall back to recorded activity timestamps.
Silence does not itself mark a turn stuck or finished; known background agents
continue to have their own explicit status.
