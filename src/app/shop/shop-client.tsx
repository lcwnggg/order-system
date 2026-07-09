"use client";

import { useTransition, useState, useMemo } from "react";
import { submitOrder } from "./actions";

export type Product = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  stock: number;
  image_url: string | null;
  category_id: string | null;
  has_variants: boolean;
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

const UNCATEGORIZED = "__uncategorized__";

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
  const [cart, setCart] = useState<CartMap>({});
  const [inputQty, setInputQty] = useState<Record<string, number>>(
    () => Object.fromEntries(products.map((p) => [p.id, 0]))
  );
  const [selectedVariantId, setSelectedVariantId] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<
    null | { success: true; orderId: string } | { error: string }
  >(null);

  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

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

  function allChildIds(parentId: string) {
    return categories.filter((c) => c.parent_id === parentId).map((c) => c.id);
  }

  const filteredProducts = products.filter((p) => {
    if (selectedChildId) {
      if (p.category_id !== selectedChildId) return false;
    } else if (selectedParentId === UNCATEGORIZED) {
      if (p.category_id !== null) return false;
    } else if (selectedParentId) {
      const valid = new Set([selectedParentId, ...allChildIds(selectedParentId)]);
      if (!p.category_id || !valid.has(p.category_id)) return false;
    }
    if (searchQuery.trim()) {
      return p.name.toLowerCase().includes(searchQuery.trim().toLowerCase());
    }
    return true;
  });

  function selectParent(id: string | null) {
    setSelectedParentId(id);
    setSelectedChildId(null);
  }

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

  function changeCartQty(key: string, delta: number) {
    setCart((prev) => {
      const item = prev[key];
      if (!item) return prev;
      const maxStock = item.variant ? item.variant.stock : item.product.stock;
      const next = item.quantity + delta;
      if (next <= 0) {
        const { [key]: _, ...rest } = prev;
        return rest;
      }
      return {
        ...prev,
        [key]: { ...item, quantity: Math.min(next, maxStock) },
      };
    });
  }

  function removeFromCart(key: string) {
    setCart((prev) => {
      const { [key]: _, ...rest } = prev;
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
      const res = await submitOrder(items);
      setResult(res);
      if ("success" in res) setCart({});
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

  return (
    <div className={`mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8${cartCount > 0 ? " pb-28 lg:pb-6" : ""}`}>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* ── 商品区 ── */}
        <div className="min-w-0 flex-1">
          {/* 大类导航 */}
          <div className="mb-3 flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={() => selectParent(null)}
              className={`flex-shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                selectedParentId === null
                  ? "bg-zinc-900 text-white"
                  : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              全部
            </button>
            {parentCategories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => selectParent(cat.id)}
                className={`flex-shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  selectedParentId === cat.id
                    ? "bg-zinc-900 text-white"
                    : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                }`}
              >
                {cat.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => selectParent(UNCATEGORIZED)}
              className={`flex-shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                selectedParentId === UNCATEGORIZED
                  ? "bg-zinc-900 text-white"
                  : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              未分类
            </button>
          </div>

          {/* 小类导航 */}
          {currentChildren.length > 0 && (
            <div className="mb-3 flex gap-2 overflow-x-auto pb-2 pl-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button
                type="button"
                onClick={() => setSelectedChildId(null)}
                className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  selectedChildId === null
                    ? "bg-zinc-700 text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
              >
                全部小类
              </button>
              {currentChildren.map((child) => (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => setSelectedChildId(child.id)}
                  className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    selectedChildId === child.id
                      ? "bg-zinc-700 text-white"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  }`}
                >
                  {child.name}
                </button>
              ))}
            </div>
          )}

          {/* 搜索框 */}
          <div className="relative mb-4">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索商品名称…"
              className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-10 pr-10 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
                ✕
              </button>
            )}
          </div>

          <p className="mb-4 text-sm font-medium text-zinc-700">
            {filteredProducts.length === 0 ? "暂无商品" : `共 ${filteredProducts.length} 件商品`}
            {searchQuery && <span className="ml-1 font-normal text-zinc-400">· 搜索「{searchQuery}」</span>}
          </p>

          {filteredProducts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white py-20 text-center">
              <p className="text-sm text-zinc-400">{searchQuery ? "未找到匹配的商品" : "暂无商品"}</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredProducts.map((product) => {
                const pvs = variantsByProduct[product.id] ?? [];
                const isVariant = product.has_variants;
                const chosenVariantId = selectedVariantId[product.id] ?? pvs[0]?.id;
                const chosenVariant = pvs.find((v) => v.id === chosenVariantId);
                const effectiveStock = isVariant ? (chosenVariant?.stock ?? 0) : product.stock;
                const outOfStock = effectiveStock === 0;
                const qty = inputQty[product.id] ?? 0;

                return (
                  <div
                    key={product.id}
                    className="flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
                  >
                    {/* 图片 */}
                    <div className="relative aspect-square w-full bg-zinc-100">
                      {product.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-zinc-300">
                          <svg className="h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                      )}
                      {outOfStock && (
                        <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/50">
                          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-zinc-700">缺货</span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-1 flex-col p-4">
                      <p className="font-semibold text-zinc-900">{product.name}</p>
                      {product.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-zinc-400">{product.description}</p>
                      )}
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-lg font-bold text-zinc-900">¥{Number(product.price).toFixed(2)}</span>
                        <span className={`text-xs ${outOfStock ? "text-red-500" : effectiveStock < 10 ? "text-amber-500" : "text-zinc-400"}`}>
                          库存 {effectiveStock}
                        </span>
                      </div>

                      {/* 颜色选择器 */}
                      {isVariant && pvs.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {pvs.map((v) => (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => setSelectedVariantId((prev) => ({ ...prev, [product.id]: v.id }))}
                              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                                chosenVariantId === v.id
                                  ? "bg-zinc-900 text-white"
                                  : "border border-zinc-200 text-zinc-600 hover:border-zinc-400"
                              } ${v.stock === 0 ? "opacity-40 line-through" : ""}`}
                            >
                              {v.color}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* 数量控制 + 加入购物车 */}
                      <div className="mt-3 flex items-center gap-2">
                        <div className="flex items-center rounded-lg border border-zinc-200">
                          <button
                            type="button"
                            disabled={outOfStock || qty <= 0}
                            onClick={() => setInputQty((p) => ({ ...p, [product.id]: Math.max(0, qty - 1) }))}
                            className="flex h-11 w-11 items-center justify-center text-zinc-500 transition hover:text-zinc-900 disabled:opacity-30 sm:h-8 sm:w-8"
                          >
                            −
                          </button>
                          <input
                            type="number"
                            min={0}
                            max={effectiveStock}
                            value={qty}
                            disabled={outOfStock}
                            onChange={(e) =>
                              setInputQty((p) => ({
                                ...p,
                                [product.id]: Math.min(effectiveStock, Math.max(0, parseInt(e.target.value) || 0)),
                              }))
                            }
                            className="w-12 bg-transparent text-center text-sm text-zinc-900 outline-none disabled:opacity-40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none sm:w-10"
                          />
                          <button
                            type="button"
                            disabled={outOfStock || qty >= effectiveStock}
                            onClick={() => setInputQty((p) => ({ ...p, [product.id]: Math.min(effectiveStock, qty + 1) }))}
                            className="flex h-11 w-11 items-center justify-center text-zinc-500 transition hover:text-zinc-900 disabled:opacity-30 sm:h-8 sm:w-8"
                          >
                            +
                          </button>
                        </div>
                        <button
                          type="button"
                          disabled={outOfStock || qty <= 0}
                          onClick={() => addToCart(product, isVariant ? chosenVariant : undefined)}
                          className="flex-1 rounded-lg bg-zinc-900 py-3 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 sm:py-2 sm:text-xs"
                        >
                          {outOfStock ? "缺货" : "加入购物车"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── 购物车 ── */}
        <div className="w-full lg:w-80 lg:shrink-0">
          <div className="sticky top-4 rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-100 px-5 py-4">
              <h2 className="font-semibold text-zinc-900">
                购物车
                {cartCount > 0 && (
                  <span className="ml-2 rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white">{cartCount}</span>
                )}
              </h2>
            </div>

            <div className="p-5">
              {cartEntries.length === 0 ? (
                <p className="py-8 text-center text-sm text-zinc-400">购物车为空</p>
              ) : (
                <ul className="space-y-3">
                  {cartEntries.map(([key, { product, variant, quantity }]) => (
                    <li key={key} className="flex items-center gap-3">
                      {product.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.image_url} alt={product.name} className="h-10 w-10 rounded-lg object-cover" />
                      ) : (
                        <div className="h-10 w-10 rounded-lg bg-zinc-100" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-zinc-900">
                          {product.name}
                          {variant && <span className="ml-1 text-zinc-400">· {variant.color}</span>}
                        </p>
                        <p className="text-xs text-zinc-400">¥{Number(product.price).toFixed(2)} × {quantity}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => changeCartQty(key, -1)}
                          className="flex h-6 w-6 items-center justify-center rounded border border-zinc-200 text-xs text-zinc-500 hover:bg-zinc-50">
                          −
                        </button>
                        <span className="w-6 text-center text-xs font-medium text-zinc-900">{quantity}</span>
                        <button type="button" onClick={() => changeCartQty(key, 1)}
                          disabled={quantity >= (variant ? variant.stock : product.stock)}
                          className="flex h-6 w-6 items-center justify-center rounded border border-zinc-200 text-xs text-zinc-500 hover:bg-zinc-50 disabled:opacity-30">
                          +
                        </button>
                        <button type="button" onClick={() => removeFromCart(key)}
                          className="ml-1 text-xs text-zinc-300 hover:text-red-400">
                          ✕
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {cartEntries.length > 0 && (
                <div className="mt-4 border-t border-zinc-100 pt-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-500">合计</span>
                    <span className="font-bold text-zinc-900">¥{total.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {result && "error" in result && (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{result.error}</p>
              )}
              {result && "success" in result && (
                <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-600">
                  订单提交成功！订单号：{result.orderId.slice(0, 8)}…
                </p>
              )}

              {lastOrderItems.length > 0 && (
                <button
                  type="button"
                  onClick={handleRepeatOrder}
                  className="mt-3 w-full rounded-xl border-2 border-zinc-300 py-3.5 text-base font-semibold text-zinc-700 transition hover:bg-zinc-50 sm:border sm:py-2 sm:text-sm sm:font-medium"
                >
                  再来一单
                </button>
              )}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={cartEntries.length === 0 || isPending}
                className="mt-2 w-full rounded-lg bg-zinc-900 py-3.5 text-base font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 sm:py-2.5 sm:text-sm"
              >
                {isPending ? "提交中…" : "提交订单"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 手机底部固定购物车操作栏 */}
      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-200 bg-white px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,.10)] lg:hidden">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-900">已选 {cartCount} 件</p>
              <p className="text-xs text-zinc-500">合计 ¥{total.toFixed(2)}</p>
            </div>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending}
              className="shrink-0 rounded-xl bg-zinc-900 px-8 py-3 text-base font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50"
            >
              {isPending ? "提交中…" : "提交订单"}
            </button>
          </div>
          {result && "error" in result && (
            <p className="mt-2 text-center text-xs text-red-600">{result.error}</p>
          )}
          {result && "success" in result && (
            <p className="mt-2 text-center text-xs text-green-600">订单提交成功！单号 {result.orderId.slice(0, 8)}…</p>
          )}
        </div>
      )}
    </div>
  );
}
