"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelOrder } from "../actions";
import { useI18n } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/dictionaries";

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

const STATUS_KEY: Record<StoreOrder["status"], TranslationKey> = {
  pending: "orderStatus.pending",
  preparing: "orderStatus.preparing",
  done: "orderStatus.done",
  cancelled: "orderStatus.cancelled",
};

const STATUS_COLOR: Record<StoreOrder["status"], string> = {
  pending: "bg-ember-50 text-ember-700",
  preparing: "bg-blue-50 text-blue-700",
  done: "bg-green-50 text-green-700",
  cancelled: "bg-paper-100 text-paper-500",
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function OrdersHistoryClient({ orders }: { orders: StoreOrder[] }) {
  const { t } = useI18n();
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
    if (!window.confirm(t("myOrders.confirmCancel"))) return;
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
      <div className="rounded-2xl border border-dashed border-paper-300 bg-paper-25 py-20 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-paper-100 text-paper-400">
          <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <p className="text-sm text-paper-500">{t("myOrders.empty")}</p>
        <a
          href="/shop"
          className="mt-4 inline-block rounded-xl bg-paper-700 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-paper-800"
        >
          {t("myOrders.goOrder")}
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-paper-900">{t("nav.myOrders")}</h1>
        <span className="text-sm text-paper-500">{t("myOrders.countTotal", { n: orders.length })}</span>
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
            className="overflow-hidden rounded-2xl glass-strong transition duration-200"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-paper-100 bg-paper-50 px-5 py-3">
              <div className="flex items-center gap-3">
                <span className="text-xs text-paper-500">{formatDateTime(order.created_at)}</span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[order.status]}`}
                >
                  {t(STATUS_KEY[order.status])}
                </span>
              </div>
              <span className="text-xs text-paper-500">#{order.id.slice(0, 8)}</span>
            </div>

            {order.note && (
              <div className="border-b border-paper-100 bg-ember-50/60 px-5 py-2 text-xs text-ember-800">
                {t("myOrders.note")}{order.note}
              </div>
            )}

            <div className="divide-y divide-paper-100 px-5">
              {order.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="text-paper-700">
                    {item.name}
                    {item.variantColor && (
                      <span className="ml-1 text-paper-500">· {item.variantColor}</span>
                    )}
                  </span>
                  <span className="text-paper-500">
                    €{Number(item.price).toFixed(2)} × {item.quantity}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-paper-100 px-5 py-3">
              <span className="text-sm font-bold text-paper-900">€{total.toFixed(2)}</span>
              <div className="flex items-center gap-2">
                {order.status === "pending" && (
                  <button
                    type="button"
                    disabled={isThisPending}
                    onClick={() => handleCancel(order.id)}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                  >
                    {isThisPending ? t("myOrders.cancelling") : t("myOrders.cancel")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleReorder(order)}
                  className="rounded-lg bg-paper-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-paper-800"
                >
                  {t("myOrders.reorder")}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
