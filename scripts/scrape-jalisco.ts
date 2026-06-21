/**
 * Scraper de la fuente forense de Jalisco (IJCF - Registro PFSI).
 * Fuente: http://consultas.cienciasforenses.jalisco.gob.mx/registro_pfsi_v2.php
 *
 * Esa página tiene un formulario que, al buscar, llama por detrás (AJAX) a
 * "buscarpfsi_v2.php" y recibe JSON con una tabla HTML adentro. Nosotros le
 * pegamos directo a ese endpoint (no hace falta Firecrawl) y guardamos cada
 * registro de "Persona Fallecida Sin Identificar" (PFSI) en la tabla `forense`.
 *
 * Cómo correrlo:
 *   pnpm scrape:jalisco                       -> todo: 20/09/2018 hasta hoy
 *   pnpm scrape:jalisco 01/01/2024 30/06/2024 -> solo ese rango (DD/MM/YYYY)
 *
 * Necesita en .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (Supabase > Project Settings > API)
 */

import { config as loadEnv } from "dotenv";
import * as cheerio from "cheerio";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TablesInsert } from "@/lib/types/database.types";

// Cargamos las variables de .env.local (ahí guardas las llaves de Supabase).
loadEnv({ path: ".env.local" });

const ENDPOINT =
  "http://consultas.cienciasforenses.jalisco.gob.mx/buscarpfsi_v2.php";
const FUENTE = "ijcf_jalisco";
const ESTADO = "Jalisco"; // toda la fuente es del estado de Jalisco
const FECHA_MINIMA = "20/09/2018"; // la fuente no tiene datos antes de esto

// ---------------------------------------------------------------------------
// Utilidades de texto
// ---------------------------------------------------------------------------

// Tipo de una selección de cheerio (ej. una celda) sin depender de tipos
// internos que cheerio 1.x no reexporta.
type Celda = ReturnType<cheerio.CheerioAPI>;

/** Toma una celda <td>, convierte los <br> en saltos de línea y limpia el texto. */
function textoCelda($cell: Celda): string {
  const html = ($cell.html() ?? "").replace(/<br\s*\/?>/gi, "\n");
  return cheerio
    .load(html)
    .root()
    .text()
    .split("\n")
    .map((linea) => linea.replace(/^\s*-\s*/, "").trim()) // quita viñetas "- "
    .filter((linea) => linea.length > 0)
    .join("\n")
    .trim();
}

/** "Hombre"/"Mujer"/"Desconocido" -> valores que acepta la columna `sexo`. */
function mapearSexo(valor: string): "Masculino" | "Femenino" | "Indeterminado" {
  const v = valor.toLowerCase();
  if (v.includes("hombre")) return "Masculino";
  if (v.includes("mujer")) return "Femenino";
  return "Indeterminado";
}

/** "41-45 años" -> {inicial:41, final:45}; "65 años" -> {65,65}; sin datos -> {null,null}. */
function parsearEdad(valor: string): { inicial: number | null; final: number | null } {
  const numeros = valor.match(/\d+/g)?.map(Number) ?? [];
  if (numeros.length === 0) return { inicial: null, final: null };
  if (numeros.length === 1) return { inicial: numeros[0], final: numeros[0] };
  return { inicial: numeros[0], final: numeros[1] };
}

/** "02/09/2024" -> "2024-09-02" (formato que entiende Postgres). null si no es válida. */
function parsearFecha(valor: string): string | null {
  const m = valor.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dia, mes, anio] = m;
  return `${anio}-${mes}-${dia}`;
}

// ---------------------------------------------------------------------------
// Manejo de fechas (para partir el rango en trozos de un mes)
// ---------------------------------------------------------------------------

function aDDMMYYYY(d: Date): string {
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}/${d.getFullYear()}`;
}

function desdeDDMMYYYY(s: string): Date {
  const [dia, mes, anio] = s.split("/").map(Number);
  return new Date(anio, mes - 1, dia);
}

/** Divide [inicio, fin] en trozos mensuales para no hacer una sola petición gigante. */
function trozosMensuales(inicio: string, fin: string): Array<{ desde: string; hasta: string }> {
  const trozos: Array<{ desde: string; hasta: string }> = [];
  let cursor = desdeDDMMYYYY(inicio);
  const limite = desdeDDMMYYYY(fin);

  while (cursor <= limite) {
    // último día del mes del cursor
    let finMes = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    if (finMes > limite) finMes = limite;
    trozos.push({ desde: aDDMMYYYY(cursor), hasta: aDDMMYYYY(finMes) });
    cursor = new Date(finMes.getFullYear(), finMes.getMonth() + 1, 1);
  }
  return trozos;
}

// ---------------------------------------------------------------------------
// Una fila ya parseada de la fuente
// ---------------------------------------------------------------------------

interface RegistroJalisco {
  fuenteId: string;
  fecha: string | null;
  sexo: "Masculino" | "Femenino" | "Indeterminado";
  probableNombre: string;
  edadInicial: number | null;
  edadFinal: number | null;
  tatuajes: string;
  indumentarias: string;
  senasParticulares: string;
  delegacion: string;
}

/** Pide un rango al endpoint y devuelve las filas parseadas. */
async function consultarRango(desde: string, hasta: string): Promise<RegistroJalisco[]> {
  const body = new URLSearchParams({
    inicio: desde,
    fin: hasta,
    sexo: "",
    tatuajes: "",
    nocache: String(Math.random()),
  });

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} al consultar ${desde}-${hasta}`);

  // El servidor responde con un BOM (carácter invisible) al inicio que rompe
  // JSON.parse, así que leemos como texto y lo quitamos antes de parsear.
  const texto = (await res.text()).replace(/^﻿/, "");
  const json = JSON.parse(texto) as { datos?: string };
  if (!json.datos) return [];

  const $ = cheerio.load(json.datos);
  const filas: RegistroJalisco[] = [];

  $("#mytable tbody tr").each((_, tr) => {
    const celdas = $(tr).find("td");
    if (celdas.length < 9) return; // fila vacía o de "no hay registros"

    const c = (i: number) => textoCelda(celdas.eq(i));
    const edad = parsearEdad(c(4));

    filas.push({
      fuenteId: c(0),
      fecha: parsearFecha(c(1)),
      sexo: mapearSexo(c(2)),
      probableNombre: c(3),
      edadInicial: edad.inicial,
      edadFinal: edad.final,
      tatuajes: c(5),
      indumentarias: c(6),
      senasParticulares: c(7),
      delegacion: c(8),
    });
  });

  return filas;
}

