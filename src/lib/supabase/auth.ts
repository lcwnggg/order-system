import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Comprobar quién está usando la aplicación.
 *
 * `getUser()` a secas devuelve `user: null` tanto cuando no hay sesión como
 * cuando no se ha podido hablar con Supabase (corte de red, un 5xx, el límite
 * de peticiones). Tratar los dos casos igual es lo que echaba a la calle a
 * gente que sí tenía la sesión bien: un fallo de medio segundo y a la pantalla
 * de acceso. Aquí se separan, y quien llama decide qué hacer con cada uno.
 */
export type AuthCheck =
  /** Sesión confirmada por Supabase. */
  | { status: "signed-in"; user: User }
  /** No hay sesión (o ya no vale): toca acceder de nuevo. */
  | { status: "signed-out"; user: null }
  /** Hay sesión, pero ahora mismo no se ha podido confirmar. No es un adiós. */
  | { status: "unavailable"; user: null };

/** Un corte pasajero merece un segundo intento antes de dar nada por perdido. */
const RETRY_DELAY_MS = 250;

function isTransient(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return true;
  const status = (error as { status?: number } | null)?.status;
  // 429 = demasiadas peticiones; 5xx = el problema lo tienen ellos. Ninguno
  // de los dos significa que esta sesión haya dejado de ser válida.
  return status === 429 || (typeof status === "number" && status >= 500);
}

export async function checkUser(supabase: SupabaseClient): Promise<AuthCheck> {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await supabase.auth.getUser();
    if (data.user) return { status: "signed-in", user: data.user };

    if (!isTransient(error)) return { status: "signed-out", user: null };
    if (attempt >= 1) return { status: "unavailable", user: null };

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
}
