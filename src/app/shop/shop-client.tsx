"use client";

import { useTransition, useState } from "react";
import { submitOrder } from "./actions";

export type Product = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  stock: number;
  image_url: string | null;
  category_id: string | null;
};

type CategoryItem = { id: string; name: string; parent_id: string | null };

type CartMap = Record<string, { product: Product; quantity: number }>;

const UNCATEGORIZED = "__uncategorized__";

export default function ShopClient({
  products,
  categories,
}: {
  products: Product[];
  categories: CategoryItem[];
}) {
  // ── Cart state (unchanged) ──
  const [cart, setCart] = useState<CartMap>({});
  const [inputQty, setInputQty] = useState<Record<string, number>>(
    () => Object.fromEntries(products.map((p) => [p.id, 0]))
  );
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<
    null | { success: true; orderId: string } | { error: string }
  >(null);

  // ── Category + search state ──
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // ── Derived category data ──
  const parentCategories = categories.filter((c) => !c.parent_id);
  const currentChildren =
    selectedParentId && selectedParentId !== UNCATEGORIZED
      ? categories.filter((c) => c.parent_id === selectedParentId)
      : [];

  function allChildIds(parentId: string) {
    return categories.filter((c) => c.parent_id === parentId).map((c) => c.id);
  }

  // ── Filtered products ──
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

  // ── Category nav helpers ──
  function selectParent(id: string | null) {
    setSelectedParentId(id);
    setSelectedChildId(null);
  }

  // ── Cart helpers (unchanged) ──
  function addToCart(product: Product) {
    const qty = inputQty[product.id] ?? 0;
    if (qty <= 0 || product.stock === 0) return;
    setCart((prev) => {
      const existing = prev[product.id]?.quantity ?? 0;
      return {
        ...prev,
        [product.id]: {
          product,
          quantity: Math.min(existing + qty, product.stock),
        },
      };
    });
    setInputQty((prev) => ({ ...prev, [product.id]: 0 }));
  }

  function changeCartQty(productId: string, delta: number) {
    setCart((prev) => {
      const item = prev[productId];
      if (!item) return prev;
      const next = item.quantity + delta;
      if (next <= 0) {
        const { [productId]: _, ...rest } = prev;
        return rest;
      }
      return {
        ...prev,
        [productId]: { ...item, quantity: Math.min(next, item.product.stock) },
      };
    });
  }

  function removeFromCart(productId: string) {
    setCart((prev) => {
      const { [productId]: _, ...rest } = prev;
      return rest;
    });
  }

  function handleSubmit() {
    const items = Object.values(cart).map((item) => ({
      productId: item.product.id,
      quantity: item.quantity,
    }));
    setResult(null);
    startTransition(async () => {
      const res = await submitOrder(items);
      setResult(res);
      if ("success" in res) setCart({});
    });
  }

  const cartItems = Object.values(cart);
  const total = cartItems.reduce(
    (sum, item) => sum + item.product.price * item.quantity,
    0
  );
  const cartCount = cartItems.reduce((n, item) => n + item.quantity, 0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* ── 商品区 ── */}
        <div className="flex-1 min-w-0">
          {/* 大类导航 */}
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => selectParent(null)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
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
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
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
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
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
            <div className="mb-3 flex flex-wrap gap-2 pl-2">
              <button
                type="button"
                onClick={() => setSelectedChildId(null)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
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
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
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
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索商品名称…"
              className="w-full rounded-xl border border-zinc-200 bg-white py-2.5 pl-10 pr-10 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
              >
                ✕
              </button>
            )}
          </div>

          {/* 商品数量提示 */}
          <p className="mb-4 text-sm font-medium text-zinc-700">
            {filteredProducts.length === 0
              ? "暂无商品"
              : `共 ${filteredProducts.length} 件商品`}
            {searchQuery && (
              <span className="ml-1 font-normal text-zinc-400">
                · 搜索「{searchQuery}」
              </span>
            )}
          </p>

          {filteredProducts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white py-20 text-center">
              <p className="text-sm text-zinc-400">
                {searchQuery ? "未找到匹配的商品" : "暂无商品"}
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredProducts.map((product) => {
                const outOfStock = product.stock === 0;
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
                        <img
                          src={product.image_url}
                          alt={product.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-zinc-300">
                          <svg
                            className="h-12 w-12"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={1}
                              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                            />
                          </svg>
                        </div>
                      )}
                      {outOfStock && (
                        <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/50">
                          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-zinc-700">
                            缺货
                          </span>
                        </div>
                      )}
                    </div>

                    {/* 信息 */}
                    <div className="flex flex-1 flex-col p-4">
                      <p className="font-semibold text-zinc-900">{product.name}</p>
                      {product.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-zinc-400">
                          {product.description}
                        </p>
                      )}
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-lg font-bold text-zinc-900">
                          ¥{Number(product.price).toFixed(2)}
                        </span>
                        <span
                          className={`text-xs ${
                            outOfStock
                              ? "text-red-500"
                              : product.stock < 10
                                ? "text-amber-500"
                                : "text-zinc-400"
                          }`}
                        >
                          库存 {product.stock}
                        </span>
                      </div>

                      {/* 数量控制 + 加入购物车 */}
                      <div className="mt-3 flex items-center gap-2">
                        <div className="flex items-center rounded-lg border border-zinc-200">
                          <button
                            type="button"
                            disabled={outOfStock || qty <= 0}
                            onClick={() =>
                              setInputQty((p) => ({
                                ...p,
                                [product.id]: Math.max(0, qty - 1),
                              }))
                            }
                            className="flex h-8 w-8 items-center justify-center text-zinc-500 transition hover:text-zinc-900 disabled:opacity-30"
                          >
                            −
                          </button>
                          <input
                            type="number"
                            min={0}
                            max={product.stock}
                            value={qty}
                            disabled={outOfStock}
                            onChange={(e) =>
                              setInputQty((p) => ({
                                ...p,
                                [product.id]: Math.min(
                                  product.stock,
                                  Math.max(0, parseInt(e.target.value) || 0)
                                ),
                              }))
                            }
                            className="w-10 bg-transparent text-center text-sm text-zinc-900 outline-none disabled:opacity-40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                          />
                          <button
                            type="button"
                            disabled={outOfStock || qty >= product.stock}
                            onClick={() =>
                              setInputQty((p) => ({
                                ...p,
                                [product.id]: Math.min(product.stock, qty + 1),
                              }))
                            }
                            className="flex h-8 w-8 items-center justify-center text-zinc-500 transition hover:text-zinc-900 disabled:opacity-30"
                          >
                            +
                          </button>
                        </div>
                        <button
                          type="button"
                          disabled={outOfStock || qty <= 0}
                          onClick={() => addToCart(product)}
                          className="flex-1 rounded-lg bg-zinc-900 py-2 text-xs font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
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

        {/* ── 购物车 (unchanged) ── */}
        <div className="w-full lg:w-80 lg:shrink-0">
          <div className="sticky top-4 rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-100 px-5 py-4">
              <h2 className="font-semibold text-zinc-900">
                购物车
                {cartCount > 0 && (
                  <span className="ml-2 rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white">
                    {cartCount}
                  </span>
                )}
              </h2>
            </div>

            <div className="p-5">
              {cartItems.length === 0 ? (
                <p className="py-8 text-center text-sm text-zinc-400">
                  购物车为空
                </p>
              ) : (
                <ul className="space-y-3">
                  {cartItems.map(({ product, quantity }) => (
                    <li key={product.id} className="flex items-center gap-3">
                      {product.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={product.image_url}
                          alt={product.name}
                          className="h-10 w-10 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-lg bg-zinc-100" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium text-zinc-900">
                          {product.name}
                        </p>
                        <p className="text-xs text-zinc-400">
                          ¥{Number(product.price).toFixed(2)} × {quantity}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => changeCartQty(product.id, -1)}
                          className="flex h-6 w-6 items-center justify-center rounded border border-zinc-200 text-xs text-zinc-500 hover:bg-zinc-50"
                        >
                          −
                        </button>
                        <span className="w-6 text-center text-xs font-medium text-zinc-900">
                          {quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => changeCartQty(product.id, 1)}
                          disabled={quantity >= product.stock}
                          className="flex h-6 w-6 items-center justify-center rounded border border-zinc-200 text-xs text-zinc-500 hover:bg-zinc-50 disabled:opacity-30"
                        >
                          +
                        </button>
                        <button
                          type="button"
                          onClick={() => removeFromCart(product.id)}
                          className="ml-1 text-xs text-zinc-300 hover:text-red-400"
                        >
                          ✕
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {cartItems.length > 0 && (
                <div className="mt-4 border-t border-zinc-100 pt-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-500">合计</span>
                    <span className="font-bold text-zinc-900">
                      ¥{total.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              {result && "error" in result && (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                  {result.error}
                </p>
              )}
              {result && "success" in result && (
                <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-600">
                  订单提交成功！订单号：{result.orderId.slice(0, 8)}…
                </p>
              )}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={cartItems.length === 0 || isPending}
                className="mt-4 w-full rounded-lg bg-zinc-900 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isPending ? "提交中…" : "提交订单"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
