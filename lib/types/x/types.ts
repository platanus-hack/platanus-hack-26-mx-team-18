import type { CandidatoPersona } from "@/lib/firecrawl/client";

/** Cuenta, hashtag o búsqueda de X de donde salió la publicación. */
export type OrigenX = {
  id: string;
  url: string;
  tipo: "perfil" | "hashtag" | "busqueda";
};

/** Datos extraídos de un post de X + metadatos del tweet. */
export type PublicacionX = CandidatoPersona & {
  tweet_url: string | null;
  texto_tweet: string | null;
  /** Fecha del post en ISO (YYYY-MM-DD o YYYY-MM-DDTHH:mm:ss). */
  fecha_publicacion: string | null;
  autor_handle: string | null;
};

/** Resultado de validación antes de insertar en `persona`. */
export type ValidacionCandidatoX = {
  valido: boolean;
  motivo_descarte: string | null;
};

/** Vista previa de una fila `persona` lista para revisión humana. */
export type PersonaPreviewX = {
  fuente: "x";
  fuente_id: string;
  nombre: string;
  sexo: "Masculino" | "Femenino" | "Indeterminado";
  edad: number | null;
  estatura: number | null;
  fecha_desaparicion: string;
  estado: string | null;
  municipio: string | null;
  rasgos: {
    tatuajes: string | null;
    senas_particulares: string | null;
    _meta: {
      x: {
        origen_id: string;
        origen_tipo: OrigenX["tipo"];
        tweet_url: string | null;
        texto_tweet: string | null;
        fecha_publicacion: string | null;
        autor_handle: string | null;
        confianza: number | null;
        resumen: string | null;
      };
    };
  };
};

/** Un registro de la muestra de verificación (fase 1, sin BD). */
export type MuestraX = {
  indice: number;
  origen: OrigenX;
  extraccion: PublicacionX;
  validacion: ValidacionCandidatoX;
  persona_preview: PersonaPreviewX | null;
};

/** Archivo completo que escribe `scrape-x`. */
export type ArchivoMuestraX = {
  generado_en: string;
  limite: number;
  total: number;
  fuentes: OrigenX[];
  muestras: MuestraX[];
};
