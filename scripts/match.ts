/**
 * Cruce masivo: compara TODOS los registros forenses contra TODAS las personas
 * desaparecidas y guarda las coincidencias probables en la tabla `coincidencias`.
 *
 * Cómo correrlo:
 *   pnpm match            -> umbral por defecto (35 puntos)
 *   pnpm match 50         -> solo guarda coincidencias de 50 puntos o más
 *
 * La lógica de puntuación vive en lib/matching/score.ts (ahí se ajustan pesos).
 */

import { config as loadEnv } from "dotenv";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  puntuar,
  tokensPersona,
  tokensForense,
  type PersonaAM,
  type ForensePM,
} from "@/lib/matching/score";
import type { TablesInsert } from "@/lib/types/database.types";

loadEnv({ path: ".env.local" });

const UMBRAL = Number(process.argv[2] ?? 35); // puntaje mínimo para guardar
const MAX_POR_FORENSE = 25; // tope de coincidencias guardadas por cada forense

type Supabase = ReturnType<typeof createAdminClient>;

/**
 * Trae TODAS las filas de una tabla. Supabase devuelve máximo 1000 por consulta,
 * así que pedimos en páginas de 1000 hasta que ya no haya más.
 */
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

/** Mapa id_de_lugar -> estado, para resolver el estado de cada registro. */
async function cargarEstados(supabase: Supabase): Promise<Map<number, string | null>> {
  const mapa = new Map<number, string | null>();
  const tam = 1000;
  for (let desde = 0; ; desde += tam) {
    const { data, error } = await supabase
      .from("lugares")
      .select("id, estado")
      .range(desde, desde + tam - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const lugar of data) mapa.set(lugar.id, lugar.estado);
    if (data.length < tam) break;
  }
  return mapa;
}

async function main() {
  const supabase = createAdminClient();

  // 1) Cargar ambos universos de datos.
  const personas = await traerTodo<PersonaAM>(
    supabase,
    "persona",
    "id, sexo, edad, estatura, fecha_desaparicion, ultimo_lugar_id, rasgos",
  );
  const forenses = await traerTodo<ForensePM>(
    supabase,
    "forense",
    "id, sexo, edad_inicial, edad_final, estatura, fecha_hallazgo, lugar_hallazgo_id, rasgos",
  );

  // Resolver el estado de cada registro a partir de su lugar (lo usa el score).
  const estados = await cargarEstados(supabase);
  for (const p of personas) {
    p.estado = p.ultimo_lugar_id != null ? estados.get(p.ultimo_lugar_id) ?? null : null;
  }
  for (const f of forenses) {
    f.estado = f.lugar_hallazgo_id != null ? estados.get(f.lugar_hallazgo_id) ?? null : null;
  }

  console.log(`📊 ${personas.length} personas vs ${forenses.length} forenses (umbral: ${UMBRAL})`);

  if (personas.length === 0 || forenses.length === 0) {
    console.log("Falta data en alguna de las dos tablas. Nada que cruzar.");
    return;
  }

  // 2) Pre-calcular las palabras clave de cada registro UNA sola vez (acelera el cruce).
  const tokPersona = new Map(personas.map((p) => [p.id, tokensPersona(p)]));
  const tokForense = new Map(forenses.map((f) => [f.id, tokensForense(f)]));

  // 3) Comparar cada forense contra cada persona.
  const coincidencias: TablesInsert<"coincidencias">[] = [];
  let comparaciones = 0;

  for (const forense of forenses) {
    const tF = tokForense.get(forense.id)!;
    const candidatas: TablesInsert<"coincidencias">[] = [];

    for (const persona of personas) {
      comparaciones++;
      const r = puntuar(persona, forense, {
        tokensPersona: tokPersona.get(persona.id),
        tokensForense: tF,
      });
      if (!r.descartado && r.puntaje >= UMBRAL) {
        candidatas.push({
          forense_id: forense.id,
          persona_id: persona.id,
          puntaje: r.puntaje,
          razon: r.razon,
        });
      }
    }

    // Quedarnos solo con las mejores coincidencias de este forense.
    candidatas.sort((a, b) => b.puntaje - a.puntaje);
    coincidencias.push(...candidatas.slice(0, MAX_POR_FORENSE));
  }

  console.log(`🔁 ${comparaciones.toLocaleString()} comparaciones → ${coincidencias.length} coincidencias`);

  if (coincidencias.length === 0) {
    console.log("No se encontraron coincidencias por encima del umbral.");
    return;
  }

  // 4) Guardar. upsert + onConflict(forense_id, persona_id) evita duplicar al re-correr.
  let guardadas = 0;
  for (let i = 0; i < coincidencias.length; i += 500) {
    const lote = coincidencias.slice(i, i + 500);
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
