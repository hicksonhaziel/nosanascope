import { ClockIcon, JobsIcon } from "../icons";
import {
  getDeploymentCategory,
  getJobCategory,
  type DashboardJob,
  type MetricsSnapshot,
} from "@/types/metrics";

interface JobStatusPanelProps {
  jobs: DashboardJob[];
  snapshot?: MetricsSnapshot;
  loading?: boolean;
  updatedAt?: string;
}

const statusStyles: Record<string, string> = {
  running: "bg-[color-mix(in_srgb,var(--success)_18%,transparent)] text-[var(--success)]",
  starting: "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-[var(--accent)]",
  stopped: "bg-[color-mix(in_srgb,var(--muted)_25%,transparent)] text-[var(--muted-strong)]",
  error: "bg-[color-mix(in_srgb,var(--danger)_18%,transparent)] text-[var(--danger)]",
  other: "bg-[color-mix(in_srgb,var(--muted)_25%,transparent)] text-[var(--muted-strong)]",
};

function formatRelative(iso?: string): string {
  if (!iso) return "no data";
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "no data";
  const delta = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  return `${Math.floor(delta / 3600)}h ago`;
}

type DeploymentRow = {
  id: string;
  status: string;
  running: number;
  failed: number;
  queued: number;
  totalJobs: number;
};

function normalizeLabel(state: string): string {
  const category = getDeploymentCategory(state);
  if (category === "running") return "Running";
  if (category === "starting") return "Starting";
  if (category === "error") return "Error";
  if (category === "stopped") return "Stopped";
  return "Other";
}

function getStatusCategory(state: string) {
  return getDeploymentCategory(state);
}

