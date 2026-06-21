/**
 * Motor de puntuación de coincidencias forenses.
 *
 * Compara un reporte de persona desaparecida (datos ANTE MORTEM) contra un
 * registro de restos no identificados (datos POST MORTEM) y devuelve un
 * puntaje de 0 a 100 que estima qué tan probable es que sean la misma persona.
 *
 * La idea (del documento del proyecto): no todas las características valen
 * igual. Un tatuaje o una seña particular es MUCHO más identificante que el
 * sexo o la estatura. Por eso cada variable tiene un "peso" distinto.
 *
 * Este archivo es lógica PURA (sin base de datos), así se puede reusar tanto
 * en el script de cruce como, en el futuro, en la web o una API.
 */

// ---------------------------------------------------------------------------
// Pesos: cuántos puntos aporta como máximo cada variable. Suman 100.
// Ajusta estos números para afinar el algoritmo.
// ---------------------------------------------------------------------------
export const PESOS = {
  rasgos: 40, // tatuajes y señas particulares -> lo más identificante
  edad: 18,
  estatura: 14,
  sexo: 10,
  lugar: 10,
  fecha: 8,
} as const;

const TOL_EDAD = 5; // años de tolerancia fuera del rango de edad forense
const TOL_ESTATURA_EXACTA = 3; // cm: hasta aquí cuenta como "misma estatura"
const TOL_ESTATURA_MAX = 12; // cm: más allá de esto, la estatura no suma
const PUNTOS_POR_SEÑA = 9; // puntos por cada palabra clave compartida en rasgos
const MAX_AÑOS_FECHA = 5; // si el hallazgo es >5 años tras la desaparición, no suma

// ---------------------------------------------------------------------------
// Tipos de entrada (solo los campos que necesita el motor).
// ---------------------------------------------------------------------------
export interface PersonaAM {
  id: number;
  sexo: string;
  edad: number | null;
  estatura: number | null;
  fecha_desaparicion: string; // "YYYY-MM-DD"
  ultimo_lugar_id: number | null;
  estado: string | null; // estado del último lugar, resuelto desde `lugares`
  rasgos: unknown; // jsonb (puede ser texto u objeto)
}

export interface ForensePM {
  id: number;
  sexo: string;
  edad_inicial: number | null;
  edad_final: number | null;
  estatura: number | null;
  fecha_hallazgo: string; // "YYYY-MM-DD"
  lugar_hallazgo_id: number | null;
  estado: string | null; // estado del lugar de hallazgo, resuelto desde `lugares`
  rasgos: unknown; // jsonb (objeto: {tatuajes, senas_particulares, ...})
}

export interface Resultado {
  puntaje: number; // 0 a 100
  razon: string; // explicación legible de por qué coinciden
  descartado: boolean; // true = imposible que sean la misma persona
}

// ---------------------------------------------------------------------------
// Utilidades de texto para comparar rasgos.
// ---------------------------------------------------------------------------

/** Quita acentos y pasa a minúsculas: "Antebrazó" -> "antebrazo". */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // marcas de acento combinantes
}

// Palabras demasiado comunes o genéricas: no aportan a la identificación.
const VACIAS = new Set([
  "para", "como", "pero", "porque", "este", "esta", "esto", "esos", "esas",
  "unos", "unas", "una", "uno", "del", "los", "las", "con", "sin", "que",
  "color", "colores", "marca", "talla", "tinta", "negro", "negra", "blanco",
  "blanca", "visible", "parte", "lado", "tipo", "presenta", "localizado",
  "localizada", "ambos", "ambas", "sobre", "tres", "dos", "cual", "cuales",
  "leyenda", "figura", "claves", "palabras", "tono", "izquierdo", "izquierda",
  "derecho", "derecha", "anterior", "posterior", "superior", "inferior",
]);

/** Convierte un texto en un conjunto de palabras clave significativas. */
export function tokens(texto: string): Set<string> {
  const set = new Set<string>();
  for (const palabra of normalizar(texto).split(/[^a-z0-9ñ]+/)) {
    if (palabra.length >= 4 && !VACIAS.has(palabra)) set.add(palabra);
  }
  return set;
}

/**
 * Aplana el campo `rasgos` (jsonb) a un texto. En `forense` es un objeto
 * {tatuajes, senas_particulares, ...}; en `persona` suele ser texto libre.
 * Con `claves` se eligen solo ciertos campos (ej. los más identificantes).
 */
export function textoDeRasgos(rasgos: unknown, claves?: string[]): string {
  if (rasgos == null) return "";
  if (typeof rasgos === "string") return rasgos;
  if (typeof rasgos === "object") {
    const obj = rasgos as Record<string, unknown>;
    const valores = claves ? claves.map((k) => obj[k]) : Object.values(obj);
    return valores.filter((v): v is string => typeof v === "string").join(" ");
  }
  return String(rasgos);
}

/** Calcula directamente las palabras clave de los rasgos de un forense. */
export function tokensForense(forense: ForensePM): Set<string> {
  return tokens(textoDeRasgos(forense.rasgos, ["tatuajes", "senas_particulares"]));
}

