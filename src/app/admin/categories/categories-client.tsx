"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addCategory,
  renameCategory,
  deleteCategory,
  assignProductsToCategory,
  removeProductFromCategory,
  type ActionResult,
} from "./actions";
import type { ProductVariant } from "@/app/admin/products/actions";
import ProductEditModal from "@/app/admin/products/product-edit-modal";
import { getTotalStock, isLowStock } from "@/lib/stock";
import { useT } from "@/lib/i18n/client";

export type Category = {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
};

export type CategoryTree = Category & { children: Category[] };

export type ProductSummary = {
  id: string;
  name: string;
  category_id: string | null;
  price: number;
  stock: number;
  description: string | null;
  image_url: string | null;
  is_active: boolean;
  has_variants: boolean;
  brand: string | null;
  barcode: string | null;
  created_at: string;
};

export default function CategoriesClient({
  categoryTree,
  products,
  variants,
}: {
  categoryTree: CategoryTree[];
  products: ProductSummary[];
  variants: ProductVariant[];
}) {
  const t = useT();
  const router = useRouter();
  const [, startTransition] = useTransition();

  // ── 编辑商品弹窗 ──
  const [editingProduct, setEditingProduct] = useState<ProductSummary | null>(null);

  function variantsFor(productId: string) {
    return variants.filter((v) => v.product_id === productId);
  }

  // 统一库存口径的小徽章：有变体时取各颜色合计，颜色按是否告急/售罄区分
  function renderStockBadge(p: ProductSummary) {
    const pvs = variantsFor(p.id);
    const total = getTotalStock(p, pvs);
    const low = isLowStock(p, pvs);
    return (
      <span
        className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium leading-none ${
          total === 0
            ? "bg-red-50 text-red-600"
            : low
            ? "bg-amber-50 text-amber-600"
            : "bg-green-50 text-green-600"
        }`}
      >
        {total === 0 ? t("common.soldOut") : total}
      </span>
    );
  }

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

  // ── 删除分类 ──
  const [deleteResults, setDeleteResults] = useState<Record<string, ActionResult>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── 展开商品列表 ──
  const [expandedChildId, setExpandedChildId] = useState<string | null>(null);
  const [expandedParentId, setExpandedParentId] = useState<string | null>(null);

  // ── 移出分类 ──
  const [removingProductId, setRemovingProductId] = useState<string | null>(null);

  // ── 添加商品到分类 Modal ──
  const [addModalCatId, setAddModalCatId] = useState<string | null>(null);
  const [addModalCatName, setAddModalCatName] = useState("");
  const [modalSelected, setModalSelected] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);
  const [assignResult, setAssignResult] = useState<ActionResult | null>(null);

  // ── 派生数据 ──
  function productsInCategory(catId: string) {
    return products.filter((p) => p.category_id === catId);
  }

  function countInParent(parent: CategoryTree) {
    const direct = productsInCategory(parent.id).length;
    return direct + parent.children.reduce(
      (sum, child) => sum + productsInCategory(child.id).length,
      0
    );
  }

  // ── 现有操作 ──
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
    if (!window.confirm(t("categories.confirmDelete", { name }))) return;
    setDeletingId(id);
    startTransition(async () => {
      const result = await deleteCategory(id);
      setDeleteResults((prev) => ({ ...prev, [id]: result }));
      setDeletingId(null);
    });
  }

  // ── 新增操作 ──
  function openAddModal(childId: string, childName: string) {
    setAddModalCatId(childId);
    setAddModalCatName(childName);
    setModalSelected(new Set());
    setAssignResult(null);
  }

  function closeModal() {
    setAddModalCatId(null);
    setModalSelected(new Set());
    setAssignResult(null);
  }

  function toggleModalProduct(id: string) {
    setModalSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleRemoveProduct(productId: string, productName: string) {
    if (!window.confirm(t("categories.confirmRemoveProduct", { name: productName }))) return;
    setRemovingProductId(productId);
    startTransition(async () => {
      await removeProductFromCategory(productId);
      setRemovingProductId(null);
    });
  }

  function handleAssign() {
    if (!addModalCatId || !modalSelected.size) return;
    setAssigning(true);
    setAssignResult(null);
    startTransition(async () => {
      const result = await assignProductsToCategory(addModalCatId, [...modalSelected]);
      setAssignResult(result);
      setAssigning(false);
      if ("success" in result) closeModal();
    });
  }

  // Modal: products NOT currently in this category
  const modalProducts = addModalCatId
    ? products.filter((p) => p.category_id !== addModalCatId)
    : [];

  const allModalSelected =
    modalProducts.length > 0 && modalProducts.every((p) => modalSelected.has(p.id));

  function toggleSelectAll() {
    if (allModalSelected) {
      setModalSelected(new Set());
    } else {
      setModalSelected(new Set(modalProducts.map((p) => p.id)));
    }
  }

  const inputCls =
    "w-full rounded-lg border border-paper-300 px-3 py-2 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-paper-500 focus:ring-2 focus:ring-paper-300";
  const btnPrimaryCls =
    "rounded-lg bg-paper-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-paper-800 disabled:opacity-50";
  const btnOutlineCls =
    "rounded-lg border border-paper-200 px-3 py-1.5 text-xs font-medium text-paper-600 transition-colors hover:bg-paper-100 disabled:opacity-40";

  return (
    <>
      <div className="space-y-6">
        {/* ── 新增表单区 ── */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* 新增大类 */}
          <div className="rounded-xl glass-strong p-5">
            <h3 className="mb-3 text-sm font-semibold text-paper-900">{t("categories.addParent")}</h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={newParentName}
                onChange={(e) => setNewParentName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddParent()}
                placeholder={t("categories.parentNamePlaceholder")}
                className={inputCls}
              />
              <button
                type="button"
                disabled={addingParent || !newParentName.trim()}
                onClick={handleAddParent}
                className={btnPrimaryCls}
              >
                {addingParent ? "…" : t("common.add")}
              </button>
            </div>
            {addParentResult && "error" in addParentResult && (
              <p className="mt-2 text-xs text-red-500">{addParentResult.error}</p>
            )}
          </div>

          {/* 新增小类 */}
          <div className="rounded-xl glass-strong p-5">
            <h3 className="mb-3 text-sm font-semibold text-paper-900">{t("categories.addChild")}</h3>
            <div className="space-y-2">
              <select
                value={newChildParentId}
                onChange={(e) => setNewChildParentId(e.target.value)}
                className={inputCls}
              >
                <option value="">{t("categories.selectParent")}</option>
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
                  placeholder={t("categories.childNamePlaceholder")}
                  className={inputCls}
                />
                <button
                  type="button"
                  disabled={addingChild || !newChildParentId || !newChildName.trim()}
                  onClick={handleAddChild}
                  className={btnPrimaryCls}
                >
                  {addingChild ? "…" : t("common.add")}
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
          <div className="rounded-xl border border-dashed border-paper-300 bg-white py-14 text-center">
            <p className="text-sm text-paper-500">{t("categories.empty")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {categoryTree.map((parent) => {
              const parentProductCount = countInParent(parent);
              return (
                <div
                  key={parent.id}
                  className="overflow-hidden rounded-2xl glass-strong"
                >
                  {/* 大类行 */}
                  <div className="flex items-center gap-3 border-b border-paper-100 bg-paper-100 px-5 py-3">
                    <span className="text-xs text-paper-500">{t("categories.parentTag")}</span>
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
                          className="flex-1 rounded-lg border border-paper-300 px-2 py-1 text-sm outline-none focus:border-paper-500"
                        />
                        <button
                          type="button"
                          disabled={renamingId === parent.id}
                          onClick={() => handleRename(parent.id)}
                          className="text-xs font-medium text-paper-900 hover:underline disabled:opacity-50"
                        >
                          {renamingId === parent.id ? t("common.saving") : t("common.save")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="text-xs text-paper-500 hover:text-paper-600"
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    ) : (
                      <span className="flex-1 text-sm font-semibold text-paper-900">
                        {parent.name}
                        <span className="ml-2 font-normal text-paper-500">
                          {t("categories.childCount", { n: parent.children.length })}
                          {parentProductCount > 0 && (
                            <span className="ml-1">{t("categories.productCountDot", { n: parentProductCount })}</span>
                          )}
                        </span>
                      </span>
                    )}
                    {editingId !== parent.id && (
                      <div className="flex items-center gap-1">
                        {productsInCategory(parent.id).length > 0 && (
                          <button
                            type="button"
                            onClick={() => setExpandedParentId(expandedParentId === parent.id ? null : parent.id)}
                            className={`${btnOutlineCls} min-w-[52px]`}
                          >
                            {expandedParentId === parent.id ? t("common.collapse") : t("common.expand")}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => startRename(parent)}
                          className={btnOutlineCls}
                        >
                          {t("common.rename")}
                        </button>
                        <button
                          type="button"
                          disabled={deletingId === parent.id}
                          onClick={() => handleDelete(parent.id, parent.name)}
                          className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-40"
                        >
                          {deletingId === parent.id ? "…" : t("common.delete")}
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

                  {/* 直属商品展开区（挂在大类上的商品） */}
                  {expandedParentId === parent.id && (
                    <div className="border-t border-paper-100 bg-paper-100/60 px-8 py-3">
                      {productsInCategory(parent.id).length === 0 ? (
                        <p className="py-2 text-xs text-paper-500">{t("categories.noDirectProducts")}</p>
                      ) : (
                        <ul className="mb-3 space-y-1">
                          {productsInCategory(parent.id).map((p) => (
                            <li key={p.id} className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingProduct(p)}
                                className="min-w-0 flex-1 truncate text-left text-xs text-paper-700 hover:text-paper-900 hover:underline"
                              >
                                {p.name}
                              </button>
                              <span className="shrink-0 text-xs text-paper-500">€{Number(p.price).toFixed(2)}</span>
                              {renderStockBadge(p)}
                              <button
                                type="button"
                                disabled={removingProductId === p.id}
                                onClick={() => handleRemoveProduct(p.id, p.name)}
                                className="shrink-0 rounded px-2 py-0.5 text-xs text-paper-500 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                              >
                                {removingProductId === p.id ? "…" : t("categories.removeFromCategory")}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <button
                        type="button"
                        onClick={() => openAddModal(parent.id, parent.name)}
                        className="rounded-lg border border-dashed border-paper-300 px-3 py-1.5 text-xs font-medium text-paper-500 transition-colors hover:border-paper-400 hover:bg-white hover:text-paper-700"
                      >
                        {t("categories.addToParent")}
                      </button>
                    </div>
                  )}

                  {/* 小类行 */}
                  {parent.children.length > 0 && (
                    <ul className="divide-y divide-paper-100">
                      {parent.children.map((child) => {
                        const childProducts = productsInCategory(child.id);
                        const isExpanded = expandedChildId === child.id;
                        return (
                          <li key={child.id}>
                            {/* 小类标题行 */}
                            <div className="flex items-center gap-3 px-5 py-2.5">
                              <span className="text-paper-400">└</span>
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
                                    className="flex-1 rounded-lg border border-paper-300 px-2 py-1 text-sm outline-none focus:border-paper-500"
                                  />
                                  <button
                                    type="button"
                                    disabled={renamingId === child.id}
                                    onClick={() => handleRename(child.id)}
                                    className="text-xs font-medium text-paper-900 hover:underline disabled:opacity-50"
                                  >
                                    {renamingId === child.id ? t("common.saving") : t("common.save")}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingId(null)}
                                    className="text-xs text-paper-500 hover:text-paper-600"
                                  >
                                    {t("common.cancel")}
                                  </button>
                                </div>
                              ) : (
                                <span className="flex-1 text-sm text-paper-700">
                                  {child.name}
                                  <span className="ml-2 text-xs text-paper-500">
                                    {t("categories.childProductCount", { n: childProducts.length })}
                                  </span>
                                </span>
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
                                    onClick={() =>
                                      setExpandedChildId(isExpanded ? null : child.id)
                                    }
                                    className={`${btnOutlineCls} min-w-[52px]`}
                                  >
                                    {isExpanded ? t("common.collapse") : t("common.expand")}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => startRename(child)}
                                    className={btnOutlineCls}
                                  >
                                    {t("common.rename")}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={deletingId === child.id}
                                    onClick={() => handleDelete(child.id, child.name)}
                                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 disabled:opacity-40"
                                  >
                                    {deletingId === child.id ? "…" : t("common.delete")}
                                  </button>
                                </div>
                              )}
                            </div>

                            {/* 展开区：商品列表 + 添加入口 */}
                            {isExpanded && (
                              <div className="border-t border-paper-100 bg-paper-100/60 px-8 py-3">
                                {childProducts.length === 0 ? (
                                  <p className="py-2 text-xs text-paper-500">{t("categories.noProducts")}</p>
                                ) : (
                                  <ul className="mb-3 space-y-1">
                                    {childProducts.map((p) => (
                                      <li
                                        key={p.id}
                                        className="flex items-center gap-2"
                                      >
                                        <button
                                          type="button"
                                          onClick={() => setEditingProduct(p)}
                                          className="min-w-0 flex-1 truncate text-left text-xs text-paper-700 hover:text-paper-900 hover:underline"
                                        >
                                          {p.name}
                                        </button>
                                        <span className="shrink-0 text-xs text-paper-500">€{Number(p.price).toFixed(2)}</span>
                                        {renderStockBadge(p)}
                                        <button
                                          type="button"
                                          disabled={removingProductId === p.id}
                                          onClick={() => handleRemoveProduct(p.id, p.name)}
                                          className="shrink-0 rounded px-2 py-0.5 text-xs text-paper-500 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                                        >
                                          {removingProductId === p.id ? "…" : t("categories.removeFromCategory")}
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                <button
                                  type="button"
                                  onClick={() => openAddModal(child.id, child.name)}
                                  className="rounded-lg border border-dashed border-paper-300 px-3 py-1.5 text-xs font-medium text-paper-500 transition-colors hover:border-paper-400 hover:bg-white hover:text-paper-700"
                                >
                                  {t("categories.addToChild")}
                                </button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 编辑商品弹窗 ── */}
      {editingProduct && (
        <ProductEditModal
          product={editingProduct}
          categories={categoryTree.flatMap((p) => [
            { id: p.id, name: p.name, parent_id: p.parent_id, sort_order: p.sort_order },
            ...p.children.map((c) => ({ id: c.id, name: c.name, parent_id: c.parent_id, sort_order: c.sort_order })),
          ])}
          variantsForProduct={variantsFor(editingProduct.id)}
          onClose={() => setEditingProduct(null)}
          onSaved={() => router.refresh()}
        />
      )}

      {/* ── Modal：选择商品 ── */}
      {addModalCatId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-paper-100 px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-paper-900">
                  {t("categories.modalTitle", { name: addModalCatName })}
                </h3>
                <p className="mt-0.5 text-xs text-paper-500">
                  {t("categories.modalSubtitle")}
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="text-paper-500 hover:text-paper-600"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-5 py-3">
              {modalProducts.length === 0 ? (
                <p className="py-6 text-center text-sm text-paper-500">
                  {t("categories.modalAllIn")}
                </p>
              ) : (
                <>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-paper-500">
                      <input
                        type="checkbox"
                        checked={allModalSelected}
                        onChange={toggleSelectAll}
                        className="h-3.5 w-3.5 rounded"
                      />
                      {t("categories.selectAll", { n: modalProducts.length })}
                    </label>
                    {modalSelected.size > 0 && (
                      <span className="text-xs text-paper-500">
                        {t("categories.selectedCount", { n: modalSelected.size })}
                      </span>
                    )}
                  </div>
                  <ul className="space-y-1">
                    {modalProducts.map((p) => (
                      <li key={p.id}>
                        <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-paper-100">
                          <input
                            type="checkbox"
                            checked={modalSelected.has(p.id)}
                            onChange={() => toggleModalProduct(p.id)}
                            className="h-3.5 w-3.5 rounded"
                          />
                          <span className="text-sm text-paper-800">{p.name}</span>
                          {p.category_id && (
                            <span className="ml-auto text-xs text-paper-500">{t("categories.hasCategory")}</span>
                          )}
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-paper-100 px-5 py-4">
              {assignResult && "error" in assignResult && (
                <p className="text-xs text-red-500">{assignResult.error}</p>
              )}
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className={btnOutlineCls}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  disabled={assigning || modalSelected.size === 0}
                  onClick={handleAssign}
                  className={btnPrimaryCls}
                >
                  {assigning ? t("common.saving") : t("categories.confirmAdd", { n: modalSelected.size })}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
