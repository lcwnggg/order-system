import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";
import LanguageSwitcher from "@/app/language-switcher";
import { getI18n } from "@/lib/i18n/server";
import ShopClient from "./shop-client";

export default async function ShopPage() {
  const { t } = await getI18n();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role === "warehouse") redirect("/admin/products");
  if (profile?.role !== "store") redirect("/login");

  const [{ data: products }, { data: categoriesData }, { data: lastOrders }, { data: variantsData }] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, description, price, stock, image_url, category_id, has_variants, brand, created_at, barcode")
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
    supabase
      .from("categories")
      .select("id, name, parent_id")
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("orders")
      .select("order_items(product_id, variant_id, quantity)")
      .eq("store_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("product_variants")
      .select("id, product_id, color, stock, sort_order")
      .order("sort_order"),
  ]);

  const lastOrderItems =
    (lastOrders?.[0]?.order_items ?? []) as { product_id: string; variant_id: string | null; quantity: number }[];

  const parentCatCount = (categoriesData ?? []).filter((c) => c.parent_id === null).length;

  return (
    <div className="relative min-h-screen p-3 sm:p-5">
      <div className="app-bg" />
      <div className="app-grain" />

      <div className="glass-flat mx-auto min-h-[calc(100vh-1.5rem)] max-w-[1360px] overflow-hidden rounded-[26px] sm:min-h-[calc(100vh-2.5rem)]">
      <header className="border-b border-white/50 bg-white/30 px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-sm text-paper-500 transition-colors hover:text-paper-900"
            >
              {t("shop.backHome")}
            </Link>
            <span className="text-paper-400">/</span>
            <span className="text-sm font-semibold text-paper-900">{t("shop.title")}</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Link
              href="/shop/orders"
              className="rounded-lg border border-white/50 bg-white/40 px-3 py-1.5 text-sm text-paper-700 transition-colors hover:bg-white/70"
            >
              {t("nav.myOrders")}
            </Link>
            <span className="hidden text-sm text-paper-500 sm:block">{user.email}</span>
            <LanguageSwitcher className="text-paper-600" />
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border border-white/50 bg-white/40 px-3 py-1.5 text-sm text-paper-700 transition-colors hover:bg-white/70"
              >
                {t("auth.signOut")}
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* 玻璃欢迎横幅：标题 + 快捷数据 + 虹彩球（参考 Streamxy 促销卡） */}
      <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
        <div className="glass-strong relative flex items-center justify-between gap-4 overflow-hidden rounded-[24px] px-6 py-7 sm:px-8">
          <div className="relative z-10">
            <p className="animate-fade-in font-mono text-[11px] uppercase tracking-[0.24em] text-paper-500">
              {t("shop.heroEyebrow", { n: products?.length ?? 0 })}
            </p>
            <h1 className="animate-fade-up mt-3 text-3xl font-semibold tracking-tight text-paper-900 sm:text-4xl">
              {t("shop.heroTitle")}
            </h1>
            <div className="animate-fade-up mt-4 flex flex-wrap gap-2 [animation-delay:150ms]">
              <span className="rounded-full bg-white/55 px-3 py-1.5 text-xs font-medium text-paper-600">
                <span className="font-mono tabular-nums text-paper-900">{products?.length ?? 0}</span> {t("shop.chipProducts")}
              </span>
              <span className="rounded-full bg-white/55 px-3 py-1.5 text-xs font-medium text-paper-600">
                <span className="font-mono tabular-nums text-paper-900">{parentCatCount}</span> {t("shop.chipCategories")}
              </span>
              {lastOrderItems.length > 0 && (
                <span className="rounded-full bg-accent-50 px-3 py-1.5 text-xs font-medium text-accent-600">
                  {t("shop.chipRepeat", { n: lastOrderItems.length })}
                </span>
              )}
            </div>
          </div>
          <div className="iri-ball hidden h-28 w-28 shrink-0 sm:block" aria-hidden />
        </div>
      </div>

      <ShopClient
        products={products ?? []}
        categories={(categoriesData ?? []) as { id: string; name: string; parent_id: string | null }[]}
        lastOrderItems={lastOrderItems}
        variants={(variantsData ?? []) as { id: string; product_id: string; color: string; stock: number; sort_order: number }[]}
      />
      </div>
    </div>
  );
}
