/**
 * Scraper de la fuente forense de la Fiscalía General del Estado de Sinaloa.
 * Fuente: https://fiscaliasinaloa.mx/Apps/ConsultaOcciso/
 *
 * Es la "Base de Datos de Occisos No Identificados y/o sin Reclamar del Servicio
 * Médico Forense del Estado y Colaboraciones". Aunque vive en un sitio de Sinaloa,
 * el filtro de Estado abarca los 32 estados (son colaboraciones), así que bajamos
 * todos.
 *
 * Cómo funciona el sitio (es un ASP.NET WebForms, ojo):
 *   1. La búsqueda es un POST a "./" con los tokens __VIEWSTATE / __EVENTVALIDATION
 *      y los criterios (estado, año, mes, sexo, "mostrar imagen=NO"). El servidor
 *      responde con un 302 a "About" y guarda los RESULTADOS EN LA SESIÓN.
 *   2. "About" muestra una lista de tarjetas: cada una trae id, nombre, edad y
 *      fecha de localización, más un botón "VER MAS" que abre "Contact.aspx?id=N".
 *   3. "Contact.aspx?id=N" trae el detalle completo (sexo, estatura, lugar,
 *      municipio, señas particulares, media filiación...), PERO sólo funciona con
 *      la misma cookie de sesión que acaba de hacer la búsqueda que contiene ese N.
 *
 * Por eso el flujo es: por cada año, una sesión hace la búsqueda y enseguida baja
 * los detalles de ESE año con su propia cookie, antes de pasar al siguiente.
 *
 * No guardamos imágenes (el detalle las trae embebidas en base64; las quitamos
 * antes de parsear).
 *
 * Cómo correrlo:
 *   pnpm scrape:sinaloa            -> todo: del año 2022 hasta el actual
 *   pnpm scrape:sinaloa 2022 2024  -> sólo ese rango de años (inclusive)
 *
 * Necesita en .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (Supabase > Project Settings > API)
 */

import { config as loadEnv } from "dotenv";
import * as cheerio from "cheerio";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TablesInsert } from "@/lib/types/database.types";

loadEnv({ path: ".env.local" });

const BASE = "https://fiscaliasinaloa.mx/Apps/ConsultaOcciso/";
const FUENTE = "fiscalia_sinaloa";
const ANIO_MINIMO = 2022; // el usuario sólo quiere de 2022 en adelante
const CONCURRENCIA = 4; // cuántas sesiones paralelas bajan detalles

// Pausa cortita para no martillar el servidor.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Utilidades de texto / parseo
// ---------------------------------------------------------------------------

/** Limpia espacios sobrantes (la fuente rellena con muchos espacios y saltos). */
function limpiar(s: string | undefined | null): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/** "SEÑA PARTICULARES:" -> "sena_particulares" (clave estable para el JSON). */
function clave(etiqueta: string): string {
  return etiqueta
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos
    .toLowerCase()
    .replace(/:/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "_");
}

/** "MASCULINO"/"FEMENINO" -> valores que acepta la columna `sexo`. */
function mapearSexo(valor: string): "Masculino" | "Femenino" | "Indeterminado" {
  const v = valor.toLowerCase();
  if (v.startsWith("masc") || v.includes("hombre")) return "Masculino";
  if (v.startsWith("feme") || v.includes("mujer")) return "Femenino";
  return "Indeterminado";
}

/** "50" -> 50; "0"/""/"NO ESPECIFICADO" -> null. */
function numeroOpcional(valor: string): number | null {
  const m = valor.match(/[\d.]+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "12/01/2022 08:40:00 a. m." -> "2022-01-12" (formato Postgres). null si no aplica. */
function parsearFechaLista(valor: string): string | null {
  const m = valor.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const [, dia, mes, anio] = m;
  return `${anio}-${mes}-${dia}`;
}

// ---------------------------------------------------------------------------
// Cookie jar + fetch que sigue redirecciones a mano (para mantener la sesión)
// ---------------------------------------------------------------------------

type Jar = Map<string, string>;

function cabeceraCookie(jar: Jar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function actualizarJar(jar: Jar, res: Response): void {
  // getSetCookie() (Node 20+) devuelve cada Set-Cookie por separado.
  const cookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean as unknown as (x: unknown) => boolean);
  for (const c of cookies as string[]) {
    const par = c.split(";")[0];
    const i = par.indexOf("=");
    if (i > 0) jar.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
  }
}

interface Respuesta {
  status: number;
  url: string;
  text: string;
}

/** fetch que sigue 30x a mano manteniendo cookies (fetch nativo no tiene jar). */
async function pedir(
  jar: Jar,
  url: string,
  method: "GET" | "POST",
  body?: string,
): Promise<Respuesta> {
  let actual = url;
  let met: "GET" | "POST" = method;
  let cuerpo = body;

  for (let salto = 0; salto < 6; salto++) {
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (compatible; investigacion-forense-opensource)",
    };
    const cookie = cabeceraCookie(jar);
    if (cookie) headers["Cookie"] = cookie;
    if (cuerpo) headers["Content-Type"] = "application/x-www-form-urlencoded";

    const res = await fetch(actual, { method: met, headers, body: cuerpo, redirect: "manual" });
    actualizarJar(jar, res);

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`Redirección ${res.status} sin Location`);
      actual = new URL(loc, actual).toString();
      // Tras un POST, el navegador sigue la redirección con GET (PRG pattern).
      if (res.status === 303 || (res.status === 302 && met === "POST")) {
        met = "GET";
        cuerpo = undefined;
      }
      continue;
    }
    return { status: res.status, url: actual, text: await res.text() };
  }
  throw new Error("Demasiadas redirecciones");
}

