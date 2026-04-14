import { GpuIcon } from "../icons";
import type { MetricsSnapshot } from "@/types/metrics";

interface GPUMetricsPanelProps {
  snapshot?: MetricsSnapshot;
  loading?: boolean;
}

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-[var(--border)] px-3 py-2">
      <span className="text-sm text-[var(--muted)]">{label}</span>
      <span className="font-mono text-sm font-medium text-[var(--text)]">{value}</span>
    </div>
  );
}

function MetricBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="rounded-md border border-[var(--border)] px-3 py-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm text-[var(--muted)]">{label}</span>
        <span className="font-mono text-sm text-[var(--text)]">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2 rounded-full bg-[color-mix(in_srgb,var(--muted)_28%,transparent)]">
        <div
          className="h-2 rounded-full bg-[var(--accent)] transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function GPUMetricsPanel({ snapshot, loading = false }: GPUMetricsPanelProps) {
  const utilization = Number(snapshot?.payload?.gpuUtilizationPct || 0);
  const vram = Number(snapshot?.payload?.vramUsagePct || 0);
  const temp = Number(snapshot?.payload?.estimatedTemperatureC || 0);

  return (
    <section className="panel min-h-[360px]">
      <header className="flex items-center gap-2 border-b border-[var(--border)] pb-3">
        <GpuIcon className="h-5 w-5 text-[var(--accent)]" />
        <h2 className="text-base font-semibold tracking-wide text-[var(--text)]">GPU Metrics</h2>
      </header>

      <div className="mt-4 grid gap-2">
        {loading && !snapshot ? (
          Array.from({ length: 6 }).map((_, index) => (
            <div
              key={`gpu-loading-${index}`}
              className="h-12 animate-pulse rounded-md border border-[var(--border)] bg-[var(--surface-muted)]"
            />
          ))
        ) : (
          <>
            <MetricBar label="GPU Utilization" value={utilization} />
            <MetricBar label="VRAM Usage" value={vram} />
            <StatRow label="Est. Temperature" value={`${temp.toFixed(1)}°C`} />
            <StatRow label="Deployments (Total)" value={snapshot?.deploymentTotal ?? 0} />
            <StatRow label="Deployments (Running)" value={snapshot?.deploymentRunning ?? 0} />
            <StatRow label="Deployments (Error)" value={snapshot?.deploymentError ?? 0} />
          </>
        )}
      </div>
      <p className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--muted)]">
        Note: GPU utilization, VRAM usage, and temperature are estimated signals, not direct
        network telemetry.
      </p>
    </section>
  );
}
