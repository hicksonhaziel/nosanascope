import { ClockIcon, JobsIcon } from "../icons";
import { getJobCategory, type DashboardJob } from "@/types/metrics";

interface JobStatusPanelProps {
  jobs: DashboardJob[];
  updatedAt?: string;
}

const statusStyles: Record<string, string> = {
  running: "bg-[color-mix(in_srgb,var(--success)_18%,transparent)] text-[var(--success)]",
  failed: "bg-[color-mix(in_srgb,var(--danger)_18%,transparent)] text-[var(--danger)]",
  queued: "bg-[color-mix(in_srgb,var(--muted)_25%,transparent)] text-[var(--muted-strong)]",
  other: "bg-[color-mix(in_srgb,var(--muted)_25%,transparent)] text-[var(--muted-strong)]",
};

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function formatRelative(iso?: string): string {
  if (!iso) return "no data";
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "no data";
  const delta = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  return `${Math.floor(delta / 3600)}h ago`;
}

export function JobStatusPanel({ jobs, updatedAt }: JobStatusPanelProps) {
  const sorted = [...jobs].sort((a, b) => b.durationSeconds - a.durationSeconds);

  return (
    <section className="panel min-h-[360px]">
      <header className="flex items-center justify-between border-b border-[var(--border)] pb-3">
        <div className="flex items-center gap-2">
          <JobsIcon className="h-5 w-5 text-[var(--accent)]" />
          <h2 className="text-base font-semibold tracking-wide text-[var(--text)]">Job Status</h2>
        </div>
        <span className="inline-flex items-center gap-1 text-xs text-[var(--muted)]">
          <ClockIcon className="h-3.5 w-3.5" />
          updated {formatRelative(updatedAt)}
        </span>
      </header>

      <div className="mt-4 space-y-2">
        <div className="grid grid-cols-[120px_1fr_92px] px-3 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
          <span>Status</span>
          <span>Job ID</span>
          <span className="text-right">Duration</span>
        </div>

        {sorted.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--border)] p-6 text-sm text-[var(--muted)]">
            No jobs in latest snapshot.
          </div>
        ) : (
          sorted.slice(0, 14).map((job) => {
            const category = getJobCategory(job.state);
            return (
              <div
                key={job.id}
                className="grid grid-cols-[120px_1fr_92px] items-center rounded-md border border-[var(--border)] px-3 py-2.5"
              >
                <span
                  className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${statusStyles[category]}`}
                >
                  {category}
                </span>
                <span
                  className="truncate font-mono text-sm text-[var(--text)]"
                  title={job.id}
                >
                  {job.id}
                </span>
                <span className="text-right font-mono text-sm text-[var(--muted-strong)]">
                  {formatDuration(job.durationSeconds)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

