import type { ScrapeSourceConfig } from "@/types/scraping";

/** Config compartida para todos los scrapers */
export const SCRAPING_CONFIG = {
  /** Timeout de fetch en ms */
  fetchTimeoutMs: 30_000,
  /** User-Agent para requests HTTP */
  userAgent: "ForenseMX-Bot/0.1 (+https://github.com/platanus-hack/platanus-hack-26-mx-team-18)",
} as const;

export type { ScrapeSourceConfig };
