"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { addProduct, type ActionResult } from "./actions";
import type { Category } from "@/app/admin/categories/categories-client";

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
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("图片加载失败"));
    };
    img.src = objectUrl;
  });
}

type UploadPhase = "idle" | "compressing" | "uploading" | "done" | "error";
type VariantDraft = { color: string; stock: string };

export default function ProductForm({ categories = [] }: { categories?: Category[] }) {
  const parentCategories = categories.filter((c) => !c.parent_id);
  function childrenOf(parentId: string) {
    return categories.filter((c) => c.parent_id === parentId);
  }

  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addProduct, null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedParentCatId, setSelectedParentCatId] = useState("");
  const [selectedChildCatId, setSelectedChildCatId] = useState("");
  const [hasVariants, setHasVariants] = useState(false);
  const [variants, setVariants] = useState<VariantDraft[]>([{ color: "", stock: "0" }]);

  useEffect(() => {
    if (state && "success" in state) {
      formRef.current?.reset();
      setImageUrl(null);
      setPreview(null);
      setPhase("idle");
      setUploadError(null);
      setSelectedParentCatId("");
      setSelectedChildCatId("");
      setHasVariants(false);
      setVariants([{ color: "", stock: "0" }]);
    }
  }, [state]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setImageUrl(null);
      setPreview(null);
      setPhase("idle");
      setUploadError(null);
      return;
    }
    try {
      setPhase("compressing");
      setUploadError(null);
      setImageUrl(null);
      setPreview(null);
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
      setImageUrl(data.publicUrl);
      setPhase("done");
    } catch (err) {
      setPhase("error");
      setUploadError(err instanceof Error ? err.message : "上传失败");
    }
  }

  async function handleDeleteImage() {
    if (imageUrl) {
      try {
        const fileName = imageUrl.split("/product-images/").pop();
        if (fileName) {
          await createClient().storage.from("product-images").remove([decodeURIComponent(fileName)]);
        }
      } catch { /* 忽略存储删除错误 */ }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
    setImageUrl(null);
    setPreview(null);
    setPhase("idle");
    setUploadError(null);
  }

  function addVariantRow() {
    setVariants((prev) => [...prev, { color: "", stock: "0" }]);
  }
  function removeVariantRow(idx: number) {
    setVariants((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateVariantRow(idx: number, field: "color" | "stock", value: string) {
    setVariants((prev) => prev.map((v, i) => (i === idx ? { ...v, [field]: value } : v)));
  }

  const variantsJson = JSON.stringify(
    variants.map((v, i) => ({
      color: v.color.trim(),
      stock: parseInt(v.stock, 10) || 0,
      sort_order: i,
    }))
  );

  const uploading = phase === "compressing" || phase === "uploading";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h2 className="mb-5 text-base font-semibold text-zinc-900">添加商品</h2>

      <form ref={formRef} action={action} className="space-y-4">
        {imageUrl && <input type="hidden" name="image_url" value={imageUrl} />}
        <input type="hidden" name="category_id" value={selectedChildCatId || selectedParentCatId} />
        <input type="hidden" name="has_variants" value={hasVariants ? "true" : "false"} />
        {hasVariants && <input type="hidden" name="variants" value={variantsJson} />}

        {/* 名称 + 价格 */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-700">
              商品名称 <span className="text-red-500">*</span>
            </label>
            <input
              name="name"
              type="text"
              required
              placeholder="请输入商品名称"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-700">
              价格（元）<span className="text-red-500">*</span>
            </label>
            <input
              name="price"
              type="number"
              required
              min="0"
              step="0.01"
              placeholder="0.00"
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
            />
          </div>
        </div>

        {/* 描述 */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-700">商品描述</label>
          <textarea
            name="description"
            rows={3}
            placeholder="请输入商品描述（可选）"
            className="w-full resize-none rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
          />
        </div>

        {/* 分类 */}
        {parentCategories.length > 0 && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-700">商品分类</label>
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                value={selectedParentCatId}
                onChange={(e) => { setSelectedParentCatId(e.target.value); setSelectedChildCatId(""); }}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
              >
                <option value="">不选大类</option>
                {parentCategories.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {selectedParentCatId && childrenOf(selectedParentCatId).length > 0 && (
                <select
                  value={selectedChildCatId}
                  onChange={(e) => setSelectedChildCatId(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                >
                  <option value="">不选小类</option>
                  {childrenOf(selectedParentCatId).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}

        {/* 颜色变体开关 + 库存/变体区域 */}
        <div>
          <div className="mb-3 flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={hasVariants}
              onClick={() => {
                setHasVariants((v) => !v);
                setVariants([{ color: "", stock: "0" }]);
              }}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                hasVariants ? "bg-zinc-900" : "bg-zinc-300"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  hasVariants ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
            <span className="text-sm font-medium text-zinc-700">这个商品分颜色/规格吗？</span>
          </div>

          {!hasVariants ? (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-700">
                库存数量 <span className="text-red-500">*</span>
              </label>
              <input
                name="stock"
                type="number"
                required
                min="0"
                step="1"
                placeholder="0"
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
              />
            </div>
          ) : (
            <div>
              <input type="hidden" name="stock" value="0" />
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <p className="mb-2 text-xs font-medium text-zinc-500">颜色变体（各颜色独立库存，价格统一）</p>
                <div className="space-y-2">
                  {variants.map((v, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder={`颜色名称，如"黑色"`}
                        value={v.color}
                        onChange={(e) => updateVariantRow(idx, "color", e.target.value)}
                        className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                      />
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="库存"
                        value={v.stock}
                        onChange={(e) => updateVariantRow(idx, "stock", e.target.value)}
                        className="w-20 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                      />
                      {variants.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeVariantRow(idx)}
                          className="flex-shrink-0 rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-red-500"
                          aria-label="删除此颜色"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addVariantRow}
                  className="mt-2 text-xs font-medium text-zinc-500 hover:text-zinc-900"
                >
                  + 添加颜色
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 图片上传 */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-700">商品图片</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-600 outline-none file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-zinc-100 file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-zinc-700 hover:file:bg-zinc-200"
          />
          {phase === "compressing" && <p className="mt-1.5 text-xs text-zinc-500">正在压缩图片…</p>}
          {phase === "uploading" && <p className="mt-1.5 text-xs text-zinc-500">正在上传至存储…</p>}
          {phase === "error" && <p className="mt-1.5 text-xs text-red-500">{uploadError}</p>}
        </div>

        {preview && (
          <div className="flex items-center gap-3 rounded-lg border border-zinc-100 bg-zinc-50 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="预览" className="h-16 w-16 rounded-lg object-cover" />
            <div className="flex-1 text-xs">
              {phase === "done" && <p className="font-medium text-green-600">图片上传成功</p>}
              {uploading && <p className="text-zinc-500">处理中…</p>}
            </div>
            {phase === "done" && (
              <button
                type="button"
                onClick={handleDeleteImage}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50"
              >
                删除图片
              </button>
            )}
          </div>
        )}

        {state && "error" in state && (
          <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{state.error}</p>
        )}
        {state && "success" in state && (
          <p className="rounded-lg bg-green-50 px-4 py-2.5 text-sm text-green-600">商品已成功添加</p>
        )}

        <div className="pt-1">
          <button
            type="submit"
            disabled={pending || uploading}
            className="rounded-lg bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? "图片上传中…" : pending ? "提交中…" : "添加商品"}
          </button>
        </div>
      </form>
    </div>
  );
}
