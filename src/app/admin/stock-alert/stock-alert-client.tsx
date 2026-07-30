"use client";

import { useState, useTransition } from "react";
import {
  adjustStock,
  adjustVariantStock,
  deleteProduct,
} from "@/app/admin/products/actions";
import { useImageLightbox } from "@/app/image-lightbox";
import { useT } from "@/lib/i18n/client";

export type LowStockVariant = { id: string; color: string; stock: number };

export type LowStockProduct = {
  id: string;
  name: string;
  stock: number;
  image_url: string | null;
  is_active: boolean;
  has_variants: boolean;
  variants: LowStockVariant[];
};

export default function StockAlertClient({ list }: { list: LowStockProduct[] }) {
  const t = useT();
  const lightbox = useImageLightbox();

  const [qty, setQty] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();

  function setError(key: string, message: string) {
    setErrors((prev) => ({ ...prev, [key]: message }));
  }

  // Reponer: `delta` = 1 para el botón rápido, null para leer la caja «N»
  function handleAdjust(
    target: { kind: "product" | "variant"; id: string },
    delta: number | null
  ) {
    let d: number;
    if (delta === null) {
      d = parseInt(qty[target.id] ?? "0", 10);
      if (isNaN(d) || d <= 0) return;
    } else {
      d = delta;
    }
    setBusyId(target.id);
    setError(target.id, "");
    startTransition(async () => {
      const result =
        target.kind === "product"
          ? await adjustStock(target.id, d)
          : await adjustVariantStock(target.id, d);
      setBusyId(null);
      if ("error" in result) setError(target.id, result.error);
      else if (delta === null) setQty((prev) => ({ ...prev, [target.id]: "" }));
    });
  }

  function handleDelete(product: LowStockProduct) {
    if (!window.confirm(t("list.confirmDelete", { name: product.name }))) return;
    setDeletingId(product.id);
    setError(product.id, "");
    startTransition(async () => {
      const result = await deleteProduct(product.id);
      setDeletingId(null);
      if ("error" in result)
        setError(product.id, t("list.deleteFailed", { message: result.error }));
    });
  }

  function stockBadge(n: number) {
    return `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium leading-none ${
      n === 0
        ? "bg-red-50 text-red-600"
        : n <= 5
        ? "bg-amber-50 text-amber-600"
        : "bg-green-50 text-green-600"
    }`;
  }

  /** Controles «+1 / N / Sumar» reutilizados por producto y por color */
  function restockControls(target: { kind: "product" | "variant"; id: string }) {
    const busy = busyId === target.id;
    return (
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => handleAdjust(target, 1)}
          className="rounded-lg bg-paper-100 px-2 py-1 text-xs font-medium text-paper-600 transition-colors hover:bg-paper-200 disabled:opacity-40"
        >
          +1
        </button>
        <input
          type="number"
          min="1"
          value={qty[target.id] ?? ""}
          onChange={(e) => setQty((prev) => ({ ...prev, [target.id]: e.target.value }))}
          placeholder="N"
          aria-label={t("stockAlert.qtyLabel")}
          className="w-11 rounded-lg border border-paper-200 px-1.5 py-1 text-xs text-paper-900 outline-none focus:border-paper-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          disabled={busy || !qty[target.id]}
          onClick={() => handleAdjust(target, null)}
          className="rounded-lg bg-paper-100 px-2 py-1 text-xs font-medium text-paper-600 transition-colors hover:bg-paper-200 disabled:opacity-40"
        >
          {busy ? "…" : t("list.addStock")}
        </button>
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-paper-300 bg-white py-20 text-center">
        <p className="text-sm text-paper-500">{t("stockAlert.empty")}</p>
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-2">
        {list.map((product) => {
          const isDeleting = deletingId === product.id;
          const error = errors[product.id];

          return (
            <li
              key={product.id}
              className={`rounded-2xl glass-strong p-3 ${isDeleting ? "opacity-50" : ""}`}
            >
              <div className="flex items-start gap-3">
                {/* Foto: pulsar para verla en grande */}
                {product.image_url ? (
                  <button
                    type="button"
                    onClick={() => lightbox.open(product.image_url, product.name)}
                    title={t("common.viewPhoto", { name: product.name })}
                    className="h-12 w-12 shrink-0 cursor-zoom-in overflow-hidden rounded-xl ring-1 ring-paper-900/10 transition hover:ring-paper-400"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={product.image_url}
                      alt={product.name}
                      className="h-full w-full object-cover"
                    />
                  </button>
                ) : (
                  <div className="h-12 w-12 shrink-0 rounded-xl bg-paper-100" />
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium text-paper-900">{product.name}</span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        product.is_active
                          ? "bg-green-50 text-green-700"
                          : "bg-paper-100 text-paper-500"
                      }`}
                    >
                      {product.is_active ? t("list.active") : t("list.inactive")}
                    </span>
                  </div>

                  {/* Stock + reposición */}
                  {product.has_variants ? (
                    <div className="mt-2 space-y-1.5">
                      {product.variants.length === 0 ? (
                        <span className="text-xs text-paper-500">{t("list.noVariants")}</span>
                      ) : (
                        product.variants.map((v) => (
                          <div key={v.id} className="flex flex-wrap items-center gap-2">
                            <span className="w-16 shrink-0 truncate text-xs text-paper-600">
                              {v.color}
                            </span>
                            <span className={stockBadge(v.stock)}>
                              {v.stock === 0 ? t("common.soldOut") : v.stock}
                            </span>
                            {restockControls({ kind: "variant", id: v.id })}
                            {errors[v.id] && (
                              <span className="text-xs text-red-500">{errors[v.id]}</span>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className={stockBadge(product.stock)}>
                        {product.stock === 0 ? t("common.soldOut") : product.stock}
                      </span>
                      <span className="text-xs text-paper-500">{t("common.units")}</span>
                      {restockControls({ kind: "product", id: product.id })}
                    </div>
                  )}
                </div>

                {/* Eliminar producto */}
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => handleDelete(product)}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-paper-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                >
                  {isDeleting ? t("common.deleting") : t("common.delete")}
                </button>
              </div>

              {error && (
                <p className="mt-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-600">{error}</p>
              )}
            </li>
          );
        })}
      </ul>

      {lightbox.node}
    </>
  );
}