export function JobStatusPanel({ jobs, snapshot, loading = false, updatedAt }: JobStatusPanelProps) {
  const grouped = new Map<string, DeploymentRow>();
  for (const job of jobs) {
    const deploymentId = (job.deploymentId || "unknown").trim();
    if (!grouped.has(deploymentId)) {
      grouped.set(deploymentId, {
        id: deploymentId,
        status: "STOPPED",
        running: 0,
        failed: 0,
        queued: 0,
        totalJobs: 0,
      });
    }

    const row = grouped.get(deploymentId)!;
    row.totalJobs += 1;
    const category = getJobCategory(job.state);
    if (category === "running") row.running += 1;
    if (category === "failed") row.failed += 1;
    if (category === "queued") row.queued += 1;
    if (row.running > 0) row.status = "RUNNING";
    else if (row.queued > 0) row.status = "STARTING";
    else if (row.failed > 0) row.status = "ERROR";
    else row.status = "STOPPED";
  }

  for (const deployment of snapshot?.payload?.deployments || []) {
    const rawId = String(deployment?.id || deployment?.name || "").trim();
    if (!rawId) continue;
    if (!grouped.has(rawId)) {
      grouped.set(rawId, {
        id: rawId,
        status: String(deployment?.status || "UNKNOWN"),
        running: Math.max(0, Number(deployment?.activeJobs || 0)),
        failed: 0,
        queued: 0,
        totalJobs: Math.max(0, Number(deployment?.activeJobs || 0)),
      });
      continue;
    }
    const row = grouped.get(rawId)!;
    row.status = String(deployment?.status || row.status);
    row.running = Math.max(row.running, Math.max(0, Number(deployment?.activeJobs || 0)));
    row.totalJobs = Math.max(row.totalJobs, Math.max(0, Number(deployment?.activeJobs || 0)));
  }

  if (grouped.size === 0) {
    const running = Number(snapshot?.deploymentRunning ?? 0);
    const starting = Number(snapshot?.deploymentStarting ?? 0);
    const error = Number(snapshot?.deploymentError ?? 0);
    const stopped = Number(snapshot?.deploymentStopped ?? 0);

    if (running > 0) {
      grouped.set("running-deployments", {
        id: `${running} running deployment${running > 1 ? "s" : ""}`,
        status: "RUNNING",
        running,
        failed: 0,
        queued: 0,
        totalJobs: running,
      });
    }
    if (starting > 0) {
      grouped.set("starting-deployments", {
        id: `${starting} starting deployment${starting > 1 ? "s" : ""}`,
        status: "STARTING",
        running: 0,
        failed: 0,
        queued: 0,
        totalJobs: starting,
      });
    }
    if (error > 0) {
      grouped.set("error-deployments", {
        id: `${error} failed/error deployment${error > 1 ? "s" : ""}`,
        status: "ERROR",
        running: 0,
        failed: error,
        queued: 0,
        totalJobs: error,
      });
    }
    if (stopped > 0) {
      grouped.set("stopped-deployments", {
        id: `${stopped} stopped deployment${stopped > 1 ? "s" : ""}`,
        status: "STOPPED",
        running: 0,
        failed: 0,
        queued: 0,
        totalJobs: stopped,
      });
    }
  }

  const sorted = Array.from(grouped.values()).sort((a, b) => {
    const order = { running: 0, starting: 1, error: 2, stopped: 3, other: 4 };
    const aScore = order[getStatusCategory(a.status) as keyof typeof order] ?? 4;
    const bScore = order[getStatusCategory(b.status) as keyof typeof order] ?? 4;
    if (aScore !== bScore) return aScore - bScore;
    return b.totalJobs - a.totalJobs;
  });
  const statusSummary = [
    { label: "Running", value: Number(snapshot?.deploymentRunning ?? 0), tone: "running" },
    { label: "Starting", value: Number(snapshot?.deploymentStarting ?? 0), tone: "starting" },
    { label: "Error", value: Number(snapshot?.deploymentError ?? 0), tone: "error" },
    { label: "Stopped", value: Number(snapshot?.deploymentStopped ?? 0), tone: "stopped" },
    { label: "Total", value: Number(snapshot?.deploymentTotal ?? 0), tone: "other" },
  ];

  return (
    <section className="panel min-h-[360px]">
      <header className="flex items-center justify-between border-b border-[var(--border)] pb-3">
        <div className="flex items-center gap-2">
          <JobsIcon className="h-5 w-5 text-[var(--accent)]" />
          <h2 className="text-base font-semibold tracking-wide text-[var(--text)]">
            Deployment Status
          </h2>
        </div>
        <span className="inline-flex items-center gap-1 text-xs text-[var(--muted)]">
          <ClockIcon className="h-3.5 w-3.5" />
          updated {formatRelative(updatedAt)}
        </span>
      </header>

      <div className="mt-4 space-y-2">
        <div className="grid gap-2 pb-2 sm:grid-cols-5">
          {statusSummary.map((item) => (
            <div
              key={item.label}
              className={`rounded-md border px-2.5 py-2 ${
                item.tone === "running"
                  ? "border-[color-mix(in_srgb,var(--success)_45%,transparent)] bg-[color-mix(in_srgb,var(--success)_11%,transparent)]"
                  : item.tone === "starting"
                    ? "border-[color-mix(in_srgb,var(--accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--accent)_11%,transparent)]"
                    : item.tone === "error"
                      ? "border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--danger)_11%,transparent)]"
                      : "border-[var(--border)] bg-[var(--surface-muted)]"
              }`}
            >
              <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{item.label}</p>
              <p className="font-mono text-base font-semibold text-[var(--text)]">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[124px_1fr_130px] px-3 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
          <span>Status</span>
          <span>Deployment</span>
          <span className="text-right">Jobs</span>
        </div>

        {loading && sorted.length === 0 ? (
          Array.from({ length: 6 }).map((_, index) => (
            <div
              key={`deployment-loading-${index}`}
              className="grid grid-cols-[124px_1fr_130px] items-center rounded-md border border-[var(--border)] px-3 py-2.5"
            >
              <span className="h-6 w-20 animate-pulse rounded-full bg-[var(--surface-muted)]" />
              <span className="h-5 w-full animate-pulse rounded bg-[var(--surface-muted)]" />
              <span className="ml-auto h-5 w-20 animate-pulse rounded bg-[var(--surface-muted)]" />
            </div>
          ))
        ) : sorted.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--border)] p-6 text-sm text-[var(--muted)]">
            No deployments found in latest snapshot.
          </div>
        ) : (
          sorted.slice(0, 14).map((deployment) => {
            const category = getStatusCategory(deployment.status);
            return (
              <div
                key={deployment.id}
                className="grid grid-cols-[124px_1fr_130px] items-center rounded-md border border-[var(--border)] px-3 py-2.5"
              >
                <span
                  className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${statusStyles[category]}`}
                >
                  {normalizeLabel(deployment.status)}
                </span>
                <span
                  className="truncate font-mono text-sm text-[var(--text)]"
                  title={deployment.id}
                >
                  {deployment.id}
                </span>
                <span className="text-right font-mono text-sm text-[var(--muted-strong)]">
                  {deployment.totalJobs} total · {deployment.running} active
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
