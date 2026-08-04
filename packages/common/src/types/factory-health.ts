export type FactoryHealthSeverity = "ok" | "warning" | "error";

export interface FactoryHealthItem {
  id: string;
  label: string;
  severity: FactoryHealthSeverity;
  message: string;
  action?: string;
  updatedAt?: string;
}

export interface FactoryHealthSummary {
  ok: number;
  warning: number;
  error: number;
}

export interface FactoryHealthSnapshot {
  generatedAt: string;
  severity: FactoryHealthSeverity;
  summary: FactoryHealthSummary;
  services: FactoryHealthItem[];
  integrations: FactoryHealthItem[];
  recentFailures: FactoryHealthItem[];
}