// ---------------------------------------------------------------------------
// Una fila ya parseada
// ---------------------------------------------------------------------------

interface RegistroSinaloa {
  fuenteId: string;
  fecha: string | null;
  sexo: "Masculino" | "Femenino" | "Indeterminado";
  edad: number | null;
  estatura: number | null;
  municipio: string | null;
  estado: string | null;
  rasgos: Record<string, string>;
}

// Un renglón de la lista (About): lo mínimo para luego abrir el detalle.
interface ItemLista {
  id: string;
  nombre: string;
  edad: number | null;
  fecha: string | null;
}

// ---------------------------------------------------------------------------
// Sesión: encapsula su propia cookie y sabe buscar un año + bajar detalles.
// ---------------------------------------------------------------------------

class Sesion {
  private jar: Jar = new Map();

  /** GET al formulario para sacar los tokens frescos del ViewState. */
  private async obtenerTokens(): Promise<Record<string, string>> {
    const { text } = await pedir(this.jar, BASE, "GET");
    const sacar = (nombre: string) =>
      text.match(new RegExp(`id="${nombre}" value="([^"]*)"`))?.[1] ?? "";
    return {
      __VIEWSTATE: sacar("__VIEWSTATE"),
      __VIEWSTATEGENERATOR: sacar("__VIEWSTATEGENERATOR"),
      __EVENTVALIDATION: sacar("__EVENTVALIDATION"),
    };
  }

  /** Hace la búsqueda de un año (todos los estados, sin imagen) y devuelve la lista. */
  async buscarAnio(anio: number): Promise<ItemLista[]> {
    const tokens = await this.obtenerTokens();
    const form = new URLSearchParams({
      ...tokens,
      "ctl00$MainContent$Folio": "",
      "ctl00$MainContent$DropDownList1": "0", // sexo: sin filtro
      "ctl00$MainContent$Paterno": "",
      "ctl00$MainContent$Materno": "",
      "ctl00$MainContent$Nombre": "",
      "ctl00$MainContent$DdlEstados": "0", // TODOS los estados
      "ctl00$MainContent$DdlAños": String(anio),
      "ctl00$MainContent$DdlMes": "0", // TODOS los meses
      "ctl00$MainContent$group1": "CheckBox2", // Mostrar Imagen = NO
      "ctl00$MainContent$Button1": "Buscar",
    });

    const { text } = await pedir(this.jar, BASE, "POST", form.toString());
    return parsearLista(text);
  }

  /** Baja y parsea el detalle de un id (usa la cookie de la sesión actual). */
  async detalle(item: ItemLista): Promise<RegistroSinaloa | null> {
    const url = `${BASE}Contact.aspx?id=${item.id}`;
    const { text } = await pedir(this.jar, url, "GET");
    return parsearDetalle(item, text);
  }
}

// ---------------------------------------------------------------------------
// Parseo de la lista (About) y del detalle (Contact.aspx)
// ---------------------------------------------------------------------------

function parsearLista(html: string): ItemLista[] {
  const $ = cheerio.load(html);
  const items: ItemLista[] = [];

  $("table.csstabla td.celdacomponente").each((_, td) => {
    const $td = $(td);
    const onclick = $td.find("input[type=submit]").attr("onclick") ?? "";
    const id = onclick.match(/CargaOcciso\((\d+)\)/)?.[1];
    if (!id) return;

    const nombre = limpiar($td.find(".TituloClass").text()).replace(/^Nombre:\s*/i, "");
    const edadTxt = limpiar($td.find(".SinopsisClass").text()).replace(/^Edad:\s*/i, "");
    const fechaTxt = limpiar($td.find(".FechaClass").text()).replace(/^Fecha Localiza:\s*/i, "");

    items.push({
      id,
      nombre,
      edad: numeroOpcional(edadTxt),
      fecha: parsearFechaLista(fechaTxt),
    });
  });

  return items;
}

