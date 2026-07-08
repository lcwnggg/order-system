"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { addProduct, type ActionResult } from "./actions";

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

export default function ProductForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    addProduct,
    null
  );
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (state && "success" in state) {
      formRef.current?.reset();
      setImageUrl(null);
      setPreview(null);
      setPhase("idle");
      setUploadError(null);
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
      const previewUrl = URL.createObjectURL(blob);
      setPreview(previewUrl);

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

  const uploading = phase === "compressing" || phase === "uploading";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h2 className="mb-5 text-base font-semibold text-zinc-900">添加商品</h2>

      <form ref={formRef} action={action} className="space-y-4">
        {imageUrl && <input type="hidden" name="image_url" value={imageUrl} />}

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

        <div>
          <label className="mb-1.5 block text-sm font-medium text-zinc-700">
            商品描述
          </label>
          <textarea
            name="description"
            rows={3}
            placeholder="请输入商品描述（可选）"
            className="w-full resize-none rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
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

          <div>
            <label className="mb-1.5 block text-sm font-medium text-zinc-700">
              商品图片
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-600 outline-none file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-zinc-100 file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-zinc-700 hover:file:bg-zinc-200"
            />
            {phase === "compressing" && (
              <p className="mt-1.5 text-xs text-zinc-500">正在压缩图片…</p>
            )}
            {phase === "uploading" && (
              <p className="mt-1.5 text-xs text-zinc-500">正在上传至存储…</p>
            )}
            {phase === "error" && (
              <p className="mt-1.5 text-xs text-red-500">{uploadError}</p>
            )}
          </div>
        </div>

        {preview && (
          <div className="flex items-center gap-3 rounded-lg border border-zinc-100 bg-zinc-50 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="预览"
              className="h-16 w-16 rounded-lg object-cover"
            />
            <div className="text-xs text-zinc-500">
              {phase === "done" && (
                <span className="font-medium text-green-600">图片上传成功</span>
              )}
              {uploading && <span>处理中…</span>}
            </div>
          </div>
        )}

        {state && "error" in state && (
          <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">
            {state.error}
          </p>
        )}
        {state && "success" in state && (
          <p className="rounded-lg bg-green-50 px-4 py-2.5 text-sm text-green-600">
            商品已成功添加
          </p>
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