// ---------------------------------------------------------------------------
// Programa principal
// ---------------------------------------------------------------------------

async function main() {
  const inicio = process.argv[2] ?? FECHA_MINIMA;
  const fin = process.argv[3] ?? aDDMMYYYY(new Date());

  console.log(`🔎 Scrapeando IJCF Jalisco del ${inicio} al ${fin}...`);

  const supabase = createAdminClient();

  // 1) Bajar todos los registros, mes por mes.
  const registros: RegistroJalisco[] = [];
  for (const { desde, hasta } of trozosMensuales(inicio, fin)) {
    try {
      const filas = await consultarRango(desde, hasta);
      console.log(`   ${desde} → ${hasta}: ${filas.length} registros`);
      registros.push(...filas);
    } catch (e) {
      console.error(`   ⚠️  Falló el rango ${desde}-${hasta}:`, (e as Error).message);
    }
  }

  if (registros.length === 0) {
    console.log("No se encontraron registros. Fin.");
    return;
  }

  // 2) Resolver lugares: por cada "Delegación IJCF" obtener (o crear) su id.
  const delegaciones = [...new Set(registros.map((r) => r.delegacion).filter(Boolean))];
  const lugarId = new Map<string, number>();

  for (const lugar of delegaciones) {
    const { data: existente } = await supabase
      .from("lugares")
      .select("id, estado")
      .eq("lugar", lugar)
      .maybeSingle();

    if (existente) {
      lugarId.set(lugar, existente.id);
      // Backfill: si la fila ya existía sin estado, la completamos ahora.
      if (!existente.estado) {
        await supabase.from("lugares").update({ estado: ESTADO }).eq("id", existente.id);
      }
      continue;
    }
    const { data: nuevo, error } = await supabase
      .from("lugares")
      .insert({ lugar, estado: ESTADO })
      .select("id")
      .single();
    if (error) throw error;
    lugarId.set(lugar, nuevo.id);
  }
  console.log(`📍 ${lugarId.size} lugares resueltos.`);

  // 3) Construir las filas para la tabla `forense` (saltando las sin fecha válida).
  const sinFecha = registros.filter((r) => !r.fecha).length;
  const filasForense: TablesInsert<"forense">[] = registros
    .filter((r) => r.fecha)
    .map((r) => ({
      fuente: FUENTE,
      fuente_id: r.fuenteId,
      fecha_hallazgo: r.fecha!,
      sexo: r.sexo,
      edad_inicial: r.edadInicial,
      edad_final: r.edadFinal,
      estatura: null, // la fuente no reporta estatura
      lugar_hallazgo_id: lugarId.get(r.delegacion) ?? null,
      rasgos: {
        probable_nombre: r.probableNombre || null,
        tatuajes: r.tatuajes || null,
        indumentarias: r.indumentarias || null,
        senas_particulares: r.senasParticulares || null,
      },
    }));

  if (sinFecha > 0) console.log(`   (${sinFecha} registros omitidos por no traer fecha válida)`);

  // 3.5) Deduplicar por (fuente, fuente_id). La fuente a veces devuelve el mismo
  // registro más de una vez (p. ej. en rangos que se traslapan), y un upsert con
  // ON CONFLICT no puede tocar la misma fila dos veces en el mismo comando.
  // Nos quedamos con la última aparición de cada fuente_id.
  const porClave = new Map<string, TablesInsert<"forense">>();
  for (const fila of filasForense) {
    porClave.set(`${fila.fuente}|${fila.fuente_id}`, fila);
  }
  const filasUnicas = [...porClave.values()];
  const duplicados = filasForense.length - filasUnicas.length;
  if (duplicados > 0) console.log(`   (${duplicados} registros duplicados colapsados por fuente_id)`);

  // 4) Guardar en Supabase. upsert + onConflict evita duplicados al re-correr.
  let guardados = 0;
  for (let i = 0; i < filasUnicas.length; i += 500) {
    const lote = filasUnicas.slice(i, i + 500);
    const { error, count } = await supabase
      .from("forense")
      .upsert(lote, { onConflict: "fuente,fuente_id", count: "exact" });
    if (error) throw error;
    guardados += count ?? lote.length;
  }

  console.log(`✅ Listo: ${guardados} registros guardados/actualizados en la tabla forense.`);
}

main().catch((e) => {
  console.error("❌ Error fatal:", e);
  process.exit(1);
});
