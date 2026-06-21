/**
 * Cliente de Firecrawl para buscar en la web (noticias, redes sociales, boletines)
 * personas reportadas como DESAPARECIDAS a partir de los rasgos de un registro
 * forense (restos sin identificar), y extraer sus datos ya estructurados.
 *
 * Firecrawl hace dos cosas en una sola llamada:
 *   1. `search`  -> busca en la web/noticias con una consulta de texto.
 *   2. formato `json` -> por cada resultado, un modelo extrae los campos que
 *      describimos en `ESQUEMA_EXTRACCION` (nombre, fecha, sexo, señas, etc.).
 *
 * Así solo necesitamos la API key de Firecrawl (FIRECRAWL_API_KEY); no hace
 * falta otra dependencia ni otro modelo.
 *
 * Privacidad: trabajamos con datos personales de víctimas de fuentes públicas y
 * con fin humanitario (cruce con restos no identificados). Manéjalos con cuidado.
 */

import { Firecrawl } from "firecrawl";

/** Lo que el modelo de Firecrawl extrae de cada página encontrada. */
export type CandidatoPersona = {
  /** true solo si la página describe a una persona DESAPARECIDA (no un cuerpo hallado). */
  es_persona_desaparecida: boolean;
  nombre: string | null;
  /** "Masculino" | "Femenino" | "Indeterminado" (lo normalizamos después). */
  sexo: string | null;
  edad: number | null;
  estatura_cm: number | null;
  /** "YYYY-MM-DD" o null si la página no la trae. */
  fecha_desaparicion: string | null;
  estado: string | null;
  municipio: string | null;
  tatuajes: string | null;
  senas_particulares: string | null;
  /** 0 a 1: qué tan seguro está el modelo de que es una persona desaparecida real. */
  confianza: number | null;
  resumen: string | null;
  /** URL de la página de donde salió el dato (la rellenamos nosotros). */
  url: string;
};

// Esquema (JSON Schema) que le pasamos a Firecrawl para que extraiga datos
// estructurados de cada resultado. Todo es opcional/nullable: preferimos un
// null honesto a un dato inventado.
const ESQUEMA_EXTRACCION = {
  type: "object",
  properties: {
    es_persona_desaparecida: {
      type: "boolean",
      description:
        "true SOLO si la página describe a una persona reportada como desaparecida o en búsqueda (ficha, boletín, post de familiares). false si describe un cuerpo/restos hallados, una persona ya localizada con vida, o cualquier otra cosa.",
    },
    nombre: { type: ["string", "null"], description: "Nombre completo de la persona desaparecida." },
    sexo: {
      type: ["string", "null"],
      enum: ["Masculino", "Femenino", "Indeterminado", null],
      description: "Sexo de la persona.",
    },
    edad: { type: ["number", "null"], description: "Edad en años al desaparecer." },
    estatura_cm: { type: ["number", "null"], description: "Estatura en centímetros." },
    fecha_desaparicion: {
      type: ["string", "null"],
      description: "Fecha de desaparición en formato YYYY-MM-DD. null si no aparece.",
    },
    estado: { type: ["string", "null"], description: "Estado de la República donde desapareció." },
    municipio: { type: ["string", "null"], description: "Municipio o ciudad donde desapareció." },
    tatuajes: { type: ["string", "null"], description: "Descripción de tatuajes, si los menciona." },
    senas_particulares: {
      type: ["string", "null"],
      description: "Señas particulares: cicatrices, lunares, marcas, características físicas.",
    },
    confianza: {
      type: ["number", "null"],
      description: "Entre 0 y 1: qué tan seguro estás de que la página describe a una persona desaparecida real con datos concretos.",
    },
    resumen: { type: ["string", "null"], description: "Resumen de una frase de lo que dice la página." },
  },
  required: ["es_persona_desaparecida"],
} as const;

const PROMPT_EXTRACCION =
  "Esta página fue encontrada al buscar a una persona desaparecida en México. " +
  "Extrae los datos de la persona desaparecida que describe. Si la página NO trata " +
  "sobre una persona desaparecida (por ejemplo: un cuerpo o restos hallados, una nota " +
  "general, publicidad), marca es_persona_desaparecida=false y deja el resto en null. " +
  "Usa null en cualquier campo que la página no indique de forma explícita; no inventes datos.";

/** Crea el cliente de Firecrawl leyendo la API key del entorno. */
export function createFirecrawlClient(): Firecrawl {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Falta FIRECRAWL_API_KEY en .env.local. Consíguela en https://firecrawl.dev",
    );
  }
  return new Firecrawl({ apiKey });
}

/**
 * Busca en la web (noticias + web general, que incluye redes sociales) y devuelve
 * los candidatos ya extraídos. `limite` = máximo de resultados a procesar (cada uno
 * consume créditos de Firecrawl, porque se scrapea y se extrae).
 */
export async function buscarCandidatos(
  app: Firecrawl,
  consulta: string,
  limite = 5,
): Promise<CandidatoPersona[]> {
  const res = await app.search(consulta, {
    sources: ["news", "web"],
    limit: limite,
    location: "Mexico",
    scrapeOptions: {
      formats: [{ type: "json", prompt: PROMPT_EXTRACCION, schema: ESQUEMA_EXTRACCION }],
    },
  });

  // Cuando se pasa scrapeOptions, cada resultado es un Document con `.json`
  // (lo extraído) y `.metadata` (de donde sacamos la URL).
  const docs = [...(res.web ?? []), ...(res.news ?? [])];
  const candidatos: CandidatoPersona[] = [];

  for (const doc of docs) {
    // Los resultados sin scrapear (solo título/URL) no tienen `.json`; los saltamos.
    const datos = (doc as { json?: unknown }).json;
    if (!datos || typeof datos !== "object") continue;

    const meta = (doc as { metadata?: { sourceURL?: string; url?: string } }).metadata;
    const url = meta?.sourceURL ?? meta?.url ?? (doc as { url?: string }).url;
    if (!url) continue;

    candidatos.push({ ...(datos as Omit<CandidatoPersona, "url">), url });
  }

  return candidatos;
}
