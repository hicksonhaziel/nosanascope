"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ChatInterface } from "@/components/dashboard/ChatInterface";
import { CreditBurnChart } from "@/components/dashboard/CreditBurnChart";
import { GPUMetricsPanel } from "@/components/dashboard/GPUMetricsPanel";
import { JobStatusPanel } from "@/components/dashboard/JobStatusPanel";
import { ThemeToggle, type ThemeMode } from "@/components/dashboard/ThemeToggle";
import { ClockIcon, ConnectionIcon } from "@/components/icons";
import type { MetricsApiResponse, MetricsSnapshot } from "@/types/metrics";

const REFRESH_INTERVAL_MS = 10_000;

function pickInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem("nosana-dashboard-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function extractErrorMessage(payload: MetricsApiResponse | null): string {
  if (!payload) return "Unable to load metrics.";
  if (typeof payload.error === "string") return payload.error;
  if (payload.error?.message) return payload.error.message;
  return "Unable to load metrics.";
}

export default function Home() {
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [snapshots, setSnapshots] = useState<MetricsSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastPolledAt, setLastPolledAt] = useState<number | null>(null);

  const applyTheme = useCallback((mode: ThemeMode) => {
    document.documentElement.setAttribute("data-theme", mode);
    window.localStorage.setItem("nosana-dashboard-theme", mode);
    setTheme(mode);
  }, []);

  useEffect(() => {
    applyTheme(pickInitialTheme());
  }, [applyTheme]);

  const fetchMetrics = useCallback(async () => {
    try {
      const response = await fetch("/api/metrics?hours=24", {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json()) as MetricsApiResponse;

      if (!response.ok || payload.ok === false || payload.success === false) {
        throw new Error(extractErrorMessage(payload));
      }

      setSnapshots(payload.snapshots || []);
      setError(null);
      setLastPolledAt(Date.now());
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMetrics();
    const timer = window.setInterval(() => {
      void fetchMetrics();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [fetchMetrics]);

  const latest = snapshots[0];
  const jobs = useMemo(() => latest?.payload?.jobs || [], [latest]);
  const isConnected = !error && snapshots.length > 0;
  const activeJobs = Number(latest?.activeJobs || 0);
  const failedJobs = Number(latest?.failedJobs || 0);
  const creditBalance = Number(latest?.creditBalance || 0);
  const headerPills = [
    { label: "Active", value: activeJobs, tone: "success" as const },
    { label: "Failed", value: failedJobs, tone: "danger" as const },
    { label: "Credits", value: creditBalance.toFixed(2), tone: "neutral" as const },
  ];

  return (
    <div className="min-h-screen px-5 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-[1320px]">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
              NosanaScope Dashboard
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--text)]">
              Infrastructure Monitoring
            </h1>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {headerPills.map((pill) => (
              <span
                key={pill.label}
                className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold ${
                  pill.tone === "success"
                    ? "border-[color-mix(in_srgb,var(--success)_45%,transparent)] bg-[color-mix(in_srgb,var(--success)_15%,transparent)] text-[var(--success)]"
                    : pill.tone === "danger"
                      ? "border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--danger)_16%,transparent)] text-[var(--danger)]"
                      : "border-[var(--border)] bg-[var(--surface-muted)] text-[var(--muted-strong)]"
                }`}
              >
                <span className="uppercase tracking-wide">{pill.label}</span>
                <span className="font-mono">{pill.value}</span>
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--muted)]">
              <ConnectionIcon className="h-3.5 w-3.5" />
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  isConnected ? "bg-[var(--success)]" : "bg-[var(--danger)]"
                }`}
              />
              {isConnected ? "Nosana reachable" : "Nosana unreachable"}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--muted)]">
              <ClockIcon className="h-3.5 w-3.5" />
              refresh every 10s
            </span>
            <ThemeToggle
              theme={theme}
              onToggle={() => applyTheme(theme === "dark" ? "light" : "dark")}
            />
          </div>
        </header>

        {error ? (
          <div className="mb-6 rounded-md border border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_16%,transparent)] px-4 py-3 text-sm text-[var(--danger)]">
            {error}
          </div>
        ) : null}

        <main className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24 }}
            className="lg:col-span-7"
          >
            <JobStatusPanel jobs={jobs} updatedAt={latest?.createdAt} />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: 0.05 }}
            className="lg:col-span-5"
          >
            <GPUMetricsPanel snapshot={latest} />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: 0.08 }}
            className="lg:col-span-8"
          >
            <CreditBurnChart snapshots={snapshots} />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, delay: 0.12 }}
            className="lg:col-span-4"
          >
            <ChatInterface />
          </motion.div>
        </main>

        <footer className="mt-5 text-right text-xs text-[var(--muted)]">
          {loading && snapshots.length === 0
            ? "Loading metrics..."
            : `Last poll: ${lastPolledAt ? new Date(lastPolledAt).toLocaleTimeString() : "n/a"}`}
        </footer>
      </div>
    </div>
  );
}
