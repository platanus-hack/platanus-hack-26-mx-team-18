import type { Json, TablesInsert } from "../database.types";
import type { OrigenX, PublicacionX, SanadoPublicacionX } from "./types";

export const FUENTE_X = "x";
const UMBRAL_CONFIANZA = 0.5;

const PALABRAS_NO_NOMBRE = [
  "adolescente", "adolecente", "menor", "menores", "joven", "jovenes",
  "niño", "nino", "niña", "nina", "niños", "ninos", "niñas", "ninas",
  "hombre", "mujer", "persona", "personas", "victima", "victimas",
  "desconocido", "desconocida", "identificar", "identificado", "identificada",
  "desaparecido", "desaparecida", "anonimo", "anonima", "sin",
];

type FuenteMeta = {
  origen: string;
  url: string;
  confianza: number | null;
  resumen: string | null;
};

function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function nombreEsGenerico(nombre: string): boolean {
  const palabras = sinAcentos(nombre).split(/[^a-z]+/).filter(Boolean);
  return palabras.some((p) => PALABRAS_NO_NOMBRE.includes(p));
}

function mapearSexo(v: string | null): "Masculino" | "Femenino" | "Indeterminado" {
  const s = (v || "").toUpperCase();
  if (s.startsWith("M") && s.includes("U")) return "Femenino";
  if (s.startsWith("M") || s.startsWith("H")) return "Masculino";
  if (s.startsWith("F")) return "Femenino";
  return "Indeterminado";
}

function soloFecha(v: string | null): string | null {
  if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mes, d] = m;
  const mesN = Number(mes);
  const diaN = Number(d);
  if (mesN < 1 || mesN > 12 || diaN < 1 || diaN > 31) return null;
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

function rasgoStr(rasgos: unknown, clave: string): string | null {
  if (rasgos && typeof rasgos === "object" && !Array.isArray(rasgos)) {
    const v = (rasgos as Record<string, unknown>)[clave];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

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

/** Misma lógica estricta que `scrape-firecrawl.ts` → `sanear`. */
export function sanearPublicacionX(pub: PublicacionX): SanadoPublicacionX | null {
  if (!pub.es_persona_desaparecida) return null;
  const nombre = pub.nombre?.trim();
  const fecha = soloFecha(pub.fecha_desaparicion);
  if (!nombre || !fecha) return null;
  if (nombreEsGenerico(nombre)) return null;
  if (typeof pub.confianza === "number" && pub.confianza < UMBRAL_CONFIANZA) return null;

  const edad =
    typeof pub.edad === "number" && pub.edad >= 0 && pub.edad <= 120 ? pub.edad : null;
  const estatura =
    typeof pub.estatura_cm === "number" && pub.estatura_cm > 0 && pub.estatura_cm < 300
      ? pub.estatura_cm
      : null;

  return {
    nombre,
    sexo: mapearSexo(pub.sexo),
    edad,
    estatura,
    fecha,
    estado: pub.estado?.trim() || null,
    municipio: pub.municipio?.trim() || null,
  };
}

export function fuenteIdX(pub: PublicacionX): string {
  return pub.tweet_url ?? pub.url;
}

/** Combina rasgos existentes con los de una publicación de X. */
export function mergeRasgosX(
  existente: unknown,
  pub: PublicacionX,
  origen: OrigenX,
): Json {
  const base: Record<string, unknown> =
    typeof existente === "string"
      ? { senas_particulares: existente }
      : existente && typeof existente === "object" && !Array.isArray(existente)
        ? { ...(existente as Record<string, unknown>) }
        : {};

  const url = fuenteIdX(pub);
  const fuentes = fuentesPrevias(existente).filter((f) => f.url !== url);
  fuentes.push({
    origen: FUENTE_X,
    url,
    confianza: pub.confianza,
    resumen: pub.resumen,
  });

  const metaPrevio =
    base._meta && typeof base._meta === "object" && !Array.isArray(base._meta)
      ? { ...(base._meta as Record<string, unknown>) }
      : {};

  return {
    ...base,
    tatuajes: unirTexto(rasgoStr(base, "tatuajes"), pub.tatuajes),
    senas_particulares: unirTexto(rasgoStr(base, "senas_particulares"), pub.senas_particulares),
    _meta: {
      ...metaPrevio,
      fuentes,
      x: {
        origen_id: origen.id,
        origen_tipo: origen.tipo,
        tweet_url: pub.tweet_url,
        texto_tweet: pub.texto_tweet,
        fecha_publicacion: pub.fecha_publicacion,
        autor_handle: pub.autor_handle,
        confianza: pub.confianza,
        resumen: pub.resumen,
      },
    },
  } as Json;
}

export function aPersonaInsertX(
  pub: PublicacionX,
  origen: OrigenX,
  s: SanadoPublicacionX,
  lugarId: number | null,
): TablesInsert<"persona"> {
  return {
    fuente: FUENTE_X,
    fuente_id: fuenteIdX(pub),
    nombre: s.nombre,
    sexo: s.sexo,
    edad: s.edad,
    estatura: s.estatura,
    fecha_desaparicion: s.fecha,
    ultimo_lugar_id: lugarId,
    rasgos: mergeRasgosX(null, pub, origen),
  };
}
