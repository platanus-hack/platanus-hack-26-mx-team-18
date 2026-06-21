/**
 * Scraper de publicaciones de X (Twitter) sobre personas desaparecidas.
 *
 * Fase 1 (actual): recolecta una muestra de N resultados y la guarda en JSON
 * para revisión humana antes de inyectar en la tabla `persona`.
 *
 * Fuentes monitoreadas:
 *   - https://x.com/BoletinCBPCDMX   (Comisión de Búsqueda CDMX)
 *   - https://x.com/Busqueda_MX      (RNPDNO / búsqueda nacional)
 *   - https://x.com/hashtag/FichaDeBúsqueda
 *
 * Cómo correrlo:
 *   pnpm scrape:x                    -> 50 resultados → data/x-muestra-50.txt
 *   pnpm scrape:x 30                 -> muestra de 30
 *   pnpm scrape:x 50 data/otro.txt   -> ruta de salida personalizada
 *
 * Necesita en .env.local: FIRECRAWL_API_KEY
 *
 * Privacidad: datos personales de víctimas, fuente pública, uso humanitario.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import {
  createFirecrawlClient,
  recolectarCandidatosX,
  FUENTES_X,
} from "@/lib/firecrawl/x-client";
import { aMuestraX } from "@/lib/types/x/adaptadores";
import type { ArchivoMuestraX } from "@/lib/types/x/types";

loadEnv({ path: ".env.local" });

const LIMITE_DEFAULT = 50;
const RESULTADOS_POR_CONSULTA = 10;
const SALIDA_DEFAULT = "data/x-muestra-50.txt";

function claveDedup(pub: { tweet_url: string | null; url: string }): string {
  return (pub.tweet_url ?? pub.url).toLowerCase();
}

async function main() {
  const limite = Math.max(1, Number(process.argv[2]) || LIMITE_DEFAULT);
  const salida = resolve(process.argv[3] ?? SALIDA_DEFAULT);

  const firecrawl = createFirecrawlClient();

  console.log(`🐦 X scraper: recolectando hasta ${limite} publicaciones…`);
  console.log(`   Fuentes: ${FUENTES_X.map((f) => f.id).join(", ")}`);

  const { publicaciones, origenPorClave } = await recolectarCandidatosX(firecrawl, {
    limite,
    resultadosPorConsulta: RESULTADOS_POR_CONSULTA,
  });

  const muestras = publicaciones.map((pub, i) => {
    const origen = origenPorClave.get(claveDedup(pub))!;
    return aMuestraX(i + 1, origen, pub);
  });

  const validos = muestras.filter((m) => m.validacion.valido).length;

  const archivo: ArchivoMuestraX = {
    generado_en: new Date().toISOString(),
    limite,
    total: muestras.length,
    fuentes: [...FUENTES_X],
    muestras,
  };

  await mkdir(dirname(salida), { recursive: true });
  await writeFile(salida, JSON.stringify(archivo, null, 2), "utf8");

  console.log(`✅ Muestra guardada: ${salida}`);
  console.log(`   ${muestras.length} publicaciones recolectadas (${validos} pasarían validación)`);
  if (muestras.length < limite) {
    console.log(
      `   ⚠️  Solo se obtuvieron ${muestras.length}/${limite}. Revisa créditos Firecrawl o re-ejecuta.`,
    );
  }
}

main().catch((e) => {
  console.error("❌ Error fatal:", e);
  process.exit(1);
});
