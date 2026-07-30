"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { addProduct, adjustStock, type ActionResult } from "./actions";
import type { Category } from "@/app/admin/categories/categories-client";
import type { Product } from "./product-list";
import BarcodeField from "./barcode-scanner";
import AiRecognizePanel from "./ai-recognize";
import type { AiSuggestion } from "./ai-actions";
import ImageCropModal from "./image-crop-modal";
import TagPicker from "./tag-picker";
import PrivateCostFields from "./private-cost-fields";
import { normalizeBarcode } from "@/lib/barcode";
import { useT } from "@/lib/i18n/client";
import type { Translate } from "@/lib/i18n/translate";

function compressToJpeg(
  file: File | Blob,
  t: Translate,
  maxWidth = 1200,
  quality = 0.8
): Promise<Blob> {
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
      if (!ctx) return reject(new Error(t("common.canvasUnavailable")));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error(t("common.compressFailed")))),
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(t("common.imageLoadFailed")));
    };
    img.src = objectUrl;
  });
}

type UploadPhase = "idle" | "compressing" | "uploading" | "done" | "error";
type VariantDraft = { color: string; stock: string };

// 一次进货往往是同一分类的一整批商品，逐个添加时分类选一次就够了：
// 记住上一次选的分类，作为下一次添加的默认值（而不是每次都清空重选）。
const LAST_CATEGORY_KEY = "addProduct:lastCategory";

// Misma idea con el proveedor: una remesa entera suele venir del mismo sitio.
const LAST_SUPPLIER_KEY = "addProduct:lastSupplier";

function readSavedSupplier(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(LAST_SUPPLIER_KEY) ?? "";
  } catch {
    return "";
  }
}

// 读取上次选择，并对着当前分类表校验：分类可能已被改名/删除/挪走，
// 直接信任 localStorage 会把商品挂到已不存在、或已不属于该大类的分类上。
function readSavedCategory(categories: Category[]): { parentId: string; childId: string } {
  const empty = { parentId: "", childId: "" };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(LAST_CATEGORY_KEY);
    if (!raw) return empty;
    const saved = JSON.parse(raw) as { parentId?: string; childId?: string };

    const parent = categories.find((c) => c.id === saved.parentId && !c.parent_id);
    if (!parent) return empty;

    const child = categories.find((c) => c.id === saved.childId && c.parent_id === parent.id);
    return { parentId: parent.id, childId: child?.id ?? "" };
  } catch {
    return empty;
  }
}

