"use client";

import { useState, useTransition, useMemo, useRef, useEffect } from "react";
import Image from "next/image";
import {
  deleteProduct,
  toggleProductActive,
  adjustStock,
  adjustVariantStock,
  setProductNewIn,
  type ProductCost,
  type ProductVariant,
} from "./actions";
import type { Category } from "@/app/admin/categories/categories-client";
import ProductEditModal from "./product-edit-modal";
import { getTotalStock, isLowStock as isLowStockOf } from "@/lib/stock";
import ScanButton from "@/app/scan-button";
import { useImageLightbox } from "@/app/image-lightbox";
import { productImages } from "@/lib/product-images";
import { NEW_IN_DAYS, isNewIn, newInDaysLeft } from "@/lib/new-in";
import { useI18n } from "@/lib/i18n/client";
import { sortByName } from "@/lib/sort";

export type Product = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  stock: number;
  image_url: string | null;
  image_urls: string[] | null;
  is_active: boolean;
  category_id: string | null;
  has_variants: boolean;
  brand: string | null;
  barcode: string | null;
  created_at: string;
  /** Fin del periodo «New in»; null/ausente = no es novedad. */
  new_until?: string | null;
};

type Tab = "recent" | "by-category";
type StatusFilter = "all" | "active" | "inactive" | "low-stock" | "new-in";


