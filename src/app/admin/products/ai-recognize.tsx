"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { suggestProductFromImages, type AiSuggestion } from "./ai-actions";

// 复用与表单一致的压缩逻辑（浏览器端）
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

type Phase = "idle" | "uploading" | "recognizing" | "done" | "error";

export default function AiRecognizePanel({
  onImageUploaded,
  onSuggestion,
}: {
  // 第一张照片上传后的公开 URL，父表单用它作为商品图
  onImageUploaded: (url: string) => void;
  // 识别结果，父表单用它自动填字段
  onSuggestion: (s: AiSuggestion) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList) {
    const list = Array.from(files).slice(0, 3); // 最多 3 张
    if (list.length === 0) return;
    setError(null);
    setPhase("uploading");

    try {
      const supabase = createClient();
      const urls: string[] = [];
      for (const file of list) {
        const blob = await compressToJpeg(file);
        const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
        const { error: upErr } = await supabase.storage
          .from("product-images")
          .upload(fileName, blob, { contentType: "image/jpeg", upsert: false });
        if (upErr) throw new Error(upErr.message);
        const { data } = supabase.storage.from("product-images").getPublicUrl(fileName);
        urls.push(data.publicUrl);
      }

      // 第一张直接用作商品图，省得再传一次
      if (urls[0]) onImageUploaded(urls[0]);

      setPhase("recognizing");
      const result = await suggestProductFromImages(urls);
      if ("error" in result) {
        setError(result.error);
        setPhase("error");
        return;
      }
      onSuggestion(result.suggestion);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "识别失败");
      setPhase("error");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const busy = phase === "uploading" || phase === "recognizing";

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-sage-900">AI 自动识别（可选）</p>
          <p className="mt-1 text-xs leading-relaxed text-sage-600">
            拍 1–2 张商品照片，AI 会自动帮你填好下面的名称、品牌、分类和描述。
            <br />
            <span className="text-sage-500">
              📸 小贴士：光线充足、白色背景、正面拍清品牌和名称最准；可再拍一张背面帮助识别更多信息。
              第一张照片会自动用作商品图，无需再传一次。
            </span>
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                busy
                  ? "cursor-not-allowed bg-indigo-300 text-white"
                  : "bg-indigo-600 text-white hover:bg-indigo-700"
              }`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {busy ? "处理中…" : "拍照 / 选择照片"}
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                disabled={busy}
                onChange={(e) => { if (e.target.files) handleFiles(e.target.files); }}
                className="hidden"
              />
            </label>

            {phase === "uploading" && <span className="text-xs text-sage-500">正在上传照片…</span>}
            {phase === "recognizing" && <span className="text-xs text-sage-500">AI 正在识别…</span>}
            {phase === "done" && (
              <span className="text-xs font-medium text-green-600">已识别，已自动填入下方字段，请核对</span>
            )}
          </div>

          {phase === "error" && error && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
