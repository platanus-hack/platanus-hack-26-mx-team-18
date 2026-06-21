/**
 * Cruce persona <-> forense en dos etapas (la lógica vive en lib/matching/score.ts):
 *
 *   1) BLOCKING: genera SOLO los pares candidatos (no compara todo contra todo).
 *      Se indexan los forenses por estado normalizado para no recorrer el
 *      universo entero por cada persona; `pasaBlocking` reconfirma cada par.
 *   2) SCORE: para cada candidato calcula score 0..1 + desglose por campo y los
 *      guarda en `coincidencias` (upsert -> idempotente: re-correr ACTUALIZA el
 *      par, no lo duplica). Los pares descartados en blocking no se guardan.
 *
 * Uso:
 *   pnpm match            -> guarda todos los pares candidatos (umbral 0)
 *   pnpm match 0.4        -> guarda solo candidatos con score >= 0.4
 */

import { config as loadEnv } from "dotenv";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  puntuar,
  pasaBlocking,
  perfilRasgos,
  type PersonaAM,
  type ForensePM,
} from "@/lib/matching/score";
import type { TablesInsert } from "@/lib/types/database.types";

loadEnv({ path: ".env.local" });

// Score mínimo para PERSISTIR. 0 = guarda todos los candidatos (lo que pide el
// spec). Subir si la tabla crece demasiado.
const UMBRAL = Number(process.argv[2] ?? 0);

type Supabase = ReturnType<typeof createAdminClient>;

/** Trae TODAS las filas paginando de 1000 en 1000 (límite de Supabase). */
async function traerTodo<T>(
  supabase: Supabase,
  tabla: "persona" | "forense",
  columnas: string,
): Promise<T[]> {
  const filas: T[] = [];
  const tam = 1000;
  for (let desde = 0; ; desde += tam) {
    const { data, error } = await supabase
      .from(tabla)
      .select(columnas)
      .range(desde, desde + tam - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    filas.push(...(data as T[]));
    if (data.length < tam) break;
  }
  return filas;
}

/** Mapa id_de_lugar -> { estado, municipio } para resolver la geografía. */
async function cargarLugares(
  supabase: Supabase,
): Promise<Map<number, { estado: string | null; municipio: string | null }>> {
  const mapa = new Map<number, { estado: string | null; municipio: string | null }>();
  const tam = 1000;
  for (let desde = 0; ; desde += tam) {
    const { data, error } = await supabase
      .from("lugares")
      .select("id, estado, municipio")
      .range(desde, desde + tam - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const l of data) mapa.set(l.id, { estado: l.estado, municipio: l.municipio });
    if (data.length < tam) break;
  }
  return mapa;
}

/** Misma normalización que el motor, para indexar por estado. */
const norm = (s: string | null): string =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

async function main() {
  const supabase = createAdminClient();

  // 1) Cargar ambos universos + resolver estado/municipio desde `lugares`.
  type PersonaFila = Omit<PersonaAM, "estado" | "municipio"> & { ultimo_lugar_id: number | null };
  type ForenseFila = Omit<ForensePM, "estado" | "municipio"> & { lugar_hallazgo_id: number | null };

  const [personasRaw, forensesRaw, lugares] = await Promise.all([
    traerTodo<PersonaFila>(
      supabase,
      "persona",
      "id, sexo, edad, estatura, fecha_desaparicion, ultimo_lugar_id, rasgos",
    ),
    traerTodo<ForenseFila>(
      supabase,
      "forense",
      "id, sexo, edad_inicial, edad_final, estatura, fecha_hallazgo, lugar_hallazgo_id, rasgos",
    ),
    cargarLugares(supabase),
  ]);

  const personas: PersonaAM[] = personasRaw.map((p) => {
    const lug = p.ultimo_lugar_id != null ? lugares.get(p.ultimo_lugar_id) : undefined;
    return { ...p, estado: lug?.estado ?? null, municipio: lug?.municipio ?? null };
  });
  const forenses: ForensePM[] = forensesRaw.map((f) => {
    const lug = f.lugar_hallazgo_id != null ? lugares.get(f.lugar_hallazgo_id) : undefined;
    return { ...f, estado: lug?.estado ?? null, municipio: lug?.municipio ?? null };
  });

  console.log(`📊 ${personas.length} personas vs ${forenses.length} forenses (umbral score: ${UMBRAL})`);
  if (personas.length === 0 || forenses.length === 0) {
    console.log("Falta data en alguna de las dos tablas. Nada que cruzar.");
    return;
  }

  // 2) Pre-calcular los perfiles de tatuajes/señas UNA vez (acelera el cruce).
  const rasgosPersona = new Map(personas.map((p) => [p.id, perfilRasgos(p.rasgos)]));
  const rasgosForense = new Map(forenses.map((f) => [f.id, perfilRasgos(f.rasgos)]));

  // 3) BLOCKING indexado: agrupamos forenses por estado. Un forense SIN estado
  //    es "comodín" (puede emparejar con cualquier estado), así que va aparte y
  //    se añade siempre. Una persona SIN estado tampoco bloquea por estado, así
  //    que se compara contra todos los forenses.
  const forPorEstado = new Map<string, ForensePM[]>();
  const forComodin: ForensePM[] = [];
  for (const f of forenses) {
    const e = norm(f.estado);
    if (!e) {
      forComodin.push(f);
      continue;
    }
    let lista = forPorEstado.get(e);
    if (!lista) {
      lista = [];
      forPorEstado.set(e, lista);
    }
    lista.push(f);
  }

  // 4) Generar candidatos y puntuarlos.
  const filas: TablesInsert<"coincidencias">[] = [];
  let candidatos = 0;
  let descartados = 0;

  for (const persona of personas) {
    const ep = norm(persona.estado);
    const universo: ForensePM[] = ep
      ? [...(forPorEstado.get(ep) ?? []), ...forComodin] // mismo estado + comodines
      : forenses; // persona sin estado: no bloquea por estado

    for (const forense of universo) {
      const block = pasaBlocking(persona, forense);
      if (!block.pasa) {
        descartados++;
        continue; // descartado en blocking: NO se guarda nada.
      }
      candidatos++;

      const r = puntuar(persona, forense, {
        rasgosPersona: rasgosPersona.get(persona.id),
        rasgosForense: rasgosForense.get(forense.id),
      });
      if (r.score < UMBRAL) continue;

      filas.push({
        forense_id: forense.id,
        persona_id: persona.id,
        score: r.score,
        puntaje: Math.round(r.score * 100), // compat con `puntaje` 0-100 existente
        razon: r.resumen,
        desglose: r.desglose as unknown as TablesInsert<"coincidencias">["desglose"],
      });
    }
  }

  console.log(
    `🔁 candidatos: ${candidatos.toLocaleString()} | descartados en blocking: ${descartados.toLocaleString()} | a guardar: ${filas.length.toLocaleString()}`,
  );
  if (filas.length === 0) {
    console.log("Ningún par candidato superó el umbral. Nada que guardar.");
    return;
  }

  // 5) Persistir. upsert + onConflict(forense_id, persona_id) -> idempotente.
  let guardadas = 0;
  for (let i = 0; i < filas.length; i += 500) {
    const lote = filas.slice(i, i + 500);
    const { error, count } = await supabase
      .from("coincidencias")
      .upsert(lote, { onConflict: "forense_id,persona_id", count: "exact" });
    if (error) throw error;
    guardadas += count ?? lote.length;
  }

  console.log(`✅ Listo: ${guardadas} coincidencias guardadas/actualizadas.`);
}

main().catch((e) => {
  console.error("❌ Error fatal:", e);
  process.exit(1);
});
