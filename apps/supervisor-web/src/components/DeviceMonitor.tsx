import { useEffect, useState } from 'react';
import type { DeviceMetricsDto, PowerReadingDto, TemperatureReadingDto } from '@remote-codex/shared';
import { ApiError, request } from '../lib/api';
import { FormDialog } from './FormDialog';
import './device-monitor.css';

const pct = (value: number | null | undefined) =>
  value == null ? '—' : `${Math.round(value)}%`;
const gib = (bytes: number) => `${(bytes / 2 ** 30).toFixed(1)} GiB`;
function Power({
  label,
  reading,
}: {
  label: string;
  reading: PowerReadingDto;
}) {
  return (
    <>
    <div className="device-monitor-reading">
      <span title={reading.source ?? undefined}>{label}</span>
      <span title={reading.reason ?? reading.source ?? undefined}>
        {reading.watts == null
          ? 'Unavailable'
          : `${reading.watts.toFixed(1)} W`}
      </span>
    </div>
      {reading.watts == null && reading.reason && (
        <p className="device-monitor-caption">
          {reading.reason}{' '}
          {reading.reason.includes('RAPL') && (
            <a href="https://github.com/dufangshi/remoteCodex/blob/main/docs/device-monitor.md#linux-sensor-access" target="_blank" rel="noreferrer">
              Sensor access setup
            </a>
          )}
        </p>
      )}
    </>
  );
}

function Temperature({ reading }: { reading: TemperatureReadingDto | undefined }) {
  return (
    <>
      <div className="device-monitor-reading">
        <span>CPU temperature</span>
        <span title={reading?.source ?? undefined}>
          {reading?.celsius == null ? 'Unavailable' : `${reading.celsius.toFixed(1)} °C`}
        </span>
      </div>
      {reading?.celsius == null && (
        <p className="device-monitor-caption">
          {reading?.reason ?? 'Update this device’s Supervisor to collect temperature sensors'}
        </p>
      )}
      {Boolean(reading?.sensors.length) && (
        <details className="device-monitor-sensors">
          <summary>CPU temperature sensors ({reading!.sensors.length})</summary>
          {reading!.sensors.map((sensor, index) => (
            <div className="device-monitor-reading" key={`${sensor.label}-${index}`}>
              <span>{sensor.label}</span><span>{sensor.celsius.toFixed(1)} °C</span>
            </div>
          ))}
        </details>
      )}
    </>
  );
}

