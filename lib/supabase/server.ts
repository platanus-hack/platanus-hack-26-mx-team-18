import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Cliente de Supabase para usar en el SERVIDOR (Server Components,
 * Server Actions y Route Handlers en app/api).
 *
 * Lee la sesión del usuario desde las cookies, así RLS sabe
 * quién está haciendo la petición.
 *
 * Ej: const supabase = await createClient();
 *     const { data } = await supabase.from("tabla").select();
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll se llamó desde un Server Component.
            // Se puede ignorar si el middleware refresca la sesión.
          }
        },
      },
    },
  );
}
