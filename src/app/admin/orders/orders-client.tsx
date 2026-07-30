"use client";

import { useMemo, useState, useTransition } from "react";
import { updateOrderStatus, deleteOrder, renameOrder } from "./actions";
import { useImageLightbox } from "@/app/image-lightbox";
import { useI18n } from "@/lib/i18n/client";
import { formatDateTime } from "@/lib/i18n/datetime";
import type { TranslationKey } from "@/lib/i18n/dictionaries";
import type { Translate } from "@/lib/i18n/translate";

type Product = {
  id: string;
  name: string;
  price: number;
  category_id: string | null;
  brand: string | null;
  image_url: string | null;
};
type CategoryItem = { id: string; name: string; parent_id: string | null };
export type OrderItem = { id: string; quantity: number; product: Product; unitPrice: number; variantColor: string | null };
export type Order = {
  id: string;
  store_id: string;
  storeName: string | null;
  storeEmail: string | null;
  status: "pending" | "preparing" | "done" | "cancelled";
  created_at: string;
  note: string | null;
  title: string | null;
  items: OrderItem[];
};

type FilterValue = "all" | "pending" | "preparing" | "done" | "cancelled";
type SummaryView = "product" | "store";

const STATUS_KEY: Record<string, TranslationKey> = {
  pending: "orderStatus.pending",
  preparing: "orderStatus.preparing",
  done: "orderStatus.done",
  cancelled: "orderStatus.cancelled",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-ember-50 text-ember-700",
  preparing: "bg-blue-50 text-blue-700",
  done: "bg-green-50 text-green-700",
  cancelled: "bg-paper-100 text-paper-500",
};

const STATUS_DOT: Record<string, string> = {
  pending: "bg-ember-500",
  preparing: "bg-blue-500",
  done: "bg-green-500",
  cancelled: "bg-paper-400",
};

function displayStore(order: Order, t: Translate): string {
  return (
    order.storeName ??
    order.storeEmail ??
    t("adminOrders.storeFallback", { id: order.store_id.slice(0, 8) })
  );
}

/** Titular de la tarjeta: el nombre que le haya puesto el almacén, o la tienda. */
function displayTitle(order: Order, t: Translate): string {
  return order.title?.trim() || displayStore(order, t);
}

// Los pedidos ya despachados o cancelados llegan plegados: lo que interesa de
// un vistazo es lo que queda por preparar.
function defaultOpen(status: Order["status"]): boolean {
  return status === "pending" || status === "preparing";
}

// 商品名（带颜色变体），用于明细展示与按商品聚合
function itemLabel(item: OrderItem): string {
  return item.variantColor ? `${item.product.name} · ${item.variantColor}` : item.product.name;
}

// 打印单是手工拼的 HTML 字符串，商品名/门店名/分类名都来自数据库。
// 不转义的话，一个叫「Cable USB <tipo C>」的商品会把后面的标签结构冲掉，
// 打印出来直接少一块内容（也顺带堵住把标记塞进打印页的可能）。
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Miniatura del producto: al pasar el ratón se agranda (CSS puro, sin estado)
 * y al pulsar se abre a tamaño completo — que es la única vía que funciona en
 * el móvil, donde no hay «pasar el ratón por encima».
 */
function ProductThumb({
  item,
  onOpen,
  alt,
}: {
  item: OrderItem;
  onOpen: () => void;
  alt: string;
}) {
  const url = item.product.image_url;
  if (!url) {
    return (
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-paper-100 text-paper-400">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M3 16l5-5 4 4 3-3 6 6M4 4h16v16H4z" />
        </svg>
      </div>
    );
  }
  return (
    <div className="group relative shrink-0">
      <button
        type="button"
        onClick={onOpen}
        className="block h-11 w-11 overflow-hidden rounded-lg ring-1 ring-paper-200 transition hover:ring-paper-400"
        aria-label={alt}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={alt} className="h-full w-full object-cover" loading="lazy" />
      </button>
      {/* Vista ampliada al pasar por encima. pointer-events-none para que no
          se coma el clic del propio botón que la ha abierto. */}
      <div className="pointer-events-none absolute left-full top-0 z-30 ml-2 hidden group-hover:block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt}
          className="h-48 w-48 rounded-xl bg-white object-contain shadow-2xl ring-1 ring-paper-200"
        />
      </div>
    </div>
  );
}

