"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

// ─────────────────────────────────────────────────────────────
// AI 自动识别：把商品照片发给 Claude，读出名称/品牌/分类/描述/条码候选。
// - 模型用 Haiku 4.5（读包装文字这种任务够用且最省）。
// - key 从环境变量 ANTHROPIC_API_KEY 读取，本文件从不接触密钥明文；
//   谁的 key、谁充值就谁付费——app 只是调用入口。
// - 图片走 Supabase 公开 URL 传给模型，无需 base64、不受 body 大小限制。
// ─────────────────────────────────────────────────────────────

export type AiSuggestion = {
  nombre: string;
  marca: string;
  categoria: string; // 命中的已有分类名，未命中为 ""
  descripcion: string;
  codigo_barras: string; // 清晰可读才给，否则 ""
};

export type AiSuggestResult = { suggestion: AiSuggestion } | { error: string };

const MODEL = "claude-haiku-4-5";

export async function suggestProductFromImages(
  imageUrls: string[]
): Promise<AiSuggestResult> {
  // 权限：仅仓库角色
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "无权限" };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "warehouse") return { error: "无权限" };

  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: "尚未配置 AI 识别（缺少 ANTHROPIC_API_KEY 环境变量）" };
  }
  const urls = imageUrls.filter((u) => u && u.startsWith("http")).slice(0, 4);
  if (urls.length === 0) return { error: "没有可识别的图片" };

  // 已有分类，供模型从中挑选（不新建分类）
  const { data: cats } = await supabase
    .from("categories")
    .select("name")
    .order("name");
  const categoryNames = (cats ?? []).map((c) => c.name).filter(Boolean);

  const system = [
    "Eres un asistente que cataloga productos para una tienda española a partir de fotos del envase.",
    "Lee el texto y la imagen del producto y extrae la información.",
    "Escribe nombre y descripción en español, tal como aparecen en el envase (no inventes).",
    "La descripción debe ser breve, una sola línea.",
    "Para la categoría, elige EXACTAMENTE una de la lista proporcionada que mejor encaje; si ninguna encaja, deja \"\".",
    "Para el código de barras, incluye solo los dígitos si se leen con claridad bajo un código de barras; si no, deja \"\".",
    "Si algún dato no se puede determinar, deja la cadena vacía \"\".",
    "Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional ni ```.",
    'Formato exacto: {"nombre":"","marca":"","categoria":"","descripcion":"","codigo_barras":""}',
  ].join(" ");

  const client = new Anthropic();

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages: [
        {
          role: "user",
          content: [
            ...urls.map((url) => ({
              type: "image" as const,
              source: { type: "url" as const, url },
            })),
            {
              type: "text" as const,
              text:
                `Categorías disponibles (elige solo una o deja ""): ` +
                (categoryNames.length ? categoryNames.join(" | ") : "(sin categorías)"),
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { error: "AI 未返回可用内容，请重试" };
    }

    // 防御式解析：去掉可能的 ``` 代码围栏再 JSON.parse
    let text = textBlock.text.trim();
    if (text.startsWith("```")) {
      text = text
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/, "")
        .trim();
    }
    const raw = JSON.parse(text) as Record<string, unknown>;

    const suggestion: AiSuggestion = {
      nombre: String(raw.nombre ?? "").trim(),
      marca: String(raw.marca ?? "").trim(),
      categoria: String(raw.categoria ?? "").trim(),
      descripcion: String(raw.descripcion ?? "").trim(),
      codigo_barras: String(raw.codigo_barras ?? "").trim(),
    };
    return { suggestion };
  } catch (err) {
    return {
      error: err instanceof Error ? `AI 识别失败：${err.message}` : "AI 识别失败",
    };
  }
}
