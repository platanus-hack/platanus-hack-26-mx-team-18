import type { PublicacionX, OrigenX, MuestraX, PersonaPreviewX, ValidacionCandidatoX } from "./types";

const PALABRAS_NO_NOMBRE = [
  "adolescente", "adolecente", "menor", "menores", "joven", "jovenes",
  "niño", "nino", "niña", "nina", "niños", "ninos", "niñas", "ninas",
  "hombre", "mujer", "persona", "personas", "victima", "victimas",
  "desconocido", "desconocida", "identificar", "identificado", "identificada",
  "desaparecido", "desaparecida", "anonimo", "anonima", "sin",
];

const UMBRAL_CONFIANZA = 0.5;

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

/** Misma lógica estricta que `scrape-firecrawl.ts` → `sanear`. */
export function validarPublicacionX(pub: PublicacionX): ValidacionCandidatoX {
  if (!pub.es_persona_desaparecida) {
    return { valido: false, motivo_descarte: "no_es_persona_desaparecida" };
  }
  const nombre = pub.nombre?.trim();
  if (!nombre) {
    return { valido: false, motivo_descarte: "sin_nombre" };
  }
  const fecha = soloFecha(pub.fecha_desaparicion);
  if (!fecha) {
    return { valido: false, motivo_descarte: "sin_fecha_desaparicion" };
  }
  if (nombreEsGenerico(nombre)) {
    return { valido: false, motivo_descarte: "nombre_generico" };
  }
  if (typeof pub.confianza === "number" && pub.confianza < UMBRAL_CONFIANZA) {
    return { valido: false, motivo_descarte: "confianza_baja" };
  }
  return { valido: true, motivo_descarte: null };
}

/** Cómo quedaría la fila en `persona` si pasara la validación. */
export function aPersonaPreviewX(pub: PublicacionX, origen: OrigenX): PersonaPreviewX | null {
  const validacion = validarPublicacionX(pub);
  if (!validacion.valido) return null;

  const nombre = pub.nombre!.trim();
  const fecha = soloFecha(pub.fecha_desaparicion)!;
  const edad =
    typeof pub.edad === "number" && pub.edad >= 0 && pub.edad <= 120 ? pub.edad : null;
  const estatura =
    typeof pub.estatura_cm === "number" && pub.estatura_cm > 0 && pub.estatura_cm < 300
      ? pub.estatura_cm
      : null;

  const fuenteId = pub.tweet_url ?? pub.url;

  return {
    fuente: "x",
    fuente_id: fuenteId,
    nombre,
    sexo: mapearSexo(pub.sexo),
    edad,
    estatura,
    fecha_desaparicion: fecha,
    estado: pub.estado?.trim() || null,
    municipio: pub.municipio?.trim() || null,
    rasgos: {
      tatuajes: pub.tatuajes?.trim() || null,
      senas_particulares: pub.senas_particulares?.trim() || null,
      _meta: {
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
    },
  };
}

export function aMuestraX(indice: number, origen: OrigenX, pub: PublicacionX): MuestraX {
  const validacion = validarPublicacionX(pub);
  return {
    indice,
    origen,
    extraccion: pub,
    validacion,
    persona_preview: validacion.valido ? aPersonaPreviewX(pub, origen) : null,
  };
}
