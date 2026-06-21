/**
 * Scraper del RNPDNO (personas desaparecidas) -> tabla `persona`.
 *
 * Cómo correrlo:
 *   pnpm scrape:rnpdno              -> Jalisco (estado 14), por defecto
 *   pnpm scrape:rnpdno 14           -> un estado concreto por id (ver lista abajo)
 *   pnpm scrape:rnpdno todos        -> TODO México (~135 mil registros, tarda)
 *   pnpm scrape:rnpdno 14 26        -> Jalisco, reanudando desde la página 26
 *                                      (útil si una corrida anterior se cortó)
 *
 * Estados (id): 1 Aguascalientes ... 14 Jalisco ... 15 Edo. de México ... 32 Zacatecas.
 *
 * Necesita en .env.local: NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.
 *
 * Privacidad: son datos personales de víctimas, de una fuente pública y para
 * uso humanitario (cruce con restos no identificados). Manéjalos con cuidado.
 */

import { config as loadEnv } from "dotenv";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ClienteRNPDNO,
  filtrosVacios,
  type VictimaRNPDNO,
} from "@/lib/rnpdno/client";
import type { TablesInsert } from "@/lib/types/database.types";

loadEnv({ path: ".env.local" });

const FUENTE = "rnpdno";
const ROWS_POR_PAGINA = 200; // tamaño de página
const PAUSA_MS = 300; // espera entre páginas para no saturar el servidor

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "HOMBRE"/"MUJER" -> valores que acepta la columna `sexo`. */
function mapearSexo(v: string): "Masculino" | "Femenino" | "Indeterminado" {
  const s = (v || "").toUpperCase();
  if (s.startsWith("H")) return "Masculino";
  if (s.startsWith("M")) return "Femenino";
  return "Indeterminado";
}

/** "2026-06-13T14:00:00.000Z" -> "2026-06-13". null si no es válida. */
function soloFecha(iso: string | null): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function nombreCompleto(v: VictimaRNPDNO): string {
  return [v.nombre, v.primerapellido, v.segundoapellido]
    .map((p) => (p || "").trim())
    .filter(Boolean)
    .join(" ");
}

async function main() {
  const arg = (process.argv[2] ?? "14").toLowerCase(); // Jalisco por defecto
  const estado = arg === "todos" || arg === "" ? "" : arg;
  const filtros = filtrosVacios(estado);
  // Página desde la que arrancar (para reanudar una corrida cortada). 1 = inicio.
  const paginaInicio = Math.max(1, Number(process.argv[3]) || 1);

  const cliente = new ClienteRNPDNO();
  const supabase = createAdminClient();

  const total = await cliente.contar(filtros);
  const paginas = Math.ceil(total / ROWS_POR_PAGINA);
  console.log(
    `🔎 RNPDNO ${estado ? `estado ${estado}` : "TODO México"}: ${total.toLocaleString()} registros (${paginas} páginas)`,
  );
  if (total === 0) return;
  if (paginaInicio > 1) console.log(`   ↪️  reanudando desde la página ${paginaInicio}`);

  // Caché de lugares para no consultar/insertar el mismo dos veces.
  const lugarId = new Map<string, number>();
  async function resolverLugar(
    nombre: string,
    estado: string | null,
    municipio: string | null,
  ): Promise<number | null> {
    if (!nombre) return null;
    if (lugarId.has(nombre)) return lugarId.get(nombre)!;
    const { data: existente } = await supabase
      .from("lugares")
      .select("id, estado")
      .eq("lugar", nombre)
      .maybeSingle();
    let id: number;
    if (existente) {
      id = existente.id;
      // Backfill: si la fila ya existía sin estado, la completamos ahora.
      if (!existente.estado && estado) {
        await supabase.from("lugares").update({ estado, municipio }).eq("id", id);
      }
    } else {
      const { data: nuevo, error } = await supabase
        .from("lugares")
        .insert({ lugar: nombre, estado, municipio })
        .select("id")
        .single();
      if (error) throw error;
      id = nuevo.id;
    }
    lugarId.set(nombre, id);
    return id;
  }

  let guardadas = 0;
  let omitidas = 0;

  for (let page = paginaInicio; page <= paginas; page++) {
    const victimas = await cliente.pagina(filtros, page, ROWS_POR_PAGINA);

    const filas: TablesInsert<"persona">[] = [];
    for (const v of victimas) {
      const fecha = soloFecha(v.fechahechos);
      if (!fecha) {
        omitidas++; // persona.fecha_desaparicion es obligatoria
        continue;
      }
      const estado = v.estado?.trim() || null;
      const municipio = v.municipio?.trim() || null;
      const lugar = [municipio, estado].filter(Boolean).join(", ");
      const edad = typeof v.edadActual === "number" && v.edadActual >= 0 && v.edadActual <= 120
        ? v.edadActual
        : null;

      filas.push({
        fuente: FUENTE,
        fuente_id: v.IDvictimadirecta,
        nombre: nombreCompleto(v) || "Sin nombre",
        sexo: mapearSexo(v.Sexo),
        edad,
        estatura: null, // la vista de lista no trae estatura
        fecha_desaparicion: fecha,
        ultimo_lugar_id: await resolverLugar(lugar, estado, municipio),
        rasgos: { estatus: v.EstatusVictima ?? null }, // señas no disponibles en esta vista
      });
    }

    if (filas.length > 0) {
      const { error, count } = await supabase
        .from("persona")
        .upsert(filas, { onConflict: "fuente,fuente_id", count: "exact" });
      if (error) throw error;
      guardadas += count ?? filas.length;
    }

    if (page % 5 === 0 || page === paginas) {
      console.log(`   página ${page}/${paginas} — ${guardadas} guardadas`);
    }
    await dormir(PAUSA_MS);
  }

  console.log(`✅ Listo: ${guardadas} personas guardadas/actualizadas.`);
  if (omitidas > 0) console.log(`   (${omitidas} omitidas por no traer fecha de desaparición)`);
}

main().catch((e) => {
  console.error("❌ Error fatal:", e);
  process.exit(1);
});