function parsearDetalle(item: ItemLista, htmlCrudo: string): RegistroSinaloa | null {
  // Quita el base64 de las imágenes ANTES de parsear (cada detalle pesa ~300 KB).
  const html = htmlCrudo.replace(/src="data:image[^"]*"/g, 'src=""');
  const $ = cheerio.load(html);

  // Recorremos todos los <span> del contenido en orden. Las "etiquetas" terminan
  // en ":"; el valor es el siguiente span que NO sea otra etiqueta. Así sacamos
  // todos los campos (incluida la media filiación) sin depender de ids exactos.
  const spans = $("span[id^='MainContent_']")
    .toArray()
    .map((el) => limpiar($(el).text()));

  const datos: Record<string, string> = {};
  for (let i = 0; i < spans.length; i++) {
    const txt = spans[i];
    if (!txt.endsWith(":")) continue; // no es etiqueta
    const valor = spans[i + 1];
    if (valor === undefined || valor.endsWith(":") || valor === "") continue; // sin valor
    const k = clave(txt);
    if (!(k in datos)) datos[k] = valor; // nos quedamos con el primer valor no vacío
    i++; // saltamos el valor ya consumido
  }

  // Nombre: lo trae la lista, pero el detalle suele tenerlo más completo.
  const nombreDetalle = limpiar($("[id='MainContent_lblnombre']").text());
  const nombre = nombreDetalle || item.nombre;

  const municipio = datos["municipio"] || null;
  const estado = datos["estado_que_reporto"] || null;

  // rasgos: todo lo que extrajimos, más alias para las llaves que lee el motor
  // de coincidencias (`senas_particulares`).
  const rasgos: Record<string, string> = { ...datos };
  if (nombre) rasgos["probable_nombre"] = nombre;
  const senas = datos["sena_particulares"] || datos["senas_particulares"];
  if (senas) rasgos["senas_particulares"] = senas;

  return {
    fuenteId: item.id,
    fecha: item.fecha,
    sexo: mapearSexo(datos["sexo"] ?? ""),
    edad: item.edad,
    estatura: numeroOpcional(datos["estatura"] ?? ""),
    municipio,
    estado,
    rasgos,
  };
}

// ---------------------------------------------------------------------------
// Programa principal
// ---------------------------------------------------------------------------

async function main() {
  const anioActual = new Date().getFullYear();
  const desde = Number(process.argv[2]) || ANIO_MINIMO;
  const hasta = Number(process.argv[3]) || anioActual;

  console.log(`🔎 Scrapeando Occisos de Fiscalía Sinaloa de ${desde} a ${hasta}...`);

  const supabase = createAdminClient();

  // Un pool de sesiones independientes para paralelizar la bajada de detalles.
  const sesiones = Array.from({ length: CONCURRENCIA }, () => new Sesion());

  const registros: RegistroSinaloa[] = [];

  for (let anio = desde; anio <= hasta; anio++) {
    // Todas las sesiones buscan el mismo año, para que cada una tenga el set
    // completo en su sesión y pueda abrir cualquier id de ese año.
    const listas = await Promise.all(sesiones.map((s) => s.buscarAnio(anio)));
    const lista = listas[0]; // todas devuelven lo mismo
    console.log(`   ${anio}: ${lista.length} registros en la lista`);
    if (lista.length === 0) continue;

    // Cola compartida: cada sesión (worker) jala ids hasta vaciarla.
    const cola = [...lista];
    let ok = 0;
    await Promise.all(
      sesiones.map(async (s) => {
        for (;;) {
          const item = cola.pop();
          if (!item) break;
          try {
            const reg = await s.detalle(item);
            if (reg) {
              registros.push(reg);
              ok++;
            }
          } catch (e) {
            console.error(`   ⚠️  Falló el detalle ${item.id}:`, (e as Error).message);
          }
          await sleep(120); // cortesía con el servidor
        }
      }),
    );
    console.log(`        detalles bajados: ${ok}/${lista.length}`);
  }

  if (registros.length === 0) {
    console.log("No se encontraron registros. Fin.");
    return;
  }

  // Resolver lugares: por cada (municipio, estado) obtener o crear su id.
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

  // Construir las filas para la tabla `forense` (saltando las sin fecha válida).
  const sinFecha = registros.filter((r) => !r.fecha).length;
  const filas: TablesInsert<"forense">[] = [];
  for (const r of registros) {
    if (!r.fecha) continue;
    const lugar = [r.municipio, r.estado].filter(Boolean).join(", ");
    filas.push({
      fuente: FUENTE,
      fuente_id: r.fuenteId,
      fecha_hallazgo: r.fecha,
      sexo: r.sexo,
      edad_inicial: r.edad,
      edad_final: r.edad,
      estatura: r.estatura,
      lugar_hallazgo_id: lugar ? await resolverLugar(lugar, r.estado, r.municipio) : null,
      rasgos: r.rasgos,
    });
  }
  if (sinFecha > 0) console.log(`   (${sinFecha} registros omitidos por no traer fecha válida)`);
  console.log(`📍 ${lugarId.size} lugares resueltos.`);

  // Deduplicar por (fuente, fuente_id): un upsert no puede tocar la misma fila
  // dos veces en el mismo comando.
  const porClave = new Map<string, TablesInsert<"forense">>();
  for (const fila of filas) porClave.set(`${fila.fuente}|${fila.fuente_id}`, fila);
  const filasUnicas = [...porClave.values()];

  // Guardar en lotes. upsert + onConflict evita duplicados al re-correr.
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
