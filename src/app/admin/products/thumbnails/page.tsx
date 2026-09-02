import { denyPage, requireRole } from "@/lib/supabase/guard";
import AppShell from "@/app/app-shell";
import { getI18n } from "@/lib/i18n/server";
import ThumbnailsClient from "./thumbnails-client";

export default async function ThumbnailsPage() {
  const { t } = await getI18n();
  const guard = await requireRole("warehouse");
  if ("error" in guard) denyPage(guard, t);
  const { user } = guard;

  return (
    <AppShell email={user.email}>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-paper-900">{t("thumbs.pageTitle")}</h1>
        <p className="mt-1 text-sm text-paper-500">{t("thumbs.pageSubtitle")}</p>
      </div>

      <ThumbnailsClient />
    </AppShell>
  );
}
