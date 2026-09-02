"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { suggestProductFromImages, type AiSuggestion } from "./ai-actions";
import { useT } from "@/lib/i18n/client";
import { resizeToJpeg, uploadProductImage } from "@/lib/image-upload";

type Phase = "idle" | "uploading" | "recognizing" | "done" | "error";

export default function AiRecognizePanel({
  onImageUploaded,
  onSuggestion,
}: {
  // 第一张照片上传后的公开 URL + 对应的原始文件。
  // 原始文件回传给父表单，是为了让用户能对这张"顺便当成商品图"的照片做裁剪，
  // 否则拍完就直接成了商品图，没有任何调整构图的机会。
  onImageUploaded: (url: string, originalFile: File) => void;
  // 识别结果，父表单用它自动填字段
  onSuggestion: (s: AiSuggestion) => void;
}) {
  const t = useT();
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
        const blob = await resizeToJpeg(file, t);
        urls.push(await uploadProductImage(supabase, blob, t));
      }

      // 第一张直接用作商品图，省得再传一次（原图一并回传，供后续裁剪）
      if (urls[0] && list[0]) onImageUploaded(urls[0], list[0]);

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
      setError(err instanceof Error ? err.message : t("ai.failed"));
      setPhase("error");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const busy = phase === "uploading" || phase === "recognizing";

  return (
    <div className="rounded-xl border border-paper-300 bg-paper-50 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-paper-200 text-paper-700">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-paper-900">{t("ai.title")}</p>
          <p className="mt-1 text-xs leading-relaxed text-paper-600">
            {t("ai.body")}
            <br />
            <span className="text-paper-500">{t("ai.tip")}</span>
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                busy
                  ? "cursor-not-allowed bg-paper-400 text-white"
                  : "bg-paper-700 text-white hover:bg-paper-800"
              }`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {busy ? t("common.processing") : t("ai.takePhoto")}
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

            {phase === "uploading" && <span className="text-xs text-paper-500">{t("ai.uploadingPhotos")}</span>}
            {phase === "recognizing" && <span className="text-xs text-paper-500">{t("ai.recognizing")}</span>}
            {phase === "done" && (
              <span className="text-xs font-medium text-green-600">{t("ai.done")}</span>
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
