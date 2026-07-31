"use client";

import { useRef, useState, useTransition, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { updateProduct, upsertVariants, type ActionResult } from "./actions";
import BarcodeField from "./barcode-scanner";
import ImageCropModal from "./image-crop-modal";
import TagPicker, { canonicalTag } from "./tag-picker";
import PrivateCostFields from "./private-cost-fields";
import ModalPortal from "@/app/modal-portal";
import { parseDecimal, sanitizeDecimalText } from "@/lib/decimal";
import { useImageLightbox } from "@/app/image-lightbox";
import { useT } from "@/lib/i18n/client";
import type { Translate } from "@/lib/i18n/translate";

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

function compressToJpeg(file: File | Blob, t: Translate, maxWidth = 1200, quality = 0.8): Promise<Blob> {
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
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error(t("common.imageLoadFailed"))); };
    img.src = objectUrl;
  });
}

export default function ProductEditModal({
  product,
  categories,
  variantsForProduct,
  cost,
  brandOptions = [],
  supplierOptions = [],
  onClose,
  onSaved,
}: {
  product: Product;
  categories: Category[];
  variantsForProduct: ProductVariant[];
  /**
   * Datos privados de compra ya guardados. `null` = el producto no tiene ficha
   * todavía pero se puede rellenar aquí; `undefined` = esta pantalla no gestiona
   * costes, así que el bloque no se muestra y al guardar NO se toca lo que
   * hubiera en la base de datos (si no, abrir y guardar borraría el coste).
   */
  cost?: { cost_price: number | null; supplier: string | null; note: string | null } | null;
  brandOptions?: string[];
  supplierOptions?: string[];
  onClose: () => void;
  onSaved?: () => void;
}) {
  const t = useT();
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
  const managesCost = cost !== undefined;
  const [editCostPrice, setEditCostPrice] = useState(
    cost?.cost_price == null ? "" : String(cost.cost_price)
  );
  const [editSupplier, setEditSupplier] = useState(cost?.supplier ?? "");
  const [editCostNote, setEditCostNote] = useState(cost?.note ?? "");
  const [newImageUrl, setNewImageUrl] = useState<string | null | undefined>(undefined);
  const [preview, setPreview] = useState<string | null>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Foto elegida pendiente de recortar (se sube después de aceptar el recorte)
  const [pendingCrop, setPendingCrop] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saveResult, setSaveResult] = useState<ActionResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const lightbox = useImageLightbox(); // 图片放大灯箱（复用全站统一组件）

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

  // Igual que al añadir un producto: la foto elegida pasa primero por el
  // recorte y solo se sube lo que se acepte ahí.
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) { setNewImageUrl(undefined); setPreview(null); setPhase("idle"); return; }
    setPendingCrop(file);
  }

  function handleCropCancel() {
    setPendingCrop(null);
    // Vaciar el input: si no, al volver a elegir la MISMA foto el navegador no
    // dispara `change` y no pasa nada.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleCropConfirm(cropped: Blob) {
    setPendingCrop(null);
    try {
      setPhase("compressing"); setUploadError(null);
      const blob = await compressToJpeg(cropped, t);
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
      setUploadError(err instanceof Error ? err.message : t("common.uploadFailed"));
    }
  }

  async function handleDeleteImage() {
    // 只删「这次刚传上来、还没保存」的那张：它没有别的引用，删掉即回收。
    // 商品原有的图片在这里【不能】真删——用户点完 ✕ 再点「取消」，商品行里的
    // image_url 还指着这个文件，结果就是一张永久裂图，且无法恢复。
    // 保存时把 image_url 置空即可，存储里留个孤儿文件远比丢图划算。
    if (typeof newImageUrl === "string") {
      try {
        const fileName = newImageUrl.split("/product-images/").pop();
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
    setEditVariants((prev) => [...prev, { color: "", stock: "", sort_order: prev.length }]);
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
        price: parseDecimal(editPrice),
        stock: editHasVariants ? 0 : parseInt(editStock, 10),
        newImageUrl,
        category_id: editChildCatId || editParentCatId || null,
        has_variants: editHasVariants,
        brand: canonicalTag(editBrand, brandOptions) || null,
        barcode: editBarcode,
        cost: managesCost
          ? {
              cost_price: editCostPrice.trim() === "" ? null : parseDecimal(editCostPrice),
              supplier: canonicalTag(editSupplier, supplierOptions) || null,
              note: editCostNote.trim() || null,
            }
          : undefined,
      });
      if ("error" in result) { setSaveResult(result); setIsSaving(false); return; }
      // Si el producto deja de tener variantes, sus filas de color ya no pintan nada:
      // se borran en el mismo guardado. Antes se quedaban huérfanas en la base de datos
      // (invisibles, pero acumulándose y listas para resucitar con datos viejos si se
      // volvía a activar el interruptor).
      const variantInputs = editVariants.map((v, i) => ({
        id: v.id,
        color: v.color,
        stock: parseInt(v.stock, 10) || 0,
        sort_order: i,
        _delete: editHasVariants ? v._delete : true,
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
    <ModalPortal>
    {/* 图片放大灯箱 */}
    {lightbox.node}
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* En el móvil ocupa toda la pantalla (100dvh cuenta con la barra del
          navegador); en pantallas grandes sigue siendo una tarjeta centrada. */}
      <div className="flex h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-none bg-white shadow-2xl sm:h-auto sm:max-h-[92vh] sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-paper-100 px-6 py-4">
          <h2 className="text-base font-semibold text-paper-900">{t("edit.title")}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-paper-500 transition-colors hover:bg-paper-100 hover:text-paper-600">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="space-y-4 px-6 py-5">
            {/* 名称 */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-paper-700">
                {t("form.productName")} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full rounded-lg border border-paper-300 px-3 py-2 text-sm text-paper-900 outline-none focus:border-paper-500 focus:ring-2 focus:ring-paper-300"
              />
            </div>

            {/* 品牌 */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-paper-700">{t("form.brand")}</label>
              <TagPicker
                value={editBrand}
                onChange={setEditBrand}
                options={brandOptions}
                placeholder={t("form.brandPlaceholder")}
              />
            </div>

            {/* 条码（可选，支持手机摄像头扫码） */}
            <BarcodeField value={editBarcode} onChange={setEditBarcode} inputId={`edit-barcode-${product.id}`} />

            {/* 价格 */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-paper-700">
                {t("form.price")} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={editPrice}
                onChange={(e) => setEditPrice(sanitizeDecimalText(e.target.value))}
                onFocus={(e) => e.target.select()}
                placeholder="0.00"
                className="w-full rounded-lg border border-paper-300 px-3 py-2 text-sm text-paper-900 outline-none focus:border-paper-500 focus:ring-2 focus:ring-paper-300"
              />
            </div>

            {/* Coste y proveedor — privado, las tiendas no lo ven */}
            {managesCost && (
            <PrivateCostFields
              costPrice={editCostPrice}
              onCostPrice={setEditCostPrice}
              supplier={editSupplier}
              onSupplier={setEditSupplier}
              note={editCostNote}
              onNote={setEditCostNote}
              supplierOptions={supplierOptions}
              salePrice={editPrice}
            />
            )}

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
                      setEditVariants([{ color: "", stock: "", sort_order: 0 }]);
                    }
                  }}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${editHasVariants ? "bg-paper-700" : "bg-paper-300"}`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${editHasVariants ? "translate-x-6" : "translate-x-1"}`} />
                </button>
                <span className="text-sm font-medium text-paper-700">{t("edit.hasVariants")}</span>
              </div>

              {!editHasVariants ? (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-paper-700">
                    {t("form.stock")} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={editStock}
                    onChange={(e) => setEditStock(e.target.value)}
                    onFocus={(e) => e.target.select()}
                    className="w-full rounded-lg border border-paper-300 px-3 py-2 text-sm text-paper-900 outline-none focus:border-paper-500 focus:ring-2 focus:ring-paper-300"
                  />
                </div>
              ) : (
                <div className="rounded-lg border border-paper-200 bg-paper-100 p-3">
                  <p className="mb-2 text-xs font-medium text-paper-500">{t("edit.variantsHint")}</p>
                  <div className="space-y-2">
                    {visibleEditVariants.map((v) => {
                      const realIdx = editVariants.indexOf(v);
                      return (
                        <div key={realIdx} className="flex items-center gap-2">
                          <input
                            type="text"
                            placeholder={t("edit.colorPlaceholder")}
                            value={v.color}
                            onChange={(e) => updateVariantRow(realIdx, "color", e.target.value)}
                            className="flex-1 rounded-lg border border-paper-300 px-3 py-2 text-sm text-paper-900 outline-none focus:border-paper-500 focus:ring-2 focus:ring-paper-300"
                          />
                          <input
                            type="number"
                            min="0"
                            step="1"
                            placeholder="0"
                            value={v.stock}
                            onChange={(e) => updateVariantRow(realIdx, "stock", e.target.value)}
                            onFocus={(e) => e.target.select()}
                            className="w-20 rounded-lg border border-paper-300 px-3 py-2 text-sm text-paper-900 outline-none focus:border-paper-500 focus:ring-2 focus:ring-paper-300"
                          />
                          {visibleEditVariants.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeVariantRow(realIdx)}
                              className="flex-shrink-0 rounded-lg p-1.5 text-paper-500 hover:bg-paper-200 hover:text-red-500"
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
                  <button type="button" onClick={addVariantRow} className="mt-2 text-xs font-medium text-paper-500 hover:text-paper-900">
                    {t("form.addColor")}
                  </button>
                </div>
              )}
            </div>

            {/* 描述 */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-paper-700">{t("form.description")}</label>
              <textarea
                rows={2}
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder={t("edit.descriptionPlaceholder")}
                className="w-full resize-none rounded-lg border border-paper-300 px-3 py-2 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-paper-500 focus:ring-2 focus:ring-paper-300"
              />
            </div>

            {/* 分类 */}
            {parentCategories.length > 0 && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-paper-700">{t("form.category")}</label>
                <div className="grid grid-cols-2 gap-3">
                  <select
                    value={editParentCatId}
                    onChange={(e) => { setEditParentCatId(e.target.value); setEditChildCatId(""); }}
                    className="w-full rounded-lg border border-paper-300 px-3 py-2 text-sm text-paper-900 outline-none focus:border-paper-500 focus:ring-2 focus:ring-paper-300"
                  >
                    <option value="">{t("form.noParent")}</option>
                    {parentCategories.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  {editParentCatId && childrenOf(editParentCatId).length > 0 && (
                    <select
                      value={editChildCatId}
                      onChange={(e) => setEditChildCatId(e.target.value)}
                      className="w-full rounded-lg border border-paper-300 px-3 py-2 text-sm text-paper-900 outline-none focus:border-paper-500 focus:ring-2 focus:ring-paper-300"
                    >
                      <option value="">{t("form.noChild")}</option>
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
              <label className="mb-1.5 block text-sm font-medium text-paper-700">
                {t("form.productImage")}
                <span className="ml-1.5 font-normal text-paper-500">{t("edit.imageKeepHint")}</span>
              </label>
              <div className="flex items-start gap-3">
                {displayImage && (
                  <div className="relative flex-shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={displayImage}
                      alt={t("edit.imagePreviewAlt")}
                      onClick={() => lightbox.open(displayImage, product.name)}
                      title={t("edit.clickToZoom")}
                      className="h-16 w-16 cursor-zoom-in rounded-lg object-cover ring-1 ring-paper-300 transition hover:ring-paper-400"
                    />
                    <button
                      type="button"
                      onClick={handleDeleteImage}
                      title={t("form.deleteImage")}
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
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="w-full rounded-lg border border-paper-300 px-3 py-2 text-sm text-paper-600 outline-none file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-paper-100 file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-paper-700 hover:file:bg-paper-200"
                  />
                  {phase === "compressing" && <p className="mt-1 text-xs text-paper-500">{t("edit.compressing")}</p>}
                  {phase === "uploading" && <p className="mt-1 text-xs text-paper-500">{t("edit.uploading")}</p>}
                  {phase === "done" && <p className="mt-1 text-xs text-green-600">{t("edit.uploaded")}</p>}
                  {phase === "error" && <p className="mt-1 text-xs text-red-500">{uploadError}</p>}
                </div>
              </div>
              {!displayImage && newImageUrl !== null && (
                <p className="mt-1 text-xs text-paper-500">{t("edit.noImageHint")}</p>
              )}
              {newImageUrl === null && (
                <p className="mt-1 text-xs text-amber-600">{t("edit.imageWillDelete")}</p>
              )}
            </div>

            {pendingCrop && (
              <ImageCropModal
                file={pendingCrop}
                onCancel={handleCropCancel}
                onConfirm={handleCropConfirm}
              />
            )}

            {saveResult && "error" in saveResult && (
              <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{saveResult.error}</p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-paper-100 px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-paper-200 px-4 py-2 text-sm font-medium text-paper-700 transition-colors hover:bg-paper-100"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={isSaving || uploading}
            onClick={handleSave}
            className="rounded-lg bg-paper-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-paper-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? t("common.saving") : uploading ? t("form.uploadingImage") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
