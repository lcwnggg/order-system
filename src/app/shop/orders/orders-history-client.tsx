"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelOrder } from "../actions";

type StoreOrderItem = {
  id: string;
  productId: string;
  name: string;
  price: number;
  quantity: number;
  variantId: string | null;
  variantColor: string | null;
};

export type StoreOrder = {
  id: string;
  status: "pending" | "preparing" | "done" | "cancelled";
  created_at: string;
  note: string | null;
  items: StoreOrderItem[];
};

const CART_KEY = "shopCart";

const STATUS_LABEL: Record<StoreOrder["status"], string> = {
  pending: "待处理",
  preparing: "备货中",
  done: "已完成",
  cancelled: "已取消",
};

const STATUS_COLOR: Record<StoreOrder["status"], string> = {
  pending: "bg-amber-50 text-amber-700",
  preparing: "bg-blue-50 text-blue-700",
  done: "bg-green-50 text-green-700",
  cancelled: "bg-sage-100 text-sage-500",
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function OrdersHistoryClient({ orders }: { orders: StoreOrder[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleReorder(order: StoreOrder) {
    // 写入购物车 localStorage（与 shop-client 同一 key/结构），跳转到下单页由其水合
    const rows = order.items.map((it) => ({
      productId: it.productId,
      variantId: it.variantId ?? undefined,
      quantity: it.quantity,
    }));
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(rows));
    } catch {
      // 忽略写入失败
    }
    router.push("/shop");
  }

  function handleCancel(orderId: string) {
    if (!window.confirm("确定取消这笔订单吗？取消后库存会自动退回。")) return;
    setError(null);
    setPendingId(orderId);
    startTransition(async () => {
      const res = await cancelOrder(orderId);
      setPendingId(null);
      if (res.error) {
        setError(res.error);
      } else {
        router.refresh();
      }
    });
  }

  function orderTotal(items: StoreOrderItem[]) {
    return items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  }

  if (orders.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-sage-300 bg-sage-25 py-20 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-sage-100 text-sage-400">
          <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <p className="text-sm text-sage-500">还没有订单</p>
        <a
          href="/shop"
          className="mt-4 inline-block rounded-xl bg-sage-700 px-5 py-2.5 text-sm font-medium text-white shadow-[0_6px_16px_rgba(74,90,70,0.28)] transition hover:bg-sage-800"
        >
          去下单
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-sage-900">我的订单</h1>
        <span className="text-sm text-sage-500">共 {orders.length} 笔</span>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}

      {orders.map((order) => {
        const total = orderTotal(order.items);
        const isThisPending = pendingId === order.id;
        return (
          <div
            key={order.id}
            className="overflow-hidden rounded-2xl border border-sage-200 bg-sage-25 shadow-[0_4px_16px_rgba(91,107,87,0.06)] transition duration-200 hover:shadow-[0_10px_24px_rgba(91,107,87,0.11)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sage-100 bg-sage-50 px-5 py-3">
              <div className="flex items-center gap-3">
                <span className="text-xs text-sage-500">{formatDateTime(order.created_at)}</span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[order.status]}`}
                >
                  {STATUS_LABEL[order.status]}
                </span>
              </div>
              <span className="text-xs text-sage-500">#{order.id.slice(0, 8)}</span>
            </div>

            {order.note && (
              <div className="border-b border-sage-100 bg-amber-50/50 px-5 py-2 text-xs text-amber-800">
                备注：{order.note}
              </div>
            )}

            <div className="divide-y divide-sage-100 px-5">
              {order.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="text-sage-700">
                    {item.name}
                    {item.variantColor && (
                      <span className="ml-1 text-sage-500">· {item.variantColor}</span>
                    )}
                  </span>
                  <span className="text-sage-500">
                    €{Number(item.price).toFixed(2)} × {item.quantity}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sage-100 px-5 py-3">
              <span className="text-sm font-bold text-sage-900">€{total.toFixed(2)}</span>
              <div className="flex items-center gap-2">
                {order.status === "pending" && (
                  <button
                    type="button"
                    disabled={isThisPending}
                    onClick={() => handleCancel(order.id)}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                  >
                    {isThisPending ? "取消中…" : "取消订单"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleReorder(order)}
                  className="rounded-lg bg-sage-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sage-800"
                >
                  重新下单
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