/** Calcula las palabras clave de los rasgos de una persona. */
export function tokensPersona(persona: PersonaAM): Set<string> {
  return tokens(textoDeRasgos(persona.rasgos));
}

const sexoConocido = (s: string) => s === "Masculino" || s === "Femenino";

/** ¿Es el mismo estado? Compara sin acentos ni mayúsculas ("JALISCO" == "Jalisco"). */
function mismoEstado(a: string, b: string): boolean {
  return normalizar(a.trim()) === normalizar(b.trim());
}

// ---------------------------------------------------------------------------
// Función principal de puntuación.
// ---------------------------------------------------------------------------

/**
 * Devuelve el puntaje de coincidencia entre una persona y un forense.
 * Para acelerar lotes grandes se pueden pasar las palabras clave ya calculadas.
 */
export function puntuar(
  persona: PersonaAM,
  forense: ForensePM,
  pre?: { tokensPersona?: Set<string>; tokensForense?: Set<string> },
): Resultado {
  // --- Filtros duros: si se cumplen, es IMPOSIBLE que sean la misma persona ---

  // 1) Sexos conocidos y distintos.
  if (sexoConocido(persona.sexo) && sexoConocido(forense.sexo) && persona.sexo !== forense.sexo) {
    return { puntaje: 0, razon: "Sexos distintos", descartado: true };
  }
  // 2) No se puede hallar un cuerpo ANTES de que la persona desapareciera.
  if (persona.fecha_desaparicion > forense.fecha_hallazgo) {
    return { puntaje: 0, razon: "Hallazgo anterior a la desaparición", descartado: true };
  }

  let puntaje = 0;
  const razones: string[] = [];

  // --- Variables que suman puntos ---

  // Sexo coincide (ambos conocidos e iguales).
  if (sexoConocido(persona.sexo) && persona.sexo === forense.sexo) {
    puntaje += PESOS.sexo;
    razones.push(`sexo coincide (${persona.sexo})`);
  }

  // Edad: la persona cae dentro (o cerca) del rango estimado del forense.
  if (persona.edad != null && forense.edad_inicial != null) {
    const ini = forense.edad_inicial;
    const fin = forense.edad_final ?? forense.edad_inicial;
    if (persona.edad >= ini && persona.edad <= fin) {
      puntaje += PESOS.edad;
      razones.push(`edad ${persona.edad} dentro del rango ${ini}-${fin}`);
    } else {
      const dist = persona.edad < ini ? ini - persona.edad : persona.edad - fin;
      if (dist <= TOL_EDAD) {
        puntaje += PESOS.edad * (1 - dist / TOL_EDAD) * 0.6;
        razones.push(`edad ${persona.edad} cercana al rango ${ini}-${fin}`);
      }
    }
  }

  // Estatura: cuanto más parecida, más puntos.
  if (persona.estatura != null && forense.estatura != null) {
    const d = Math.abs(persona.estatura - forense.estatura);
    if (d <= TOL_ESTATURA_EXACTA) {
      puntaje += PESOS.estatura;
      razones.push(`estatura casi igual (${persona.estatura} vs ${forense.estatura} cm)`);
    } else if (d <= TOL_ESTATURA_MAX) {
      const factor = 1 - (d - TOL_ESTATURA_EXACTA) / (TOL_ESTATURA_MAX - TOL_ESTATURA_EXACTA);
      puntaje += PESOS.estatura * factor;
      razones.push(`estatura parecida (${persona.estatura} vs ${forense.estatura} cm)`);
    }
  }

  // Lugar: mismo estado. Es una señal SUAVE (suma puntos, nunca descarta):
  // es común que alguien desaparezca en un estado y sus restos aparezcan en otro.
  if (persona.estado && forense.estado && mismoEstado(persona.estado, forense.estado)) {
    puntaje += PESOS.lugar;
    razones.push(`mismo estado (${forense.estado})`);
  }

  // Cercanía temporal: hallazgo poco después de la desaparición = más probable.
  const dias =
    (Date.parse(forense.fecha_hallazgo) - Date.parse(persona.fecha_desaparicion)) / 86_400_000;
  if (Number.isFinite(dias) && dias >= 0) {
    const años = dias / 365;
    if (años <= MAX_AÑOS_FECHA) {
      puntaje += PESOS.fecha * (1 - años / MAX_AÑOS_FECHA);
    }
  }

  // Rasgos: palabras clave compartidas entre tatuajes/señas (lo más fuerte).
  const tP = pre?.tokensPersona ?? tokensPersona(persona);
  const tF = pre?.tokensForense ?? tokensForense(forense);
  const comunes = [...tP].filter((t) => tF.has(t));
  if (comunes.length > 0) {
    puntaje += Math.min(PESOS.rasgos, comunes.length * PUNTOS_POR_SEÑA);
    razones.push(`señas en común: ${comunes.slice(0, 6).join(", ")}`);
  }

  return {
    puntaje: Math.round(puntaje * 100) / 100, // 2 decimales (columna numeric(5,2))
    razon: razones.join("; ") || "Sin coincidencias relevantes",
    descartado: false,
  };
}