export default function OrdersClient({ orders, categories }: { orders: Order[]; categories: CategoryItem[] }) {
  const { locale, tag, t } = useI18n();
  const [filter, setFilter] = useState<FilterValue>("all");
  const [summaryView, setSummaryView] = useState<SummaryView>("product");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Plegado: solo se guardan los pedidos cuya visibilidad se ha tocado a mano;
  // el resto sigue la regla por estado (defaultOpen).
  const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const lightbox = useImageLightbox();
  const [, startTransition] = useTransition();

  const filtered = useMemo(
    () => (filter === "all" ? orders : orders.filter((o) => o.status === filter)),
    [orders, filter]
  );

  const pendingOrders = useMemo(() => orders.filter((o) => o.status === "pending"), [orders]);

  // 按商品合并
  const productSummary = useMemo(() => {
    const map = new Map<string, number>();
    for (const order of pendingOrders) {
      for (const item of order.items) {
        const label = itemLabel(item);
        map.set(label, (map.get(label) ?? 0) + item.quantity);
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [pendingOrders]);

  // 按门店分组
  const storeGroups = useMemo(() => {
    const groups = new Map<
      string,
      { storeLabel: string; orderCount: number; products: Map<string, number> }
    >();
    for (const order of pendingOrders) {
      const key = order.store_id;
      if (!groups.has(key)) {
        groups.set(key, {
          storeLabel: displayStore(order, t),
          orderCount: 0,
          products: new Map(),
        });
      }
      const g = groups.get(key)!;
      g.orderCount++;
      for (const item of order.items) {
        const label = itemLabel(item);
        g.products.set(label, (g.products.get(label) ?? 0) + item.quantity);
      }
    }
    // key 用 store_id 而不是店名：两家门店重名时用店名当 React key 会撞车
    return Array.from(groups.entries()).map(([storeId, g]) => ({
      storeId,
      storeLabel: g.storeLabel,
      orderCount: g.orderCount,
      products: Array.from(g.products.entries()).sort((a, b) => b[1] - a[1]),
    }));
  }, [pendingOrders, t]);

  function handlePrint() {
    const dateStr = new Date().toLocaleDateString(tag, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    // Build product → { total, brand, image, categoryId, stores }
    const productMap = new Map<
      string,
      {
        name: string;
        brand: string | null;
        imageUrl: string | null;
        total: number;
        categoryId: string | null;
        stores: Map<string, number>;
      }
    >();
    for (const order of pendingOrders) {
      const storeName = displayStore(order, t);
      for (const item of order.items) {
        const key = item.variantColor ? `${item.product.id}-${item.variantColor}` : item.product.id;
        if (!productMap.has(key)) {
          productMap.set(key, {
            name: itemLabel(item),
            brand: item.product.brand,
            imageUrl: item.product.image_url,
            total: 0,
            categoryId: item.product.category_id,
            stores: new Map(),
          });
        }
        const p = productMap.get(key)!;
        p.total += item.quantity;
        p.stores.set(storeName, (p.stores.get(storeName) ?? 0) + item.quantity);
      }
    }

    // Category label helper
    function catLabel(catId: string | null): { parent: string; child: string } {
      const none = t("common.uncategorized");
      if (!catId) return { parent: none, child: "" };
      const cat = categories.find((c) => c.id === catId);
      if (!cat) return { parent: none, child: "" };
      if (!cat.parent_id) return { parent: cat.name, child: "" };
      const par = categories.find((c) => c.id === cat.parent_id);
      return { parent: par?.name ?? none, child: cat.name };
    }

    // Sort by parent category → child category → product name
    const rows = [...productMap.values()].sort((a, b) => {
      const la = catLabel(a.categoryId);
      const lb = catLabel(b.categoryId);
      const pc = la.parent.localeCompare(lb.parent, tag);
      if (pc !== 0) return pc;
      const cc = la.child.localeCompare(lb.child, tag);
      if (cc !== 0) return cc;
      return a.name.localeCompare(b.name, tag);
    });

    // Cada referencia es un bloque y los bloques van en columnas (ver el CSS:
    // se meten tantas como quepan a lo ancho de la hoja). Todo lo secundario
    // —subcategoría y desglose por tienda— va en la misma línea para no gastar
    // renglones: así no queda media hoja en blanco a la derecha.
    let lastParent = "";
    const itemsHtml = rows
      .map((p) => {
        const { parent, child } = catLabel(p.categoryId);
        // El espacio entre etiquetas es necesario: sin él la línea no tiene por
        // dónde cortar y el desglose se sale de la columna.
        const storeDetail = [...p.stores.entries()]
          .map(([s, q]) => `<span class="store-tag">${escapeHtml(s)}×${q}</span>`)
          .join(" ");
        let header = "";
        if (parent !== lastParent) {
          lastParent = parent;
          header = `<div class="cat">${escapeHtml(parent)}</div>`;
        }
        const thumb = p.imageUrl
          ? `<img class="thumb" src="${escapeHtml(p.imageUrl)}" alt="">`
          : `<div class="thumb no-img"></div>`;
        const brand = p.brand ? `<span class="brand">${escapeHtml(p.brand)}</span>` : "";
        const meta = child ? `<span class="cname">${escapeHtml(child)}</span>` : "";
        return `${header}<div class="item">
${thumb}
<div class="info"><span class="pname">${escapeHtml(p.name)}</span>${brand} <span class="meta">${meta}${storeDetail}</span></div>
<div class="qty">${p.total}</div></div>`;
      })
      .join("");

    const html = `<!DOCTYPE html><html lang="${tag}"><head><meta charset="utf-8">
<title>${t("print.title")} ${dateStr}</title>
<style>
@page{size:A4 portrait;margin:8mm 7mm}
*{box-sizing:border-box}
body{font-family:sans-serif;margin:0;color:#111;font-size:11px;
  -webkit-print-color-adjust:exact;print-color-adjust:exact}
/* Cabecera en una sola línea, pegada al primer producto */
.head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;
  border-bottom:1.2px solid #111;padding-bottom:3px;margin-bottom:4px}
h1{font-size:13px;margin:0;letter-spacing:-.01em}
.sub{color:#555;font-size:9px;text-align:right}
/* Se meten tantas columnas como quepan (mínimo 58 mm cada una): 3 en A4
   vertical, 4 en horizontal. Así no sobra ancho de papel sin usar. */
.cols{columns:58mm;column-gap:5mm;column-rule:1px solid #eceef2}
.cat{break-inside:avoid;break-after:avoid;page-break-after:avoid;
  font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#4b5563;
  background:#eceef2;border-radius:2px;padding:1px 4px;margin:4px 0 1px}
.cat:first-child{margin-top:0}
.item{display:flex;align-items:flex-start;gap:4px;padding:2px 0;
  border-bottom:1px solid #e5e7eb;break-inside:avoid;page-break-inside:avoid}
.thumb{width:26px;height:26px;flex:0 0 26px;object-fit:cover;border-radius:3px;
  border:1px solid #e5e7eb;background:#fff}
.thumb.no-img{background:#f3f4f6}
.info{flex:1;min-width:0;line-height:1.35;overflow-wrap:anywhere}
.pname{font-weight:600;font-size:10px}
/* Marca, subcategoría y tiendas siguen el flujo del nombre: rellenan el hueco
   que quede a la derecha en vez de abrir un renglón nuevo cada una. */
.brand{font-size:8px;font-weight:600;color:#374151;background:#eef2f7;
  padding:0 3px;border-radius:2px;margin-left:3px;white-space:nowrap}
.meta{font-size:8px;color:#6b7280;margin-left:3px}
.cname{color:#9ca3af;margin-right:3px;white-space:nowrap}
.store-tag{background:#f3f4f6;color:#374151;padding:0 4px;border-radius:999px;
  margin-right:2px;white-space:nowrap}
.qty{flex:0 0 auto;font-weight:700;font-size:13px;line-height:1.15;white-space:nowrap;padding-left:3px}
</style></head><body>
<div class="head">
<h1>${t("print.title")}</h1>
<div class="sub">${t("print.generated", { date: dateStr })} · ${t("print.pendingOrders", {
      n: pendingOrders.length,
    })} · ${t("print.productKinds", { n: rows.length })}</div>
</div>
<div class="cols">${itemsHtml}</div>
</body></html>`;

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(html);
    win.document.close();

    // Las miniaturas vienen de Supabase por red. Si se llama a print() sin
    // esperarlas, el diálogo sale con los huecos vacíos. Se sondea hasta que
    // todas estén resueltas, con tope de 8 s para no dejar a la usuaria
    // colgada si una imagen no carga (se imprime igual, sin esa foto).
    const deadline = Date.now() + 8000;
    const tryPrint = () => {
      try {
        const images = Array.from(win.document.images);
        const settled = images.every((img) => img.complete);
        if (settled || Date.now() > deadline) win.print();
        else win.setTimeout(tryPrint, 150);
      } catch {
        /* la ventana se ha cerrado antes de imprimir */
      }
    };
    win.setTimeout(tryPrint, 120);
  }

  function handleUpdateStatus(orderId: string, newStatus: "preparing" | "done") {
    setPendingId(orderId);
    setActionError(null);
    startTransition(async () => {
      const res = await updateOrderStatus(orderId, newStatus);
      setPendingId(null);
      if (res.error) setActionError(res.error);
    });
  }

  function handleDelete(orderId: string) {
    if (!window.confirm(t("adminOrders.confirmDelete"))) return;
    setDeletingId(orderId);
    setActionError(null);
    startTransition(async () => {
      const res = await deleteOrder(orderId);
      setDeletingId(null);
      if (res.error) setActionError(res.error);
    });
  }

  function handleRenameSubmit(orderId: string) {
    const value = renameValue;
    setRenamingId(null);
    setActionError(null);
    startTransition(async () => {
      const res = await renameOrder(orderId, value);
      if (res.error) setActionError(res.error);
    });
  }

  function toggleOpen(order: Order) {
    setOpenOverrides((prev) => ({
      ...prev,
      [order.id]: !(prev[order.id] ?? defaultOpen(order.status)),
    }));
  }

  function setAllOpen(open: boolean) {
    setOpenOverrides((prev) => {
      const next = { ...prev };
      for (const o of filtered) next[o.id] = open;
      return next;
    });
  }

  function orderTotal(items: OrderItem[]) {
    return items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  }

  const filterTabs: { value: FilterValue; label: string }[] = [
    { value: "all", label: t("common.all") },
    { value: "pending", label: t("orderStatus.pending") },
    { value: "preparing", label: t("orderStatus.preparing") },
    { value: "done", label: t("orderStatus.done") },
    { value: "cancelled", label: t("orderStatus.cancelled") },
  ];

  return (
    <div className="space-y-6">
      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {actionError}
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="ml-3 text-red-400 hover:text-red-600"
          >
            ×
          </button>
        </div>
      )}

      {/* ── 待备货汇总 ── */}
      <div className="rounded-xl border border-ember-200 bg-ember-50 overflow-hidden">
        {/* 汇总标题 + 视图切换 */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
          <h2 className="text-sm font-semibold text-ember-800">
            {t("adminOrders.summaryTitle")}
            <span className="ml-2 font-normal text-ember-600">
              {t("adminOrders.summaryCount", { n: pendingOrders.length })}
            </span>
          </h2>
          <div className="flex items-center gap-2">
            {pendingOrders.length > 0 && (
              <button
                type="button"
                onClick={handlePrint}
                className="rounded-lg border border-ember-200 bg-white px-3 py-1.5 text-xs font-medium text-ember-700 transition-colors hover:bg-ember-50"
              >
                {t("adminOrders.print")}
              </button>
            )}
            <div className="flex gap-1 rounded-lg border border-ember-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setSummaryView("product")}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  summaryView === "product"
                    ? "bg-ember-600 text-white"
                    : "text-ember-700 hover:bg-ember-50"
                }`}
              >
                {t("adminOrders.byProduct")}
              </button>
              <button
                type="button"
                onClick={() => setSummaryView("store")}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  summaryView === "store"
                    ? "bg-ember-600 text-white"
                    : "text-ember-700 hover:bg-ember-50"
                }`}
              >
                {t("adminOrders.byStore")}
              </button>
            </div>
          </div>
        </div>

        <div className="px-5 pb-4">
          {pendingOrders.length === 0 ? (
            <p className="text-sm text-ember-600">{t("adminOrders.noPending")}</p>
          ) : summaryView === "product" ? (
            /* 按商品汇总 */
            <div className="flex flex-wrap gap-2">
              {productSummary.map(([name, qty]) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-paper-800 ring-1 ring-ember-200"
                >
                  <span>{name}</span>
                  <span className="rounded-full bg-ember-100 px-1.5 py-0.5 text-xs font-bold text-ember-700">
                    ×{qty}
                  </span>
                </span>
              ))}
            </div>
          ) : (
            /* 按门店分组 */
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {storeGroups.map((group) => (
                <div
                  key={group.storeId}
                  className="rounded-lg bg-white p-3 ring-1 ring-ember-200"
                >
                  <p className="mb-2 text-xs font-semibold text-paper-800">
                    {group.storeLabel}
                    <span className="ml-1.5 font-normal text-paper-500">
                      {t("adminOrders.storeOrderCount", { n: group.orderCount })}
                    </span>
                  </p>
                  <ul className="space-y-1">
                    {group.products.map(([name, qty]) => (
                      <li key={name} className="flex items-center justify-between text-xs">
                        <span className="text-paper-600">{name}</span>
                        <span className="font-bold text-ember-700">×{qty}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 筛选 tabs + 全部展开/收起 ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-fit gap-1 rounded-xl border border-paper-200 bg-white p-1">
          {filterTabs.map(({ value, label }) => {
            const count =
              value === "all" ? orders.length : orders.filter((o) => o.status === value).length;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                  filter === value ? "bg-paper-700 text-white" : "text-paper-500 hover:text-paper-900"
                }`}
              >
                {label}
                <span className={`ml-1.5 text-xs ${filter === value ? "text-paper-400" : "text-paper-500"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        {filtered.length > 0 && (
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setAllOpen(true)}
              className="rounded-lg border border-paper-200 bg-white px-3 py-1.5 text-xs font-medium text-paper-600 hover:text-paper-900"
            >
              {t("adminOrders.expandAll")}
            </button>
            <button
              type="button"
              onClick={() => setAllOpen(false)}
              className="rounded-lg border border-paper-200 bg-white px-3 py-1.5 text-xs font-medium text-paper-600 hover:text-paper-900"
            >
              {t("adminOrders.collapseAll")}
            </button>
          </div>
        )}
      </div>

      {/* ── 订单列表 ── */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-paper-300 bg-white py-16 text-center">
          <p className="text-sm text-paper-500">
            {filter === "all"
              ? t("adminOrders.emptyAll")
              : t("adminOrders.emptyFiltered", { status: t(STATUS_KEY[filter]) })}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((order) => {
            const total = orderTotal(order.items);
            const isThisPending = pendingId === order.id;
            const isOpen = openOverrides[order.id] ?? defaultOpen(order.status);
            const isRenaming = renamingId === order.id;
            return (
              <div
                key={order.id}
                className="overflow-hidden rounded-2xl glass-strong transition duration-200"
              >
                {/* Cabecera: nombre + estado + acción principal a la derecha */}
                <div className="flex items-start gap-3 px-5 py-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-paper-100 text-sm font-semibold text-paper-700">
                    {displayTitle(order, t).charAt(0)}
                  </div>

                  <div className="min-w-0 flex-1">
                    {isRenaming ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          autoFocus
                          value={renameValue}
                          maxLength={80}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRenameSubmit(order.id);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          placeholder={t("adminOrders.namePlaceholder")}
                          className="min-w-0 flex-1 rounded-lg border border-paper-300 px-2.5 py-1 text-sm text-paper-900 outline-none focus:border-paper-500 focus:ring-2 focus:ring-paper-300"
                        />
                        <button
                          type="button"
                          onClick={() => handleRenameSubmit(order.id)}
                          className="rounded-lg bg-paper-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-paper-800"
                        >
                          {t("common.save")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenamingId(null)}
                          className="rounded-lg px-2 py-1 text-xs font-medium text-paper-500 hover:text-paper-900"
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-paper-900">
                          {displayTitle(order, t)}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(order.id);
                            setRenameValue(order.title ?? "");
                          }}
                          className="rounded p-1 text-paper-400 transition-colors hover:bg-paper-100 hover:text-paper-700"
                          aria-label={t("adminOrders.rename")}
                          title={t("adminOrders.rename")}
                        >
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[order.status]}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[order.status]}`} />
                          {t(STATUS_KEY[order.status])}
                        </span>
                      </div>
                    )}
                    <p className="mt-0.5 truncate text-xs text-paper-500">
                      {order.title ? `${displayStore(order, t)} · ` : ""}
                      {formatDateTime(order.created_at, locale)} · {t("adminOrders.itemCount", { n: order.items.length })} · #{order.id.slice(0, 8)}
                    </p>
                  </div>

                  {/* Acciones arriba a la derecha: el botón de preparar es lo que
                      más se pulsa, no tiene sentido tenerlo al final del pedido. */}
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="text-base font-bold text-paper-900">€{total.toFixed(2)}</span>
                    {order.status === "pending" && (
                      <button
                        type="button"
                        disabled={isThisPending}
                        onClick={() => handleUpdateStatus(order.id, "preparing")}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>
                        {isThisPending ? t("common.processing") : t("adminOrders.startPreparing")}
                      </button>
                    )}
                    {order.status === "preparing" && (
                      <button
                        type="button"
                        disabled={isThisPending}
                        onClick={() => handleUpdateStatus(order.id, "done")}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                        {isThisPending ? t("common.processing") : t("adminOrders.markDone")}
                      </button>
                    )}
                    {(order.status === "done" || order.status === "cancelled") && (
                      <button
                        type="button"
                        disabled={deletingId === order.id}
                        onClick={() => handleDelete(order.id)}
                        className="rounded-lg border border-paper-200 px-3.5 py-1.5 text-xs font-medium text-paper-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      >
                        {deletingId === order.id ? t("common.deleting") : t("common.delete")}
                      </button>
                    )}
                  </div>
                </div>

                {order.note && (
                  <div className="border-t border-paper-100 bg-ember-50/60 px-5 py-2 text-xs text-ember-800">
                    {t("adminOrders.note")}{order.note}
                  </div>
                )}

                {/* Barra de plegado */}
                <button
                  type="button"
                  onClick={() => toggleOpen(order)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-2 border-t border-paper-100 px-5 py-2 text-xs font-medium text-paper-500 transition-colors hover:bg-paper-50 hover:text-paper-900"
                >
                  <svg
                    className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  {isOpen ? t("common.collapse") : t("common.expand")}
                  <span className="text-paper-400">
                    · {t("adminOrders.itemCount", { n: order.items.length })}
                  </span>
                </button>

                {isOpen && (
                  <div className="divide-y divide-paper-100 border-t border-paper-100 px-5">
                    {order.items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 py-2.5 text-sm"
                      >
                        <ProductThumb
                          item={item}
                          alt={t("adminOrders.viewPhoto", { name: item.product.name })}
                          onOpen={() => lightbox.open(item.product.image_url, itemLabel(item))}
                        />
                        <span className="min-w-0 flex-1 text-paper-700">
                          {item.product.name}
                          {item.variantColor && (
                            <span className="ml-1 text-paper-500">· {item.variantColor}</span>
                          )}
                          {item.product.brand && (
                            <span className="ml-1.5 rounded bg-paper-100 px-1.5 py-0.5 text-[11px] font-medium text-paper-600">
                              {item.product.brand}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-paper-500">
                          €{Number(item.unitPrice).toFixed(2)} × {item.quantity}
                        </span>
                        <span className="w-20 shrink-0 text-right font-medium text-paper-900">
                          €{(item.unitPrice * item.quantity).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Foto a tamaño completo (la vía que funciona en el móvil) */}
      {lightbox.node}
    </div>
  );
}
