"use client";

import { useState, useTransition, useMemo } from "react";
import {
  deleteProduct,
  toggleProductActive,
  adjustStock,
  adjustVariantStock,
  type ProductVariant,
} from "./actions";
import type { Category } from "@/app/admin/categories/categories-client";
import ProductEditModal from "./product-edit-modal";

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
  brand: string | null;
  created_at: string;
};

type Tab = "recent" | "by-category";
type StatusFilter = "all" | "active" | "inactive" | "low-stock";


export default function ProductList({
  products,
  categories,
  variants,
}: {
  products: Product[];
  categories: Category[];
  variants: ProductVariant[];
}) {
  // ── 分类辅助 ──
  const parentCategories = useMemo(
    () => categories.filter((c) => !c.parent_id),
    [categories]
  );

  function childrenOf(parentId: string) {
    return categories.filter((c) => c.parent_id === parentId);
  }

  function categoryLabel(categoryId: string | null) {
    if (!categoryId) return "未分类";
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return "未分类";
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
    if (product.has_variants) {
      const pvs = variantsFor(product.id);
      return pvs.length > 0 && pvs.some((v) => v.stock <= 5);
    }
    return product.stock <= 5;
  }

  // ── 筛选 & 标签页状态 ──
  const [adminSearch, setAdminSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState<StatusFilter>("all");
  const [activeTab, setActiveTab] = useState<Tab>("recent");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // ── 编辑弹窗状态 ──
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // ── 表格操作状态 ──
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
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
        if (
          !p.name.toLowerCase().includes(q) &&
          !(p.brand?.toLowerCase().includes(q) ?? false)
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
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, adminSearch, filterCategory, filterStatus, categories, variants]);

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
      groups.push({ catId: null, catName: "未分类", items: map.get(null)! });
    }
    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredProducts, parentCategories, categories]);

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
    if (!window.confirm(`确定删除「${product.name}」吗？此操作无法撤销。`)) return;
    setDeletingId(product.id);
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteProduct(product.id);
      setDeletingId(null);
      if ("error" in result) setDeleteError(result.error);
    });
  }

  // ── 共用行渲染 ──
  function renderRow(product: Product) {
    const isDeleting = deletingId === product.id;
    const isToggling = togglingId === product.id;
    const pvs = variantsFor(product.id);

    return (
      <tr
        key={product.id}
        className={`group hover:bg-zinc-50/80 ${!product.is_active ? "opacity-50" : ""}`}
      >
        {/* 图片 */}
        <td className="px-3 py-1.5">
          {product.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.image_url}
              alt={product.name}
              width={40}
              height={40}
              className="h-10 w-10 rounded-md object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-zinc-100 text-zinc-300">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}
        </td>

        {/* 名称 / 品牌 / 分类 */}
        <td className="px-3 py-1.5 max-w-[260px]">
          <p className="truncate text-sm font-medium leading-snug text-zinc-900">{product.name}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            {product.brand && (
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600">
                {product.brand}
              </span>
            )}
            <span className={`text-xs ${product.category_id ? "text-zinc-400" : "text-zinc-300"}`}>
              {categoryLabel(product.category_id)}
            </span>
            {product.has_variants && pvs.length > 0 && (
              <span className="text-xs text-blue-500">{pvs.length}色</span>
            )}
          </div>
        </td>

        {/* 价格 */}
        <td className="px-3 py-1.5 whitespace-nowrap text-sm text-zinc-700">
          ¥{Number(product.price).toFixed(2)}
        </td>

        {/* 库存 */}
        <td className="px-3 py-1.5">
          {product.has_variants ? (
            <div className="space-y-1">
              {pvs.length === 0 ? (
                <span className="text-xs text-zinc-400">暂无变体</span>
              ) : (
                pvs.map((variant) => (
                  <div key={variant.id} className="flex items-center gap-1 flex-nowrap">
                    <span className="w-14 shrink-0 truncate text-xs text-zinc-600">{variant.color}</span>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium leading-none ${
                      variant.stock === 0 ? "bg-red-50 text-red-600"
                        : variant.stock <= 5 ? "bg-amber-50 text-amber-600"
                        : "bg-green-50 text-green-600"
                    }`}>
                      {variant.stock === 0 ? "售罄" : variant.stock}
                    </span>
                    <button
                      type="button"
                      disabled={adjustingVariantId === variant.id}
                      onClick={() => handleAdjustVariant(variant.id, 1)}
                      className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-600 hover:bg-zinc-200 disabled:opacity-40 transition-colors"
                    >
                      +1
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={adjustQty[variant.id] ?? ""}
                      onChange={(e) => setAdjustQty((prev) => ({ ...prev, [variant.id]: e.target.value }))}
                      placeholder="N"
                      className="w-9 shrink-0 rounded border border-zinc-200 px-1 py-0.5 text-xs text-zinc-900 outline-none focus:border-zinc-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <button
                      type="button"
                      disabled={adjustingVariantId === variant.id || !adjustQty[variant.id]}
                      onClick={() => handleAdjustVariant(variant.id, null)}
                      className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-600 hover:bg-zinc-200 disabled:opacity-40 transition-colors"
                    >
                      {adjustingVariantId === variant.id ? "…" : "加"}
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
                {product.stock === 0 ? "售罄" : product.stock}
              </span>
              <button
                type="button"
                disabled={adjustingId === product.id}
                onClick={() => handleAdjust(product.id, 1)}
                className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-600 hover:bg-zinc-200 disabled:opacity-40 transition-colors"
              >
                +1
              </button>
              <input
                type="number"
                min="1"
                value={adjustQty[product.id] ?? ""}
                onChange={(e) => setAdjustQty((prev) => ({ ...prev, [product.id]: e.target.value }))}
                placeholder="N"
                className="w-9 shrink-0 rounded border border-zinc-200 px-1 py-0.5 text-xs text-zinc-900 outline-none focus:border-zinc-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <button
                type="button"
                disabled={adjustingId === product.id || !adjustQty[product.id]}
                onClick={() => handleAdjust(product.id, null)}
                className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-600 hover:bg-zinc-200 disabled:opacity-40 transition-colors"
              >
                {adjustingId === product.id ? "…" : "加"}
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
            onClick={() => handleToggleActive(product)}
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              product.is_active
                ? "bg-green-50 text-green-700 hover:bg-green-100"
                : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
            }`}
          >
            {isToggling ? "…" : product.is_active ? "上架 ↓" : "下架 ↑"}
          </button>
        </td>

        {/* 操作 */}
        <td className="px-3 py-1.5">
          <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={() => openEdit(product)}
              className="rounded px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100"
            >
              编辑
            </button>
            <button
              type="button"
              disabled={isDeleting}
              onClick={() => handleDelete(product)}
              className="rounded px-2.5 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-40"
            >
              {isDeleting ? "…" : "删除"}
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

    return (
      <div
        key={product.id}
        className={`overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm${!product.is_active ? " opacity-60" : ""}`}
      >
        {/* 主信息行 */}
        <div className="flex items-start gap-3 p-3">
          {product.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.image_url} alt={product.name} width={56} height={56}
              className="h-14 w-14 shrink-0 rounded-lg object-cover" />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-300">
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-semibold leading-snug text-zinc-900">{product.name}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1">
              {product.brand && (
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600">{product.brand}</span>
              )}
              <span className={`text-xs ${product.category_id ? "text-zinc-400" : "text-zinc-300"}`}>
                {categoryLabel(product.category_id)}
              </span>
              {product.has_variants && pvs.length > 0 && (
                <span className="text-xs text-blue-500">{pvs.length}色</span>
              )}
            </div>
            <p className="mt-1 text-sm font-bold text-zinc-900">¥{Number(product.price).toFixed(2)}</p>
          </div>
          <button
            type="button"
            disabled={isToggling}
            onClick={() => handleToggleActive(product)}
            className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
              product.is_active
                ? "bg-green-50 text-green-700 hover:bg-green-100"
                : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"
            }`}
          >
            {isToggling ? "…" : product.is_active ? "上架" : "下架"}
          </button>
        </div>

        {/* 库存快捷调整 */}
        <div className="border-t border-zinc-50 bg-zinc-50/50 px-3 py-2">
          {product.has_variants ? (
            <div className="space-y-1.5">
              {pvs.length === 0 ? (
                <span className="text-xs text-zinc-400">暂无变体</span>
              ) : (
                pvs.map((variant) => (
                  <div key={variant.id} className="flex items-center gap-1.5">
                    <span className="w-16 shrink-0 truncate text-xs text-zinc-600">{variant.color}</span>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium leading-none ${
                      variant.stock === 0 ? "bg-red-50 text-red-600"
                        : variant.stock <= 5 ? "bg-amber-50 text-amber-600"
                        : "bg-green-50 text-green-600"
                    }`}>
                      {variant.stock === 0 ? "售罄" : variant.stock}
                    </span>
                    <button type="button" disabled={adjustingVariantId === variant.id}
                      onClick={() => handleAdjustVariant(variant.id, 1)}
                      className="rounded px-2 py-1 text-xs font-medium bg-zinc-100 text-zinc-600 hover:bg-zinc-200 disabled:opacity-40 transition-colors">
                      +1
                    </button>
                    <input type="number" min="1" value={adjustQty[variant.id] ?? ""}
                      onChange={(e) => setAdjustQty((prev) => ({ ...prev, [variant.id]: e.target.value }))}
                      placeholder="N"
                      className="w-10 rounded border border-zinc-200 px-1.5 py-1 text-xs text-zinc-900 outline-none focus:border-zinc-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                    <button type="button"
                      disabled={adjustingVariantId === variant.id || !adjustQty[variant.id]}
                      onClick={() => handleAdjustVariant(variant.id, null)}
                      className="rounded px-2 py-1 text-xs font-medium bg-zinc-100 text-zinc-600 hover:bg-zinc-200 disabled:opacity-40 transition-colors">
                      {adjustingVariantId === variant.id ? "…" : "加"}
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 text-xs text-zinc-500">库存</span>
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium leading-none ${
                product.stock === 0 ? "bg-red-50 text-red-600"
                  : product.stock <= 5 ? "bg-amber-50 text-amber-600"
                  : "bg-green-50 text-green-600"
              }`}>
                {product.stock === 0 ? "售罄" : product.stock}
              </span>
              <button type="button" disabled={adjustingId === product.id}
                onClick={() => handleAdjust(product.id, 1)}
                className="rounded px-2 py-1 text-xs font-medium bg-zinc-100 text-zinc-600 hover:bg-zinc-200 disabled:opacity-40 transition-colors">
                +1
              </button>
              <input type="number" min="1" value={adjustQty[product.id] ?? ""}
                onChange={(e) => setAdjustQty((prev) => ({ ...prev, [product.id]: e.target.value }))}
                placeholder="N"
                className="w-12 rounded border border-zinc-200 px-1.5 py-1 text-xs text-zinc-900 outline-none focus:border-zinc-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
              <button type="button"
                disabled={adjustingId === product.id || !adjustQty[product.id]}
                onClick={() => handleAdjust(product.id, null)}
                className="rounded px-2 py-1 text-xs font-medium bg-zinc-100 text-zinc-600 hover:bg-zinc-200 disabled:opacity-40 transition-colors">
                {adjustingId === product.id ? "…" : "加"}
              </button>
              {adjustErrors[product.id] && (
                <span className="text-xs text-red-500">{adjustErrors[product.id]}</span>
              )}
            </div>
          )}
        </div>

        {/* 操作按钮行 */}
        <div className="flex divide-x divide-zinc-100 border-t border-zinc-100">
          <button type="button" onClick={() => openEdit(product)}
            className="flex-1 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50">
            编辑
          </button>
          <button type="button" disabled={isDeleting} onClick={() => handleDelete(product)}
            className="flex-1 py-2.5 text-sm font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-40">
            {isDeleting ? "…" : "删除"}
          </button>
        </div>
      </div>
    );
  }

  // ── 共用表格 ──
  const TABLE_HEADER = (
    <thead>
      <tr className="border-b border-zinc-100 bg-zinc-50/80 text-left">
        <th className="px-3 py-2 text-xs font-medium text-zinc-400 w-12">图</th>
        <th className="px-3 py-2 text-xs font-medium text-zinc-400">商品 / 品牌 / 分类</th>
        <th className="px-3 py-2 text-xs font-medium text-zinc-400 whitespace-nowrap">价格</th>
        <th className="px-3 py-2 text-xs font-medium text-zinc-400">库存</th>
        <th className="px-3 py-2 text-xs font-medium text-zinc-400">状态</th>
        <th className="px-3 py-2 w-20"></th>
      </tr>
    </thead>
  );

  function renderTable(items: Product[], emptyMsg = "无匹配商品") {
    if (items.length === 0) {
      return (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-white py-10 text-center">
          <p className="text-sm text-zinc-400">{emptyMsg}</p>
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
        <div className="hidden overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm sm:block">
          <div className="overflow-x-auto">
            <table className="w-full">{TABLE_HEADER}
              <tbody className="divide-y divide-zinc-100">{items.map(renderRow)}</tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  const hasActiveFilters =
    adminSearch.trim() !== "" || filterCategory !== "" || filterStatus !== "all";

  return (
    <>
      {deleteError && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          删除失败：{deleteError}
          <button type="button" onClick={() => setDeleteError(null)} className="ml-3 text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {/* ── 筛选栏 ── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {/* 搜索框 */}
        <div className="relative min-w-[180px] flex-1">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={adminSearch}
            onChange={(e) => setAdminSearch(e.target.value)}
            placeholder="名称 / 品牌…"
            className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 pl-8 pr-7 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
          />
          {adminSearch && (
            <button type="button" onClick={() => setAdminSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 text-xs">✕</button>
          )}
        </div>

        {/* 分类筛选 */}
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-700 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
        >
          <option value="">全部分类</option>
          {parentCategories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
          <option value="__uncategorized__">未分类</option>
        </select>

        {/* 状态筛选 */}
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as StatusFilter)}
          className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-700 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
        >
          <option value="all">全部状态</option>
          <option value="active">上架中</option>
          <option value="inactive">已下架</option>
          <option value="low-stock">库存告急 ≤5</option>
        </select>

        {/* 重置 */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => { setAdminSearch(""); setFilterCategory(""); setFilterStatus("all"); }}
            className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-500 hover:bg-zinc-50"
          >
            重置
          </button>
        )}

        {/* 计数 */}
        <span className="ml-auto shrink-0 text-xs text-zinc-400">
          {filteredProducts.length} / {products.length} 件
        </span>
      </div>

      {/* ── 标签页 ── */}
      <div className="mb-3 flex gap-0.5 border-b border-zinc-200">
        {(["recent", "by-category"] as Tab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "border-b-2 border-zinc-900 text-zinc-900"
                : "text-zinc-500 hover:text-zinc-700"
            }`}
          >
            {tab === "recent" ? "最近添加" : "按分类浏览"}
          </button>
        ))}
      </div>

      {/* ── 内容区 ── */}
      {activeTab === "recent" && renderTable(recentProducts, adminSearch || hasActiveFilters ? "无匹配商品" : "暂无商品")}

      {activeTab === "by-category" && (
        groupedProducts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-200 bg-white py-10 text-center">
            <p className="text-sm text-zinc-400">{hasActiveFilters ? "无匹配商品" : "暂无商品"}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {groupedProducts.map((group) => {
              const collapsed = isGroupCollapsed(group.catId);
              return (
                <div
                  key={group.catId ?? "__null__"}
                  className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
                >
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.catId)}
                    className="flex w-full items-center justify-between px-4 py-2.5 hover:bg-zinc-50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-800">{group.catName}</span>
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500">
                        {group.items.length} 件
                      </span>
                    </div>
                    <svg
                      className={`h-4 w-4 text-zinc-400 transition-transform ${collapsed ? "-rotate-90" : ""}`}
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
                      <div className="block space-y-3 border-t border-zinc-100 p-3 sm:hidden">
                        {group.items.map(renderCard)}
                      </div>
                      {/* 桌面端表格 */}
                      <div className="hidden border-t border-zinc-100 overflow-x-auto sm:block">
                        <table className="w-full">
                          <tbody className="divide-y divide-zinc-100">
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
          onClose={closeEdit}
        />
      )}
    </>
  );
}
