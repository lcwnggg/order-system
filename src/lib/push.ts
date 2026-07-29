import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

// ─────────────────────────────────────────────────────────────
// Envío de notificaciones push (Web Push / VAPID).
//
// Solo servidor. Lee las suscripciones con la service role key porque quien
// dispara el aviso es la TIENDA que hace el pedido, y una tienda no puede (ni
// debe) leer las suscripciones del almacén: RLS se lo impide, y está bien que
// así sea.
// ─────────────────────────────────────────────────────────────

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/** ¿Están configuradas las claves VAPID? Si no, el push simplemente no existe. */
export function pushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let vapidReady = false;
function ensureVapid() {
  if (vapidReady) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@example.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
  vapidReady = true;
}

/**
 * Envía un aviso a todos los dispositivos de un usuario.
 *
 * Nunca lanza: un fallo mandando la notificación no puede tumbar el pedido que
 * la ha provocado. Devuelve cuántos avisos salieron, para poder registrarlo.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!pushConfigured()) return 0;

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    // Sin service role key no hay forma de leer las suscripciones ajenas.
    return 0;
  }

  const { data, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (error || !data || data.length === 0) return 0;

  ensureVapid();
  const body = JSON.stringify(payload);
  const staleIds: string[] = [];
  let sent = 0;

  await Promise.all(
    (data as SubscriptionRow[]).map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body
        );
        sent++;
      } catch (err) {
        // 404/410 = el navegador tiró la suscripción (app desinstalada, permiso
        // revocado…). Se borra: si no, cada pedido reintentaría un endpoint
        // muerto para siempre.
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) staleIds.push(sub.id);
      }
    })
  );

  if (staleIds.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", staleIds);
  }

  return sent;
}