export function DeviceMonitor() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<DeviceMetricsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let disposed = false;
    let busy = false;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    const poll = async () => {
      if (disposed || busy || stopped) return;
      clearTimeout(timer);
      if (document.hidden || !navigator.onLine) {
        if (!navigator.onLine) setError('Device monitoring is offline');
        timer = setTimeout(poll, 5000);
        return;
      }
      busy = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 10_000);
      try {
        const sample = await request<DeviceMetricsDto>('/api/device/metrics', {
          signal: controller.signal,
        });
        if (!disposed) {
          setData(sample);
          setError(null);
        }
      } catch (cause) {
        if (!disposed) {
          if (cause instanceof ApiError && cause.statusCode === 403) {
            setForbidden(true);
            stopped = true;
          } else if (cause instanceof ApiError && cause.statusCode === 404) {
            setError('Update this device’s Supervisor to enable monitoring');
            // Check occasionally after the device is updated.
          } else
            setError('Device metrics unavailable; showing the last sample');
        }
      } finally {
        clearTimeout(timeout);
        busy = false;
        if (!disposed && !stopped) timer = setTimeout(poll, open ? 2000 : 5000);
      }
    };
    void poll();
    const wake = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('offline', wake);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(clock);
      controller?.abort();
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('offline', wake);
    };
  }, [open]);
  if (forbidden) return null;
  const age = data
    ? Math.max(0, Math.floor((now - Date.parse(data.sampledAt)) / 1000))
    : null;
  const stale = Boolean(error) || (age != null && age > 15);
  const gpu = data?.gpus.find((gpu) => gpu.usagePercent != null);
  return (
    <>
      <button
        type="button"
        className="device-monitor-button"
        aria-label="Device monitor"
        aria-expanded={open}
        data-stale={stale || undefined}
        title={error ?? 'CPU, memory and hardware sensors'}
        onClick={() => setOpen(true)}
      >
        <span>
          CPU <b>{pct(stale ? null : data?.cpu.usagePercent)}</b>
        </span>
        <span>
          RAM <b>{pct(stale ? null : data?.memory.usagePercent)}</b>
        </span>
        {gpu && (
          <span>
            GPU <b>{pct(stale ? null : gpu.usagePercent)}</b>
          </span>
        )}
      </button>
      {open && (
        <FormDialog
          title="Device monitor"
          onClose={() => setOpen(false)}
          description={
            data?.environment === 'wsl'
              ? 'WSL environment · CPU and memory describe the Linux VM.'
              : data?.environment === 'container'
                ? 'Container environment · System CPU and memory, with container limits below.'
                : 'Current system CPU, memory and available hardware sensors.'
          }
        >
          <div className="device-monitor-details">
            {error && (
              <p role="status" className="device-monitor-notice">
                {error}
              </p>
            )}
            {!data && !error && (
              <p role="status">Collecting the first CPU sample…</p>
            )}
            {data && (
              <>
                <p className="device-monitor-caption">
                  {stale ? 'Last sample' : 'Updated'} {age}s ago ·{' '}
                  {data.platform}
                  <br />
                  CPU sample window {(data.sampleWindowMs / 1000).toFixed(1)}s
                </p>
                <section aria-label="CPU utilization">
                  <div className="device-monitor-heading">
                    <h3>CPU</h3>
                    <strong>{pct(data.cpu.usagePercent)}</strong>
                  </div>
                  <p className="device-monitor-caption">
                    {data.cpu.model} · {data.cpu.logicalCoreCount} logical cores
                  </p>
                  <div className="device-monitor-cores">
                    {data.cpu.cores.map((core) => (
                      <div key={core.index} className="device-monitor-core">
                        <span>
                          Core {core.index + 1}
                          <b>{pct(core.usagePercent)}</b>
                        </span>
                        <progress
                          aria-label={`Core ${core.index + 1} utilization`}
                          max={100}
                          value={core.usagePercent ?? undefined}
                        />
                      </div>
                    ))}
                  </div>
                  <Power label="CPU power" reading={data.cpuPower} />
                  <Temperature reading={data.cpuTemperature} />
                </section>
                <section aria-label="Memory utilization">
                  <div className="device-monitor-heading">
                    <h3>Memory</h3>
                    <strong>{pct(data.memory.usagePercent)}</strong>
                  </div>
                  <div className="device-monitor-reading">
                    <span>Used / total</span>
                    <span>
                      {gib(data.memory.usedBytes)} /{' '}
                      {gib(data.memory.totalBytes)}
                    </span>
                  </div>
                  <div className="device-monitor-reading">
                    <span>Available</span>
                    <span>{gib(data.memory.availableBytes)}</span>
                  </div>
                  {data.swap.totalBytes > 0 && (
                    <div className="device-monitor-reading">
                      <span>Swap / page file</span>
                      <span>
                        {gib(data.swap.usedBytes)} / {gib(data.swap.totalBytes)}
                      </span>
                    </div>
                  )}
                </section>
                {data.limits && (
                  <section aria-label="Container limits">
                    <h3>Container limits</h3>
                    {data.limits.cpuCores != null && (
                      <div className="device-monitor-reading">
                        <span>CPU quota</span>
                        <span>{data.limits.cpuCores} cores</span>
                      </div>
                    )}
                    {data.limits.memoryTotalBytes != null && (
                      <div className="device-monitor-reading">
                        <span>Memory</span>
                        <span>
                          {data.limits.memoryUsedBytes == null
                            ? '—'
                            : gib(data.limits.memoryUsedBytes)}{' '}
                          / {gib(data.limits.memoryTotalBytes)}
                        </span>
                      </div>
                    )}
                  </section>
                )}
                {data.gpus.map((gpu) => (
                  <section key={gpu.id} aria-label={`GPU ${gpu.name}`}>
                    <div className="device-monitor-heading">
                      <h3>{gpu.name}</h3>
                      <strong>{pct(gpu.usagePercent)}</strong>
                    </div>
                    {gpu.totalMemoryBytes != null && (
                      <div className="device-monitor-reading">
                        <span>GPU memory</span>
                        <span>
                          {gpu.usedMemoryBytes == null
                            ? '—'
                            : gib(gpu.usedMemoryBytes)}{' '}
                          / {gib(gpu.totalMemoryBytes)}
                        </span>
                      </div>
                    )}
                    <Power label="GPU power" reading={gpu.power} />
                  </section>
                ))}
                {data.hardwareNotes.map((note) => (
                  <p key={note} className="device-monitor-caption">
                    {note}
                  </p>
                ))}
                <p className="device-monitor-caption">
                  Hardware sensors sampled at{' '}
                  {new Date(data.hardwareSampledAt).toLocaleTimeString()}. Power
                  requires supported hardware and sensor access.
                </p>
              </>
            )}
          </div>
        </FormDialog>
      )}
    </>
  );
}
