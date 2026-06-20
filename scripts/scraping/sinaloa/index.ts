/**
 * Entry point — Scraper Sinaloa
 *
 * Flujo esperado (sin implementar):
 * 1. Conectar a Supabase con SUPABASE_SERVICE_ROLE_KEY
 * 2. Crear scrape_run para cada fuente en sources.ts
 * 3. fetch(url) → cheerio.load(html) → extraer registros
 * 4. Insertar raw_records con payload crudo
 * 5. Finalizar scrape_run
 */

import { SINALOA_SOURCES } from "./sources";

async function main() {
  console.log("[sinaloa] Scraper placeholder — sin lógica implementada");
  console.log(`[sinaloa] Fuentes configuradas: ${SINALOA_SOURCES.length}`);
  SINALOA_SOURCES.forEach((source) => {
    console.log(`  - ${source.name}: ${source.url || "(URL pendiente)"}`);
  });
}

main().catch((err) => {
  console.error("[sinaloa] Error:", err);
  process.exit(1);
});
