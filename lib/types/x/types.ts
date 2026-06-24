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

/** Datos saneados listos para insertar en `persona`. */
export type SanadoPublicacionX = {
  nombre: string;
  sexo: "Masculino" | "Femenino" | "Indeterminado";
  edad: number | null;
  estatura: number | null;
  fecha: string;
  estado: string | null;
  municipio: string | null;
};
