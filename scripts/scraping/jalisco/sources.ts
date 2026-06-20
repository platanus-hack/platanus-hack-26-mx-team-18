import type { ScrapeSourceConfig } from "@/types/scraping";

/**
 * Fuentes gubernamentales públicas — Jalisco.
 * TODO: Completar URLs reales y documentar estructura HTML de cada portal.
 */
export const JALISCO_SOURCES: ScrapeSourceConfig[] = [
  {
    name: "Portal forense Jalisco (placeholder)",
    url: "", // TODO: URL del portal gubernamental
    sourceType: "government_portal",
    stateCode: "JAL",
    notes: "Documentar selectores CSS y paginación aquí",
  },
];
