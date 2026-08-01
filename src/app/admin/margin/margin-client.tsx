"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useI18n } from "@/lib/i18n/client";

export type MarginProduct = {
  id: string;
  name: string;
  price: number;
  /** Precio de compra; null cuando no está apuntado. */
  cost: number | null;
  image_url: string | null;
  category_id: string | null;
  brand: string | null;
  stock: number;
};

type CategoryItem = { id: string; name: string; parent_id: string | null };

/** Cantidad elegida por producto. Ausente = no seleccionado. */
type Selection = Record<string, number>;

export default function MarginClient({
  products,
  categories,
}: {
  products: MarginProduct[];
  categories: CategoryItem[];
}) {
  const { tag, t } = useI18n();
  const [selection, setSelection] = useState<Selection>({});
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string>("all");
  const [onlyWithCost, setOnlyWithCost] = useState(false);

  // Desplegable de categorías en plano, con la madre delante para distinguir
  // dos subcategorías que se llamen igual («Fundas» de móvil y de tablet).
  const categoryOptions = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    return categories
      .map((c) => ({
        id: c.id,
        label: c.parent_id
          ? `${byId.get(c.parent_id)?.name ?? "—"} › ${c.name}`
          : c.name,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, tag));
  }, [categories, tag]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Elegir una categoría madre incluye lo que cuelgue de ella: si no, marcar
    // «Fundas» dejaría fuera todos los productos, que están en las hijas.
    const childIds = new Set(
      categories.filter((c) => c.parent_id === categoryId).map((c) => c.id)
    );
    return products.filter((p) => {
      if (onlyWithCost && p.cost === null) return false;
      if (categoryId === "none" && p.category_id) return false;
      if (
        categoryId !== "all" &&
        categoryId !== "none" &&
        p.category_id !== categoryId &&
        !(p.category_id && childIds.has(p.category_id))
      ) {
        return false;
      }
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.brand ?? "").toLowerCase().includes(q)
      );
    });
  }, [products, query, onlyWithCost, categoryId, categories]);

  // Las cuentas se hacen sobre TODO lo seleccionado, no sobre lo que se ve:
  // buscar otra cosa no puede cambiar el total que se está calculando.
  const totals = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p]));
    let revenue = 0;
    let cost = 0;
    let missing = 0;
    let units = 0;
    for (const [id, qty] of Object.entries(selection)) {
      const p = byId.get(id);
      if (!p || qty <= 0) continue;
      units += qty;
      revenue += p.price * qty;
      if (p.cost === null) missing++;
      else cost += p.cost * qty;
    }
    return { revenue, cost, profit: revenue - cost, missing, units };
  }, [selection, products]);

  const selectedCount = Object.values(selection).filter((q) => q > 0).length;
  const marginPct = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0;

  function toggle(p: MarginProduct) {
    setSelection((prev) => {
      const next = { ...prev };
      if (next[p.id] !== undefined) delete next[p.id];
      else next[p.id] = 1;
      return next;
    });
  }

  function setQty(id: string, raw: string) {
    const n = parseInt(raw, 10);
    setSelection((prev) => ({ ...prev, [id]: isNaN(n) || n < 0 ? 0 : n }));
  }

  function selectFiltered() {
    setSelection((prev) => {
      const next = { ...prev };
      for (const p of filtered) if (next[p.id] === undefined) next[p.id] = 1;
      return next;
    });
  }

  /** «¿Y si vendo todo lo que tengo?»: cantidad = stock actual. */
  function useStock() {
    setSelection((prev) => {
      const next = { ...prev };
      for (const p of products) {
        if (next[p.id] !== undefined) next[p.id] = p.stock;
      }
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {/* ── Cuentas, siempre a la vista mientras se elige ── */}
      <div className="sticky top-0 z-10 rounded-2xl border border-amber-200/70 bg-amber-50/90 px-5 py-4 backdrop-blur">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-sm font-semibold text-amber-900">
            {t("money.selectionTitle")}
            <span className="ml-1.5 font-normal text-amber-700">{t("cost.onlyYou")}</span>
          </h2>
          <span className="text-xs text-amber-800">
            {t("money.selectedCount", { n: selectedCount })} · {t("money.units", { n: totals.units })}
          </span>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-white/80 px-3 py-2">
            <p className="text-xs text-paper-500">{t("money.spent")}</p>
            <p className="text-xl font-bold text-paper-900">€{totals.cost.toFixed(2)}</p>
          </div>
          <div className="rounded-lg bg-white/80 px-3 py-2">
            <p className="text-xs text-paper-500">{t("money.revenue")}</p>
            <p className="text-xl font-bold text-paper-900">€{totals.revenue.toFixed(2)}</p>
          </div>
          <div className="rounded-lg bg-white/80 px-3 py-2">
            <p className="text-xs text-paper-500">{t("money.profit")}</p>
            <p className={`text-xl font-bold ${totals.profit >= 0 ? "text-green-700" : "text-red-600"}`}>
              €{totals.profit.toFixed(2)}
              <span className="ml-1.5 text-xs font-medium">
                {t("money.marginPct", { pct: marginPct.toFixed(0) })}
              </span>
            </p>
          </div>
        </div>

        {totals.missing > 0 && (
          <p className="mt-2 text-xs text-amber-800">
            {t("money.missingProducts", { n: totals.missing })}
          </p>
        )}
        {selectedCount === 0 && (
          <p className="mt-2 text-xs text-amber-800">{t("money.emptyHint")}</p>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={selectFiltered}
            className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-50"
          >
            {t("money.selectFiltered", { n: filtered.length })}
          </button>
          <button
            type="button"
            disabled={selectedCount === 0}
            onClick={useStock}
            className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-50 disabled:opacity-40"
          >
            {t("money.useStock")}
          </button>
          <button
            type="button"
            disabled={selectedCount === 0}
            onClick={() => setSelection({})}
            className="rounded-lg border border-paper-200 bg-white px-3 py-1.5 text-xs font-medium text-paper-600 transition-colors hover:text-paper-900 disabled:opacity-40"
          >
            {t("money.clear")}
          </button>
        </div>
      </div>

      {/* ── Filtros ── */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("money.search")}
          className="min-w-[180px] flex-1 rounded-xl border border-paper-200 bg-white px-3 py-2 text-sm text-paper-900 placeholder-paper-400 outline-none focus:border-paper-400"
        />
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="rounded-xl border border-paper-200 bg-white px-3 py-2 text-sm text-paper-900 outline-none focus:border-paper-400"
        >
          <option value="all">{t("common.all")}</option>
          {categoryOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
          <option value="none">{t("common.uncategorized")}</option>
        </select>
        <label className="flex items-center gap-2 rounded-xl border border-paper-200 bg-white px-3 py-2 text-sm text-paper-600">
          <input
            type="checkbox"
            checked={onlyWithCost}
            onChange={(e) => setOnlyWithCost(e.target.checked)}
            className="h-4 w-4 accent-amber-600"
          />
          {t("money.onlyWithCost")}
        </label>
      </div>

      {/* ── Lista ── */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-paper-300 bg-white py-16 text-center">
          <p className="text-sm text-paper-500">{t("money.noResults")}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((p) => {
            const qty = selection[p.id];
            const picked = qty !== undefined;
            const unitProfit = p.cost === null ? null : p.price - p.cost;
            return (
              <li
                key={p.id}
                className={`rounded-2xl p-3 transition-colors ${
                  picked ? "border border-amber-300 bg-amber-50/70" : "glass-strong"
                }`}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={picked}
                    onChange={() => toggle(p)}
                    aria-label={p.name}
                    className="h-4 w-4 shrink-0 accent-amber-600"
                  />

                  {p.image_url ? (
                    <Image
                      src={p.image_url}
                      alt={p.name}
                      width={44}
                      height={44}
                      className="h-11 w-11 shrink-0 rounded-xl object-cover ring-1 ring-paper-900/10"
                    />
                  ) : (
                    <div className="h-11 w-11 shrink-0 rounded-xl bg-paper-100" />
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-paper-900">
                      {p.name}
                      {p.brand && (
                        <span className="ml-1.5 rounded bg-paper-100 px-1.5 py-0.5 text-[11px] font-medium text-paper-600">
                          {p.brand}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-paper-500">
                      {t("money.priceEach", { price: p.price.toFixed(2) })}
                      {" · "}
                      {p.cost === null ? (
                        <span className="text-amber-700">{t("money.noCost")}</span>
                      ) : (
                        <>
                          {t("money.costEach", { cost: p.cost.toFixed(2) })}
                          {" · "}
                          <span className={unitProfit! >= 0 ? "text-green-700" : "text-red-600"}>
                            {t("money.profitShort", { amount: unitProfit!.toFixed(2) })}
                          </span>
                        </>
                      )}
                      {" · "}
                      {t("money.inStock", { n: p.stock })}
                    </p>
                  </div>

                  {picked && (
                    <div className="flex shrink-0 items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        value={qty}
                        onChange={(e) => setQty(p.id, e.target.value)}
                        onFocus={(e) => e.target.select()}
                        aria-label={t("money.qty")}
                        className="w-16 rounded-lg border border-paper-200 px-2 py-1 text-sm text-paper-900 outline-none focus:border-paper-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <span className="w-20 text-right text-sm font-semibold text-paper-900">
                        €{(p.price * (qty || 0)).toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
