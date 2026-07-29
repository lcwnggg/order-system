"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateStoreName, createStoreAccount, type ActionResult } from "./actions";
import { useT } from "@/lib/i18n/client";

export type StoreUser = {
  id: string;
  email: string;
  store_name: string | null;
};

export default function StoresClient({ stores }: { stores: StoreUser[] }) {
  const t = useT();
  const router = useRouter();
  const [names, setNames] = useState<Record<string, string>>(
    () => Object.fromEntries(stores.map((s) => [s.id, s.store_name ?? ""]))
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ActionResult | null>>({});
  const [, startTransition] = useTransition();

  // ── 新建门店账号 ──
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newStoreName, setNewStoreName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createOk, setCreateOk] = useState<string | null>(null);

  function handleSave(storeId: string) {
    setSavingId(storeId);
    setResults((prev) => ({ ...prev, [storeId]: null }));
    startTransition(async () => {
      const result = await updateStoreName(storeId, names[storeId] ?? "");
      setResults((prev) => ({ ...prev, [storeId]: result }));
      setSavingId(null);
    });
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    setCreateOk(null);
    startTransition(async () => {
      const res = await createStoreAccount(newEmail, newPassword, newStoreName);
      setCreating(false);
      if ("error" in res) {
        setCreateError(res.error);
      } else {
        setCreateOk(t("stores.created", { email: newEmail.trim().toLowerCase() }));
        setNewEmail("");
        setNewPassword("");
        setNewStoreName("");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* ── 新建门店账号 ── */}
      <form
        onSubmit={handleCreate}
        className="rounded-2xl glass-strong p-5"
      >
        <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.18em] text-paper-500">
          {t("stores.createTitle")}
        </p>
        <p className="mb-4 text-sm text-paper-600">
          {t("stores.createHint")}
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <input
            type="email"
            required
            autoComplete="off"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder={t("stores.emailPlaceholder")}
            className="rounded-lg border border-paper-200 bg-white px-3 py-2 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-paper-400 focus:ring-2 focus:ring-paper-200"
          />
          <input
            type="text"
            required
            minLength={6}
            autoComplete="off"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={t("stores.passwordPlaceholder")}
            className="rounded-lg border border-paper-200 bg-white px-3 py-2 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-paper-400 focus:ring-2 focus:ring-paper-200"
          />
          <input
            type="text"
            value={newStoreName}
            onChange={(e) => setNewStoreName(e.target.value)}
            placeholder={t("stores.namePlaceholder")}
            className="rounded-lg border border-paper-200 bg-white px-3 py-2 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-paper-400 focus:ring-2 focus:ring-paper-200"
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="submit"
            disabled={creating}
            className="rounded-full bg-paper-800 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-paper-700 disabled:opacity-50"
          >
            {creating ? t("stores.creating") : t("stores.create")}
          </button>
          {createError && <span className="text-xs text-ember-600">{createError}</span>}
          {createOk && <span className="text-xs text-paper-600">{createOk}</span>}
        </div>
      </form>

      {/* ── 门店列表 ── */}
      {stores.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-paper-300 bg-paper-25 py-16 text-center">
          <p className="text-sm text-paper-500">{t("stores.empty")}</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl glass-strong">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-paper-100 bg-paper-100 text-left">
                <th className="px-5 py-3 font-medium text-paper-500">{t("stores.thEmail")}</th>
                <th className="px-5 py-3 font-medium text-paper-500">{t("stores.thName")}</th>
                <th className="px-5 py-3 font-medium text-paper-500">{t("stores.thActions")}</th>
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
                        placeholder={t("stores.namePlaceholderRow")}
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
                          {isSaving ? t("common.saving") : t("common.save")}
                        </button>
                        {result && "success" in result && (
                          <span className="text-xs text-paper-600">{t("common.saved")}</span>
                        )}
                        {result && "error" in result && (
                          <span className="text-xs text-ember-600">{result.error}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
