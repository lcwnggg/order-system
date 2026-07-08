"use client";

import { useState, useTransition } from "react";
import { addCategory, renameCategory, deleteCategory, type ActionResult } from "./actions";

export type Category = {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
};

export type CategoryTree = Category & { children: Category[] };

export default function CategoriesClient({
  categoryTree,
}: {
  categoryTree: CategoryTree[];
}) {
  const [, startTransition] = useTransition();

  // ── 新增大类 ──
  const [newParentName, setNewParentName] = useState("");
  const [addParentResult, setAddParentResult] = useState<ActionResult | null>(null);
  const [addingParent, setAddingParent] = useState(false);

  // ── 新增小类 ──
  const [newChildParentId, setNewChildParentId] = useState("");
  const [newChildName, setNewChildName] = useState("");
  const [addChildResult, setAddChildResult] = useState<ActionResult | null>(null);
  const [addingChild, setAddingChild] = useState(false);

  // ── 改名 ──
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [renameResults, setRenameResults] = useState<Record<string, ActionResult>>({});
  const [renamingId, setRenamingId] = useState<string | null>(null);

  // ── 删除 ──
  const [deleteResults, setDeleteResults] = useState<Record<string, ActionResult>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function handleAddParent() {
    setAddingParent(true);
    setAddParentResult(null);
    startTransition(async () => {
      const result = await addCategory(newParentName, null);
      setAddParentResult(result);
      setAddingParent(false);
      if ("success" in result) setNewParentName("");
    });
  }

  function handleAddChild() {
    setAddingChild(true);
    setAddChildResult(null);
    startTransition(async () => {
      const result = await addCategory(newChildName, newChildParentId);
      setAddChildResult(result);
      setAddingChild(false);
      if ("success" in result) setNewChildName("");
    });
  }

  function startRename(cat: Category) {
    setEditingId(cat.id);
    setEditingName(cat.name);
    setRenameResults((prev) => ({ ...prev, [cat.id]: null as unknown as ActionResult }));
  }

  function handleRename(id: string) {
    setRenamingId(id);
    startTransition(async () => {
      const result = await renameCategory(id, editingName);
      setRenameResults((prev) => ({ ...prev, [id]: result }));
      setRenamingId(null);
      if ("success" in result) setEditingId(null);
    });
  }

  function handleDelete(id: string, name: string) {
    if (!window.confirm(`确定删除分类「${name}」吗？`)) return;
    setDeletingId(id);
    startTransition(async () => {
      const result = await deleteCategory(id);
      setDeleteResults((prev) => ({ ...prev, [id]: result }));
      setDeletingId(null);
    });
  }

  const inputCls =
    "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200";
  const btnPrimaryCls =
    "rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50";
  const btnOutlineCls =
    "rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:opacity-40";

  return (
    <div className="space-y-6">
      {/* ── 新增表单区 ── */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* 新增大类 */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-zinc-900">添加大类</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={newParentName}
              onChange={(e) => setNewParentName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddParent()}
              placeholder="大类名称"
              className={inputCls}
            />
            <button
              type="button"
              disabled={addingParent || !newParentName.trim()}
              onClick={handleAddParent}
              className={btnPrimaryCls}
            >
              {addingParent ? "…" : "添加"}
            </button>
          </div>
          {addParentResult && "error" in addParentResult && (
            <p className="mt-2 text-xs text-red-500">{addParentResult.error}</p>
          )}
        </div>

        {/* 新增小类 */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-zinc-900">在大类下添加小类</h3>
          <div className="space-y-2">
            <select
              value={newChildParentId}
              onChange={(e) => setNewChildParentId(e.target.value)}
              className={inputCls}
            >
              <option value="">选择所属大类…</option>
              {categoryTree.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                type="text"
                value={newChildName}
                onChange={(e) => setNewChildName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddChild()}
                placeholder="小类名称"
                className={inputCls}
              />
              <button
                type="button"
                disabled={addingChild || !newChildParentId || !newChildName.trim()}
                onClick={handleAddChild}
                className={btnPrimaryCls}
              >
                {addingChild ? "…" : "添加"}
              </button>
            </div>
          </div>
          {addChildResult && "error" in addChildResult && (
            <p className="mt-2 text-xs text-red-500">{addChildResult.error}</p>
          )}
        </div>
      </div>

      {/* ── 分类列表 ── */}
      {categoryTree.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white py-14 text-center">
          <p className="text-sm text-zinc-400">暂无分类，请通过上方表单添加</p>
        </div>
      ) : (
        <div className="space-y-3">
          {categoryTree.map((parent) => (
            <div
              key={parent.id}
              className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
            >
              {/* 大类行 */}
              <div className="flex items-center gap-3 border-b border-zinc-100 bg-zinc-50 px-5 py-3">
                <span className="text-xs text-zinc-400">大类</span>
                {editingId === parent.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      autoFocus
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRename(parent.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="flex-1 rounded-lg border border-zinc-300 px-2 py-1 text-sm outline-none focus:border-zinc-500"
                    />
                    <button
                      type="button"
                      disabled={renamingId === parent.id}
                      onClick={() => handleRename(parent.id)}
                      className="text-xs font-medium text-zinc-900 hover:underline disabled:opacity-50"
                    >
                      {renamingId === parent.id ? "保存中…" : "保存"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="text-xs text-zinc-400 hover:text-zinc-600"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <span className="flex-1 text-sm font-semibold text-zinc-900">
                    {parent.name}
                    <span className="ml-2 font-normal text-zinc-400">
                      {parent.children.length} 个小类
                    </span>
                  </span>
                )}
                {editingId !== parent.id && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => startRename(parent)}
                      className={btnOutlineCls}
                    >
                      改名
                    </button>
                    <button
                      type="button"
                      disabled={deletingId === parent.id}
                      onClick={() => handleDelete(parent.id, parent.name)}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-40"
                    >
                      {deletingId === parent.id ? "…" : "删除"}
                    </button>
                  </div>
                )}
              </div>

              {/* 错误提示（大类级别） */}
              {deleteResults[parent.id] && "error" in deleteResults[parent.id] && (
                <div className="border-b border-red-100 bg-red-50 px-5 py-2 text-xs text-red-600">
                  {(deleteResults[parent.id] as { error: string }).error}
                </div>
              )}
              {renameResults[parent.id] && "error" in renameResults[parent.id] && (
                <div className="border-b border-red-100 bg-red-50 px-5 py-2 text-xs text-red-600">
                  {(renameResults[parent.id] as { error: string }).error}
                </div>
              )}

              {/* 小类行 */}
              {parent.children.length > 0 && (
                <ul className="divide-y divide-zinc-50">
                  {parent.children.map((child) => (
                    <li key={child.id} className="flex items-center gap-3 px-5 py-2.5">
                      <span className="text-zinc-300">└</span>
                      {editingId === child.id ? (
                        <div className="flex flex-1 items-center gap-2">
                          <input
                            autoFocus
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleRename(child.id);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            className="flex-1 rounded-lg border border-zinc-300 px-2 py-1 text-sm outline-none focus:border-zinc-500"
                          />
                          <button
                            type="button"
                            disabled={renamingId === child.id}
                            onClick={() => handleRename(child.id)}
                            className="text-xs font-medium text-zinc-900 hover:underline disabled:opacity-50"
                          >
                            {renamingId === child.id ? "保存中…" : "保存"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="text-xs text-zinc-400 hover:text-zinc-600"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <span className="flex-1 text-sm text-zinc-700">{child.name}</span>
                      )}
                      {editingId !== child.id && (
                        <div className="flex items-center gap-1">
                          {renameResults[child.id] && "error" in renameResults[child.id] && (
                            <span className="text-xs text-red-500">
                              {(renameResults[child.id] as { error: string }).error}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => startRename(child)}
                            className={btnOutlineCls}
                          >
                            改名
                          </button>
                          <button
                            type="button"
                            disabled={deletingId === child.id}
                            onClick={() => handleDelete(child.id, child.name)}
                            className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-40"
                          >
                            {deletingId === child.id ? "…" : "删除"}
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
