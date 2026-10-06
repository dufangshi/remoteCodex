# Device resource monitoring proposal

The current device list reports connection and heartbeat state, but the Supervisor does not yet expose CPU, memory or power measurements. This document describes an implementation path; these features are not included in 0.12.59.

## CPU and memory

Use `sysinfo = "=0.37.2"`, with default features disabled and the `system` feature enabled. This version supports Windows, macOS and Linux and requires Rust 1.88, below the repository's pinned 1.89 toolchain. Keep one sampler alive so CPU usage is calculated from successive measurements rather than a new baseline on every request. Refresh CPU and memory only, without enumerating processes, disks or networks.

Expose an authenticated `GET /api/management/resources` returning camelCase fields for sample time, platform, environment, logical CPU count, CPU usage percent, used/available/total memory bytes, and optional power readings. The first CPU sample should be marked as warming up rather than displayed as zero. Cache a coherent snapshot for a short sampling interval, such as three seconds, shared by all viewers.

The device cards and device settings can poll the existing encrypted device API transport while visible. Show CPU percent, used/total memory, sample age, and optional power. Stop polling when the page is hidden or the device is offline; clear stale values or visibly mark them stale. Use explicit device URLs without changing the globally selected device.

WSL should use the Linux implementation and identify the environment as WSL. Its CPU and memory measurements describe the WSL environment, including the VM's available resources. Monitoring the Windows host instead requires a separate Windows sampler or a deliberately designed host bridge. Do not silently label WSL measurements as whole-host measurements.

## Optional power readings

Power availability is a hardware capability, separate from operating-system support. Each reading needs a scope and source; CPU-package watts and battery discharge watts are different measurements.

| Environment | Possible power source | Scope and availability |
| --- | --- | --- |
| Linux | Powercap/RAPL `energy_uj` differences over elapsed time | CPU package, when the hardware exposes readable energy counters. Handle counter wrap and avoid summing package and nested subdomains twice. |
| Windows | Battery discharge rate via Windows battery APIs | Battery discharge power on supported battery-equipped devices. Desktop CPU/package measurements need an additional hardware-specific provider. |
| macOS | Battery energy rate; optional `powermetrics` integration | Battery discharge power where reported; CPU/GPU power needs a separate sampler with the required privileges. |
| WSL | Optional Windows host bridge | Host hardware power sensors are generally not exposed to the Linux guest. |

The cross-platform `battery` crate is one candidate for battery discharge measurements. Only show a reading when the battery is discharging and the rate is valid. Charging rate, missing sensors and unknown rates must not be displayed as device power consumption or as zero watts. A sensor failure should not interrupt CPU/memory monitoring or thread execution.

## Validation scope

Use targeted Rust tests for CPU warm-up, bounds/units, environment detection, unavailable sensors, energy counter wrap and domain selection. Test the authenticated endpoint and existing device permission boundary. Use a focused browser regression for two separately addressed devices, an offline transition and unavailable power. Native Windows, WSL and macOS readings should be checked on those environments before claiming measured accuracy; Linux results alone do not validate the other platforms.

## Sources

- [sysinfo 0.37.2 supported platforms, Rust requirement and sampling guidance](https://docs.rs/sysinfo/0.37.2/sysinfo/)
- [Linux Power Capping Framework and energy counters](https://cdn.kernel.org/doc/html/latest/power/powercap/powercap.html)
- [Windows SYSTEM_BATTERY_STATE discharge rate](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-system_battery_state)
- [WSL VM memory and processor settings](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)
- [Cross-platform battery library](https://docs.rs/battery/0.7.8/battery/)
