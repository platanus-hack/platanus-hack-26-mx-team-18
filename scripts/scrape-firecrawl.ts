/**
 * Búsqueda de personas DESAPARECIDAS en la web con Firecrawl -> tabla `persona`.
 *
 * Buscamos directamente fichas/boletines/notas de personas desaparecidas en
 * México. Firecrawl extrae los datos ya estructurados y los guardamos en
 * `persona`. Después, `pnpm match` los cruza contra los restos forenses.
 *
 * MERGE: si ya existe una persona con el MISMO nombre y sexo, no creamos otra
 * ni pisamos lo que ya había: combinamos. Unimos los textos de tatuajes/señas
 * (sumando lo nuevo a lo viejo) y rellenamos los datos que faltaban (edad,
 * estatura, etc.). Así cada fuente enriquece el registro en vez de competir.
 *
 * Cómo correrlo:
 *   pnpm scrape:firecrawl                          -> consulta general, 10 resultados
 *   pnpm scrape:firecrawl "desaparecidos Sinaloa"  -> una consulta a la medida
 *   pnpm scrape:firecrawl estados                  -> recorre los 32 estados
 *   pnpm scrape:firecrawl estados 8                -> 32 estados, 8 resultados c/u
 *
 * OJO con los créditos: cada resultado se scrapea y se extrae. Con "estados"
 * el costo ≈ 32 × resultados. Empieza con números chicos.
 *
 * Necesita en .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * y FIRECRAWL_API_KEY.
 *
 * Privacidad: datos personales de víctimas, fuente pública, uso humanitario.
 */

import { config as loadEnv } from "dotenv";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createFirecrawlClient,
  buscarCandidatos,
  type CandidatoPersona,
} from "@/lib/firecrawl/client";
import type { Json, TablesInsert } from "@/lib/types/database.types";

loadEnv({ path: ".env.local" });

const FUENTE = "firecrawl";
const PAUSA_MS = 1000; // espera entre búsquedas para no saturar la API
const UMBRAL_CONFIANZA = 0.5; // descartamos extracciones por debajo de esto

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Palabras genéricas que NO son un nombre real: cuando el "nombre" extraído
// es en realidad una etiqueta ("adolescente", "menor de edad", etc.) lo
// descartamos en vez de guardar basura. Comparamos sin acentos y por palabra.
const PALABRAS_NO_NOMBRE = [
  "adolescente", "adolecente", "menor", "menores", "joven", "jovenes",
  "niño", "nino", "niña", "nina", "niños", "ninos", "niñas", "ninas",
  "hombre", "mujer", "persona", "personas", "victima", "victimas",
  "desconocido", "desconocida", "identificar", "identificado", "identificada",
  "desaparecido", "desaparecida", "anonimo", "anonima", "sin",
];

/** Normaliza texto para comparar: sin acentos y en minúsculas. */
function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** ¿El "nombre" es en realidad una etiqueta genérica (no un nombre real)? */
function nombreEsGenerico(nombre: string): boolean {
  const palabras = sinAcentos(nombre).split(/[^a-z]+/).filter(Boolean);
  return palabras.some((p) => PALABRAS_NO_NOMBRE.includes(p));
}

const ESTADOS = [
  "Aguascalientes", "Baja California", "Baja California Sur", "Campeche",
  "Chiapas", "Chihuahua", "Ciudad de México", "Coahuila", "Colima", "Durango",
  "Guanajuato", "Guerrero", "Hidalgo", "Jalisco", "Estado de México",
  "Michoacán", "Morelos", "Nayarit", "Nuevo León", "Oaxaca", "Puebla",
  "Querétaro", "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora",
  "Tabasco", "Tamaulipas", "Tlaxcala", "Veracruz", "Yucatán", "Zacatecas",
];

/** Normaliza el sexo extraído a los valores que acepta la columna. */
function mapearSexo(v: string | null): "Masculino" | "Femenino" | "Indeterminado" {
  const s = (v || "").toUpperCase();
  if (s.startsWith("M") && s.includes("U")) return "Femenino"; // "MUJER"/"FEMENINO"
  if (s.startsWith("M") || s.startsWith("H")) return "Masculino"; // "MASCULINO"/"HOMBRE"
  if (s.startsWith("F")) return "Femenino";
  return "Indeterminado";
}

/** "2026-06-13..." -> "2026-06-13" si es una fecha REAL; null si no. */
function soloFecha(v: string | null): string | null {
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mes, d] = m;
  const mesN = Number(mes);
  const diaN = Number(d);
  // Descarta basura como "1999-00-00" o "2026-13-40" que sí cumplen el formato.
  if (mesN < 1 || mesN > 12 || diaN < 1 || diaN > 31) return null;
  // Confirma que el día existe en ese mes (ej. descarta "2026-02-30").
  const fecha = new Date(`${y}-${mes}-${d}T00:00:00Z`);
  if (
    Number.isNaN(fecha.getTime()) ||
    fecha.getUTCMonth() + 1 !== mesN ||
    fecha.getUTCDate() !== diaN
  ) {
    return null;
  }
  return `${y}-${mes}-${d}`;
}