export default function ProductList({
  products,
  categories,
  variants,
  costs = [],
  brandOptions = [],
  supplierOptions = [],
}: {
  products: Product[];
  categories: Category[];
  variants: ProductVariant[];
  costs?: ProductCost[];
  brandOptions?: string[];
  supplierOptions?: string[];
}) {
  const { t, tag } = useI18n();
  const lightbox = useImageLightbox();

  // Coste/proveedor por producto. Esta pantalla es solo del almacén, y la tabla
  // `product_costs` ya tiene RLS de solo-almacén: si un empleado llegase aquí,
  // el mapa vendría vacío igualmente.
  const costByProduct = useMemo(() => {
    const map = new Map<string, ProductCost>();
    for (const c of costs) map.set(c.product_id, c);
    return map;
  }, [costs]);

  // ── 分类辅助 ──
  // Alfabético: el filtro lateral y las cabeceras de grupo se leen buscando un
  // nombre, no por el orden en que se crearon las categorías.
  const sortedCategories = useMemo(() => sortByName(categories, tag), [categories, tag]);
  const parentCategories = useMemo(
    () => sortedCategories.filter((c) => !c.parent_id),
    [sortedCategories]
  );

  function categoryLabel(categoryId: string | null) {
    if (!categoryId) return t("common.uncategorized");
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return t("common.uncategorized");
    if (!cat.parent_id) return cat.name;
    const parent = categories.find((c) => c.id === cat.parent_id);
    return parent ? `${parent.name} › ${cat.name}` : cat.name;
  }

  function getParentCatId(product: Product): string | null {
    if (!product.category_id) return null;
    const cat = categories.find((c) => c.id === product.category_id);
    if (!cat) return null;
    return cat.parent_id ?? cat.id;
  }

  function variantsFor(productId: string) {
    return variants.filter((v) => v.product_id === productId);
  }

  function isLowStock(product: Product) {
    return isLowStockOf(product, variantsFor(product.id));
  }

  // 商品总库存（有变体则为各颜色合计，否则为 products.stock）
  function totalStockOf(product: Product) {
    return getTotalStock(product, variantsFor(product.id));
  }

  // ── 筛选 & 标签页状态 ──
  const [adminSearch, setAdminSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState<StatusFilter>("all");
  const [stockLessThan, setStockLessThan] = useState(""); // 按库存合计筛选：少于 N 件
  const [activeTab, setActiveTab] = useState<Tab>("recent");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // ── 分类/状态抽屉：默认收起，桌面端悬停自动展开，触屏点击展开 ──
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const canHoverRef = useRef(false);
  useEffect(() => {
    canHoverRef.current = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }, []);
  function openSidebarOnHover() {
    if (canHoverRef.current) setSidebarOpen(true);
  }
  function closeSidebarOnHover() {
    if (canHoverRef.current) setSidebarOpen(false);
  }

  // ── 编辑弹窗状态 ──
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // ── 表格操作状态 ──
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [markingNewInId, setMarkingNewInId] = useState<string | null>(null);
  const [newInError, setNewInError] = useState<string | null>(null);
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [adjustQty, setAdjustQty] = useState<Record<string, string>>({});
  const [adjustErrors, setAdjustErrors] = useState<Record<string, string>>({});
  const [adjustingVariantId, setAdjustingVariantId] = useState<string | null>(null);

  const [, startTransition] = useTransition();

  // ── 计算过滤结果 ──
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (adminSearch.trim()) {
        const q = adminSearch.trim().toLowerCase();
        // También por proveedor: «¿qué le compré a Fulano?» es una pregunta
        // frecuente y el proveedor no se ve en ningún otro filtro.
        const supplier = costByProduct.get(p.id)?.supplier ?? "";
        if (
          !p.name.toLowerCase().includes(q) &&
          !(p.brand?.toLowerCase().includes(q) ?? false) &&
          !supplier.toLowerCase().includes(q)
        ) return false;
      }
      if (filterCategory === "__uncategorized__") {
        if (p.category_id !== null) return false;
      } else if (filterCategory !== "") {
        if (getParentCatId(p) !== filterCategory) return false;
      }
      if (filterStatus === "active" && !p.is_active) return false;
      if (filterStatus === "inactive" && p.is_active) return false;
      if (filterStatus === "low-stock" && !isLowStock(p)) return false;
      if (filterStatus === "new-in" && !isNewIn(p)) return false;
      const lt = parseInt(stockLessThan, 10);
      if (!isNaN(lt) && lt > 0 && totalStockOf(p) >= lt) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, adminSearch, filterCategory, filterStatus, stockLessThan, categories, variants, costByProduct]);

  // "最近添加" tab：按 created_at 倒序
  const recentProducts = useMemo(
    () => [...filteredProducts].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [filteredProducts]
  );

  // "按分类浏览" tab：按父分类分组
  const groupedProducts = useMemo(() => {
    const map = new Map<string | null, Product[]>();
    for (const p of filteredProducts) {
      const parentId = getParentCatId(p);
      if (!map.has(parentId)) map.set(parentId, []);
      map.get(parentId)!.push(p);
    }
    const groups: Array<{ catId: string | null; catName: string; items: Product[] }> = [];
    for (const parent of parentCategories) {
      if (map.has(parent.id)) {
        groups.push({ catId: parent.id, catName: parent.name, items: map.get(parent.id)! });
      }
    }
    if (map.has(null)) {
      groups.push({ catId: null, catName: t("common.uncategorized"), items: map.get(null)! });
    }
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredProducts, parentCategories, categories]);

  // ── 侧栏计数：按分类/状态统计商品数（基于全量 products，不随筛选变化，方便一眼看清全貌） ──
  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    let uncategorized = 0;
    for (const p of products) {
      const parentId = getParentCatId(p);
      if (parentId === null) {
        uncategorized++;
        continue;
      }
      map.set(parentId, (map.get(parentId) ?? 0) + 1);
    }
    return { map, uncategorized };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, categories]);

  const statusCounts = useMemo(() => {
    let active = 0;
    let inactive = 0;
    let low = 0;
    let newIn = 0;
    for (const p of products) {
      if (p.is_active) active++;
      else inactive++;
      if (isLowStock(p)) low++;
      if (isNewIn(p)) newIn++;
    }
    return { active, inactive, low, newIn };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, variants]);

  function toggleGroup(catId: string | null) {
    const key = catId ?? "__null__";
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function isGroupCollapsed(catId: string | null) {
    return collapsedGroups.has(catId ?? "__null__");
  }

  // ── 打开/关闭编辑弹窗 ──
  function openEdit(product: Product) {
    setEditingProduct(product);
  }

  // ── 扫码查找并编辑：按条码定位商品，命中即开编辑弹窗；未命中则填入搜索框提示 ──
  const [scanMiss, setScanMiss] = useState<string | null>(null);
  function handleScanFind(code: string) {
    const c = code.trim();
    if (!c) return;
    const hit = products.find((p) => (p.barcode ?? "").trim() === c);
    if (hit) {
      setScanMiss(null);
      setEditingProduct(hit);
    } else {
      setAdminSearch(c);
      setScanMiss(c);
    }
  }

  function closeEdit() {
    setEditingProduct(null);
  }

  // ── 上架/下架 ──
  function handleToggleActive(product: Product) {
    setTogglingId(product.id);
    startTransition(async () => {
      await toggleProductActive(product.id, !product.is_active);
      setTogglingId(null);
    });
  }

  // ── 加入/移出「New in」──
  function handleToggleNewIn(product: Product) {
    setMarkingNewInId(product.id);
    setNewInError(null);
    startTransition(async () => {
      const result = await setProductNewIn(product.id, !isNewIn(product));
      setMarkingNewInId(null);
      if ("error" in result) setNewInError(result.error);
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
  function handleAdjustVariant(variantId: string, delta: number | null) {
    let d: number;
    if (delta === null) {
      d = parseInt(adjustQty[variantId] ?? "0", 10);
      if (isNaN(d) || d <= 0) return;
    } else {
      d = delta;
    }
    setAdjustingVariantId(variantId);
    startTransition(async () => {
      await adjustVariantStock(variantId, d);
      setAdjustingVariantId(null);
      if (delta === null) setAdjustQty((prev) => ({ ...prev, [variantId]: "" }));
    });
  }

  // ── 删除商品 ──
  function handleDelete(product: Product) {
    if (!window.confirm(t("list.confirmDelete", { name: product.name }))) return;
    setDeletingId(product.id);
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteProduct(product.id);
      setDeletingId(null);
      if ("error" in result) setDeleteError(result.error);
    });
  }

  // ── 共用行渲染 ──
  // Línea privada de compra: coste + proveedor. Marcada con un candado para que
  // quede claro de un vistazo que eso no lo ve nadie más.
  function renderPrivateInfo(product: Product) {
    const c = costByProduct.get(product.id);
    if (!c || (c.cost_price == null && !c.supplier)) return null;
    const profit = c.cost_price == null ? null : Number(product.price) - Number(c.cost_price);
    return (
      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-amber-700">
        <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        {c.cost_price != null && <span className="font-medium">€{Number(c.cost_price).toFixed(2)}</span>}
        {profit != null && (
          <span className={profit >= 0 ? "text-green-700" : "text-red-600"}>
            {profit >= 0 ? "+" : ""}€{profit.toFixed(2)}
          </span>
        )}
        {c.supplier && <span className="truncate">· {c.supplier}</span>}
      </p>
    );
  }

  // «New in»: la misma chapa sirve de indicador y de interruptor. Encendida
  // dice cuántos días le quedan; apagada es el atajo para marcar la novedad
  // sin abrir la ficha (marcar de nuevo reinicia el plazo).
  function renderNewInChip(product: Product) {
    const active = isNewIn(product);
    const busy = markingNewInId === product.id;
    const daysLeft = newInDaysLeft(product);
    return (
      <button
        type="button"
        disabled={busy}
        onClick={(e) => { e.stopPropagation(); handleToggleNewIn(product); }}
        title={active ? t("newIn.restart", { n: NEW_IN_DAYS }) : t("newIn.formHint", { n: NEW_IN_DAYS })}
        className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 ${
          active
            ? "bg-accent-50 text-accent-600 hover:bg-accent-100"
            : "text-paper-400 hover:bg-paper-100 hover:text-paper-600"
        }`}
      >
        {busy ? "…" : active ? `${t("newIn.badge")} · ${daysLeft}d` : t("newIn.markShort")}
      </button>
    );
  }

  function renderRow(product: Product) {
    const isDeleting = deletingId === product.id;
    const isToggling = togglingId === product.id;
    const pvs = variantsFor(product.id);
    const photos = productImages(product);

    return (
      <tr
        key={product.id}
        onClick={() => openEdit(product)}
        title={t("list.clickToEdit")}
        className={`group cursor-pointer hover:bg-paper-100/80 ${!product.is_active ? "opacity-50" : ""}`}
      >
        {/* 图片（点击看大图，不触发整行编辑） */}
        <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
          {photos.length > 0 ? (
            <button
              type="button"
              onClick={() => lightbox.open(photos, product.name)}
              title={
                photos.length > 1
                  ? t("common.viewPhotos", { n: photos.length, name: product.name })
                  : t("common.viewPhoto", { name: product.name })
              }
              className="relative block h-10 w-10 cursor-zoom-in overflow-hidden rounded-md ring-1 ring-transparent transition hover:ring-paper-400"
            >
              <Image
                src={photos[0]}
                alt={product.name}
                width={40}
                height={40}
                className="h-10 w-10 object-cover"
              />
              {photos.length > 1 && (
                <span className="absolute bottom-0 right-0 rounded-tl-md bg-paper-900/70 px-1 font-mono text-[9px] leading-4 text-white">
                  {photos.length}
                </span>
              )}
            </button>
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-paper-100 text-paper-400">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}
        </td>

        {/* 名称 / 品牌 / 分类 */}
        <td className="px-3 py-1.5 max-w-[260px]">
          <p className="truncate text-sm font-medium leading-snug text-paper-900">{product.name}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            {product.brand && (
              <span className="rounded bg-paper-100 px-1.5 py-0.5 text-xs font-medium text-paper-600">
                {product.brand}
              </span>
            )}
            <span className={`text-xs ${product.category_id ? "text-paper-500" : "text-paper-400"}`}>
              {categoryLabel(product.category_id)}
            </span>
            {product.has_variants && pvs.length > 0 && (
              <span className="text-xs text-blue-500">{t("list.colorsCount", { n: pvs.length })}</span>
            )}
            <span onClick={(e) => e.stopPropagation()}>{renderNewInChip(product)}</span>
          </div>
          {renderPrivateInfo(product)}
        </td>

        {/* 价格 */}
        <td className="px-3 py-1.5 whitespace-nowrap text-sm text-paper-700">
          €{Number(product.price).toFixed(2)}
        </td>

        {/* 条码 */}
        <td className="px-3 py-1.5 whitespace-nowrap font-mono text-xs text-paper-500">
          {product.barcode ? product.barcode : <span className="text-paper-400">—</span>}
        </td>

        {/* 库存 */}
        <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
          {product.has_variants ? (
            <div className="space-y-1">
              {pvs.length === 0 ? (
                <span className="text-xs text-paper-500">{t("list.noVariants")}</span>
              ) : (
                pvs.map((variant) => (
                  <div key={variant.id} className="flex items-center gap-1 flex-nowrap">
                    <span className="w-14 shrink-0 truncate text-xs text-paper-600">{variant.color}</span>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium leading-none ${
                      variant.stock === 0 ? "bg-red-50 text-red-600"
                        : variant.stock <= 5 ? "bg-amber-50 text-amber-600"
                        : "bg-green-50 text-green-600"
                    }`}>
                      {variant.stock === 0 ? t("common.soldOut") : variant.stock}
                    </span>
                    <button
                      type="button"
                      disabled={adjustingVariantId === variant.id}
                      onClick={() => handleAdjustVariant(variant.id, 1)}
                      className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium bg-paper-100 text-paper-600 hover:bg-paper-200 disabled:opacity-40 transition-colors"
                    >
                      +1
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={adjustQty[variant.id] ?? ""}
                      onChange={(e) => setAdjustQty((prev) => ({ ...prev, [variant.id]: e.target.value }))}
                      placeholder="N"
                      className="w-9 shrink-0 rounded border border-paper-200 px-1 py-0.5 text-xs text-paper-900 outline-none focus:border-paper-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <button
                      type="button"
                      disabled={adjustingVariantId === variant.id || !adjustQty[variant.id]}
                      onClick={() => handleAdjustVariant(variant.id, null)}
                      className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium bg-paper-100 text-paper-600 hover:bg-paper-200 disabled:opacity-40 transition-colors"
                    >
                      {adjustingVariantId === variant.id ? "…" : t("list.addStock")}
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1 flex-nowrap">
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium leading-none ${
                product.stock === 0 ? "bg-red-50 text-red-600"
                  : product.stock <= 5 ? "bg-amber-50 text-amber-600"
                  : "bg-green-50 text-green-600"
              }`}>
                {product.stock === 0 ? t("common.soldOut") : product.stock}
              </span>
              <button
                type="button"
                disabled={adjustingId === product.id}
                onClick={() => handleAdjust(product.id, 1)}
                className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium bg-paper-100 text-paper-600 hover:bg-paper-200 disabled:opacity-40 transition-colors"
              >
                +1
              </button>
              <input
                type="number"
                min="1"
                value={adjustQty[product.id] ?? ""}
                onChange={(e) => setAdjustQty((prev) => ({ ...prev, [product.id]: e.target.value }))}
                placeholder="N"
                className="w-9 shrink-0 rounded border border-paper-200 px-1 py-0.5 text-xs text-paper-900 outline-none focus:border-paper-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <button
                type="button"
                disabled={adjustingId === product.id || !adjustQty[product.id]}
                onClick={() => handleAdjust(product.id, null)}
                className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium bg-paper-100 text-paper-600 hover:bg-paper-200 disabled:opacity-40 transition-colors"
              >
                {adjustingId === product.id ? "…" : t("list.addStock")}
              </button>
              {adjustErrors[product.id] && (
                <span className="text-xs text-red-500">{adjustErrors[product.id]}</span>
              )}
            </div>
          )}
        </td>

        {/* 状态 */}
        <td className="px-3 py-1.5">
          <button
            type="button"
            disabled={isToggling}
            onClick={(e) => { e.stopPropagation(); handleToggleActive(product); }}
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              product.is_active
                ? "bg-green-50 text-green-700 hover:bg-green-100"
                : "bg-paper-100 text-paper-500 hover:bg-paper-200"
            }`}
          >
            {isToggling ? "…" : product.is_active ? t("list.activeArrow") : t("list.inactiveArrow")}
          </button>
        </td>

        {/* 操作（桌面端：整行可点击编辑，这里仅保留删除） */}
        <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              disabled={isDeleting}
              onClick={() => handleDelete(product)}
              className="rounded px-2.5 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-40"
            >
              {isDeleting ? "…" : t("common.delete")}
            </button>
          </div>
        </td>
      </tr>
    );
  }

  // ── 手机端卡片渲染 ──
  function renderCard(product: Product) {
    const isDeleting = deletingId === product.id;
    const isToggling = togglingId === product.id;
    const pvs = variantsFor(product.id);
    const photos = productImages(product);

    return (
      <div
        key={product.id}
        className={`overflow-hidden rounded-2xl glass-strong${!product.is_active ? " opacity-60" : ""}`}
      >
        {/* 主信息行 */}
        <div className="flex items-start gap-3 p-3">
          {photos.length > 0 ? (
            <button
              type="button"
              onClick={() => lightbox.open(photos, product.name)}
              title={
                photos.length > 1
                  ? t("common.viewPhotos", { n: photos.length, name: product.name })
                  : t("common.viewPhoto", { name: product.name })
              }
              className="relative h-14 w-14 shrink-0 cursor-zoom-in overflow-hidden rounded-lg"
            >
              <Image src={photos[0]} alt={product.name} width={56} height={56}
                className="h-full w-full object-cover" />
              {photos.length > 1 && (
                <span className="absolute bottom-0 right-0 rounded-tl-md bg-paper-900/70 px-1 font-mono text-[9px] leading-4 text-white">
                  {photos.length}
                </span>
              )}
            </button>
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-paper-100 text-paper-400">
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-semibold leading-snug text-paper-900">{product.name}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1">
              {product.brand && (
                <span className="rounded bg-paper-100 px-1.5 py-0.5 text-xs font-medium text-paper-600">{product.brand}</span>
              )}
              <span className={`text-xs ${product.category_id ? "text-paper-500" : "text-paper-400"}`}>
                {categoryLabel(product.category_id)}
              </span>
              {product.has_variants && pvs.length > 0 && (
                <span className="text-xs text-blue-500">{t("list.colorsCount", { n: pvs.length })}</span>
              )}
              {renderNewInChip(product)}
            </div>
            <p className="mt-1 text-sm font-bold text-paper-900">€{Number(product.price).toFixed(2)}</p>
            {renderPrivateInfo(product)}
            {product.barcode && (
              <p className="mt-0.5 flex items-center gap-1 font-mono text-[11px] text-paper-500">
                <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 5a1 1 0 011-1h1m12 0h1a1 1 0 011 1v1m0 12v1a1 1 0 01-1 1h-1M6 20H5a1 1 0 01-1-1v-1M4 12h16M8 8v8m4-8v8m4-8v8" />
                </svg>
                <span className="truncate">{product.barcode}</span>
              </p>
            )}
          </div>
          <button
            type="button"
            disabled={isToggling}
            onClick={(e) => { e.stopPropagation(); handleToggleActive(product); }}
            className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
              product.is_active
                ? "bg-green-50 text-green-700 hover:bg-green-100"
                : "bg-paper-100 text-paper-500 hover:bg-paper-200"
            }`}
          >
            {isToggling ? "…" : product.is_active ? t("list.active") : t("list.inactive")}
          </button>
        </div>

        {/* 库存快捷调整 */}
        <div className="border-t border-paper-100 bg-paper-100/50 px-3 py-2">
          {product.has_variants ? (
            <div className="space-y-1.5">
              {pvs.length === 0 ? (
                <span className="text-xs text-paper-500">{t("list.noVariants")}</span>
              ) : (
                pvs.map((variant) => (
                  <div key={variant.id} className="flex items-center gap-1.5">
                    <span className="w-16 shrink-0 truncate text-xs text-paper-600">{variant.color}</span>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium leading-none ${
                      variant.stock === 0 ? "bg-red-50 text-red-600"
                        : variant.stock <= 5 ? "bg-amber-50 text-amber-600"
                        : "bg-green-50 text-green-600"
                    }`}>
                      {variant.stock === 0 ? t("common.soldOut") : variant.stock}
                    </span>
                    <button type="button" disabled={adjustingVariantId === variant.id}
                      onClick={() => handleAdjustVariant(variant.id, 1)}
                      className="rounded px-2 py-1 text-xs font-medium bg-paper-100 text-paper-600 hover:bg-paper-200 disabled:opacity-40 transition-colors">
                      +1
                    </button>
                    <input type="number" min="1" value={adjustQty[variant.id] ?? ""}
                      onChange={(e) => setAdjustQty((prev) => ({ ...prev, [variant.id]: e.target.value }))}
                      placeholder="N"
                      className="w-10 rounded border border-paper-200 px-1.5 py-1 text-xs text-paper-900 outline-none focus:border-paper-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                    <button type="button"
                      disabled={adjustingVariantId === variant.id || !adjustQty[variant.id]}
                      onClick={() => handleAdjustVariant(variant.id, null)}
                      className="rounded px-2 py-1 text-xs font-medium bg-paper-100 text-paper-600 hover:bg-paper-200 disabled:opacity-40 transition-colors">
                      {adjustingVariantId === variant.id ? "…" : t("list.addStock")}
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 text-xs text-paper-500">{t("list.thStock")}</span>
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium leading-none ${
                product.stock === 0 ? "bg-red-50 text-red-600"
                  : product.stock <= 5 ? "bg-amber-50 text-amber-600"
                  : "bg-green-50 text-green-600"
              }`}>
                {product.stock === 0 ? t("common.soldOut") : product.stock}
              </span>
              <button type="button" disabled={adjustingId === product.id}
                onClick={() => handleAdjust(product.id, 1)}
                className="rounded px-2 py-1 text-xs font-medium bg-paper-100 text-paper-600 hover:bg-paper-200 disabled:opacity-40 transition-colors">
                +1
              </button>
              <input type="number" min="1" value={adjustQty[product.id] ?? ""}
                onChange={(e) => setAdjustQty((prev) => ({ ...prev, [product.id]: e.target.value }))}
                placeholder="N"
                className="w-12 rounded border border-paper-200 px-1.5 py-1 text-xs text-paper-900 outline-none focus:border-paper-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
              <button type="button"
                disabled={adjustingId === product.id || !adjustQty[product.id]}
                onClick={() => handleAdjust(product.id, null)}
                className="rounded px-2 py-1 text-xs font-medium bg-paper-100 text-paper-600 hover:bg-paper-200 disabled:opacity-40 transition-colors">
                {adjustingId === product.id ? "…" : t("list.addStock")}
              </button>
              {adjustErrors[product.id] && (
                <span className="text-xs text-red-500">{adjustErrors[product.id]}</span>
              )}
            </div>
          )}
        </div>

        {/* 操作按钮行 */}
        <div className="flex divide-x divide-paper-100 border-t border-paper-100">
          <button type="button" onClick={() => openEdit(product)}
            className="flex-1 py-2.5 text-sm font-medium text-paper-700 transition-colors hover:bg-paper-100">
            {t("common.edit")}
          </button>
          <button type="button" disabled={isDeleting} onClick={() => handleDelete(product)}
            className="flex-1 py-2.5 text-sm font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-40">
            {isDeleting ? "…" : t("common.delete")}
          </button>
        </div>
      </div>
    );
  }

  // ── 共用表格 ──
  const TABLE_HEADER = (
    <thead>
      <tr className="border-b border-paper-100 bg-paper-100/80 text-left">
        <th className="px-3 py-2 text-xs font-medium text-paper-500 w-12">{t("list.thImage")}</th>
        <th className="px-3 py-2 text-xs font-medium text-paper-500">{t("list.thProduct")}</th>
        <th className="px-3 py-2 text-xs font-medium text-paper-500 whitespace-nowrap">{t("list.thPrice")}</th>
        <th className="px-3 py-2 text-xs font-medium text-paper-500 whitespace-nowrap">{t("list.thBarcode")}</th>
        <th className="px-3 py-2 text-xs font-medium text-paper-500">{t("list.thStock")}</th>
        <th className="px-3 py-2 text-xs font-medium text-paper-500">{t("list.thStatus")}</th>
        <th className="px-3 py-2 w-20"></th>
      </tr>
    </thead>
  );

  function renderTable(items: Product[], emptyMsg: string) {
    if (items.length === 0) {
      return (
        <div className="rounded-xl border border-dashed border-paper-200 bg-white py-10 text-center">
          <p className="text-sm text-paper-500">{emptyMsg}</p>
        </div>
      );
    }
    return (
      <>
        {/* 手机端卡片列表 */}
        <div className="block space-y-3 sm:hidden">
          {items.map(renderCard)}
        </div>
        {/* 桌面端表格 */}
        <div className="hidden overflow-hidden rounded-2xl glass-strong sm:block">
          <div className="overflow-x-auto">
            <table className="w-full">{TABLE_HEADER}
              <tbody className="divide-y divide-paper-100">{items.map(renderRow)}</tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  const hasActiveFilters =
    adminSearch.trim() !== "" || filterCategory !== "" || filterStatus !== "all" || stockLessThan.trim() !== "";

  return (
    <>
      {deleteError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {t("list.deleteFailed", { message: deleteError })}
          <button type="button" onClick={() => setDeleteError(null)} className="ml-3 text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {newInError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {newInError}
          <button type="button" onClick={() => setNewInError(null)} className="ml-3 text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {/* ── 分类/状态抽屉：默认收起，鼠标靠近左边缘自动展开，点击把手也可展开/收起 ── */}
      <div
        onMouseEnter={openSidebarOnHover}
        onMouseLeave={closeSidebarOnHover}
        className={`fixed inset-y-0 left-0 z-40 flex transition-transform duration-300 ${sidebarOpen ? "translate-x-0" : "-translate-x-56"}`}
      >
        <div className="h-full w-56 overflow-y-auto border-r border-paper-200 bg-paper-25 p-5 pt-8">
          <div className="mb-6">
            <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-paper-400">{t("list.sidebarCategories")}</p>
            <nav className="space-y-0.5">
              <SidebarItem
                active={filterCategory === ""}
                onClick={() => setFilterCategory("")}
                label={t("common.all")}
                count={products.length}
              />
              {parentCategories.map((c) => (
                <SidebarItem
                  key={c.id}
                  active={filterCategory === c.id}
                  onClick={() => setFilterCategory(c.id)}
                  label={c.name}
                  count={categoryCounts.map.get(c.id) ?? 0}
                />
              ))}
              <SidebarItem
                active={filterCategory === "__uncategorized__"}
                onClick={() => setFilterCategory("__uncategorized__")}
                label={t("common.uncategorized")}
                count={categoryCounts.uncategorized}
              />
            </nav>
          </div>
          <div>
            <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-paper-400">{t("list.sidebarStatus")}</p>
            <nav className="space-y-0.5">
              <SidebarItem active={filterStatus === "all"} onClick={() => setFilterStatus("all")} label={t("list.allStatus")} count={products.length} />
              <SidebarItem active={filterStatus === "active"} onClick={() => setFilterStatus("active")} label={t("list.statusActive")} count={statusCounts.active} dotClassName="bg-paper-400" />
              <SidebarItem active={filterStatus === "inactive"} onClick={() => setFilterStatus("inactive")} label={t("list.statusInactive")} count={statusCounts.inactive} dotClassName="bg-paper-300" />
              <SidebarItem active={filterStatus === "low-stock"} onClick={() => setFilterStatus("low-stock")} label={t("list.statusLow")} count={statusCounts.low} dotClassName="bg-ember-500" />
              <SidebarItem active={filterStatus === "new-in"} onClick={() => setFilterStatus("new-in")} label={t("newIn.label")} count={statusCounts.newIn} dotClassName="bg-accent-500" />
            </nav>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          className="flex h-12 w-8 shrink-0 items-center justify-center self-center rounded-r-lg border border-l-0 border-paper-200 bg-white text-paper-500 transition-colors hover:text-paper-800"
          aria-label={sidebarOpen ? t("list.collapseFilters") : t("list.expandFilters")}
        >
          <svg className={`h-4 w-4 transition-transform duration-300 ${sidebarOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-paper-900/10" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── 筛选栏 ── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/* 搜索框 */}
        <div className="relative min-w-[180px] flex-1">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-paper-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={adminSearch}
            onChange={(e) => setAdminSearch(e.target.value)}
            placeholder={t("list.searchPlaceholder")}
            className="w-full rounded-lg border border-paper-200 bg-white py-1.5 pl-8 pr-7 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-paper-400 focus:ring-2 focus:ring-paper-200"
          />
          {adminSearch && (
            <button type="button" onClick={() => setAdminSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-paper-500 hover:text-paper-600 text-xs">✕</button>
          )}
        </div>

        {/* 扫码查找并编辑 */}
        <ScanButton
          onScan={handleScanFind}
          label={t("list.scanFind")}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-paper-300 bg-white px-3 py-1.5 text-sm font-medium text-paper-700 transition-colors hover:border-paper-400 hover:bg-paper-100"
        />

        {/* 按库存合计筛选：少于 N 件 */}
        <div className="flex items-center gap-1 rounded-lg border border-paper-200 bg-white px-2.5 py-1.5">
          <span className="whitespace-nowrap text-sm text-paper-500">{t("list.stockLessThan")}</span>
          <input
            type="number"
            min="1"
            value={stockLessThan}
            onChange={(e) => setStockLessThan(e.target.value)}
            placeholder="N"
            className="w-12 bg-transparent text-sm text-paper-900 placeholder-paper-500 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="whitespace-nowrap text-sm text-paper-500">{t("common.units")}</span>
        </div>

        {/* 重置 */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => { setAdminSearch(""); setFilterCategory(""); setFilterStatus("all"); setStockLessThan(""); }}
            className="rounded-lg border border-paper-200 px-2.5 py-1.5 text-xs text-paper-500 hover:bg-paper-100"
          >
            {t("common.reset")}
          </button>
        )}

        {/* 计数 */}
        <span className="ml-auto shrink-0 text-xs text-paper-500">
          {filteredProducts.length} / {products.length} {t("common.units")}
        </span>
      </div>

      {/* 扫码未命中提示 */}
      {scanMiss && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-ember-200 bg-ember-50 px-3 py-2 text-sm text-ember-700">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ember-500" />
          <span className="min-w-0 flex-1">{t("list.scanMiss", { code: scanMiss })}</span>
          <button type="button" onClick={() => setScanMiss(null)} className="shrink-0 text-paper-400 hover:text-paper-600">✕</button>
        </div>
      )}

      {/* ── 标签页 ── */}
      <div className="mb-3 flex gap-0.5 border-b border-paper-200">
        {(["recent", "by-category"] as Tab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "border-b-2 border-paper-800 text-paper-900"
                : "text-paper-500 hover:text-paper-700"
            }`}
          >
            {tab === "recent" ? t("list.tabRecent") : t("list.tabByCategory")}
          </button>
        ))}
      </div>

      {/* ── 内容区 ── */}
      {activeTab === "recent" && renderTable(recentProducts, adminSearch || hasActiveFilters ? t("list.noMatch") : t("list.empty"))}

      {activeTab === "by-category" && (
        groupedProducts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-paper-200 bg-white py-10 text-center">
            <p className="text-sm text-paper-500">{hasActiveFilters ? t("list.noMatch") : t("list.empty")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {groupedProducts.map((group) => {
              const collapsed = isGroupCollapsed(group.catId);
              return (
                <div
                  key={group.catId ?? "__null__"}
                  className="overflow-hidden rounded-2xl glass-strong"
                >
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.catId)}
                    className="flex w-full items-center justify-between px-4 py-2.5 hover:bg-paper-100 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-paper-800">{group.catName}</span>
                      <span className="rounded-full bg-paper-100 px-2 py-0.5 text-xs font-medium text-paper-500">
                        {t("list.groupCount", { n: group.items.length })}
                      </span>
                    </div>
                    <svg
                      className={`h-4 w-4 text-paper-500 transition-transform ${collapsed ? "-rotate-90" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {!collapsed && (
                    <>
                      {/* 手机端卡片 */}
                      <div className="block space-y-3 border-t border-paper-100 p-3 sm:hidden">
                        {group.items.map(renderCard)}
                      </div>
                      {/* 桌面端表格 */}
                      <div className="hidden border-t border-paper-100 overflow-x-auto sm:block">
                        <table className="w-full">
                          <tbody className="divide-y divide-paper-100">
                            {group.items.map(renderRow)}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {editingProduct && (
        <ProductEditModal
          product={editingProduct}
          categories={categories}
          variantsForProduct={variantsFor(editingProduct.id)}
          cost={costByProduct.get(editingProduct.id) ?? null}
          brandOptions={brandOptions}
          supplierOptions={supplierOptions}
          onClose={closeEdit}
        />
      )}

      {lightbox.node}
    </>
  );
}

/** 侧栏单项：分类/状态名 + 右侧计数，选中态用墨色填充 */
function SidebarItem({
  active,
  onClick,
  label,
  count,
  dotClassName,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  dotClassName?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
        active ? "bg-paper-800 text-white" : "text-paper-600 hover:bg-paper-100"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        {dotClassName && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-white" : dotClassName}`} />}
        <span className="truncate">{label}</span>
      </span>
      <span className={`shrink-0 font-mono text-xs tabular-nums ${active ? "text-white/70" : "text-paper-400"}`}>
        {count}
      </span>
    </button>
  );
}
