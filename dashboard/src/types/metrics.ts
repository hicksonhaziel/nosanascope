export type DashboardJobCategory = "running" | "failed" | "queued" | "other";
export type DashboardDeploymentCategory = "running" | "starting" | "stopped" | "error" | "other";

export interface DashboardJob {
  id: string;
  state: string;
  durationSeconds: number;
  deploymentId?: string;
}

export interface MetricsSnapshot {
  id: number;
  createdAt: string;
  activeJobs: number;
  failedJobs: number;
  queuedJobs: number;
  creditBalance: number;
  burnRatePerHour: number;
  deploymentTotal: number;
  deploymentRunning: number;
  deploymentStarting: number;
  deploymentStopped: number;
  deploymentError: number;
  payload?: {
    capturedAt?: string;
    assignedCredits?: number;
    reservedCredits?: number;
    settledCredits?: number;
    marketCount?: number;
    gpuUtilizationPct?: number;
    vramUsagePct?: number;
    estimatedTemperatureC?: number;
    jobs?: DashboardJob[];
    deployments?: Array<{
      id?: string;
      name?: string;
      status?: string;
      activeJobs?: number;
      replicas?: number;
    }>;
  };
}

export interface MetricsApiResponse {
  ok?: boolean;
  success?: boolean;
  error?: { message?: string; code?: string | number } | string;
  hours?: number;
  count?: number;
  snapshots?: MetricsSnapshot[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

export interface ChatApiResponse {
  ok: boolean;
  sessionId?: string;
  agentId?: string;
  userId?: string;
  message?: ChatMessage;
  error?: string;
}

export function getJobCategory(state: string): DashboardJobCategory {
  const normalized = state.toUpperCase();
  if (["RUNNING", "STARTING", "ACTIVE"].includes(normalized)) return "running";
  if (["ERROR", "FAILED", "STOPPED", "CRASHED", "INSUFFICIENT_FUNDS"].includes(normalized)) {
    return "failed";
  }
  if (["QUEUED", "PENDING", "DRAFT"].includes(normalized)) return "queued";
  return "other";
}

export function getDeploymentCategory(state: string): DashboardDeploymentCategory {
  const normalized = state.toUpperCase();
  if (normalized === "RUNNING") return "running";
  if (normalized === "STARTING") return "starting";
  if (["STOPPED", "STOPPING"].includes(normalized)) return "stopped";
  if (["ERROR", "FAILED", "INSUFFICIENT_FUNDS", "CRASHED"].includes(normalized)) return "error";
  return "other";
}
