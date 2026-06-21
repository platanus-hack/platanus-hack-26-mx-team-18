import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";

/**
 * Cliente de Supabase con permiso de ADMINISTRADOR (service_role).
 *
 * ⚠️  SOLO para usar en scripts/procesos de servidor de confianza
 *     (como el scraper). NUNCA lo importes en componentes del navegador.
 *
 * Tu RLS deja que cualquiera LEA, pero solo usuarios logueados ESCRIBAN.
 * El scraper no es un usuario logueado, así que usa la "service_role key",
 * que salta el RLS para poder insertar datos. Esa key es secreta y vive
 * solo en .env.local (que está en .gitignore: nunca se sube a git).
 *
 * Esto NO rompe tu modelo de seguridad: la API pública sigue protegida por
 * RLS; esta llave solo la usa tu backend de confianza.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Faltan variables de entorno: NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY.\n" +
        "Copia la 'service_role key' desde Supabase > Project Settings > API y ponla en .env.local.",
    );
  }

  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
