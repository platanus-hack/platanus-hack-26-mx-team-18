/**
 * Scraper de publicaciones de X (Twitter) sobre personas desaparecidas → tabla `persona`.
 *
 * Fuentes:
 *   - https://x.com/BoletinCBPCDMX
 *   - https://x.com/Busqueda_MX
 *   - https://x.com/hashtag/FichaDeBúsqueda
 *
 * MERGE: mismo criterio que `scrape-firecrawl` (nombre + estado + fecha ±6 días).
 *
 * Cómo correrlo:
 *   pnpm scrape:x       -> hasta 50 publicaciones
 *   pnpm scrape:x 30    -> límite personalizado
 *
 * Necesita en .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FIRECRAWL_API_KEY
 *
 * Privacidad: datos personales de víctimas, fuente pública, uso humanitario.
 */

import { config as loadEnv } from "dotenv";
import { createAdminClient } from "@/lib/supabase/admin";
import { createFirecrawlClient, recolectarCandidatosX } from "@/lib/firecrawl/x-client";
import {
  aPersonaInsertX,
  mergeRasgosX,
  sanearPublicacionX,
} from "@/lib/types/x/adaptadores";
import type { OrigenX, PublicacionX } from "@/lib/types/x/types";

loadEnv({ path: ".env.local" });

const LIMITE_DEFAULT = 50;
const RESULTADOS_POR_CONSULTA = 10;
const TOLERANCIA_DIAS = 6;

function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function normEstado(s: string): string {
  return sinAcentos(s).trim();
}

function fechasCercanas(a: string, b: string, dias: number): boolean {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return Math.abs(ta - tb) / 86_400_000 <= dias;
}

function claveDedup(pub: PublicacionX): string {
  return (pub.tweet_url ?? pub.url).toLowerCase();
}

async function main() {
  const limite = Math.max(1, Number(process.argv[2]) || LIMITE_DEFAULT);

  const supabase = createAdminClient();
  const firecrawl = createFirecrawlClient();

  const { publicaciones, origenPorClave } = await recolectarCandidatosX(firecrawl, {
    limite,
    resultadosPorConsulta: RESULTADOS_POR_CONSULTA,
  });

  const lugarId = new Map<string, number>();
  async function resolverLugar(estado: string | null): Promise<number | null> {
    if (!estado) return null;
    if (lugarId.has(estado)) return lugarId.get(estado)!;
    const { data: existente } = await supabase
      .from("lugares")
      .select("id")
      .eq("lugar", estado)
      .maybeSingle();
    let id: number;
    if (existente) {
      id = existente.id;
    } else {
      const { data: nuevo, error } = await supabase
        .from("lugares")
        .insert({ lugar: estado, estado, municipio: null })
        .select("id")
        .single();
      if (error) throw error;
      id = nuevo.id;
    }
    lugarId.set(estado, id);
    return id;
  }

  async function guardarConMerge(
    pub: PublicacionX,
    origen: OrigenX,
  ): Promise<"nueva" | "merge"> {
    const s = sanearPublicacionX(pub)!;
    const lugarPersonaId = await resolverLugar(s.estado);

    const { data: existentes } = await supabase
      .from("persona")
      .select("id, edad, estatura, ultimo_lugar_id, rasgos, fecha_desaparicion, lugares:ultimo_lugar_id(estado)")
      .ilike("nombre", s.nombre)
      .limit(50);

    const previa = s.estado
      ? (existentes ?? []).find((p) => {
          const lug = Array.isArray(p.lugares) ? p.lugares[0] : p.lugares;
          const pEstado = lug?.estado ?? null;
          if (!pEstado || normEstado(pEstado) !== normEstado(s.estado!)) return false;
          return fechasCercanas(p.fecha_desaparicion, s.fecha, TOLERANCIA_DIAS);
        })
      : undefined;

    if (previa) {
      const { error } = await supabase
        .from("persona")
        .update({
          edad: previa.edad ?? s.edad,
          estatura: previa.estatura ?? s.estatura,
          ultimo_lugar_id: previa.ultimo_lugar_id ?? lugarPersonaId,
          rasgos: mergeRasgosX(previa.rasgos, pub, origen),
        })
        .eq("id", previa.id);
      if (error) throw error;
      return "merge";
    }

    const fila = aPersonaInsertX(pub, origen, s, lugarPersonaId);
    const { error } = await supabase
      .from("persona")
      .upsert(fila, { onConflict: "fuente,fuente_id" });
    if (error) throw error;
    return "nueva";
  }

  for (const pub of publicaciones) {
    if (!sanearPublicacionX(pub)) continue;
    const origen = origenPorClave.get(claveDedup(pub))!;
    await guardarConMerge(pub, origen);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
