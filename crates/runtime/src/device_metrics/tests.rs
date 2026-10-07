#![cfg(test)]
use super::*;

#[test]
fn device_metrics_validate_percent_memory_and_power_units() {
    assert_eq!(percent(100.0), Some(100.0));
    for n in [f64::NAN, f64::INFINITY, -1.0, 101.0] {
        assert_eq!(percent(n), None);
    }
    assert_eq!(memory(100, 30).used_bytes, 70);
    assert_eq!(memory(100, 30).usage_percent, Some(70.0));
    assert_eq!(memory(0, 30).usage_percent, None);
    assert_eq!(
        hardware::labeled_power("CPU Power: 2345 mW", "CPU Power:"),
        Some(2.345)
    );
    assert_eq!(
        hardware::labeled_power("GPU Power: 31.2 W", "GPU Power:"),
        Some(31.2)
    );
    assert_eq!(
        hardware::labeled_power(
            "Intel energy model derived package power (CPUs+GT+SA): 12.24W",
            "Intel energy model derived package power (CPUs+GT+SA):"
        ),
        Some(12.24)
    );
    assert_eq!(
        hardware::labeled_power("CPU Power: N/A", "CPU Power:"),
        None
    );
    assert_eq!(
        hardware::energy_watts(1_000_000, 5_000_000, None, 2.0),
        Some(2.0)
    );
    assert_eq!(
        hardware::energy_watts(9_000_000, 1_000_000, Some(10_000_000), 2.0),
        Some(1.0)
    );
    assert_eq!(hardware::energy_watts(10, 2, None, 2.0), None);
}

#[test]
fn device_metrics_parse_gpu_provider_fixtures_without_inventing_missing_values() {
    let gpus = hardware::parse_nvidia("GPU-a, \"NVIDIA, Test\", 73, 1024, 8192, 120.5\nGPU-b, RTX, N/A, N/A, 4096, [Not Supported]\n");
    assert_eq!(gpus.len(), 2);
    assert_eq!(gpus[0].name, "NVIDIA, Test");
    assert_eq!(gpus[0].used_memory_bytes, Some(1_073_741_824));
    assert_eq!(gpus[0].power.watts, Some(120.5));
    assert_eq!(gpus[1].usage_percent, None);
    assert_eq!(gpus[1].power.watts, None);
    let (cpu, temperature, windows) = hardware::parse_windows(
        r#"{"cpuPowerWatts":null,"gpus":[{"id":"luid-1","name":"GPU 0","usagePercent":45}]}"#,
    );
    assert_eq!(cpu.watts, None);
    assert_eq!(temperature.celsius, None);
    assert_eq!(windows[0].usage_percent, Some(45.0));
    let mac = hardware::parse_ioreg(br#"<?xml version="1.0"?><plist version="1.0"><array><dict><key>IORegistryEntryName</key><string>AGX</string><key>PerformanceStatistics</key><dict><key>Device Utilization %</key><integer>67</integer></dict></dict></array></plist>"#);
    assert_eq!(mac[0].usage_percent, Some(67.0));
    assert_eq!(mac[0].power.watts, None);
}

#[tokio::test]
async fn device_metrics_live_sampling_is_warmed_shared_and_serializes_camel_case() {
    let monitor = DeviceMonitor::default();
    let (a, b) = tokio::join!(monitor.snapshot(), monitor.snapshot());
    let a = a.unwrap();
    let b = b.unwrap();
    assert_eq!(a.sampled_at, b.sampled_at);
    assert!(a.sample_window_ms >= 900);
    assert!(a.cpu.logical_core_count > 0);
    assert_eq!(a.cpu.cores.len(), a.cpu.logical_core_count);
    assert!(a.cpu.usage_percent.is_some());
    assert!(a.memory.total_bytes > 0);
    assert_eq!(
        a.memory.used_bytes + a.memory.available_bytes,
        a.memory.total_bytes
    );
    #[cfg(target_os = "linux")]
    {
        let stat = std::fs::read_to_string("/proc/stat").unwrap();
        let count = stat
            .lines()
            .filter(|line| {
                line.strip_prefix("cpu")
                    .is_some_and(|tail| tail.starts_with(|c: char| c.is_ascii_digit()))
            })
            .count();
        assert_eq!(a.cpu.logical_core_count, count);
        let meminfo = std::fs::read_to_string("/proc/meminfo").unwrap();
        let total = meminfo
            .lines()
            .find(|line| line.starts_with("MemTotal:"))
            .unwrap()
            .split_whitespace()
            .nth(1)
            .unwrap()
            .parse::<u64>()
            .unwrap()
            * 1024;
        assert_eq!(a.memory.total_bytes, total);
    }
    println!(
        "Native sample: {} cores, CPU {:?}%, RAM {}/{} bytes, environment={}, CPU power={:?}, CPU temperature={:?}, sensor reason={:?}",
        a.cpu.logical_core_count,
        a.cpu.usage_percent,
        a.memory.used_bytes,
        a.memory.total_bytes,
        a.environment,
        a.cpu_power.watts,
        a.cpu_temperature.celsius,
        a.cpu_power.reason
    );
    let value = serde_json::to_value(a).unwrap();
    assert!(value["cpu"]["logicalCoreCount"].is_number());
    assert!(value.get("sampleWindowMs").is_some());
    assert!(value.get("sample_window_ms").is_none());
    assert!(value.get("cpuTemperature").is_some());
}

#[test]
fn device_metrics_temperature_provider_units_and_invalid_values() {
    assert_eq!(
        hardware::labeled_temperature("CPU die temperature: 73.25 C", "CPU die temperature:"),
        Some(73.25)
    );
    assert_eq!(
        hardware::labeled_temperature("CPU die temperature: 163 F", "CPU die temperature:"),
        None
    );
    for n in [f64::NAN, f64::INFINITY, -273.15, 999.0] {
        assert_eq!(hardware::celsius(n), None);
    }
    let (power, temperature, _) =
        hardware::parse_windows(r#"{"cpuPowerWatts":65.5,"cpuTemperatureCelsius":82.5,"gpus":[]}"#);
    assert_eq!(power.watts, Some(65.5));
    assert_eq!(temperature.celsius, Some(82.5));
}
