import type { ScrapeSourceConfig } from "@/types/scraping";

/**
 * Fuentes gubernamentales públicas — Sinaloa.
 * TODO: Completar URLs reales y documentar estructura HTML de cada portal.
 */
export const SINALOA_SOURCES: ScrapeSourceConfig[] = [
  {
    name: "Portal forense Sinaloa (placeholder)",
    url: "", // TODO: URL del portal gubernamental
    sourceType: "government_portal",
    stateCode: "SIN",
    notes: "Documentar selectores CSS y paginación aquí",
  },
];
