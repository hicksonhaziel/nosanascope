import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CreditIcon } from "../icons";
import type { MetricsSnapshot } from "@/types/metrics";

interface CreditBurnChartProps {
  snapshots: MetricsSnapshot[];
}

export function CreditBurnChart({ snapshots }: CreditBurnChartProps) {
  const latest = snapshots[0];
  const normalized = [...snapshots].reverse();
  const step = normalized.length > 96 ? Math.ceil(normalized.length / 96) : 1;
  const sampled = normalized.filter((_, index) => index % step === 0);

  const chartData = sampled.map((item) => {
    const ts = new Date(item.createdAt).getTime();
    return {
      time: Number.isFinite(ts) ? ts : 0,
      balance: Number(item.creditBalance || 0),
      runway: null as number | null,
    };
  });

  const latestPoint = chartData[chartData.length - 1];
  const burnRate = Number(latest?.burnRatePerHour || 0);
  const runwayHours = burnRate > 0 ? Number(latest?.creditBalance || 0) / burnRate : null;

  if (latestPoint && runwayHours && Number.isFinite(runwayHours) && runwayHours > 0) {
    latestPoint.runway = latestPoint.balance;
    chartData.push({
      time: latestPoint.time + runwayHours * 60 * 60 * 1000,
      balance: 0,
      runway: 0,
    });
  }

  return (
    <section className="panel">
      <header className="flex items-center justify-between border-b border-[var(--border)] pb-3">
        <div className="flex items-center gap-2">
          <CreditIcon className="h-5 w-5 text-[var(--accent)]" />
          <h2 className="text-base font-semibold tracking-wide text-[var(--text)]">Credit Burn</h2>
        </div>
        <span className="font-mono text-sm text-[var(--muted-strong)]">
          {Number(latest?.burnRatePerHour || 0).toFixed(2)} / hr
        </span>
      </header>

      <div className="mt-4">
        <div className="mb-3 flex items-center justify-between text-sm">
          <span className="text-[var(--muted)]">Available Credits</span>
          <div className="text-right">
            <span className="font-mono text-[var(--text)]">
              {Number(latest?.creditBalance || 0).toFixed(2)}
            </span>
            <p className="text-xs text-[var(--muted)]">
              runway:{" "}
              {runwayHours && Number.isFinite(runwayHours) ? `${runwayHours.toFixed(1)}h` : "n/a"}
            </p>
          </div>
        </div>
        <div className="h-[240px] min-w-0 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-2 md:p-3">
          {chartData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
              Waiting for metrics samples.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
              <LineChart data={chartData} margin={{ left: 8, right: 8, top: 12, bottom: 8 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="time"
                  type="number"
                  tickFormatter={(value) =>
                    new Date(Number(value)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                  }
                  tick={{ fill: "var(--muted)", fontSize: 11 }}
                  domain={["dataMin", "dataMax"]}
                />
                <YAxis
                  tick={{ fill: "var(--muted)", fontSize: 11 }}
                  tickFormatter={(value) => `${Number(value).toFixed(1)}`}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text)",
                  }}
                  labelFormatter={(value) =>
                    new Date(Number(value)).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  }
                  formatter={(value, name) => {
                    const numeric = Number(value ?? 0);
                    if (name === "runway") return [`${numeric.toFixed(2)} NOS`, "Runway"];
                    return [`${numeric.toFixed(2)} NOS`, "Balance"];
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="balance"
                  stroke="var(--accent)"
                  strokeWidth={2.2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  type="linear"
                  dataKey="runway"
                  stroke="var(--muted)"
                  strokeDasharray="6 4"
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </section>
  );
}
