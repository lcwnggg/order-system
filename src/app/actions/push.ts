"use server";

import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { translateDbError } from "@/lib/i18n/db-errors";
import { pushConfigured, sendPushToUser } from "@/lib/push";

// Suscripción del navegador tal cual la serializa PushSubscription.toJSON()
export type BrowserSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

/** Guarda (o refresca) la suscripción push del usuario que ha iniciado sesión. */
export async function savePushSubscription(
  sub: BrowserSubscription,
  userAgent?: string
): Promise<{ error?: string }> {
  const t = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("common.notLoggedIn") };

  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return { error: t("push.invalidSubscription") };
  }

  // upsert por endpoint: el navegador puede devolver el mismo endpoint tras
  // reinstalar, y entonces solo hay que reapuntarlo al usuario actual.
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      user_agent: userAgent?.slice(0, 300) ?? null,
    },
    { onConflict: "endpoint" }
  );
  if (error) return { error: translateDbError(error.message, t) };

  return {};
}

/** Da de baja este dispositivo. */
export async function deletePushSubscription(endpoint: string): Promise<{ error?: string }> {
  const t = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("common.notLoggedIn") };

  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("user_id", user.id);
  if (error) return { error: translateDbError(error.message, t) };

  return {};
}

/** Aviso de prueba, para comprobar que el móvil lo recibe de verdad. */
export async function sendTestPush(): Promise<{ error?: string; sent?: number }> {
  const t = await getT();
  if (!pushConfigured()) return { error: t("push.notConfigured") };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("common.notLoggedIn") };

  const sent = await sendPushToUser(user.id, {
    title: t("push.testTitle"),
    body: t("push.testBody"),
    url: "/admin/orders",
    tag: "test",
  });
  if (sent === 0) return { error: t("push.noDevices") };
  return { sent };
}
