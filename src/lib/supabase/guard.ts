import { redirect } from "next/navigation";
import { createClient } from "./server";
import { checkUser } from "./auth";
import type { Translate } from "@/lib/i18n/translate";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export type Role = "warehouse" | "store";

export type GuardProfile = { role: Role; store_name: string | null };

/**
 * Portero común de páginas y server actions.
 *
 * Cada acción se comprueba por su cuenta porque cualquiera puede hacerle un
 * POST directo: el proxy no vale como autorización (y desde que dejó de
 * redirigir los POST de las acciones, menos todavía).
 *
 * Lo que aporta frente al `if (!user) return null` de antes es distinguir tres
 * situaciones que no son la misma: no tienes permiso, no hay sesión, y no se
 * ha podido comprobar. Las tres acababan en «Sin permiso» o en la pantalla de
 * acceso, así que un corte de red mientras se guardaba un producto se leía
 * como «te han echado» cuando bastaba con volver a intentarlo.
 */
export type Guard =
  | { supabase: SupabaseClient; user: User; profile: GuardProfile }
  | { error: "no-permission" }
  | { error: "signed-out" }
  | { error: "unavailable" };

export type GuardError = Extract<Guard, { error: string }>;

export async function requireRole(...roles: Role[]): Promise<Guard> {
  const supabase = await createClient();

  const auth = await checkUser(supabase);
  if (auth.status === "unavailable") return { error: "unavailable" };
  if (auth.status === "signed-out") return { error: "signed-out" };

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, store_name")
    .eq("id", auth.user.id)
    .maybeSingle();

  // Antes este error se tragaba y el usuario acababa en «Sin permiso». No leer
  // el perfil no es no tenerlo: si la consulta falla, se dice que se reintente.
  if (error) return { error: "unavailable" };
  if (!profile || !roles.includes(profile.role as Role)) return { error: "no-permission" };

  return { supabase, user: auth.user, profile: profile as GuardProfile };
}

/** El aviso que ve el usuario para cada motivo de rechazo. */
export function guardMessage(guard: GuardError, t: Translate): string {
  if (guard.error === "unavailable") return t("common.authUnavailable");
  if (guard.error === "signed-out") return t("common.sessionExpired");
  return t("common.noPermission");
}

/**
 * Cierre de una página protegida cuando el portero dice que no.
 *
 * «unavailable» NO manda a la pantalla de acceso: no saber si la sesión vale
 * no es haberla perdido, y mandar ahí a alguien que estaba trabajando es
 * exactamente el fallo que se quería quitar. Se corta con un error, que la
 * página de error deja reintentar sin perder la sesión.
 */
export function denyPage(guard: GuardError, t: Translate, fallback = "/login"): never {
  if (guard.error === "unavailable") throw new Error(guardMessage(guard, t));
  redirect(fallback);
}
