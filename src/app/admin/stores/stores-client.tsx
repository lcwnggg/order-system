"use client";

import { useState, useTransition } from "react";
import { updateStoreName, type ActionResult } from "./actions";

export type StoreUser = {
  id: string;
  email: string;
  store_name: string | null;
};

export default function StoresClient({ stores }: { stores: StoreUser[] }) {
  const [names, setNames] = useState<Record<string, string>>(
    () => Object.fromEntries(stores.map((s) => [s.id, s.store_name ?? ""]))
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ActionResult | null>>({});
  const [, startTransition] = useTransition();

  function handleSave(storeId: string) {
    setSavingId(storeId);
    setResults((prev) => ({ ...prev, [storeId]: null }));
    startTransition(async () => {
      const result = await updateStoreName(storeId, names[storeId] ?? "");
      setResults((prev) => ({ ...prev, [storeId]: result }));
      setSavingId(null);
    });
  }

  if (stores.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-paper-300 bg-white py-16 text-center">
        <p className="text-sm text-paper-500">暂无 store 角色用户</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-paper-200 bg-paper-25">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-paper-100 bg-paper-100 text-left">
            <th className="px-5 py-3 font-medium text-paper-500">邮箱</th>
            <th className="px-5 py-3 font-medium text-paper-500">店名</th>
            <th className="px-5 py-3 font-medium text-paper-500">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-paper-100">
          {stores.map((store) => {
            const isSaving = savingId === store.id;
            const result = results[store.id];
            return (
              <tr key={store.id} className="hover:bg-paper-100">
                <td className="px-5 py-3 text-paper-600">{store.email}</td>
                <td className="px-5 py-3">
                  <input
                    type="text"
                    value={names[store.id] ?? ""}
                    onChange={(e) =>
                      setNames((prev) => ({ ...prev, [store.id]: e.target.value }))
                    }
                    onKeyDown={(e) => e.key === "Enter" && handleSave(store.id)}
                    placeholder="输入店名…"
                    className="w-full max-w-xs rounded-lg border border-paper-200 px-3 py-1.5 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-paper-400 focus:ring-2 focus:ring-paper-200"
                  />
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => handleSave(store.id)}
                      className="rounded-lg bg-paper-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-paper-800 disabled:opacity-50"
                    >
                      {isSaving ? "保存中…" : "保存"}
                    </button>
                    {result && "success" in result && (
                      <span className="text-xs text-green-600">已保存</span>
                    )}
                    {result && "error" in result && (
                      <span className="text-xs text-red-500">{result.error}</span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
