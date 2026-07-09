"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  updateProduct,
  deleteProduct,
  toggleProductActive,
  adjustStock,
  adjustVariantStock,
  upsertVariants,
  type ActionResult,
  type ProductVariant,
} from "./actions";
import type { Category } from "@/app/admin/categories/categories-client";

export type Product = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  stock: number;
  image_url: string | null;
  is_active: boolean;
  category_id: string | null;
  has_variants: boolean;
  created_at: string;
};

type VariantDraft = {
  id?: string;
  color: string;
  stock: string;
  sort_order: number;
  _delete?: boolean;
};

function compressToJpeg(file: File, maxWidth = 1200, quality = 0.8): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas 不可用"));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("压缩失败"))),
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("图片加载失败")); };
    img.src = objectUrl;
  });
}

type UploadPhase = "idle" | "compressing" | "uploading" | "done" | "error";

export default function ProductList({
  products,
  categories,
  variants,
}: {
  products: Product[];
  categories: Category[];
  variants: ProductVariant[];
}) {
  const parentCategories = categories.filter((c) => !c.parent_id);
  function childrenOf(parentId: string) {
    return categories.filter((c) => c.parent_id === parentId);
  }
  function categoryLabel(categoryId: string | null) {
    if (!categoryId) return null;
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return null;
    if (!cat.parent_id) return cat.name;
    const parent = categories.find((c) => c.id === cat.parent_id);
    return parent ? `${parent.name} › ${cat.name}` : cat.name;
  }
  function variantsFor(productId: string) {
    return variants.filter((v) => v.product_id === productId);
  }

  // ── 编辑弹窗状态 ──
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editStock, setEditStock] = useState("");
  const [editHasVariants, setEditHasVariants] = useState(false);
  const [editVariants, setEditVariants] = useState<VariantDraft[]>([]);
  const [newImageUrl, setNewImageUrl] = useState<string | null | undefined>(undefined);
  const [preview, setPreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<ActionResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editParentCatId, setEditParentCatId] = useState("");
  const [editChildCatId, setEditChildCatId] = useState("");

  // ── 表格操作状态 ──
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [adjustQty, setAdjustQty] = useState<Record<string, string>>({});
  const [adjustErrors, setAdjustErrors] = useState<Record<string, string>>({});
  const [adjustingVariantId, setAdjustingVariantId] = useState<string | null>(null);

  const [, startTransition] = useTransition();

  // ── 打开/关闭编辑弹窗 ──
  function openEdit(product: Product) {
    setEditingProduct(product);
    setEditName(product.name);
    setEditDescription(product.description ?? "");
    setEditPrice(String(product.price));
    setEditStock(String(product.stock));
    setEditHasVariants(product.has_variants);
    setEditVariants(
      variantsFor(product.id).map((v) => ({
        id: v.id,
        color: v.color,
        stock: String(v.stock),
        sort_order: v.sort_order,
      }))
    );
    setNewImageUrl(undefined);
    setPreview(null);
    setPhase("idle");
    setUploadError(null);
    setSaveResult(null);
    const cat = categories.find((c) => c.id === product.category_id);
    if (!cat) { setEditParentCatId(""); setEditChildCatId(""); }
    else if (cat.parent_id) { setEditParentCatId(cat.parent_id); setEditChildCatId(cat.id); }
    else { setEditParentCatId(cat.id); setEditChildCatId(""); }
  }

  function closeEdit() {
    setEditingProduct(null);
    setPreview(null);
    setPhase("idle");
    setUploadError(null);
    setSaveResult(null);
    setIsSaving(false);
    setEditVariants([]);
  }

  // ── 图片上传/删除 ──
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) { setNewImageUrl(undefined); setPreview(null); setPhase("idle"); return; }
    try {
      setPhase("compressing"); setUploadError(null);
      const blob = await compressToJpeg(file);
      setPreview(URL.createObjectURL(blob));
      setPhase("uploading");
      const supabase = createClient();
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
      const { error } = await supabase.storage
        .from("product-images")
        .upload(fileName, blob, { contentType: "image/jpeg", upsert: false });
      if (error) throw new Error(error.message);
      const { data } = supabase.storage.from("product-images").getPublicUrl(fileName);
      setNewImageUrl(data.publicUrl);
      setPhase("done");
    } catch (err) {
      setPhase("error");
      setUploadError(err instanceof Error ? err.message : "上传失败");
    }
  }

  async function handleDeleteImage() {
    // 删除新上传的图（如果有）
    const urlToDelete = typeof newImageUrl === "string" ? newImageUrl : editingProduct?.image_url;
    if (urlToDelete) {
      try {
        const fileName = urlToDelete.split("/product-images/").pop();
        if (fileName) {
          await createClient().storage.from("product-images").remove([decodeURIComponent(fileName)]);
        }
      } catch { /* 忽略存储错误 */ }
    }
    setNewImageUrl(null); // null = 保存时将 image_url 置空
    setPreview(null);
    setPhase("idle");
    setUploadError(null);
  }

  // ── 变体草稿操作 ──
  function addVariantRow() {
    setEditVariants((prev) => [
      ...prev,
      { color: "", stock: "0", sort_order: prev.length },
    ]);
  }
  function removeVariantRow(idx: number) {
    setEditVariants((prev) => {
      const row = prev[idx];
      if (row.id) return prev.map((v, i) => (i === idx ? { ...v, _delete: true } : v));
      return prev.filter((_, i) => i !== idx);
    });
  }
  function updateVariantRow(idx: number, field: "color" | "stock", value: string) {
    setEditVariants((prev) =>
      prev.map((v, i) => (i === idx ? { ...v, [field]: value } : v))
    );
  }

  // ── 保存编辑 ──
  function handleSave() {
    if (!editingProduct) return;
    setIsSaving(true);
    setSaveResult(null);
    startTransition(async () => {
      const result = await updateProduct(editingProduct.id, {
        name: editName,
        description: editDescription,
        price: parseFloat(editPrice),
        stock: editHasVariants ? 0 : parseInt(editStock, 10),
        newImageUrl,
        category_id: editChildCatId || editParentCatId || null,
        has_variants: editHasVariants,
      });
      if ("error" in result) {
        setSaveResult(result);
        setIsSaving(false);
        return;
      }
      // 保存变体变更
      const variantInputs = editVariants.map((v, i) => ({
        id: v.id,
        color: v.color,
        stock: parseInt(v.stock, 10) || 0,
        sort_order: i,
        _delete: v._delete,
      }));
      if (variantInputs.length > 0) {
        const varResult = await upsertVariants(editingProduct.id, variantInputs);
        if ("error" in varResult) {
          setSaveResult(varResult);
          setIsSaving(false);
          return;
        }
      }
      setIsSaving(false);
      closeEdit();
    });
  }

  // ── 上架/下架 ──
  function handleToggleActive(product: Product) {
    setTogglingId(product.id);
    startTransition(async () => {
      await toggleProductActive(product.id, !product.is_active);
      setTogglingId(null);
    });
  }

  // ── 商品总库存快捷调整 ──
  function handleAdjust(productId: string, delta: number | null) {
    let d: number;
    if (delta === null) {
      d = parseInt(adjustQty[productId] ?? "0", 10);
      if (isNaN(d) || d <= 0) return;
    } else {
      d = delta;
    }
    setAdjustingId(productId);
    setAdjustErrors((prev) => ({ ...prev, [productId]: "" }));
    startTransition(async () => {
      const result = await adjustStock(productId, d);
      setAdjustingId(null);
      if ("error" in result) {
        setAdjustErrors((prev) => ({ ...prev, [productId]: result.error }));
      } else if (delta === null) {
        setAdjustQty((prev) => ({ ...prev, [productId]: "" }));
      }
    });
  }

  // ── 变体库存快捷调整 ──
  function handleAdjustVariant(variantId: string, delta: number) {
    setAdjustingVariantId(variantId);
    startTransition(async () => {
      await adjustVariantStock(variantId, delta);
      setAdjustingVariantId(null);
    });
  }

  // ── 删除商品 ──
  function handleDelete(product: Product) {
    if (!window.confirm(`确定删除「${product.name}」吗？此操作无法撤销。`)) return;
    setDeletingId(product.id);
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteProduct(product.id);
      setDeletingId(null);
      if ("error" in result) setDeleteError(result.error);
    });
  }

  const uploading = phase === "compressing" || phase === "uploading";
  const displayImage =
    preview ?? (newImageUrl === null ? null : editingProduct?.image_url ?? null);
  const visibleEditVariants = editVariants.filter((v) => !v._delete);

  return (
    <>
      {deleteError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          删除失败：{deleteError}
          <button type="button" onClick={() => setDeleteError(null)} className="ml-3 text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50 text-left">
                <th className="px-4 py-3 font-medium text-zinc-500">图片</th>
                <th className="px-4 py-3 font-medium text-zinc-500">名称</th>
                <th className="px-4 py-3 font-medium text-zinc-500">价格</th>
                <th className="px-4 py-3 font-medium text-zinc-500">库存</th>
                <th className="px-4 py-3 font-medium text-zinc-500">状态</th>
                <th className="px-4 py-3 font-medium text-zinc-500"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {products.map((product) => {
                const isDeleting = deletingId === product.id;
                const isToggling = togglingId === product.id;
                const pvs = variantsFor(product.id);
                return (
                  <tr key={product.id} className={`hover:bg-zinc-50 ${!product.is_active ? "opacity-50" : ""}`}>
                    {/* 图片 */}
                    <td className="px-4 py-3">
                      {product.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.image_url} alt={product.name} width={56} height={56} className="h-14 w-14 rounded-lg object-cover" />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-zinc-100 text-zinc-300">
                          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}
                    </td>

                    {/* 名称 */}
                    <td className="px-4 py-3">
                      <p className="font-medium text-zinc-900">{product.name}</p>
                      {categoryLabel(product.category_id) && (
                        <p className="mt-0.5 text-xs text-zinc-400">{categoryLabel(product.category_id)}</p>
                      )}
                      {product.description && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-zinc-400">{product.description}</p>
                      )}
                      {product.has_variants && (
                        <span className="mt-0.5 inline-block rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                          {pvs.length} 种颜色
                        </span>
                      )}
                    </td>

                    {/* 价格 */}
                    <td className="px-4 py-3 text-zinc-700">¥{Number(product.price).toFixed(2)}</td>

                    {/* 库存 */}
                    <td className="px-4 py-3">
                      {product.has_variants ? (
                        /* 变体库存 */
                        <div className="space-y-1.5">
                          {pvs.length === 0 ? (
                            <span className="text-xs text-zinc-400">暂无变体</span>
                          ) : (
                            pvs.map((variant) => (
                              <div key={variant.id} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                                <span className="text-xs font-medium text-zinc-600">{variant.color}</span>
                                <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium ${
                                  variant.stock === 0
                                    ? "bg-red-50 text-red-600"
                                    : variant.stock < 10
                                      ? "bg-amber-50 text-amber-600"
                                      : "bg-green-50 text-green-600"
                                }`}>
                                  {variant.stock === 0 ? "售罄" : variant.stock}
                                </span>
                                {([1, 10] as const).map((n) => (
                                  <button
                                    key={n}
                                    type="button"
                                    disabled={adjustingVariantId === variant.id}
                                    onClick={() => handleAdjustVariant(variant.id, n)}
                                    className="rounded px-1.5 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-700 hover:bg-zinc-200 disabled:opacity-40 transition-colors"
                                  >
                                    +{n}
                                  </button>
                                ))}
                              </div>
                            ))
                          )}
                        </div>
                      ) : (
                        /* 普通库存 + 快捷调整 */
                        <div className="space-y-1.5">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            product.stock === 0
                              ? "bg-red-50 text-red-600"
                              : product.stock < 10
                                ? "bg-amber-50 text-amber-600"
                                : "bg-green-50 text-green-600"
                          }`}>
                            {product.stock === 0 ? "已售罄" : `${product.stock} 件`}
                          </span>
                          <div className="flex flex-wrap items-center gap-1">
                            {([1, 10] as const).map((n) => (
                              <button
                                key={n}
                                type="button"
                                disabled={adjustingId === product.id}
                                onClick={() => handleAdjust(product.id, n)}
                                className="rounded px-1.5 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-700 hover:bg-zinc-200 disabled:opacity-40 transition-colors"
                              >
                                +{n}
                              </button>
                            ))}
                            <div className="flex items-center gap-0.5">
                              <input
                                type="number"
                                min="1"
                                value={adjustQty[product.id] ?? ""}
                                onChange={(e) =>
                                  setAdjustQty((prev) => ({ ...prev, [product.id]: e.target.value }))
                                }
                                placeholder="N"
                                className="w-10 rounded border border-zinc-200 px-1 py-0.5 text-xs text-zinc-900 outline-none focus:border-zinc-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                              />
                              <button
                                type="button"
                                disabled={adjustingId === product.id || !adjustQty[product.id]}
                                onClick={() => handleAdjust(product.id, null)}
                                className="rounded px-1.5 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-700 hover:bg-zinc-200 disabled:opacity-40 transition-colors"
                              >
                                {adjustingId === product.id ? "…" : "增加"}
                              </button>
                            </div>
                          </div>
                          {adjustErrors[product.id] && (
                            <p className="text-xs text-red-500">{adjustErrors[product.id]}</p>
                          )}
                        </div>
                      )}
                    </td>

                    {/* 状态 */}
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={isToggling}
                        onClick={() => handleToggleActive(product)}
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          product.is_active
                            ? "bg-green-50 text-green-700 hover:bg-green-100"
                            : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
                        }`}
                      >
                        {isToggling ? "…" : product.is_active ? "上架 ↓" : "下架 ↑"}
                      </button>
                    </td>

                    {/* 操作 */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(product)}
                          className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100"
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => handleDelete(product)}
                          className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-40"
                        >
                          {isDeleting ? "删除中…" : "删除"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 编辑弹窗 ── */}
      {editingProduct && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) closeEdit(); }}
        >
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            {/* 弹窗标题 */}
            <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-6 py-4">
              <h2 className="text-base font-semibold text-zinc-900">编辑商品</h2>
              <button type="button" onClick={closeEdit} className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 弹窗主体（可滚动） */}
            <div className="flex-1 overflow-y-auto">
              <div className="space-y-4 px-6 py-5">
                {/* 名称 */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-zinc-700">
                    商品名称 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                  />
                </div>

                {/* 价格 */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-zinc-700">
                    价格（元）<span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                  />
                </div>

                {/* 颜色变体开关 + 库存/变体区域 */}
                <div>
                  <div className="mb-3 flex items-center gap-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={editHasVariants}
                      onClick={() => {
                        const next = !editHasVariants;
                        setEditHasVariants(next);
                        if (next && editVariants.length === 0) {
                          setEditVariants([{ color: "", stock: "0", sort_order: 0 }]);
                        }
                      }}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                        editHasVariants ? "bg-zinc-900" : "bg-zinc-300"
                      }`}
                    >
                      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${editHasVariants ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                    <span className="text-sm font-medium text-zinc-700">分颜色/规格</span>
                  </div>

                  {!editHasVariants ? (
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-zinc-700">
                        库存数量 <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={editStock}
                        onChange={(e) => setEditStock(e.target.value)}
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                      />
                    </div>
                  ) : (
                    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                      <p className="mb-2 text-xs font-medium text-zinc-500">颜色变体（各颜色独立库存）</p>
                      <div className="space-y-2">
                        {visibleEditVariants.map((v, displayIdx) => {
                          const realIdx = editVariants.indexOf(v);
                          return (
                            <div key={realIdx} className="flex items-center gap-2">
                              <input
                                type="text"
                                placeholder='如"黑色"'
                                value={v.color}
                                onChange={(e) => updateVariantRow(realIdx, "color", e.target.value)}
                                className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                              />
                              <input
                                type="number"
                                min="0"
                                step="1"
                                placeholder="库存"
                                value={v.stock}
                                onChange={(e) => updateVariantRow(realIdx, "stock", e.target.value)}
                                className="w-20 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                              />
                              {visibleEditVariants.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeVariantRow(realIdx)}
                                  className="flex-shrink-0 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-red-500"
                                  aria-label="删除"
                                >
                                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        onClick={addVariantRow}
                        className="mt-2 text-xs font-medium text-zinc-500 hover:text-zinc-900"
                      >
                        + 添加颜色
                      </button>
                    </div>
                  )}
                </div>

                {/* 描述 */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-zinc-700">商品描述</label>
                  <textarea
                    rows={2}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="可选"
                    className="w-full resize-none rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                  />
                </div>

                {/* 分类 */}
                {parentCategories.length > 0 && (
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-zinc-700">商品分类</label>
                    <div className="grid grid-cols-2 gap-3">
                      <select
                        value={editParentCatId}
                        onChange={(e) => { setEditParentCatId(e.target.value); setEditChildCatId(""); }}
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                      >
                        <option value="">不选大类</option>
                        {parentCategories.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      {editParentCatId && childrenOf(editParentCatId).length > 0 && (
                        <select
                          value={editChildCatId}
                          onChange={(e) => setEditChildCatId(e.target.value)}
                          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                        >
                          <option value="">不选小类</option>
                          {childrenOf(editParentCatId).map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                )}

                {/* 图片 */}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-zinc-700">
                    商品图片
                    <span className="ml-1.5 font-normal text-zinc-400">（不选则保留原图）</span>
                  </label>
                  <div className="flex items-start gap-3">
                    {displayImage && (
                      <div className="relative flex-shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={displayImage} alt="图片预览" className="h-16 w-16 rounded-lg object-cover ring-1 ring-zinc-200" />
                        <button
                          type="button"
                          onClick={handleDeleteImage}
                          title="删除图片"
                          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow hover:bg-red-600"
                        >
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleFileChange}
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-600 outline-none file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-zinc-100 file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-zinc-700 hover:file:bg-zinc-200"
                      />
                      {phase === "compressing" && <p className="mt-1 text-xs text-zinc-500">正在压缩…</p>}
                      {phase === "uploading" && <p className="mt-1 text-xs text-zinc-500">正在上传…</p>}
                      {phase === "done" && <p className="mt-1 text-xs text-green-600">上传成功</p>}
                      {phase === "error" && <p className="mt-1 text-xs text-red-500">{uploadError}</p>}
                    </div>
                  </div>
                  {!displayImage && newImageUrl !== null && (
                    <p className="mt-1 text-xs text-zinc-400">无图片 · 上传后可删除/更换</p>
                  )}
                  {newImageUrl === null && (
                    <p className="mt-1 text-xs text-amber-600">图片将在保存后删除</p>
                  )}
                </div>

                {saveResult && "error" in saveResult && (
                  <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{saveResult.error}</p>
                )}
              </div>
            </div>

            {/* 弹窗底部 */}
            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-zinc-100 px-6 py-4">
              <button
                type="button"
                onClick={closeEdit}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isSaving || uploading}
                onClick={handleSave}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? "保存中…" : uploading ? "图片上传中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
