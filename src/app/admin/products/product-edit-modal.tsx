"use client";

import { useState, useTransition, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { updateProduct, upsertVariants, type ActionResult } from "./actions";
import BarcodeField from "./barcode-scanner";

type Product = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  stock: number;
  image_url: string | null;
  is_active: boolean;
  category_id: string | null;
  has_variants: boolean;
  brand: string | null;
  barcode: string | null;
  created_at: string;
};

type Category = {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
};

type ProductVariant = {
  id: string;
  product_id: string;
  color: string;
  stock: number;
  sort_order: number;
};

type VariantDraft = {
  id?: string;
  color: string;
  stock: string;
  sort_order: number;
  _delete?: boolean;
};

type UploadPhase = "idle" | "compressing" | "uploading" | "done" | "error";

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

export default function ProductEditModal({
  product,
  categories,
  variantsForProduct,
  onClose,
  onSaved,
}: {
  product: Product;
  categories: Category[];
  variantsForProduct: ProductVariant[];
  onClose: () => void;
  onSaved?: () => void;
}) {
  const parentCategories = useMemo(
    () => categories.filter((c) => !c.parent_id),
    [categories]
  );

  function childrenOf(parentId: string) {
    return categories.filter((c) => c.parent_id === parentId);
  }

  const [editName, setEditName] = useState(product.name);
  const [editBrand, setEditBrand] = useState(product.brand ?? "");
  const [editBarcode, setEditBarcode] = useState(product.barcode ?? "");
  const [editDescription, setEditDescription] = useState(product.description ?? "");
  const [editPrice, setEditPrice] = useState(String(product.price));
  const [editStock, setEditStock] = useState(String(product.stock));
  const [editHasVariants, setEditHasVariants] = useState(product.has_variants);
  const [editVariants, setEditVariants] = useState<VariantDraft[]>(() =>
    variantsForProduct.map((v) => ({
      id: v.id,
      color: v.color,
      stock: String(v.stock),
      sort_order: v.sort_order,
    }))
  );
  const [newImageUrl, setNewImageUrl] = useState<string | null | undefined>(undefined);
  const [preview, setPreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<ActionResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false); // 图片放大灯箱

  const initialCat = categories.find((c) => c.id === product.category_id);
  const [editParentCatId, setEditParentCatId] = useState<string>(() => {
    if (!initialCat) return "";
    return initialCat.parent_id ?? initialCat.id;
  });
  const [editChildCatId, setEditChildCatId] = useState<string>(() => {
    if (!initialCat) return "";
    return initialCat.parent_id ? initialCat.id : "";
  });

  const [, startTransition] = useTransition();

  const uploading = phase === "compressing" || phase === "uploading";
  const displayImage = preview ?? (newImageUrl === null ? null : product.image_url ?? null);
  const visibleEditVariants = editVariants.filter((v) => !v._delete);

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
    const urlToDelete = typeof newImageUrl === "string" ? newImageUrl : product.image_url;
    if (urlToDelete) {
      try {
        const fileName = urlToDelete.split("/product-images/").pop();
        if (fileName) {
          await createClient().storage.from("product-images").remove([decodeURIComponent(fileName)]);
        }
      } catch { /* 忽略存储错误 */ }
    }
    setNewImageUrl(null);
    setPreview(null);
    setPhase("idle");
    setUploadError(null);
  }

  function addVariantRow() {
    setEditVariants((prev) => [...prev, { color: "", stock: "0", sort_order: prev.length }]);
  }
  function removeVariantRow(idx: number) {
    setEditVariants((prev) => {
      const row = prev[idx];
      if (row.id) return prev.map((v, i) => (i === idx ? { ...v, _delete: true } : v));
      return prev.filter((_, i) => i !== idx);
    });
  }
  function updateVariantRow(idx: number, field: "color" | "stock", value: string) {
    setEditVariants((prev) => prev.map((v, i) => (i === idx ? { ...v, [field]: value } : v)));
  }

  function handleSave() {
    setIsSaving(true);
    setSaveResult(null);
    startTransition(async () => {
      const result = await updateProduct(product.id, {
        name: editName,
        description: editDescription,
        price: parseFloat(editPrice),
        stock: editHasVariants ? 0 : parseInt(editStock, 10),
        newImageUrl,
        category_id: editChildCatId || editParentCatId || null,
        has_variants: editHasVariants,
        brand: editBrand.trim() || null,
        barcode: editBarcode,
      });
      if ("error" in result) { setSaveResult(result); setIsSaving(false); return; }
      const variantInputs = editVariants.map((v, i) => ({
        id: v.id,
        color: v.color,
        stock: parseInt(v.stock, 10) || 0,
        sort_order: i,
        _delete: v._delete,
      }));
      if (variantInputs.length > 0) {
        const varResult = await upsertVariants(product.id, variantInputs);
        if ("error" in varResult) { setSaveResult(varResult); setIsSaving(false); return; }
      }
      setIsSaving(false);
      onSaved?.();
      onClose();
    });
  }

  return (
    <>
    {/* 图片放大灯箱 */}
    {zoomOpen && displayImage && (
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
        onClick={() => setZoomOpen(false)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={displayImage}
          alt="放大预览"
          className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
        />
        <button
          type="button"
          onClick={() => setZoomOpen(false)}
          className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-zinc-700 shadow hover:bg-white"
          aria-label="关闭"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    )}
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-6 py-4">
          <h2 className="text-base font-semibold text-zinc-900">编辑商品</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

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

            {/* 品牌 */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-700">品牌</label>
              <input
                type="text"
                value={editBrand}
                onChange={(e) => setEditBrand(e.target.value)}
                placeholder="如 Xiaomi、Temco（可选）"
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
              />
            </div>

            {/* 条码（可选，支持手机摄像头扫码） */}
            <BarcodeField value={editBarcode} onChange={setEditBarcode} inputId={`edit-barcode-${product.id}`} />

            {/* 价格 */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-700">
                价格（€）<span className="text-red-500">*</span>
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

            {/* 颜色变体开关 + 库存 */}
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
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${editHasVariants ? "bg-zinc-900" : "bg-zinc-300"}`}
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
                    {visibleEditVariants.map((v) => {
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
                  <button type="button" onClick={addVariantRow} className="mt-2 text-xs font-medium text-zinc-500 hover:text-zinc-900">
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
                    <img
                      src={displayImage}
                      alt="图片预览"
                      onClick={() => setZoomOpen(true)}
                      title="点击放大查看"
                      className="h-16 w-16 cursor-zoom-in rounded-lg object-cover ring-1 ring-zinc-200 transition hover:ring-zinc-400"
                    />
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

        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-zinc-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
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
    </>
  );
}
