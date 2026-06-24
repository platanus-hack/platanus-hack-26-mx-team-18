/**
 * Cliente Firecrawl orientado a publicaciones de X (Twitter) sobre personas
 * desaparecidas en México. Reutiliza el esquema de extracción de `client.ts`
 * y añade metadatos del tweet.
 */

import type { Firecrawl } from "firecrawl";
import {
  createFirecrawlClient,
  ESQUEMA_EXTRACCION,
  PROMPT_EXTRACCION,
  type CandidatoPersona,
} from "./client";
import type { OrigenX, PublicacionX } from "@/lib/types/x/types";

export { createFirecrawlClient };

/** Fuentes oficiales / hashtag que monitoreamos en X. */
export const FUENTES_X: readonly OrigenX[] = [
  {
    id: "BoletinCBPCDMX",
    url: "https://x.com/BoletinCBPCDMX",
    tipo: "perfil",
  },
  {
    id: "Busqueda_MX",
    url: "https://x.com/Busqueda_MX",
    tipo: "perfil",
  },
  {
    id: "FichaDeBusqueda",
    url: "https://x.com/hashtag/FichaDeB%C3%BAsqueda?src=hashtag_click",
    tipo: "hashtag",
  },
] as const;

/** Consultas de búsqueda web acotadas a x.com por fuente. */
export const CONSULTAS_X: Record<string, string[]> = {
  BoletinCBPCDMX: [
    "site:x.com/BoletinCBPCDMX persona desaparecida ficha búsqueda México",
    "site:x.com/BoletinCBPCDMX desaparecido boletín",
  ],
  Busqueda_MX: [
    "site:x.com/Busqueda_MX persona desaparecida",
    "site:x.com/Busqueda_MX desaparecido México",
  ],
  FichaDeBusqueda: [
    "site:x.com #FichaDeBúsqueda persona desaparecida",
    "site:x.com FichaDeBúsqueda desaparecido México",
  ],
};

const CAMPOS_TWEET = {
  tweet_url: {
    type: ["string", "null"],
    description: "URL directa del tweet/post (x.com/.../status/...).",
  },
  texto_tweet: {
    type: ["string", "null"],
    description: "Texto completo del tweet tal como aparece en la página.",
  },
  fecha_publicacion: {
    type: ["string", "null"],
    description: "Fecha/hora de publicación del tweet en ISO si está visible.",
  },
  autor_handle: {
    type: ["string", "null"],
    description: "Handle del autor (@cuenta) sin el arroba.",
  },
} as const;

/** Esquema para un solo post (búsqueda web o tweet individual). */
const ESQUEMA_PUBLICACION_X = {
  type: "object",
  properties: {
    ...ESQUEMA_EXTRACCION.properties,
    ...CAMPOS_TWEET,
  },
  required: ESQUEMA_EXTRACCION.required,
} as const;

/** Esquema para una página de perfil o hashtag con varios posts visibles. */
const ESQUEMA_PAGINA_X = {
  type: "object",
  properties: {
    publicaciones: {
      type: "array",
      description:
        "Cada tweet/post visible en la página que describa a una persona desaparecida o ficha de búsqueda.",
      items: ESQUEMA_PUBLICACION_X,
    },
  },
  required: ["publicaciones"],
} as const;

const PROMPT_PAGINA_X =
  "Esta página es de X (Twitter): un perfil institucional o un hashtag sobre personas desaparecidas en México. " +
  "Extrae TODAS las publicaciones visibles que describan a una persona reportada como desaparecida o en búsqueda " +
  "(ficha, boletín, alerta). Por cada post incluye el texto del tweet y su URL si la ves. " +
  "Si un post NO trata sobre una persona desaparecida concreta, omítelo del arreglo. " +
  "No inventes datos; usa null en campos no explícitos.";

const PROMPT_BUSQUEDA_X =
  PROMPT_EXTRACCION +
  " Además, si es un post de X, incluye tweet_url, texto_tweet, fecha_publicacion y autor_handle cuando estén disponibles.";

const PAUSA_MS = 1000;
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

function claveDedup(pub: PublicacionX): string {
  return (pub.tweet_url ?? pub.url).toLowerCase();
}

function aPublicacionX(
  datos: Record<string, unknown>,
  urlFallback: string,
): PublicacionX | null {
  if (!datos || typeof datos !== "object") return null;

  const url =
    (typeof datos.tweet_url === "string" && datos.tweet_url.trim()) ||
    (typeof datos.url === "string" && datos.url.trim()) ||
    urlFallback;

  return {
    es_persona_desaparecida: Boolean(datos.es_persona_desaparecida),
    nombre: typeof datos.nombre === "string" ? datos.nombre : null,
    sexo: typeof datos.sexo === "string" ? datos.sexo : null,
    edad: typeof datos.edad === "number" ? datos.edad : null,
    estatura_cm: typeof datos.estatura_cm === "number" ? datos.estatura_cm : null,
    fecha_desaparicion:
      typeof datos.fecha_desaparicion === "string" ? datos.fecha_desaparicion : null,
    estado: typeof datos.estado === "string" ? datos.estado : null,
    municipio: typeof datos.municipio === "string" ? datos.municipio : null,
    tatuajes: typeof datos.tatuajes === "string" ? datos.tatuajes : null,
    senas_particulares:
      typeof datos.senas_particulares === "string" ? datos.senas_particulares : null,
    confianza: typeof datos.confianza === "number" ? datos.confianza : null,
    resumen: typeof datos.resumen === "string" ? datos.resumen : null,
    url,
    tweet_url: typeof datos.tweet_url === "string" ? datos.tweet_url : null,
    texto_tweet: typeof datos.texto_tweet === "string" ? datos.texto_tweet : null,
    fecha_publicacion:
      typeof datos.fecha_publicacion === "string" ? datos.fecha_publicacion : null,
    autor_handle: typeof datos.autor_handle === "string" ? datos.autor_handle : null,
  };
}

