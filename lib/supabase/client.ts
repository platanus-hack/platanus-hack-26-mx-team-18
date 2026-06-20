import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente de Supabase para usar en el NAVEGADOR (Client Components).
 * Úsalo en componentes con "use client".
 *
 * Ej: const supabase = createClient();
 *     const { data } = await supabase.from("tabla").select();
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
