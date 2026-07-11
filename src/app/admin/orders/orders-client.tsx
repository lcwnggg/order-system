"use client";

import { useMemo, useState, useTransition } from "react";
import { updateOrderStatus } from "./actions";

type Product = { id: string; name: string; price: number; category_id: string | null };
type CategoryItem = { id: string; name: string; parent_id: string | null };
export type OrderItem = { id: string; quantity: number; product: Product; variantColor: string | null };
export type Order = {
  id: string;
  store_id: string;
  storeName: string | null;
  storeEmail: string | null;
  status: "pending" | "preparing" | "done";
  created_at: string;
  items: OrderItem[];
};

type FilterValue = "all" | "pending" | "preparing" | "done";
type SummaryView = "product" | "store";

const STATUS_LABEL: Record<string, string> = {
  pending: "待处理",
  preparing: "备货中",
  done: "已完成",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  preparing: "bg-blue-50 text-blue-700",
  done: "bg-green-50 text-green-700",
};

function displayStore(order: Order): string {
  return order.storeName ?? order.storeEmail ?? `门店 ${order.store_id.slice(0, 8)}…`;
}

// 商品名（带颜色变体），用于明细展示与按商品聚合
function itemLabel(item: OrderItem): string {
  return item.variantColor ? `${item.product.name} · ${item.variantColor}` : item.product.name;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${day} ${h}:${mi}`;
}

export default function OrdersClient({ orders, categories }: { orders: Order[]; categories: CategoryItem[] }) {
  const [filter, setFilter] = useState<FilterValue>("all");
  const [summaryView, setSummaryView] = useState<SummaryView>("product");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const filtered = useMemo(
    () => (filter === "all" ? orders : orders.filter((o) => o.status === filter)),
    [orders, filter]
  );

  const pendingOrders = useMemo(() => orders.filter((o) => o.status === "pending"), [orders]);

  // 按商品合并
  const productSummary = useMemo(() => {
    const map = new Map<string, number>();
    for (const order of pendingOrders) {
      for (const item of order.items) {
        const label = itemLabel(item);
        map.set(label, (map.get(label) ?? 0) + item.quantity);
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [pendingOrders]);

  // 按门店分组
  const storeGroups = useMemo(() => {
    const groups = new Map<
      string,
      { storeLabel: string; orderCount: number; products: Map<string, number> }
    >();
    for (const order of pendingOrders) {
      const key = order.store_id;
      if (!groups.has(key)) {
        groups.set(key, {
          storeLabel: displayStore(order),
          orderCount: 0,
          products: new Map(),
        });
      }
      const g = groups.get(key)!;
      g.orderCount++;
      for (const item of order.items) {
        const label = itemLabel(item);
        g.products.set(label, (g.products.get(label) ?? 0) + item.quantity);
      }
    }
    return Array.from(groups.values()).map((g) => ({
      storeLabel: g.storeLabel,
      orderCount: g.orderCount,
      products: Array.from(g.products.entries()).sort((a, b) => b[1] - a[1]),
    }));
  }, [pendingOrders]);

  function handlePrint() {
    const dateStr = new Date().toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    // Build product → { total, categoryId, stores }
    const productMap = new Map<
      string,
      { name: string; total: number; categoryId: string | null; stores: Map<string, number> }
    >();
    for (const order of pendingOrders) {
      const storeName = displayStore(order);
      for (const item of order.items) {
        const key = item.variantColor ? `${item.product.id}-${item.variantColor}` : item.product.id;
        if (!productMap.has(key)) {
          productMap.set(key, {
            name: itemLabel(item),
            total: 0,
            categoryId: item.product.category_id,
            stores: new Map(),
          });
        }
        const p = productMap.get(key)!;
        p.total += item.quantity;
        p.stores.set(storeName, (p.stores.get(storeName) ?? 0) + item.quantity);
      }
    }

    // Category label helper
    function catLabel(catId: string | null): { parent: string; child: string } {
      if (!catId) return { parent: "未分类", child: "" };
      const cat = categories.find((c) => c.id === catId);
      if (!cat) return { parent: "未分类", child: "" };
      if (!cat.parent_id) return { parent: cat.name, child: "" };
      const par = categories.find((c) => c.id === cat.parent_id);
      return { parent: par?.name ?? "未分类", child: cat.name };
    }

    // Sort by parent category → child category → product name
    const rows = [...productMap.values()].sort((a, b) => {
      const la = catLabel(a.categoryId);
      const lb = catLabel(b.categoryId);
      const pc = la.parent.localeCompare(lb.parent, "zh-CN");
      if (pc !== 0) return pc;
      const cc = la.child.localeCompare(lb.child, "zh-CN");
      if (cc !== 0) return cc;
      return a.name.localeCompare(b.name, "zh-CN");
    });

    // Build HTML rows, with category section headers
    let lastParent = "";
    const tableRows = rows
      .map((p) => {
        const { parent, child } = catLabel(p.categoryId);
        const storeDetail = [...p.stores.entries()]
          .map(([s, q]) => `<span class="store-tag">${s}×${q}</span>`)
          .join(" ");
        let header = "";
        if (parent !== lastParent) {
          lastParent = parent;
          header = `<tr class="cat-row"><td colspan="2">${parent}</td></tr>`;
        }
        return `${header}<tr>
<td><div class="pname">${p.name}</div>${child ? `<div class="cname">${parent} › ${child}</div>` : ""}<div class="stores">${storeDetail}</div></td>
<td class="qty">${p.total}</td></tr>`;
      })
      .join("");

    const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<title>备货单 ${dateStr}</title>
<style>
body{font-family:sans-serif;margin:2cm;color:#111;font-size:14px}
h1{font-size:20px;margin-bottom:4px}
.sub{color:#555;font-size:12px;margin-bottom:24px}
table{width:100%;border-collapse:collapse}
th{text-align:left;border-bottom:2px solid #111;padding:8px 4px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#444}
th.qty,td.qty{text-align:right}
td{padding:9px 4px;border-bottom:1px solid #e5e7eb;vertical-align:top}
td.qty{font-weight:700;font-size:18px;white-space:nowrap;vertical-align:top;padding-top:11px}
.pname{font-weight:600;margin-bottom:3px}
.cname{font-size:11px;color:#9ca3af;margin-bottom:4px}
.stores{display:flex;flex-wrap:wrap;gap:4px}
.store-tag{font-size:11px;color:#374151;background:#f3f4f6;padding:1px 7px;border-radius:999px}
.cat-row{background:#f9fafb}
.cat-row td{padding:10px 4px 3px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;border-bottom:1px solid #d1d5db}
@media print{body{margin:1cm}}
</style></head><body>
<h1>备货单</h1>
<div class="sub">生成时间：${dateStr}　·　${pendingOrders.length} 笔待处理订单　·　${rows.length} 种商品</div>
<table><thead><tr><th>商品（门店需求明细）</th><th class="qty">合计</th></tr></thead>
<tbody>${tableRows}</tbody></table>
</body></html>`;

    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
      win.print();
    }
  }

  function handleUpdateStatus(orderId: string, newStatus: "preparing" | "done") {
    setPendingId(orderId);
    startTransition(async () => {
      await updateOrderStatus(orderId, newStatus);
      setPendingId(null);
    });
  }

  function orderTotal(items: OrderItem[]) {
    return items.reduce((sum, i) => sum + i.product.price * i.quantity, 0);
  }

  const filterTabs: { value: FilterValue; label: string }[] = [
    { value: "all", label: "全部" },
    { value: "pending", label: "待处理" },
    { value: "preparing", label: "备货中" },
    { value: "done", label: "已完成" },
  ];

  return (
    <div className="space-y-6">
      {/* ── 待备货汇总 ── */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
        {/* 汇总标题 + 视图切换 */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
          <h2 className="text-sm font-semibold text-amber-800">
            待备货汇总
            <span className="ml-2 font-normal text-amber-600">
              （{pendingOrders.length} 个待处理订单）
            </span>
          </h2>
          <div className="flex items-center gap-2">
            {pendingOrders.length > 0 && (
              <button
                type="button"
                onClick={handlePrint}
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-50"
              >
                打印备货单
              </button>
            )}
            <div className="flex gap-1 rounded-lg border border-amber-200 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setSummaryView("product")}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  summaryView === "product"
                    ? "bg-amber-600 text-white"
                    : "text-amber-700 hover:bg-amber-50"
                }`}
              >
                按商品汇总
              </button>
              <button
                type="button"
                onClick={() => setSummaryView("store")}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  summaryView === "store"
                    ? "bg-amber-600 text-white"
                    : "text-amber-700 hover:bg-amber-50"
                }`}
              >
                按门店分组
              </button>
            </div>
          </div>
        </div>

        <div className="px-5 pb-4">
          {pendingOrders.length === 0 ? (
            <p className="text-sm text-amber-600">暂无待处理订单</p>
          ) : summaryView === "product" ? (
            /* 按商品汇总 */
            <div className="flex flex-wrap gap-2">
              {productSummary.map(([name, qty]) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 shadow-sm ring-1 ring-amber-200"
                >
                  <span>{name}</span>
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-700">
                    ×{qty}
                  </span>
                </span>
              ))}
            </div>
          ) : (
            /* 按门店分组 */
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {storeGroups.map((group) => (
                <div
                  key={group.storeLabel}
                  className="rounded-lg bg-white p-3 shadow-sm ring-1 ring-amber-200"
                >
                  <p className="mb-2 text-xs font-semibold text-zinc-800">
                    {group.storeLabel}
                    <span className="ml-1.5 font-normal text-zinc-400">
                      {group.orderCount} 笔订单
                    </span>
                  </p>
                  <ul className="space-y-1">
                    {group.products.map(([name, qty]) => (
                      <li key={name} className="flex items-center justify-between text-xs">
                        <span className="text-zinc-600">{name}</span>
                        <span className="font-bold text-amber-700">×{qty}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 筛选 tabs ── */}
      <div className="flex w-fit gap-1 rounded-xl border border-zinc-200 bg-white p-1 shadow-sm">
        {filterTabs.map(({ value, label }) => {
          const count =
            value === "all" ? orders.length : orders.filter((o) => o.status === value).length;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                filter === value ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-900"
              }`}
            >
              {label}
              <span className={`ml-1.5 text-xs ${filter === value ? "text-zinc-300" : "text-zinc-400"}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── 订单列表 ── */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white py-16 text-center">
          <p className="text-sm text-zinc-400">
            {filter === "all" ? "暂无订单" : `暂无${STATUS_LABEL[filter]}订单`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((order) => {
            const total = orderTotal(order.items);
            const isThisPending = pendingId === order.id;
            return (
              <div
                key={order.id}
                className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 bg-zinc-50 px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-zinc-900">
                      {displayStore(order)}
                    </span>
                    <span className="text-xs text-zinc-400">
                      {formatDateTime(order.created_at)}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[order.status]}`}
                    >
                      {STATUS_LABEL[order.status]}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-zinc-900">
                      €{total.toFixed(2)}
                    </span>
                    {order.status === "pending" && (
                      <button
                        type="button"
                        disabled={isThisPending}
                        onClick={() => handleUpdateStatus(order.id, "preparing")}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                      >
                        {isThisPending ? "处理中…" : "开始备货"}
                      </button>
                    )}
                    {order.status === "preparing" && (
                      <button
                        type="button"
                        disabled={isThisPending}
                        onClick={() => handleUpdateStatus(order.id, "done")}
                        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                      >
                        {isThisPending ? "处理中…" : "标记完成"}
                      </button>
                    )}
                    {order.status === "done" && (
                      <span className="text-xs text-zinc-400">已完成</span>
                    )}
                  </div>
                </div>

                <div className="divide-y divide-zinc-50 px-5">
                  {order.items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between py-3 text-sm"
                    >
                      <span className="text-zinc-700">
                        {item.product.name}
                        {item.variantColor && (
                          <span className="ml-1 text-zinc-400">· {item.variantColor}</span>
                        )}
                      </span>
                      <span className="text-zinc-400">
                        €{Number(item.product.price).toFixed(2)} × {item.quantity}
                      </span>
                      <span className="w-20 text-right font-medium text-zinc-900">
                        €{(item.product.price * item.quantity).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
