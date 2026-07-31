"use client";

import Image from "next/image";
import { useTransition, useState, useMemo, useEffect, useRef } from "react";
import { submitOrder } from "./actions";
import ScanButton from "@/app/scan-button";
import { useImageLightbox } from "@/app/image-lightbox";
import ModalPortal from "@/app/modal-portal";
import { useT } from "@/lib/i18n/client";

export type Product = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  stock: number;
  image_url: string | null;
  category_id: string | null;
  has_variants: boolean;
  brand: string | null;
  created_at: string;
  barcode: string | null;
};

export type ProductVariant = {
  id: string;
  product_id: string;
  color: string;
  stock: number;
  sort_order: number;
};

type CategoryItem = { id: string; name: string; parent_id: string | null };

type CartEntry = {
  product: Product;
  variant?: { id: string; color: string; stock: number };
  quantity: number;
};

type CartMap = Record<string, CartEntry>;
type ViewMode = "grid" | "compact";

const UNCATEGORIZED = "__uncategorized__";
const VIEW_MODE_KEY = "shopViewMode";
const CART_KEY = "shopCart";

export default function ShopClient({
  products,
  categories,
  lastOrderItems,
  variants,
}: {
  products: Product[];
  categories: CategoryItem[];
  lastOrderItems: { product_id: string; variant_id: string | null; quantity: number }[];
  variants: ProductVariant[];
}) {
  const t = useT();
  const lightbox = useImageLightbox();

  // ── 购物车 & 下单 ──
  const [cart, setCart] = useState<CartMap>({});
  const [inputQty, setInputQty] = useState<Record<string, number>>(
    () => Object.fromEntries(products.map((p) => [p.id, 0]))
  );
  const [selectedVariantId, setSelectedVariantId] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<
    null | { success: true; orderId: string } | { error: string }
  >(null);

  // ── 分类 & 搜索 ──
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"default" | "price-asc" | "price-desc" | "name">("default");
  const [inStockOnly, setInStockOnly] = useState(false);
  // 扫码下单反馈（成功加购 / 未找到 / 缺货）
  const [scanFeedback, setScanFeedback] = useState<{ ok: boolean; text: string } | null>(null);

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

  // ── 视图模式（localStorage 持久化） ──
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  useEffect(() => {
    const saved = localStorage.getItem(VIEW_MODE_KEY);
    // 从 localStorage 水合客户端状态，避免 SSR 首屏水合不一致（与购物车水合同一模式）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === "compact" || saved === "grid") setViewMode(saved);
  }, []);
  function switchViewMode(mode: ViewMode) {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  }

  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  // ── 购物车持久化（localStorage） ──
  // 只存最小结构 {productId, variantId, quantity}，挂载时按当前商品/变体重新水合，
  // 避免持久化了过期的价格/库存或已下架商品。
  const [cartHydrated, setCartHydrated] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CART_KEY);
      if (saved) {
        const rows = JSON.parse(saved) as { productId: string; variantId?: string; quantity: number }[];
        const restored: CartMap = {};
        for (const row of rows) {
          const product = products.find((p) => p.id === row.productId);
          if (!product) continue;
          if (row.variantId) {
            const variant = variants.find((v) => v.id === row.variantId);
            if (!variant || variant.stock === 0) continue;
            const qty = Math.min(row.quantity, variant.stock);
            if (qty <= 0) continue;
            restored[cartKey(product.id, variant.id)] = {
              product,
              variant: { id: variant.id, color: variant.color, stock: variant.stock },
              quantity: qty,
            };
          } else {
            if (product.stock === 0) continue;
            const qty = Math.min(row.quantity, product.stock);
            if (qty <= 0) continue;
            restored[product.id] = { product, quantity: qty };
          }
        }
        // 从 localStorage 水合客户端状态，避免 SSR 首屏水合不一致（与 viewMode 同一模式）
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (Object.keys(restored).length) setCart(restored);
      }
    } catch {
      // 解析失败忽略
    }
    setCartHydrated(true);
    // 仅在挂载时水合一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 水合完成后，购物车变化即写回 localStorage
  useEffect(() => {
    if (!cartHydrated) return;
    const rows = Object.values(cart).map((item) => ({
      productId: item.product.id,
      variantId: item.variant?.id,
      quantity: item.quantity,
    }));
    localStorage.setItem(CART_KEY, JSON.stringify(rows));
  }, [cart, cartHydrated]);

  // ── 分类派生 ──
  const parentCategories = categories.filter((c) => !c.parent_id);
  const currentChildren =
    selectedParentId && selectedParentId !== UNCATEGORIZED
      ? categories.filter((c) => c.parent_id === selectedParentId)
      : [];

  const variantsByProduct = useMemo(() => {
    const map: Record<string, ProductVariant[]> = {};
    for (const v of variants) {
      (map[v.product_id] ??= []).push(v);
    }
    return map;
  }, [variants]);

  // 分类 id → 名称，用于卡片上的分类标签
  const catNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of categories) map[c.id] = c.name;
    return map;
  }, [categories]);

  // 商品可售库存（含变体口径），用于「只看有货」筛选
  function totalStock(p: Product) {
    if (p.has_variants) {
      return (variantsByProduct[p.id] ?? []).reduce((s, v) => s + v.stock, 0);
    }
    return p.stock;
  }

  function allChildIds(parentId: string) {
    return categories.filter((c) => c.parent_id === parentId).map((c) => c.id);
  }

  // ── 侧栏计数：按大类 / 库存状态统计商品数（基于全量 products，不随筛选变化） ──
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    let uncategorized = 0;
    for (const p of products) {
      if (p.category_id === null) {
        uncategorized++;
        continue;
      }
      const cat = categories.find((c) => c.id === p.category_id);
      const parentId = cat ? (cat.parent_id ?? cat.id) : null;
      if (parentId) counts[parentId] = (counts[parentId] ?? 0) + 1;
    }
    return { counts, uncategorized };
  }, [products, categories]);

  const stockCounts = useMemo(() => {
    let inStock = 0;
    for (const p of products) if (totalStock(p) > 0) inStock++;
    return { inStock, total: products.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, variantsByProduct]);

  const filteredProducts = products
    .filter((p) => {
      if (selectedChildId) {
        if (p.category_id !== selectedChildId) return false;
      } else if (selectedParentId === UNCATEGORIZED) {
        if (p.category_id !== null) return false;
      } else if (selectedParentId) {
        const valid = new Set([selectedParentId, ...allChildIds(selectedParentId)]);
        if (!p.category_id || !valid.has(p.category_id)) return false;
      }
      if (inStockOnly && totalStock(p) <= 0) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          (p.brand?.toLowerCase().includes(q) ?? false)
        );
      }
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "price-asc":
          return a.price - b.price;
        case "price-desc":
          return b.price - a.price;
        case "name":
          return a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });

  function selectParent(id: string | null) {
    setSelectedParentId(id);
    setSelectedChildId(null);
  }

  // ── 购物车逻辑（不变） ──
  function cartKey(productId: string, variantId?: string) {
    return variantId ? `${productId}-${variantId}` : productId;
  }

  function addToCart(product: Product, variant?: ProductVariant) {
    const qty = inputQty[product.id] ?? 0;
    if (qty <= 0) return;
    const effectiveStock = variant ? variant.stock : product.stock;
    if (effectiveStock === 0) return;
    const key = cartKey(product.id, variant?.id);
    setCart((prev) => {
      const existing = prev[key]?.quantity ?? 0;
      return {
        ...prev,
        [key]: {
          product,
          variant: variant ? { id: variant.id, color: variant.color, stock: variant.stock } : undefined,
          quantity: Math.min(existing + qty, effectiveStock),
        },
      };
    });
    setInputQty((prev) => ({ ...prev, [product.id]: 0 }));
  }

  // 扫码下单：按条码找商品，直接加 1 到购物车
  function handleScanOrder(code: string) {
    const c = code.trim();
    if (!c) return;
    const product = products.find((p) => (p.barcode ?? "").trim() === c);
    if (!product) {
      setScanFeedback({ ok: false, text: t("scan.notFound", { code: c }) });
      return;
    }
    // 变体商品：取第一个有货的颜色
    const pvs = variantsByProduct[product.id] ?? [];
    const variant = product.has_variants ? pvs.find((v) => v.stock > 0) : undefined;
    const effectiveStock = product.has_variants ? (variant?.stock ?? 0) : product.stock;
    if (effectiveStock <= 0) {
      setScanFeedback({ ok: false, text: t("scan.outOfStock", { name: product.name }) });
      return;
    }
    const key = cartKey(product.id, variant?.id);
    setCart((prev) => {
      const existing = prev[key]?.quantity ?? 0;
      return {
        ...prev,
        [key]: {
          product,
          variant: variant ? { id: variant.id, color: variant.color, stock: variant.stock } : undefined,
          quantity: Math.min(existing + 1, effectiveStock),
        },
      };
    });
    setScanFeedback({
      ok: true,
      text: t("scan.added", {
        name: `${product.name}${variant ? ` · ${variant.color}` : ""}`,
      }),
    });
  }

  // 反馈 3.5s 后自动消失
  useEffect(() => {
    if (!scanFeedback) return;
    const t = setTimeout(() => setScanFeedback(null), 3500);
    return () => clearTimeout(t);
  }, [scanFeedback]);

  function changeCartQty(key: string, delta: number) {
    setCart((prev) => {
      const item = prev[key];
      if (!item) return prev;
      const maxStock = item.variant ? item.variant.stock : item.product.stock;
      const next = item.quantity + delta;
      if (next <= 0) {
        const rest = { ...prev };
        delete rest[key];
        return rest;
      }
      return { ...prev, [key]: { ...item, quantity: Math.min(next, maxStock) } };
    });
  }

  function removeFromCart(key: string) {
    setCart((prev) => {
      const rest = { ...prev };
      delete rest[key];
      return rest;
    });
  }

  function handleSubmit() {
    const items = Object.values(cart).map((item) => ({
      productId: item.product.id,
      quantity: item.quantity,
      variantId: item.variant?.id,
    }));
    setResult(null);
    startTransition(async () => {
      const res = await submitOrder(items, note);
      setResult(res);
      if ("success" in res) {
        setCart({});
        setNote("");
      }
    });
  }

  function handleRepeatOrder() {
    const newCart: CartMap = {};
    for (const item of lastOrderItems) {
      const product = products.find((p) => p.id === item.product_id);
      if (!product) continue;
      if (item.variant_id) {
        const variant = variants.find((v) => v.id === item.variant_id);
        if (!variant || variant.stock === 0) continue;
        const qty = Math.min(item.quantity, variant.stock);
        const key = cartKey(product.id, variant.id);
        newCart[key] = { product, variant: { id: variant.id, color: variant.color, stock: variant.stock }, quantity: qty };
      } else {
        if (product.stock === 0) continue;
        const qty = Math.min(item.quantity, product.stock);
        newCart[product.id] = { product, quantity: qty };
      }
    }
    if (!Object.keys(newCart).length) return;
    setCart(newCart);
    setInputQty(Object.fromEntries(products.map((p) => [p.id, 0])));
    setResult(null);
  }

  const cartEntries = Object.entries(cart);
  const total = cartEntries.reduce((sum, [, item]) => sum + item.product.price * item.quantity, 0);
  const cartCount = cartEntries.reduce((n, [, item]) => n + item.quantity, 0);

  // ── 占位图 ──
  const imgPlaceholder = (size: "lg" | "sm") => (
    <div className={`flex h-full items-center justify-center text-paper-400`}>
      <svg className={size === "lg" ? "h-12 w-12" : "h-7 w-7"} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    </div>
  );

  return (
    <div className={`mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8${cartCount > 0 ? " pb-28 lg:pb-6" : ""}`}>
      {/* ── 分类/状态抽屉：默认收起，鼠标靠近左边缘自动展开，点击把手也可展开/收起 ── */}
      <div
        onMouseEnter={openSidebarOnHover}
        onMouseLeave={closeSidebarOnHover}
        className={`fixed inset-y-0 left-0 z-40 flex transition-transform duration-300 ${sidebarOpen ? "translate-x-0" : "-translate-x-56"}`}
      >
        <div className="h-full w-56 overflow-y-auto glass-strong p-5 pt-8">
          <div className="mb-6">
            <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-paper-400">{t("shop.filterCategory")}</p>
            <nav className="space-y-0.5">
              <CatSidebarItem active={selectedParentId === null} onClick={() => selectParent(null)} label={t("common.all")} count={products.length} />
              {parentCategories.map((c) => (
                <CatSidebarItem
                  key={c.id}
                  active={selectedParentId === c.id}
                  onClick={() => selectParent(c.id)}
                  label={c.name}
                  count={categoryCounts.counts[c.id] ?? 0}
                />
              ))}
              <CatSidebarItem active={selectedParentId === UNCATEGORIZED} onClick={() => selectParent(UNCATEGORIZED)} label={t("common.uncategorized")} count={categoryCounts.uncategorized} />
            </nav>
          </div>
          <div>
            <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-paper-400">{t("shop.stockStatus")}</p>
            <nav className="space-y-0.5">
              <CatSidebarItem active={!inStockOnly} onClick={() => setInStockOnly(false)} label={t("shop.allProducts")} count={stockCounts.total} />
              <CatSidebarItem active={inStockOnly} onClick={() => setInStockOnly(true)} label={t("shop.inStockOnly")} count={stockCounts.inStock} dotClassName="bg-paper-400" />
            </nav>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          className="flex h-12 w-8 shrink-0 items-center justify-center self-center rounded-r-lg border border-l-0 border-paper-200 bg-white text-paper-500 transition-colors hover:text-paper-800"
          aria-label={sidebarOpen ? t("shop.collapseFilters") : t("shop.expandFilters")}
        >
          <svg className={`h-4 w-4 transition-transform duration-300 ${sidebarOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-paper-900/10" onClick={() => setSidebarOpen(false)} />
      )}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">

        {/* ── 商品区 ── */}
        <div className="min-w-0 flex-1">

          {/* 小类导航 */}
          {currentChildren.length > 0 && (
            <div className="mb-3 flex gap-2 overflow-x-auto pb-2 pl-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button
                type="button"
                onClick={() => setSelectedChildId(null)}
                className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${selectedChildId === null ? "bg-paper-800 text-white" : "bg-paper-100 text-paper-600 hover:bg-paper-200"}`}
              >
                {t("shop.allSubcategories")}
              </button>
              {currentChildren.map((child) => (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => setSelectedChildId(child.id)}
                  className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${selectedChildId === child.id ? "bg-paper-800 text-white" : "bg-paper-100 text-paper-600 hover:bg-paper-200"}`}
                >
                  {child.name}
                </button>
              ))}
            </div>
          )}

          {/* 搜索框 + 视图切换 */}
          <div className="mb-4 flex items-center gap-2">
            <div className="relative flex-1">
              <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-paper-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("shop.searchPlaceholder")}
                className="w-full rounded-xl border border-paper-200 bg-white py-2.5 pl-10 pr-10 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-paper-400 focus:ring-2 focus:ring-paper-200"
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-paper-500 hover:text-paper-600">✕</button>
              )}
            </div>

            {/* 扫码下单 */}
            <ScanButton
              onScan={handleScanOrder}
              label={t("shop.scanToOrder")}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-paper-800 bg-paper-800 px-3.5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-paper-700"
            />

            {/* 视图切换 */}
            <div className="flex items-center rounded-xl border border-paper-200 bg-white p-1 gap-0.5">
              <button
                type="button"
                title={t("shop.viewGrid")}
                onClick={() => switchViewMode("grid")}
                className={`rounded-lg p-1.5 transition-colors ${viewMode === "grid" ? "bg-paper-700 text-white" : "text-paper-500 hover:text-paper-700"}`}
              >
                {/* 2×2 grid icon */}
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 16 16">
                  <rect x="1" y="1" width="6" height="6" rx="1" />
                  <rect x="9" y="1" width="6" height="6" rx="1" />
                  <rect x="1" y="9" width="6" height="6" rx="1" />
                  <rect x="9" y="9" width="6" height="6" rx="1" />
                </svg>
              </button>
              <button
                type="button"
                title={t("shop.viewCompact")}
                onClick={() => switchViewMode("compact")}
                className={`rounded-lg p-1.5 transition-colors ${viewMode === "compact" ? "bg-paper-700 text-white" : "text-paper-500 hover:text-paper-700"}`}
              >
                {/* 3×3 grid icon */}
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 16 16">
                  <rect x="1"   y="1"   width="4" height="4" rx="0.5" />
                  <rect x="6"   y="1"   width="4" height="4" rx="0.5" />
                  <rect x="11"  y="1"   width="4" height="4" rx="0.5" />
                  <rect x="1"   y="6"   width="4" height="4" rx="0.5" />
                  <rect x="6"   y="6"   width="4" height="4" rx="0.5" />
                  <rect x="11"  y="6"   width="4" height="4" rx="0.5" />
                  <rect x="1"   y="11"  width="4" height="4" rx="0.5" />
                  <rect x="6"   y="11"  width="4" height="4" rx="0.5" />
                  <rect x="11"  y="11"  width="4" height="4" rx="0.5" />
                </svg>
              </button>
            </div>
          </div>

          {/* 扫码下单反馈条 */}
          {scanFeedback && (
            <div
              className={`animate-fade-up mb-4 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm ${
                scanFeedback.ok
                  ? "border-paper-200 bg-paper-25 text-paper-800"
                  : "border-ember-200 bg-ember-50 text-ember-700"
              }`}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${scanFeedback.ok ? "bg-paper-700" : "bg-ember-500"}`} />
              <span className="min-w-0 flex-1">{scanFeedback.text}</span>
              <button type="button" onClick={() => setScanFeedback(null)} className="shrink-0 text-paper-400 hover:text-paper-600">✕</button>
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-xs tracking-[0.12em] text-paper-600">
              {filteredProducts.length === 0
                ? t("shop.noProducts")
                : t("shop.countProducts", { n: filteredProducts.length })}
              {searchQuery && <span className="ml-1 text-paper-400">{t("shop.searchTag", { q: searchQuery })}</span>}
            </p>
            <div className="flex items-center gap-2">
              <div className="relative">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  className="appearance-none rounded-full border border-paper-200 bg-paper-25 py-1.5 pl-3 pr-8 text-xs font-medium text-paper-600 outline-none transition-colors hover:border-paper-300 focus:border-paper-400"
                >
                  <option value="default">{t("shop.sortDefault")}</option>
                  <option value="price-asc">{t("shop.sortPriceAsc")}</option>
                  <option value="price-desc">{t("shop.sortPriceDesc")}</option>
                  <option value="name">{t("shop.sortName")}</option>
                </select>
                <svg className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-paper-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>

          {filteredProducts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-paper-300 bg-white py-20 text-center">
              <p className="text-sm text-paper-500">{searchQuery ? t("shop.noMatch") : t("shop.noProducts")}</p>
            </div>
          ) : viewMode === "grid" ? (
            /* ── 大图模式 ── */
            <div className="stagger-children grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredProducts.map((product) => {
                const pvs = variantsByProduct[product.id] ?? [];
                const isVariant = product.has_variants;
                const chosenVariantId = selectedVariantId[product.id] ?? pvs[0]?.id;
                const chosenVariant = pvs.find((v) => v.id === chosenVariantId);
                const effectiveStock = isVariant ? (chosenVariant?.stock ?? 0) : product.stock;
                const outOfStock = effectiveStock === 0;
                const qty = inputQty[product.id] ?? 0;
                const isNew = Date.now() - new Date(product.created_at).getTime() < 14 * 864e5;
                const catName = product.category_id ? catNameById[product.category_id] : null;

                return (
                  <div key={product.id} className="group flex flex-col overflow-hidden rounded-xl glass-strong transition-colors duration-200 hover:border-paper-400">
                    {/* 顶部信息条：品牌／分类 + 库存（mono 系统声，编辑风） */}
                    <div className="flex items-center justify-between gap-2 border-b border-paper-100 px-3.5 py-2.5">
                      <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-paper-500">
                        {product.brand ?? catName ?? "—"}
                        {isNew && <span className="ml-2 text-ember-600">{t("shop.new")}</span>}
                      </span>
                      {outOfStock ? (
                        <span className="shrink-0 font-mono text-[10px] tracking-[0.08em] text-ember-600">{t("common.soldOut")}</span>
                      ) : (
                        <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] text-paper-600">
                          <span className={`h-1.5 w-1.5 rounded-full ${effectiveStock < 10 ? "bg-ember-500" : "bg-paper-300"}`} />
                          {t("shop.stockN", { n: effectiveStock })}
                        </span>
                      )}
                    </div>
                    {/* 图片：白底 + 细线分隔，无阴影无徽章 */}
                    <div className="relative aspect-square w-full overflow-hidden border-b border-paper-100 bg-white">
                      {product.image_url ? (
                        <Image
                          src={product.image_url}
                          alt={product.name}
                          fill
                          sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw"
                          className={`object-cover transition-transform duration-300 group-hover:scale-[1.03] ${outOfStock ? "opacity-60 grayscale" : ""}`}
                        />
                      ) : imgPlaceholder("lg")}
                      {product.image_url && (
                        <button
                          type="button"
                          onClick={() => lightbox.open(product.image_url, product.name)}
                          title={t("common.viewPhoto", { name: product.name })}
                          className="absolute inset-0 cursor-zoom-in"
                        >
                          <span className="sr-only">{t("common.viewPhoto", { name: product.name })}</span>
                        </button>
                      )}
                    </div>

                    <div className="flex flex-1 flex-col px-4 pb-4 pt-3">
                      <p className="line-clamp-2 text-[15px] font-medium leading-snug text-paper-900">{product.name}</p>
                      {/* 价格：单一字重，靠字号说话 */}
                      <p className="mt-2 text-2xl font-normal tracking-tight text-paper-900">
                        €{Number(product.price).toFixed(2)}
                      </p>

                      {/* 颜色选择器 */}
                      {isVariant && pvs.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {pvs.map((v) => (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => setSelectedVariantId((prev) => ({ ...prev, [product.id]: v.id }))}
                              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                                chosenVariantId === v.id ? "bg-paper-800 text-white" : "border border-paper-200 text-paper-600 hover:border-paper-400"
                              } ${v.stock === 0 ? "opacity-40 line-through" : ""}`}
                            >
                              {v.color}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* 数量控制 + 加入购物车（ghost 胶囊，唯一实心按钮留给提交订单） */}
                      <div className="mt-3 border-t border-paper-100 pt-3">
                        {outOfStock ? (
                          <button type="button" disabled
                            className="w-full cursor-not-allowed rounded-full border border-paper-200 py-2.5 text-xs font-medium text-paper-400">
                            {t("shop.outOfStockBtn")}
                          </button>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="flex items-center rounded-full border border-paper-200">
                              <button type="button" disabled={qty <= 0}
                                onClick={() => setInputQty((p) => ({ ...p, [product.id]: Math.max(0, qty - 1) }))}
                                className="flex h-10 w-9 items-center justify-center rounded-l-full text-paper-500 transition hover:text-paper-900 disabled:opacity-30 sm:h-9">−</button>
                              <input type="number" min={0} max={effectiveStock} value={qty}
                                onChange={(e) => setInputQty((p) => ({ ...p, [product.id]: Math.min(effectiveStock, Math.max(0, parseInt(e.target.value) || 0)) }))}
                                className="w-8 bg-transparent text-center font-mono text-sm text-paper-900 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                              <button type="button" disabled={qty >= effectiveStock}
                                onClick={() => setInputQty((p) => ({ ...p, [product.id]: Math.min(effectiveStock, qty + 1) }))}
                                className="flex h-10 w-9 items-center justify-center rounded-r-full text-paper-500 transition hover:text-paper-900 disabled:opacity-30 sm:h-9">+</button>
                            </div>
                            <button type="button" disabled={qty <= 0}
                              onClick={() => addToCart(product, isVariant ? chosenVariant : undefined)}
                              className="flex-1 rounded-full border border-paper-800 py-2.5 text-xs font-medium text-paper-800 transition-colors hover:bg-paper-800 hover:text-white disabled:cursor-not-allowed disabled:border-paper-200 disabled:text-paper-400 disabled:hover:bg-transparent">
                              {t("shop.addToCart")}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* ── 紧凑模式 ── */
            <div className="stagger-children grid gap-2 grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {filteredProducts.map((product) => {
                const pvs = variantsByProduct[product.id] ?? [];
                const isVariant = product.has_variants;
                const chosenVariantId = selectedVariantId[product.id] ?? pvs[0]?.id;
                const chosenVariant = pvs.find((v) => v.id === chosenVariantId);
                const effectiveStock = isVariant ? (chosenVariant?.stock ?? 0) : product.stock;
                const outOfStock = effectiveStock === 0;
                const qty = inputQty[product.id] ?? 0;

                return (
                  <div key={product.id} className="group flex flex-col overflow-hidden rounded-xl glass-strong transition duration-200 hover:border-paper-300">
                    {/* 图片（正方形，紧凑） */}
                    <div className="relative aspect-square w-full overflow-hidden bg-paper-100">
                      {product.image_url ? (
                        <Image
                          src={product.image_url}
                          alt={product.name}
                          fill
                          sizes="(max-width: 640px) 50vw, (max-width: 1280px) 33vw, 20vw"
                          className="object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : imgPlaceholder("sm")}
                      {outOfStock && (
                        <div className="absolute inset-0 flex items-center justify-center bg-paper-900/55">
                          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-paper-700">{t("shop.outOfStockShort")}</span>
                        </div>
                      )}
                      {product.image_url && (
                        <button
                          type="button"
                          onClick={() => lightbox.open(product.image_url, product.name)}
                          title={t("common.viewPhoto", { name: product.name })}
                          className="absolute inset-0 cursor-zoom-in"
                        >
                          <span className="sr-only">{t("common.viewPhoto", { name: product.name })}</span>
                        </button>
                      )}
                    </div>

                    <div className="flex flex-1 flex-col p-2">
                      {/* 名称（单行截断） */}
                      <p className="truncate text-xs font-semibold leading-snug text-paper-900">{product.name}</p>

                      {/* 价格 + 库存 */}
                      <div className="mt-0.5 flex items-baseline justify-between gap-1">
                        <span className="text-base font-normal tracking-tight text-paper-900">€{Number(product.price).toFixed(2)}</span>
                        <span className={`shrink-0 font-mono text-[10px] tracking-[0.08em] ${outOfStock || effectiveStock < 10 ? "text-ember-600" : "text-paper-500"}`}>
                          {t("shop.unitsShort", { n: effectiveStock })}
                        </span>
                      </div>

                      {/* 颜色选择器（紧凑） */}
                      {isVariant && pvs.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {pvs.map((v) => (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => setSelectedVariantId((prev) => ({ ...prev, [product.id]: v.id }))}
                              className={`rounded px-1.5 py-0.5 text-xs font-medium transition-colors ${
                                chosenVariantId === v.id ? "bg-paper-700 text-white" : "border border-paper-200 text-paper-600 hover:border-paper-400"
                              } ${v.stock === 0 ? "opacity-40 line-through" : ""}`}
                            >
                              {v.color}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* 数量控制 + 加入 */}
                      <div className="mt-1.5 flex items-center gap-1">
                        <div className="flex items-center rounded border border-paper-200">
                          <button type="button" disabled={outOfStock || qty <= 0}
                            onClick={() => setInputQty((p) => ({ ...p, [product.id]: Math.max(0, qty - 1) }))}
                            className="flex h-7 w-7 items-center justify-center text-xs text-paper-500 transition hover:text-paper-900 disabled:opacity-30">−</button>
                          <input type="number" min={0} max={effectiveStock} value={qty} disabled={outOfStock}
                            onChange={(e) => setInputQty((p) => ({ ...p, [product.id]: Math.min(effectiveStock, Math.max(0, parseInt(e.target.value) || 0)) }))}
                            className="w-7 bg-transparent text-center text-xs text-paper-900 outline-none disabled:opacity-40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                          <button type="button" disabled={outOfStock || qty >= effectiveStock}
                            onClick={() => setInputQty((p) => ({ ...p, [product.id]: Math.min(effectiveStock, qty + 1) }))}
                            className="flex h-7 w-7 items-center justify-center text-xs text-paper-500 transition hover:text-paper-900 disabled:opacity-30">+</button>
                        </div>
                        <button type="button" disabled={outOfStock || qty <= 0}
                          onClick={() => addToCart(product, isVariant ? chosenVariant : undefined)}
                          className="flex-1 rounded-full border border-paper-800 py-1 text-xs font-medium text-paper-800 transition-colors hover:bg-paper-800 hover:text-white disabled:cursor-not-allowed disabled:border-paper-200 disabled:text-paper-400 disabled:hover:bg-transparent">
                          {outOfStock ? t("shop.outOfStockShort") : t("shop.addShort")}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── 购物车侧边栏 ── */}
        <div className="w-full lg:w-80 lg:shrink-0">
          <div className="sticky top-4 rounded-xl glass-strong">
            <div className="border-b border-paper-100 px-5 py-4">
              <h2 className="font-semibold text-paper-900">
                {t("cart.title")}
                {cartCount > 0 && (
                  <span className="ml-2 rounded-full bg-paper-700 px-2 py-0.5 text-xs font-medium text-white">{cartCount}</span>
                )}
              </h2>
            </div>

            <div className="p-5">
              {cartEntries.length === 0 ? (
                <p className="py-8 text-center text-sm text-paper-500">{t("cart.empty")}</p>
              ) : (
                <ul className="space-y-3">
                  {cartEntries.map(([key, { product, variant, quantity }]) => (
                    <li key={key} className="flex items-center gap-3">
                      {product.image_url ? (
                        <button
                          type="button"
                          onClick={() => lightbox.open(product.image_url, product.name)}
                          title={t("common.viewPhoto", { name: product.name })}
                          className="h-10 w-10 shrink-0 cursor-zoom-in overflow-hidden rounded-lg"
                        >
                          <Image src={product.image_url} alt={product.name} width={40} height={40} className="h-full w-full object-cover" />
                        </button>
                      ) : (
                        <div className="h-10 w-10 rounded-lg bg-paper-100" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-paper-900">
                          {product.name}
                          {variant && <span className="ml-1 text-paper-500">· {variant.color}</span>}
                        </p>
                        <p className="text-xs text-paper-500">€{Number(product.price).toFixed(2)} × {quantity}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => changeCartQty(key, -1)}
                          className="flex h-6 w-6 items-center justify-center rounded border border-paper-200 text-xs text-paper-500 hover:bg-paper-100">−</button>
                        <span className="w-6 text-center text-xs font-medium text-paper-900">{quantity}</span>
                        <button type="button" onClick={() => changeCartQty(key, 1)}
                          disabled={quantity >= (variant ? variant.stock : product.stock)}
                          className="flex h-6 w-6 items-center justify-center rounded border border-paper-200 text-xs text-paper-500 hover:bg-paper-100 disabled:opacity-30">+</button>
                        <button type="button" onClick={() => removeFromCart(key)} className="ml-1 text-xs text-paper-400 hover:text-red-400">✕</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {cartEntries.length > 0 && (
                <div className="mt-4 border-t border-paper-100 pt-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-paper-500">{t("cart.total")}</span>
                    <span className="font-bold text-paper-900">€{total.toFixed(2)}</span>
                  </div>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t("cart.notePlaceholder")}
                    rows={2}
                    className="mt-3 w-full resize-none rounded-lg border border-paper-200 px-3 py-2 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-paper-400 focus:ring-2 focus:ring-paper-200"
                  />
                </div>
              )}

              {result && "error" in result && (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{result.error}</p>
              )}
              {result && "success" in result && (
                <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-600">
                  {t("cart.orderSuccess", { id: result.orderId.slice(0, 8) })}
                </p>
              )}

              {lastOrderItems.length > 0 && (
                <button type="button" onClick={handleRepeatOrder}
                  className="mt-3 w-full rounded-xl border-2 border-paper-300 py-3.5 text-base font-semibold text-paper-700 transition hover:bg-paper-100 sm:border sm:py-2 sm:text-sm sm:font-medium">
                  {t("cart.repeatOrder")}
                </button>
              )}
              <button type="button" onClick={handleSubmit} disabled={cartEntries.length === 0 || isPending}
                className="mt-2 w-full rounded-lg bg-paper-700 py-3.5 text-base font-medium text-white transition hover:bg-paper-800 disabled:cursor-not-allowed disabled:opacity-40 sm:py-2.5 sm:text-sm">
                {isPending ? t("common.submitting") : t("cart.submit")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 手机底部固定购物车入口 */}
      {cartCount > 0 && (
        <button
          type="button"
          onClick={() => setMobileCartOpen(true)}
          className="fixed inset-x-0 bottom-0 z-40 flex w-full items-center justify-between border-t border-paper-200 bg-white px-5 py-3.5 lg:hidden"
        >
          <div className="flex items-center gap-3">
            <div className="relative">
              <svg className="h-6 w-6 text-paper-900" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-paper-700 text-[10px] font-bold text-white">
                {cartCount > 9 ? "9+" : cartCount}
              </span>
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold text-paper-900">{t("cart.selectedCount", { n: cartCount })}</p>
              <p className="text-xs text-paper-500">{t("cart.total")} €{total.toFixed(2)}</p>
            </div>
          </div>
          <span className="rounded-xl bg-paper-700 px-5 py-2.5 text-sm font-semibold text-white">{t("cart.viewCart")}</span>
        </button>
      )}

      {/* 手机购物车滑出面板 */}
      {mobileCartOpen && (
        <ModalPortal>
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileCartOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col rounded-t-2xl bg-white">
            {/* 面板头部 */}
            <div className="flex shrink-0 items-center justify-between border-b border-paper-100 px-5 py-4">
              <h2 className="font-semibold text-paper-900">
                {t("cart.title")}
                {cartCount > 0 && (
                  <span className="ml-2 rounded-full bg-paper-700 px-2 py-0.5 text-xs font-medium text-white">{cartCount}</span>
                )}
              </h2>
              <button type="button" onClick={() => setMobileCartOpen(false)}
                className="rounded-lg p-1 text-paper-500 hover:text-paper-600">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 商品列表 */}
            <div className="flex-1 overflow-y-auto px-5 py-2">
              {cartEntries.length === 0 ? (
                <p className="py-12 text-center text-sm text-paper-500">{t("cart.empty")}</p>
              ) : (
                <ul className="divide-y divide-paper-100">
                  {cartEntries.map(([key, { product, variant, quantity }]) => (
                    <li key={key} className="flex items-start gap-3 py-3">
                      {product.image_url ? (
                        <button
                          type="button"
                          onClick={() => lightbox.open(product.image_url, product.name)}
                          title={t("common.viewPhoto", { name: product.name })}
                          className="h-14 w-14 shrink-0 cursor-zoom-in overflow-hidden rounded-lg"
                        >
                          <Image src={product.image_url} alt={product.name} width={56} height={56} className="h-full w-full object-cover" />
                        </button>
                      ) : (
                        <div className="h-14 w-14 shrink-0 rounded-lg bg-paper-100" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-snug text-paper-900">
                          {product.name}
                          {variant && <span className="ml-1 text-paper-500">· {variant.color}</span>}
                        </p>
                        <p className="mt-0.5 text-xs text-paper-500">€{Number(product.price).toFixed(2)} {t("cart.perUnit")}</p>
                        <p className="mt-1 text-sm font-bold text-paper-900">€{(product.price * quantity).toFixed(2)}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <button type="button" onClick={() => removeFromCart(key)}
                          className="text-paper-400 hover:text-red-400">
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                        <div className="flex items-center rounded-lg border border-paper-200">
                          <button type="button" onClick={() => changeCartQty(key, -1)}
                            className="flex h-9 w-9 items-center justify-center text-paper-500 hover:text-paper-900">−</button>
                          <span className="w-8 text-center text-sm font-medium text-paper-900">{quantity}</span>
                          <button type="button" onClick={() => changeCartQty(key, 1)}
                            disabled={quantity >= (variant ? variant.stock : product.stock)}
                            className="flex h-9 w-9 items-center justify-center text-paper-500 hover:text-paper-900 disabled:opacity-30">+</button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 面板底部操作区 */}
            <div className="shrink-0 border-t border-paper-100 px-5 pb-8 pt-4">
              <div className="mb-3 flex items-baseline justify-between">
                <span className="text-sm text-paper-500">{t("cart.itemCount", { n: cartCount })}</span>
                <span className="text-xl font-bold text-paper-900">€{total.toFixed(2)}</span>
              </div>
              {cartEntries.length > 0 && (
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t("cart.notePlaceholder")}
                  rows={2}
                  className="mb-3 w-full resize-none rounded-lg border border-paper-200 px-3 py-2 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-paper-400 focus:ring-2 focus:ring-paper-200"
                />
              )}
              {result && "error" in result && (
                <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{result.error}</p>
              )}
              {result && "success" in result && (
                <p className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-600">
                  {t("cart.orderSuccess", { id: result.orderId.slice(0, 8) })}
                </p>
              )}
              {lastOrderItems.length > 0 && (
                <button type="button" onClick={handleRepeatOrder}
                  className="mb-2 w-full rounded-xl border-2 border-paper-300 py-3 text-base font-semibold text-paper-700 transition hover:bg-paper-100">
                  {t("cart.repeatOrder")}
                </button>
              )}
              <button type="button" onClick={handleSubmit} disabled={cartEntries.length === 0 || isPending}
                className="w-full rounded-xl bg-paper-700 py-3.5 text-base font-semibold text-white transition hover:bg-paper-800 disabled:cursor-not-allowed disabled:opacity-40">
                {isPending ? t("common.submitting") : t("cart.submit")}
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {lightbox.node}
    </div>
  );
}

/** 分类侧栏单项：名称 + 右侧计数，选中态用墨色填充 */
function CatSidebarItem({
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
