"use client";

import { useEffect, useState } from "react";
import { savePushSubscription, deletePushSubscription, sendTestPush } from "@/app/actions/push";
import { useT } from "@/lib/i18n/client";

// ─────────────────────────────────────────────────────────────
// Activar/desactivar los avisos al móvil cuando entra un pedido.
//
// Detalle importante de iOS: Safari solo entrega push si la web está añadida
// a la pantalla de inicio. En un iPhone con Safari normal, `PushManager` ni
// siquiera existe, así que en vez de un botón que no haría nada se muestran
// las instrucciones para instalarla.
// ─────────────────────────────────────────────────────────────

/** La clave VAPID viaja en base64url; el navegador la quiere en bytes. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type Support = "checking" | "ok" | "needs-install" | "unsupported";

export default function PushToggle() {
  const t = useT();
  const [support, setSupport] = useState<Support>("checking");
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isIOS, setIsIOS] = useState(false);

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    let cancelled = false;

    async function check() {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        // Safari en iOS no soporta display-mode: standalone; usa esta propiedad
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

      if (cancelled) return;
      setIsIOS(ios);

      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setSupport(ios && !standalone ? "needs-install" : "unsupported");
        return;
      }

      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        const existing = await registration.pushManager.getSubscription();
        if (cancelled) return;
        setSubscribed(existing !== null);
        setSupport("ok");
      } catch {
        if (!cancelled) setSupport("unsupported");
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubscribe() {
    if (!publicKey) {
      setMessage(t("push.notConfigured"));
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage(t("push.permissionDenied"));
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } };
      if (!json.endpoint || !json.keys) throw new Error("subscription incompleta");

      const res = await savePushSubscription(
        { endpoint: json.endpoint, keys: json.keys },
        navigator.userAgent
      );
      if (res.error) {
        // Si el servidor no la ha podido guardar, deshacer la suscripción del
        // navegador: dejarla activa haría creer que llegarán avisos que no van
        // a llegar nunca.
        await sub.unsubscribe();
        setMessage(res.error);
        return;
      }
      setSubscribed(true);
      setMessage(t("push.enabled"));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("push.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleUnsubscribe() {
    setBusy(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        await deletePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setSubscribed(false);
      setMessage(t("push.disabled"));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("push.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    setBusy(true);
    setMessage(null);
    const res = await sendTestPush();
    setMessage(res.error ?? t("push.testSent"));
    setBusy(false);
  }

  if (support === "checking") return null;

  return (
    <div className="mb-4 rounded-xl border border-paper-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-lg ${
              subscribed ? "bg-green-50 text-green-600" : "bg-paper-100 text-paper-500"
            }`}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </span>
          <div>
            <p className="text-sm font-medium text-paper-900">{t("push.title")}</p>
            <p className="text-xs text-paper-500">
              {support === "ok"
                ? subscribed
                  ? t("push.onThisDevice")
                  : t("push.offThisDevice")
                : support === "needs-install"
                  ? t("push.iosInstallHint")
                  : t("push.unsupported")}
            </p>
          </div>
        </div>

        {support === "ok" && (
          <div className="flex items-center gap-2">
            {subscribed && (
              <button
                type="button"
                onClick={handleTest}
                disabled={busy}
                className="rounded-lg border border-paper-200 px-3 py-1.5 text-xs font-medium text-paper-600 hover:text-paper-900 disabled:opacity-50"
              >
                {t("push.test")}
              </button>
            )}
            <button
              type="button"
              onClick={subscribed ? handleUnsubscribe : handleSubscribe}
              disabled={busy}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                subscribed
                  ? "border border-paper-200 text-paper-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                  : "bg-paper-700 text-white hover:bg-paper-800"
              }`}
            >
              {busy ? t("common.processing") : subscribed ? t("push.disable") : t("push.enable")}
            </button>
          </div>
        )}
      </div>

      {/* En iOS hay que añadirla a la pantalla de inicio; sin eso no hay push. */}
      {support === "needs-install" && isIOS && (
        <p className="mt-2 rounded-lg bg-paper-50 px-3 py-2 text-xs text-paper-600">
          {t("push.iosSteps")}
        </p>
      )}

      {message && <p className="mt-2 text-xs text-paper-600">{message}</p>}
    </div>
  );
}