/** Scrapea la timeline de un perfil o hashtag y extrae publicaciones estructuradas. */
export async function scrapeFuenteX(
  app: Firecrawl,
  origen: OrigenX,
): Promise<PublicacionX[]> {
  const doc = await app.scrape(origen.url, {
    formats: [{ type: "json", prompt: PROMPT_PAGINA_X, schema: ESQUEMA_PAGINA_X }],
    waitFor: 4000,
    timeout: 90_000,
    actions: [
      { type: "wait", milliseconds: 2000 },
      { type: "scroll", direction: "down" },
      { type: "wait", milliseconds: 1500 },
      { type: "scroll", direction: "down" },
    ],
  });

  const json = (doc as { json?: unknown }).json;
  if (!json || typeof json !== "object") return [];

  const publicaciones = (json as { publicaciones?: unknown }).publicaciones;
  if (!Array.isArray(publicaciones)) return [];

  const resultados: PublicacionX[] = [];
  for (const item of publicaciones) {
    if (!item || typeof item !== "object") continue;
    const pub = aPublicacionX(item as Record<string, unknown>, origen.url);
    if (pub) resultados.push(pub);
  }
  return resultados;
}

/** Busca en la web (x.com) y extrae datos estructurados por resultado. */
export async function buscarEnX(
  app: Firecrawl,
  consulta: string,
  limite: number,
): Promise<PublicacionX[]> {
  const res = await app.search(consulta, {
    sources: ["web"],
    limit: limite,
    location: "Mexico",
    scrapeOptions: {
      formats: [{ type: "json", prompt: PROMPT_BUSQUEDA_X, schema: ESQUEMA_PUBLICACION_X }],
    },
  });

  const docs = [...(res.web ?? [])];
  const resultados: PublicacionX[] = [];

  for (const doc of docs) {
    const datos = (doc as { json?: unknown }).json;
    if (!datos || typeof datos !== "object") continue;

    const meta = (doc as { metadata?: { sourceURL?: string; url?: string } }).metadata;
    const url = meta?.sourceURL ?? meta?.url ?? (doc as { url?: string }).url ?? "";
    if (!url) continue;

    const pub = aPublicacionX(datos as Record<string, unknown>, url);
    if (pub) resultados.push(pub);
  }

  return resultados;
}

export type RecolectarOpciones = {
  limite: number;
  resultadosPorConsulta: number;
  pausaMs?: number;
};

/**
 * Recolecta candidatos desde perfiles/hashtags y búsquedas web en x.com.
 * Deduplica por URL del tweet y respeta el límite global.
 */
export async function recolectarCandidatosX(
  app: Firecrawl,
  opciones: RecolectarOpciones,
): Promise<{ publicaciones: PublicacionX[]; origenPorClave: Map<string, OrigenX> }> {
  const { limite, resultadosPorConsulta, pausaMs = PAUSA_MS } = opciones;
  const vistos = new Set<string>();
  const publicaciones: PublicacionX[] = [];
  const origenPorClave = new Map<string, OrigenX>();

  function agregar(lista: PublicacionX[], origen: OrigenX) {
    for (const pub of lista) {
      if (publicaciones.length >= limite) return;
      const clave = claveDedup(pub);
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      origenPorClave.set(clave, origen);
      publicaciones.push(pub);
    }
  }

  // 1) Scrape directo de cada fuente (timeline / hashtag).
  for (const fuente of FUENTES_X) {
    if (publicaciones.length >= limite) break;
    try {
      const extraidos = await scrapeFuenteX(app, fuente);
      agregar(extraidos, fuente);
    } catch {
      // Firecrawl puede fallar por créditos o bloqueo; seguimos con la siguiente fuente.
    }
    await dormir(pausaMs);
  }

  // 2) Búsquedas web acotadas a x.com por fuente.
  for (const fuente of FUENTES_X) {
    if (publicaciones.length >= limite) break;
    const consultas = CONSULTAS_X[fuente.id] ?? [];
    for (const consulta of consultas) {
      if (publicaciones.length >= limite) break;
      const faltan = limite - publicaciones.length;
      const pedir = Math.min(resultadosPorConsulta, faltan);
      try {
        const extraidos = await buscarEnX(app, consulta, pedir);
        agregar(extraidos, { ...fuente, tipo: "busqueda" });
      } catch {
        // idem
      }
      await dormir(pausaMs);
    }
  }

  return { publicaciones, origenPorClave };
}

/** Alias tipado para compatibilidad con el flujo de `CandidatoPersona`. */
export type { CandidatoPersona };
