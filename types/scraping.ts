import type { Database, Json } from "./database";

export type ScrapeRunStatus = Database["public"]["Enums"]["scrape_run_status"];

export interface ScrapeSourceConfig {
  id?: string;
  name: string;
  url: string;
  sourceType: string;
  stateCode: string;
  /** Selectores CSS o notas para el parser — completar por estado */
  notes?: string;
}

export interface ScrapeRun {
  id: string;
  sourceId: string;
  status: ScrapeRunStatus;
  startedAt: string;
  finishedAt: string | null;
  recordsFound: number;
  errorMessage: string | null;
}

export interface RawRecord {
  id: string;
  scrapeRunId: string;
  sourceId: string;
  externalId: string | null;
  rawPayload: Json;
  scrapedAt: string;
}
