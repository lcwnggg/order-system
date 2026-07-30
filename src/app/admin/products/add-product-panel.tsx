"use client";

import { useState } from "react";
import ProductForm from "./product-form";
import type { Category } from "@/app/admin/categories/categories-client";
import type { Product } from "./product-list";
import { useT } from "@/lib/i18n/client";

export default function AddProductPanel({
  categories,
  products,
  brandOptions,
  supplierOptions,
}: {
  categories: Category[];
  products: Product[];
  brandOptions: string[];
  supplierOptions: string[];
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-full items-center justify-center gap-2.5 rounded-2xl border border-dashed border-paper-300 bg-paper-25 py-5 text-sm font-medium text-paper-600 transition-colors hover:border-paper-400 hover:bg-paper-100"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-paper-700 text-white transition-transform group-hover:scale-110">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
        </span>
        {t("adminProducts.addNew")}
      </button>
    );
  }

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-paper-500 transition-colors hover:bg-paper-100 hover:text-paper-700"
        >
          {t("common.collapse")}
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
      </div>
      <ProductForm
        categories={categories}
        products={products}
        brandOptions={brandOptions}
        supplierOptions={supplierOptions}
      />
    </div>
  );
}