const TOLERANCIA_DIAS = 6; // ± días de fecha_desaparicion para considerar misma persona

/** Normaliza un estado para comparar: sin acentos, minúsculas, sin espacios extra. */
function normEstado(s: string): string {
  return sinAcentos(s).trim();
}

/** ¿Dos fechas "YYYY-MM-DD" están dentro de ±`dias`? */
function fechasCercanas(a: string, b: string, dias: number): boolean {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return Math.abs(ta - tb) / 86_400_000 <= dias;
}

/**
 * Une dos textos sin duplicar: si uno ya contiene al otro, deja el más completo;
 * si no, los concatena con " | ". Base del merge de tatuajes/señas.
 */
function unirTexto(a: string | null, b: string | null): string | null {
  const A = (a || "").trim();
  const B = (b || "").trim();
  if (!A) return B || null;
  if (!B) return A;
  const al = A.toLowerCase();
  const bl = B.toLowerCase();
  if (al.includes(bl)) return A;
  if (bl.includes(al)) return B;
  return `${A} | ${B}`;
}

/** Lee una clave string de un objeto `rasgos` (jsonb) de forma segura. */
function rasgoStr(rasgos: unknown, clave: string): string | null {
  if (rasgos && typeof rasgos === "object" && !Array.isArray(rasgos)) {
    const v = (rasgos as Record<string, unknown>)[clave];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

type FuenteMeta = {
  origen: string;
  url: string;
  confianza: number | null;
  resumen: string | null;
};

/** El "rastro" de fuentes que ya tenía el registro (en rasgos._meta.fuentes). */
function fuentesPrevias(rasgos: unknown): FuenteMeta[] {
  if (rasgos && typeof rasgos === "object" && !Array.isArray(rasgos)) {
    const meta = (rasgos as Record<string, unknown>)._meta;
    if (meta && typeof meta === "object") {
      const fs = (meta as Record<string, unknown>).fuentes;
      if (Array.isArray(fs)) return fs as FuenteMeta[];
    }
  }
  return [];
}

/**
 * Combina los rasgos existentes con los del candidato nuevo. Preserva las demás
 * claves que ya tuviera el registro (ej. `estatus` que pone el scraper RNPDNO).
 */
function mergeRasgos(existente: unknown, c: CandidatoPersona): Json {
  // Si lo previo era texto libre, lo tratamos como señas.
  const base: Record<string, unknown> =
    typeof existente === "string"
      ? { senas_particulares: existente }
      : existente && typeof existente === "object" && !Array.isArray(existente)
        ? { ...(existente as Record<string, unknown>) }
        : {};

  const nuevaFuente: FuenteMeta = {
    origen: "firecrawl",
    url: c.url,
    confianza: c.confianza,
    resumen: c.resumen,
  };
  // Evitamos repetir la misma URL en el rastro de fuentes.
  const fuentes = fuentesPrevias(existente).filter((f) => f.url !== c.url);
  fuentes.push(nuevaFuente);

  return {
    ...base,
    tatuajes: unirTexto(rasgoStr(base, "tatuajes"), c.tatuajes),
    senas_particulares: unirTexto(rasgoStr(base, "senas_particulares"), c.senas_particulares),
    _meta: { fuentes },
  } as Json;
}

/**
 * Valida un candidato con el filtro ESTRICTO y devuelve sus datos saneados,
 * o null si se descarta (no es desaparecido, le falta nombre/fecha, etc.).
 */
function sanear(c: CandidatoPersona): {
  nombre: string;
  sexo: "Masculino" | "Femenino" | "Indeterminado";
  edad: number | null;
  estatura: number | null;
  fecha: string;
} | null {
  if (!c.es_persona_desaparecida) return null;
  const nombre = c.nombre?.trim();
  const fecha = soloFecha(c.fecha_desaparicion);
  if (!nombre || !fecha) return null; // campos obligatorios de la tabla
  if (nombreEsGenerico(nombre)) return null; // "adolescente", "menor", etc.: no es un nombre real
  if (typeof c.confianza === "number" && c.confianza < UMBRAL_CONFIANZA) return null;

  const edad = typeof c.edad === "number" && c.edad >= 0 && c.edad <= 120 ? c.edad : null;
  const estatura =
    typeof c.estatura_cm === "number" && c.estatura_cm > 0 && c.estatura_cm < 300
      ? c.estatura_cm
      : null;

  return { nombre, sexo: mapearSexo(c.sexo), edad, estatura, fecha };
}

async function main() {
  const arg1 = (process.argv[2] ?? "").trim();
  const resultadosPorBusqueda = Math.max(1, Number(process.argv[3]) || 10);

  // Decidimos las consultas a lanzar.
  let consultas: string[];
  if (arg1.toLowerCase() === "estados") {
    consultas = ESTADOS.map((e) => `personas desaparecidas ${e} México ficha de búsqueda boletín`);
  } else if (arg1) {
    consultas = [arg1];
  } else {
    consultas = ["personas desaparecidas México ficha de búsqueda boletín 2026"];
  }

  const supabase = createAdminClient();
  const firecrawl = createFirecrawlClient();

  console.log(
    `🔥 Firecrawl: ${consultas.length} consulta(s), ${resultadosPorBusqueda} resultados c/u`,
  );

  // Caché de lugares (igual que en los otros scrapers).
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

  /**
   * Inserta una persona nueva o, si ya existe la MISMA (mismo nombre + sexo +
   * estado + fecha de desaparición dentro de ±6 días), la enriquece.
   */
  async function guardarConMerge(c: CandidatoPersona): Promise<"nueva" | "merge"> {
    const s = sanear(c)!;
    const candEstado = c.estado?.trim() || null;
    const lugarPersonaId = await resolverLugar(candEstado);

    // Candidatas con el mismo nombre (sin distinguir mayúsculas). No comparamos
    // por sexo: la fuente a veces lo trae mal o vacío y partía registros iguales.
    const { data: existentes } = await supabase
      .from("persona")
      .select("id, edad, estatura, ultimo_lugar_id, rasgos, fecha_desaparicion, lugares:ultimo_lugar_id(estado)")
      .ilike("nombre", s.nombre)
      .limit(50);

    // Solo es "la misma" si además coincide el estado y la fecha está cerca.
    // Si el candidato no trae estado, no podemos validar -> la tratamos como distinta.
    const previa = candEstado
      ? (existentes ?? []).find((p) => {
          const lug = Array.isArray(p.lugares) ? p.lugares[0] : p.lugares;
          const pEstado = lug?.estado ?? null;
          if (!pEstado || normEstado(pEstado) !== normEstado(candEstado)) return false;
          return fechasCercanas(p.fecha_desaparicion, s.fecha, TOLERANCIA_DIAS);
        })
      : undefined;

    if (previa) {
      // MERGE: rellenamos lo que faltaba y combinamos los rasgos.
      const { error } = await supabase
        .from("persona")
        .update({
          edad: previa.edad ?? s.edad,
          estatura: previa.estatura ?? s.estatura,
          ultimo_lugar_id: previa.ultimo_lugar_id ?? lugarPersonaId,
          rasgos: mergeRasgos(previa.rasgos, c),
        })
        .eq("id", previa.id);
      if (error) throw error;
      return "merge";
    }

    // NUEVA: usamos upsert por (fuente, fuente_id=url) para no duplicar al re-correr.
    const fila: TablesInsert<"persona"> = {
      fuente: FUENTE,
      fuente_id: c.url,
      nombre: s.nombre,
      sexo: s.sexo,
      edad: s.edad,
      estatura: s.estatura,
      fecha_desaparicion: s.fecha,
      ultimo_lugar_id: lugarPersonaId,
      rasgos: mergeRasgos(null, c),
    };
    const { error } = await supabase
      .from("persona")
      .upsert(fila, { onConflict: "fuente,fuente_id" });
    if (error) throw error;
    return "nueva";
  }

  let nuevas = 0;
  let merges = 0;
  let descartados = 0;

  for (const consulta of consultas) {
    let candidatos: CandidatoPersona[] = [];
    try {
      candidatos = await buscarCandidatos(firecrawl, consulta, resultadosPorBusqueda);
    } catch (e) {
      console.warn(`   ⚠️  "${consulta.slice(0, 40)}…": búsqueda falló (${(e as Error).message})`);
      await dormir(PAUSA_MS);
      continue;
    }

    let nuevasQ = 0;
    let mergesQ = 0;
    for (const c of candidatos) {
      if (!sanear(c)) {
        descartados++;
        continue;
      }
      // Secuencial a propósito: así dos resultados de la misma persona en la
      // misma corrida se fusionan (el 2º ya encuentra al 1º en la BD).
      const r = await guardarConMerge(c);
      if (r === "nueva") nuevasQ++;
      else mergesQ++;
    }
    nuevas += nuevasQ;
    merges += mergesQ;
    console.log(
      `   "${consulta.slice(0, 50)}…" → ${nuevasQ} nuevas, ${mergesQ} merges`,
    );
    await dormir(PAUSA_MS);
  }

  console.log(`✅ Listo: ${nuevas} personas nuevas, ${merges} enriquecidas (merge).`);
  if (descartados > 0) console.log(`   ${descartados} candidatos descartados por el filtro estricto.`);
}

main().catch((e) => {
  console.error("❌ Error fatal:", e);
  process.exit(1);
});