export default function ProductForm({
  categories = [],
  products = [],
  brandOptions = [],
  supplierOptions = [],
}: {
  categories?: Category[];
  products?: Product[];
  brandOptions?: string[];
  supplierOptions?: string[];
}) {
  const t = useT();
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
  const [selectedParentCatId, setSelectedParentCatId] = useState(
    () => readSavedCategory(categories).parentId
  );
  const [selectedChildCatId, setSelectedChildCatId] = useState(
    () => readSavedCategory(categories).childId
  );
  const [hasVariants, setHasVariants] = useState(false);
  const [variants, setVariants] = useState<VariantDraft[]>([{ color: "", stock: "" }]);
  const [barcode, setBarcode] = useState("");
  const [brand, setBrand] = useState("");
  const [price, setPrice] = useState("");
  // Datos privados de compra (van a `product_costs`, invisible para las tiendas)
  const [costPrice, setCostPrice] = useState("");
  const [supplier, setSupplier] = useState(() => readSavedSupplier());
  const [costNote, setCostNote] = useState("");
  // 条码查重：录入/扫码时若命中已有商品，提示直接加库存，避免建出重复商品
  const [dupStockQty, setDupStockQty] = useState("");
  const [dupAdding, setDupAdding] = useState(false);
  const [dupAdded, setDupAdded] = useState(false);
  // 待裁剪的原图（选择/拍照后先弹裁剪框，确认后才压缩上传）
  const [pendingCrop, setPendingCrop] = useState<File | null>(null);
  // 保留一份原图，"重新裁剪"时用原图而不是已裁剪过的图，避免越裁越小
  const [originalFile, setOriginalFile] = useState<File | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        LAST_CATEGORY_KEY,
        JSON.stringify({ parentId: selectedParentCatId, childId: selectedChildCatId })
      );
    } catch {
      /* 隐私模式等场景下 localStorage 可能不可用，忽略即可 */
    }
  }, [selectedParentCatId, selectedChildCatId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LAST_SUPPLIER_KEY, supplier);
    } catch {
      /* 隐私模式等场景下 localStorage 可能不可用，忽略即可 */
    }
  }, [supplier]);

  useEffect(() => {
    if (state && "success" in state) {
      // 分类、品牌、供应商大概率与下一件商品相同（同一批进货），特意不清空，
      // 减少连续添加时的重复选择/输入；其余字段（名称/价格/库存/图片等）逐件都不同，正常清空。
      formRef.current?.reset();
      // 提交成功后清空表单：响应 action state 变化，属于正当的副作用重置
      /* eslint-disable react-hooks/set-state-in-effect */
      setPrice("");
      setCostPrice("");
      setCostNote("");
      setImageUrl(null);
      setPreview(null);
      setPhase("idle");
      setUploadError(null);
      setHasVariants(false);
      setVariants([{ color: "", stock: "" }]);
      setBarcode("");
      setPendingCrop(null);
      setOriginalFile(null);
      setDupStockQty("");
      setDupAdded(false);
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [state]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setImageUrl(null);
      setPreview(null);
      setPhase("idle");
      setUploadError(null);
      return;
    }
    // 先弹裁剪框，确认之后再走压缩上传
    setOriginalFile(file);
    setPendingCrop(file);
  }

  function handleCropCancel() {
    setPendingCrop(null);
    // 清空 input 的值，这样用户重新选择同一张图片时浏览器仍会触发 change 事件
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleRecrop() {
    if (originalFile) setPendingCrop(originalFile);
  }

  async function handleCropConfirm(blob: Blob) {
    setPendingCrop(null);
    try {
      setPhase("compressing");
      setUploadError(null);
      setImageUrl(null);
      setPreview(null);
      const compressed = await compressToJpeg(blob, t);
      setPreview(URL.createObjectURL(compressed));
      setPhase("uploading");
      const supabase = createClient();
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
      const { error } = await supabase.storage
        .from("product-images")
        .upload(fileName, compressed, { contentType: "image/jpeg", upsert: false });
      if (error) throw new Error(error.message);
      const { data } = supabase.storage.from("product-images").getPublicUrl(fileName);
      setImageUrl(data.publicUrl);
      setPhase("done");
    } catch (err) {
      setPhase("error");
      setUploadError(err instanceof Error ? err.message : t("common.uploadFailed"));
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
    setOriginalFile(null);
  }

  const duplicateProduct = useMemo(() => {
    const norm = normalizeBarcode(barcode);
    if (!norm) return null;
    return products.find((p) => normalizeBarcode(p.barcode) === norm) ?? null;
  }, [barcode, products]);

  // 换了条码/清空条码时，上一次查重命中的"加库存"状态就不再适用了。
  // 渲染期间直接比对重置（而不是用 effect），命中变化的当次渲染就已经是干净状态。
  const [trackedDupId, setTrackedDupId] = useState<string | undefined>(undefined);
  if (duplicateProduct?.id !== trackedDupId) {
    setTrackedDupId(duplicateProduct?.id);
    setDupStockQty("");
    setDupAdded(false);
  }

  async function handleAddStockToDuplicate() {
    if (!duplicateProduct) return;
    const qty = parseInt(dupStockQty, 10);
    if (isNaN(qty) || qty <= 0) return;
    setDupAdding(true);
    setDupAdded(false);
    const result = await adjustStock(duplicateProduct.id, qty);
    setDupAdding(false);
    if (!("error" in result)) {
      setDupAdded(true);
      setDupStockQty("");
    }
  }

  function addVariantRow() {
    setVariants((prev) => [...prev, { color: "", stock: "" }]);
  }
  function removeVariantRow(idx: number) {
    setVariants((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateVariantRow(idx: number, field: "color" | "stock", value: string) {
    setVariants((prev) => prev.map((v, i) => (i === idx ? { ...v, [field]: value } : v)));
  }

  // AI 识别：第一张照片作为商品图。拍完立刻弹裁剪框——两个拍照入口都要一样，
  // 用户不该先看到"已上传"再自己去点「裁剪」。AI 识别在后台继续跑，互不影响；
  // 取消裁剪就保留原图。
  function handleAiImage(url: string, file: File) {
    setImageUrl(url);
    setPreview(url);
    setPhase("done");
    setUploadError(null);
    setOriginalFile(file);
    setPendingCrop(file);
  }

  // AI 识别：把结果填入各字段（名称/品牌/描述为非受控输入，直接写 DOM 值）
  function applyAiSuggestion(s: AiSuggestion) {
    const form = formRef.current;
    if (form) {
      const setField = (name: string, value: string) => {
        const el = form.elements.namedItem(name) as
          | HTMLInputElement
          | HTMLTextAreaElement
          | null;
        if (el && value) el.value = value;
      };
      setField("name", s.nombre);
      setField("description", s.descripcion);
    }
    if (s.marca) setBrand(s.marca);
    // 分类：按名称匹配到已有分类，自动选中大类/小类
    if (s.categoria) {
      const cat = categories.find((c) => c.name === s.categoria);
      if (cat) {
        if (cat.parent_id) {
          setSelectedParentCatId(cat.parent_id);
          setSelectedChildCatId(cat.id);
        } else {
          setSelectedParentCatId(cat.id);
          setSelectedChildCatId("");
        }
      }
    }
    // 条码候选（格式不对会在字段里标红，用户可改）
    if (s.codigo_barras) setBarcode(s.codigo_barras);
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
    <div className="rounded-2xl glass-strong p-6">
      <h2 className="mb-5 text-base font-semibold text-paper-900">{t("form.addProduct")}</h2>

      <form ref={formRef} action={action} className="space-y-4">
        {imageUrl && <input type="hidden" name="image_url" value={imageUrl} />}
        <input type="hidden" name="category_id" value={selectedChildCatId || selectedParentCatId} />
        <input type="hidden" name="has_variants" value={hasVariants ? "true" : "false"} />
        {hasVariants && <input type="hidden" name="variants" value={variantsJson} />}

        {/* AI 自动识别（可选）：拍照 → 自动填字段 + 首图作商品图 */}
        <AiRecognizePanel onImageUploaded={handleAiImage} onSuggestion={applyAiSuggestion} />

        {/* 名称 + 品牌 + 价格 */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-paper-700">
              {t("form.productName")} <span className="text-red-500">*</span>
            </label>
            <input
              name="name"
              type="text"
              required
              placeholder={t("form.productNamePlaceholder")}
              className="w-full rounded-lg border border-paper-300 px-3 py-2 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-paper-500 focus:ring-2 focus:ring-paper-300"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-paper-700">{t("form.brand")}</label>
            <TagPicker
              name="brand"
              value={brand}
              onChange={setBrand}
              options={brandOptions}
              placeholder={t("form.brandPlaceholder")}
            />
          </div>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-paper-700">
            {t("form.price")} <span className="text-red-500">*</span>
          </label>
          <input
            name="price"
            type="number"
            required
            min="0"
            step="0.01"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
            className="w-full rounded-lg border border-paper-300 px-3 py-2 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-paper-500 focus:ring-2 focus:ring-paper-300"
          />
        </div>

        {/* Coste y proveedor — privado, las tiendas no lo ven */}
        <PrivateCostFields
          costPrice={costPrice}
          onCostPrice={setCostPrice}
          supplier={supplier}
          onSupplier={setSupplier}
          note={costNote}
          onNote={setCostNote}
          supplierOptions={supplierOptions}
          salePrice={price}
          withHiddenInputs
        />

        {/* 条码（可选，支持手机摄像头扫码） */}
        <BarcodeField name="barcode" value={barcode} onChange={setBarcode} inputId="new-barcode" />

        {/* 条码查重：命中已有商品时，提示直接加库存而不是建重复商品 */}
        {duplicateProduct && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-800">
              {t("form.barcodeDuplicateWarning", { name: duplicateProduct.name })}
            </p>
            {duplicateProduct.has_variants ? (
              <p className="mt-1 text-xs text-amber-700">{t("form.barcodeDuplicateVariantsHint")}</p>
            ) : (
              <>
                <p className="mt-1 text-xs text-amber-700">
                  {t("form.barcodeDuplicateStock", { n: duplicateProduct.stock })}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={dupStockQty}
                    onChange={(e) => setDupStockQty(e.target.value)}
                    placeholder={t("form.stockShort")}
                    className="w-20 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-sm text-paper-900 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
                  />
                  <button
                    type="button"
                    disabled={dupAdding || !dupStockQty}
                    onClick={handleAddStockToDuplicate}
                    className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {dupAdding ? t("common.submitting") : t("form.barcodeDuplicateAddStock")}
                  </button>
                  {dupAdded && (
                    <span className="text-xs font-medium text-green-600">{t("form.barcodeDuplicateAdded")}</span>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* 描述 */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-paper-700">{t("form.description")}</label>
          <textarea
            name="description"
            rows={3}
            placeholder={t("form.descriptionPlaceholder")}
            className="w-full resize-none rounded-lg border border-paper-300 px-3 py-2 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-paper-500 focus:ring-2 focus:ring-paper-300"
          />
        </div>

        {/* 分类 */}
        {parentCategories.length > 0 && (
          <div>
            <label className="mb-1.5 block text-sm font-medium text-paper-700">{t("form.category")}</label>
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                value={selectedParentCatId}
                onChange={(e) => { setSelectedParentCatId(e.target.value); setSelectedChildCatId(""); }}
                className="w-full rounded-lg border border-paper-300 px-3 py-2 text-sm text-paper-900 outline-none focus:border-paper-500 focus:ring-2 focus:ring-paper-300"
              >
                <option value="">{t("form.noParent")}</option>
                {parentCategories.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {selectedParentCatId && childrenOf(selectedParentCatId).length > 0 && (
                <select
                  value={selectedChildCatId}
                  onChange={(e) => setSelectedChildCatId(e.target.value)}
                  className="w-full rounded-lg border border-paper-300 px-3 py-2 text-sm text-paper-900 outline-none focus:border-paper-500 focus:ring-2 focus:ring-paper-300"
                >
                  <option value="">{t("form.noChild")}</option>
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
                setVariants([{ color: "", stock: "" }]);
              }}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                hasVariants ? "bg-paper-700" : "bg-paper-300"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  hasVariants ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
            <span className="text-sm font-medium text-paper-700">{t("form.hasVariantsQuestion")}</span>
          </div>

          {!hasVariants ? (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-paper-700">
                {t("form.stock")} <span className="text-red-500">*</span>
              </label>
              <input
                name="stock"
                type="number"
                required
                min="0"
                step="1"
                placeholder="0"
                className="w-full rounded-lg border border-paper-300 px-3 py-2 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-paper-500 focus:ring-2 focus:ring-paper-300"
              />
            </div>
          ) : (
            <div>
              <input type="hidden" name="stock" value="0" />
              <div className="rounded-lg border border-paper-200 bg-paper-100 p-3">
                <p className="mb-2 text-xs font-medium text-paper-500">{t("form.variantsHint")}</p>
                <div className="space-y-2">
                  {variants.map((v, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder={t("form.colorPlaceholder")}
                        value={v.color}
                        onChange={(e) => updateVariantRow(idx, "color", e.target.value)}
                        className="flex-1 rounded-lg border border-paper-300 px-3 py-2 text-sm text-paper-900 outline-none focus:border-paper-500 focus:ring-2 focus:ring-paper-300"
                      />
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="0"
                        value={v.stock}
                        onChange={(e) => updateVariantRow(idx, "stock", e.target.value)}
                        onFocus={(e) => e.target.select()}
                        className="w-20 rounded-lg border border-paper-300 px-3 py-2 text-sm text-paper-900 outline-none focus:border-paper-500 focus:ring-2 focus:ring-paper-300"
                      />
                      {variants.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeVariantRow(idx)}
                          className="flex-shrink-0 rounded-lg p-1.5 text-paper-500 hover:bg-paper-200 hover:text-red-500"
                          aria-label={t("form.removeColor")}
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
                  className="mt-2 text-xs font-medium text-paper-500 hover:text-paper-900"
                >
                  {t("form.addColor")}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 图片上传 */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-paper-700">{t("form.productImage")}</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="w-full rounded-lg border border-paper-300 px-3 py-2 text-sm text-paper-600 outline-none file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-paper-100 file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-paper-700 hover:file:bg-paper-200"
          />
          {phase === "compressing" && <p className="mt-1.5 text-xs text-paper-500">{t("form.compressing")}</p>}
          {phase === "uploading" && <p className="mt-1.5 text-xs text-paper-500">{t("form.uploadingStorage")}</p>}
          {phase === "error" && <p className="mt-1.5 text-xs text-red-500">{uploadError}</p>}
        </div>

        {preview && (
          <div className="flex items-center gap-3 rounded-lg border border-paper-100 bg-paper-100 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt={t("form.previewAlt")} className="h-16 w-16 rounded-lg object-cover" />
            <div className="flex-1 text-xs">
              {phase === "done" && <p className="font-medium text-green-600">{t("form.imageUploaded")}</p>}
              {uploading && <p className="text-paper-500">{t("common.processing")}</p>}
            </div>
            {phase === "done" && originalFile && (
              <button
                type="button"
                onClick={handleRecrop}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-paper-700 hover:bg-paper-200"
              >
                {t("form.crop")}
              </button>
            )}
            {phase === "done" && (
              <button
                type="button"
                onClick={handleDeleteImage}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50"
              >
                {t("form.deleteImage")}
              </button>
            )}
          </div>
        )}

        {pendingCrop && (
          <ImageCropModal file={pendingCrop} onCancel={handleCropCancel} onConfirm={handleCropConfirm} />
        )}

        {state && "error" in state && (
          <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{state.error}</p>
        )}
        {state && "success" in state && (
          <p className="rounded-lg bg-green-50 px-4 py-2.5 text-sm text-green-600">{t("form.productAdded")}</p>
        )}

        <div className="pt-1">
          <button
            type="submit"
            disabled={pending || uploading}
            className="rounded-lg bg-paper-700 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-paper-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? t("form.uploadingImage") : pending ? t("common.submitting") : t("form.addProduct")}
          </button>
        </div>
      </form>
    </div>
  );
}
