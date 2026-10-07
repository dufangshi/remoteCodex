use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerReadingDto {
    pub watts: Option<f64>,
    pub source: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuCoreMetricsDto {
    pub index: usize,
    pub usage_percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuMetricsDto {
    pub model: String,
    pub usage_percent: Option<f64>,
    pub logical_core_count: usize,
    pub cores: Vec<CpuCoreMetricsDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryMetricsDto {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub usage_percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuMetricsDto {
    pub id: String,
    pub name: String,
    pub usage_percent: Option<f64>,
    pub used_memory_bytes: Option<u64>,
    pub total_memory_bytes: Option<u64>,
    pub power: PowerReadingDto,
    pub source: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLimitsDto {
    pub cpu_cores: Option<f64>,
    pub memory_total_bytes: Option<u64>,
    pub memory_used_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceMetricsDto {
    pub sampled_at: String,
    pub sample_window_ms: u64,
    pub platform: String,
    pub environment: String,
    pub cpu: CpuMetricsDto,
    pub memory: MemoryMetricsDto,
    pub swap: MemoryMetricsDto,
    pub cpu_power: PowerReadingDto,
    pub gpus: Vec<GpuMetricsDto>,
    pub hardware_sampled_at: String,
    pub hardware_notes: Vec<String>,
    pub limits: Option<DeviceLimitsDto>,
}
