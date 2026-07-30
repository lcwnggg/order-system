"use client";

import { useState } from "react";
import TagPicker, { canonicalTag } from "./tag-picker";
import { useT } from "@/lib/i18n/client";

/**
 * Bloque privado: a cuánto lo compro y a quién.
 *
 * Se guarda en `product_costs`, tabla con RLS de solo-almacén: las tiendas no
 * reciben ni una fila, ni desde la interfaz ni consultando la base de datos por
 * su cuenta. Por eso el aviso «solo tú ves esto» del encabezado es literal.
 */
export default function PrivateCostFields({
  costPrice,
  onCostPrice,
  supplier,
  onSupplier,
  note,
  onNote,
  supplierOptions,
  salePrice,
  /** En el formulario de alta (FormData) hacen falta inputs ocultos. */
  withHiddenInputs = false,
  defaultOpen = false,
}: {
  costPrice: string;
  onCostPrice: (v: string) => void;
  supplier: string;
  onSupplier: (v: string) => void;
  note: string;
  onNote: (v: string) => void;
  supplierOptions: string[];
  salePrice: string;
  withHiddenInputs?: boolean;
  defaultOpen?: boolean;
}) {
  const t = useT();
  const hasData = !!costPrice.trim() || !!supplier.trim() || !!note.trim();
  const [open, setOpen] = useState(defaultOpen || hasData);

  const cost = parseFloat(costPrice);
  const sale = parseFloat(salePrice);
  const showMargin = !isNaN(cost) && cost > 0 && !isNaN(sale) && sale > 0;
  const profit = sale - cost;
  const marginPct = showMargin ? (profit / sale) * 100 : 0;

  return (
    <div className="rounded-xl border border-amber-200/70 bg-amber-50/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <svg className="h-4 w-4 shrink-0 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        <span className="flex-1 text-sm font-medium text-amber-900">
          {t("cost.sectionTitle")}
          <span className="ml-1.5 font-normal text-amber-700">{t("cost.onlyYou")}</span>
        </span>
        {!open && hasData && (
          <span className="truncate text-xs font-medium text-amber-700">
            {costPrice.trim() && `€${cost.toFixed(2)}`}
            {costPrice.trim() && supplier.trim() && " · "}
            {supplier.trim()}
          </span>
        )}
        <svg
          className={`h-4 w-4 shrink-0 text-amber-600 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="space-y-3 border-t border-amber-200/70 px-3 py-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-amber-900">{t("cost.costPrice")}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={costPrice}
                onChange={(e) => onCostPrice(e.target.value)}
                onFocus={(e) => e.target.select()}
                placeholder="0.00"
                className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
              />
              {showMargin && (
                <p className={`mt-1 text-xs font-medium ${profit >= 0 ? "text-green-700" : "text-red-600"}`}>
                  {t("cost.margin", { profit: profit.toFixed(2), pct: marginPct.toFixed(0) })}
                </p>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-amber-900">{t("cost.supplier")}</label>
              <TagPicker
                value={supplier}
                onChange={onSupplier}
                options={supplierOptions}
                placeholder={t("cost.supplierPlaceholder")}
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-amber-900">{t("cost.note")}</label>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => onNote(e.target.value)}
              placeholder={t("cost.notePlaceholder")}
              className="w-full resize-none rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
            />
          </div>
        </div>
      )}

      {/* Los ocultos van fuera del `open`: si el bloque está plegado, lo escrito
          se sigue enviando. */}
      {withHiddenInputs && (
        <>
          <input type="hidden" name="cost_price" value={costPrice} />
          <input type="hidden" name="supplier" value={canonicalTag(supplier, supplierOptions)} />
          <input type="hidden" name="cost_note" value={note} />
        </>
      )}
    </div>
  );
}
