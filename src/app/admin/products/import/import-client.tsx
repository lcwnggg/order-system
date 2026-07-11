"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { bulkImportProducts, type BulkImportMode, type BulkImportRow } from "../actions";

type CategoryRow = { id: string; name: string; parent_id: string | null };
type ExistingProduct = {
  id: string;
  name: string;
  price: number;
  stock: number;
  brand: string | null;
  category_id: string | null;
  has_variants: boolean;
};

// 固定的模板列，顺序与含义均不可由用户/自动推断改变
const EXPECTED_HEADERS = ["nombre", "marca", "categoria", "subcategoria", "color", "precio", "stock"] as const;
type HeaderKey = (typeof EXPECTED_HEADERS)[number];

type ImportRow = {
  key: string;
  nombre: string;
  marca: string;
  categoriaRaw: string; // CSV 原始文本，供参考
  categoriaId: string; // 匹配/用户选择到的分类 id，"" = 未匹配
  subcategoriaRaw: string;
  subcategoriaId: string;
  color: string;
  precio: string;
  stock: string;
};

type CellKey = "nombre" | "categoria" | "subcategoria" | "precio" | "stock";

type RowValidation = {
  cellErrors: Partial<Record<CellKey, string>>;
  rowErrors: string[];
  isDuplicate: boolean;
  existingProductId?: string;
};

function normalize(s: string) {
  return s.trim().toLowerCase();
}

function rowHasError(rv: RowValidation) {
  return Object.keys(rv.cellErrors).length > 0 || rv.rowErrors.length > 0;
}

function matchCategoryId(raw: string, candidates: CategoryRow[]): string {
  if (raw.trim() === "") return "";
  const hit = candidates.find((c) => c.name === raw);
  return hit ? hit.id : "";
}

function appendRowError(map: Map<string, RowValidation>, key: string, msg: string) {
  const rv = map.get(key);
  if (rv && !rv.rowErrors.includes(msg)) rv.rowErrors.push(msg);
}

function validateRows(
  rows: ImportRow[],
  existingProducts: ExistingProduct[]
): Map<string, RowValidation> {
  const result = new Map<string, RowValidation>();

  for (const row of rows) {
    const cellErrors: Partial<Record<CellKey, string>> = {};
    if (row.nombre.trim() === "") cellErrors.nombre = "商品名称不能为空";

    if (row.categoriaRaw.trim() !== "" && !row.categoriaId) {
      cellErrors.categoria = "分类不存在，请重新选择";
    }
    if (row.subcategoriaRaw.trim() !== "" && !row.subcategoriaId) {
      cellErrors.subcategoria = row.categoriaId ? "子分类不存在，请重新选择" : "请先选择分类";
    }

    const precioNum = Number(row.precio);
    if (row.precio.trim() === "" || isNaN(precioNum) || precioNum <= 0) {
      cellErrors.precio = "价格须为大于 0 的数字";
    }
    if (!/^\d+$/.test(row.stock.trim())) {
      cellErrors.stock = "库存须为非负整数";
    }

    result.set(row.key, { cellErrors, rowErrors: [], isDuplicate: false });
  }

  // 按商品名称分组（大小写不敏感），用于重复检测与变体一致性校验
  const groups = new Map<string, ImportRow[]>();
  for (const row of rows) {
    if (row.nombre.trim() === "") continue;
    const key = normalize(row.nombre);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const existingByName = new Map<string, ExistingProduct>();
  for (const p of existingProducts) existingByName.set(normalize(p.name), p);

  for (const [key, groupRows] of groups) {
    const existing = existingByName.get(key);
    for (const row of groupRows) {
      const rv = result.get(row.key)!;
      rv.isDuplicate = !!existing;
      rv.existingProductId = existing?.id;
    }

    if (groupRows.length > 1) {
      const colorsFilled = groupRows.map((r) => r.color.trim() !== "");
      const anyFilled = colorsFilled.some(Boolean);
      const allFilled = colorsFilled.every(Boolean);

      if (anyFilled && !allFilled) {
        for (const row of groupRows) {
          appendRowError(
            result,
            row.key,
            "同一商品名下的行需统一：要么每行都填颜色（作为该商品的变体），要么该商品只有一行且不填颜色"
          );
        }
      } else if (allFilled) {
        const counts = new Map<string, number>();
        for (const row of groupRows) {
          const c = normalize(row.color);
          counts.set(c, (counts.get(c) ?? 0) + 1);
        }
        for (const row of groupRows) {
          if ((counts.get(normalize(row.color)) ?? 0) > 1) {
            appendRowError(result, row.key, "同一商品下颜色重复");
          }
        }
      }

      const first = groupRows[0];
      for (const row of groupRows.slice(1)) {
        if (row.marca !== first.marca) {
          appendRowError(result, row.key, "同一商品的品牌需保持一致");
          appendRowError(result, first.key, "同一商品的品牌需保持一致");
        }
        if (row.categoriaId !== first.categoriaId) {
          appendRowError(result, row.key, "同一商品的分类需保持一致");
          appendRowError(result, first.key, "同一商品的分类需保持一致");
        }
        if (row.subcategoriaId !== first.subcategoriaId) {
          appendRowError(result, row.key, "同一商品的子分类需保持一致");
          appendRowError(result, first.key, "同一商品的子分类需保持一致");
        }
        const p1 = Number(first.precio);
        const p2 = Number(row.precio);
        if (!isNaN(p1) && !isNaN(p2) && p1 !== p2) {
          appendRowError(result, row.key, "同一商品的价格需保持一致（价格是商品级字段，不能分颜色设置）");
          appendRowError(result, first.key, "同一商品的价格需保持一致（价格是商品级字段，不能分颜色设置）");
        }
      }
    }
  }

  return result;
}

function buildSubmission(
  rows: ImportRow[],
  validationMap: Map<string, RowValidation>
): BulkImportRow[] {
  const groups = new Map<string, ImportRow[]>();
  const order: string[] = [];
  for (const row of rows) {
    const key = normalize(row.nombre);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(row);
  }

  return order.map((key) => {
    const groupRows = groups.get(key)!;
    const first = groupRows[0];
    const rv = validationMap.get(first.key)!;
    const hasVariants = groupRows.some((r) => r.color.trim() !== "");
    return {
      nombre: first.nombre,
      marca: first.marca.trim() === "" ? null : first.marca,
      categoryId: first.subcategoriaId || first.categoriaId || null,
      precio: Number(first.precio),
      hasVariants,
      stock: hasVariants ? 0 : parseInt(first.stock, 10),
      variants: hasVariants
        ? groupRows.map((r) => ({ color: r.color, stock: parseInt(r.stock, 10) }))
        : [],
      isDuplicate: rv.isDuplicate,
      existingProductId: rv.existingProductId,
    };
  });
}

function downloadTemplate() {
  const header = EXPECTED_HEADERS.join(",");
  const sampleRows = [
    "Cargador USB-C 20W,Anker,Cargadores,,,15.99,50",
    "Cable USB-C a Lightning,Anker,Cables,,Negro,9.99,30",
  ];
  const csv = [header, ...sampleRows].join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "商品导入模板.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ImportClient({
  categories,
  existingProducts,
}: {
  categories: CategoryRow[];
  existingProducts: ExistingProduct[];
}) {
  const parentCategories = useMemo(() => categories.filter((c) => !c.parent_id), [categories]);
  function childrenOf(parentId: string) {
    return categories.filter((c) => c.parent_id === parentId);
  }

  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [duplicateMode, setDuplicateMode] = useState<BulkImportMode>("skip");
  const [isImporting, startTransition] = useTransition();
  const [importResult, setImportResult] = useState<
    { imported: number; skipped: number; failed: number; errors: string[] } | { error: string } | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validationMap = useMemo(
    () => (rows ? validateRows(rows, existingProducts) : new Map<string, RowValidation>()),
    [rows, existingProducts]
  );

  const hasDuplicates = useMemo(
    () => (rows ?? []).some((r) => validationMap.get(r.key)?.isDuplicate),
    [rows, validationMap]
  );

  const canImport =
    !!rows &&
    rows.length > 0 &&
    rows.every((r) => !rowHasError(validationMap.get(r.key)!)) &&
    !isImporting;

  async function handleFile(file: File) {
    setFileError(null);
    setRows(null);
    setImportResult(null);
    setDuplicateMode("skip");
    setFileName(file.name);

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) {
        setFileError("文件中没有工作表");
        return;
      }
      const ws = wb.Sheets[sheetName];
      const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
      if (grid.length === 0) {
        setFileError("文件为空");
        return;
      }

      const headerRow = grid[0].map((h) => String(h ?? ""));
      const missing = EXPECTED_HEADERS.filter((h) => !headerRow.includes(h));
      const extra = headerRow.filter((h) => h !== "" && !(EXPECTED_HEADERS as readonly string[]).includes(h));
      if (missing.length > 0 || extra.length > 0) {
        setFileError(
          `表头与模板不符。${missing.length ? `缺少列：${missing.join("、")}。` : ""}${
            extra.length ? `多余列：${extra.join("、")}。` : ""
          }请使用「下载 CSV 模板」生成的表头，不要增删或改名列。`
        );
        return;
      }

      const colIndex = (name: HeaderKey) => headerRow.indexOf(name);
      const dataRows = grid.slice(1).filter((r) => r.some((cell) => String(cell ?? "").trim() !== ""));

      if (dataRows.length === 0) {
        setFileError("文件中没有数据行");
        return;
      }

      const newRows: ImportRow[] = dataRows.map((r, i) => {
        const get = (name: HeaderKey) => String(r[colIndex(name)] ?? "");
        const categoriaRaw = get("categoria");
        const subcategoriaRaw = get("subcategoria");
        const categoriaId = matchCategoryId(categoriaRaw, parentCategories);
        const subcategoriaId = categoriaId ? matchCategoryId(subcategoriaRaw, childrenOf(categoriaId)) : "";
        return {
          key: `row-${i}-${Date.now()}`,
          nombre: get("nombre"),
          marca: get("marca"),
          categoriaRaw,
          categoriaId,
          subcategoriaRaw,
          subcategoriaId,
          color: get("color"),
          precio: get("precio"),
          stock: get("stock"),
        };
      });

      setRows(newRows);
    } catch (err) {
      setFileError(err instanceof Error ? `解析文件失败：${err.message}` : "解析文件失败");
    }
  }

  function updateField(key: string, field: "nombre" | "marca" | "color" | "precio" | "stock", value: string) {
    setRows((prev) => (prev ? prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)) : prev));
  }

  function updateCategoria(key: string, categoryId: string) {
    setRows((prev) =>
      prev
        ? prev.map((r) =>
            r.key === key
              ? { ...r, categoriaId: categoryId, subcategoriaId: "" }
              : r
          )
        : prev
    );
  }

  function updateSubcategoria(key: string, subId: string) {
    setRows((prev) =>
      prev ? prev.map((r) => (r.key === key ? { ...r, subcategoriaId: subId } : r)) : prev
    );
  }

  function resetAll() {
    setRows(null);
    setFileError(null);
    setFileName(null);
    setImportResult(null);
    setDuplicateMode("skip");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleConfirmImport() {
    if (!rows) return;
    const payload = buildSubmission(rows, validationMap);
    startTransition(async () => {
      const result = await bulkImportProducts(payload, duplicateMode);
      setImportResult(result);
    });
  }

  // ── 导入完成后的结果页 ──
  if (importResult && !("error" in importResult)) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
          <svg className="h-7 w-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-zinc-900">导入完成</h2>
        <p className="mt-2 text-sm text-zinc-600">
          成功导入 <span className="font-semibold text-green-600">{importResult.imported}</span> 条，
          跳过重复 <span className="font-semibold text-amber-600">{importResult.skipped}</span> 条，
          失败 <span className="font-semibold text-red-600">{importResult.failed}</span> 条
        </p>
        {importResult.errors.length > 0 && (
          <div className="mx-auto mt-4 max-w-lg rounded-lg border border-red-100 bg-red-50 p-3 text-left text-xs text-red-600">
            {importResult.errors.map((e, i) => (
              <p key={i}>{e}</p>
            ))}
          </div>
        )}
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={resetAll}
            className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            继续导入
          </button>
          <Link
            href="/admin/products"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
          >
            返回商品列表
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 说明 + 模板下载 */}
      <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div>
          <p className="text-sm font-medium text-zinc-900">1. 下载模板，按格式填写商品数据</p>
          <p className="mt-1 text-xs text-zinc-400">
            列固定为 nombre、marca、categoria、subcategoria、color、precio、stock。同一商品有多个颜色时，每个颜色一行、商品名称保持一致。
          </p>
        </div>
        <button
          type="button"
          onClick={downloadTemplate}
          className="shrink-0 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
        >
          下载 CSV 模板
        </button>
      </div>

      {/* 上传区域 */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <p className="mb-3 text-sm font-medium text-zinc-900">2. 上传文件（.csv / .xlsx）</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
          className="block w-full text-sm text-zinc-600 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-zinc-700"
        />
        {fileName && <p className="mt-2 text-xs text-zinc-400">已选择文件：{fileName}</p>}
        {fileError && (
          <p className="mt-3 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{fileError}</p>
        )}
      </div>

      {/* 预览 & 校验 */}
      {rows && rows.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-zinc-900">
              3. 核对数据（共 {rows.length} 行）
              {" · "}
              <span className={rows.every((r) => !rowHasError(validationMap.get(r.key)!)) ? "text-green-600" : "text-red-600"}>
                {rows.filter((r) => rowHasError(validationMap.get(r.key)!)).length} 行有错误
              </span>
            </p>
            <button
              type="button"
              onClick={resetAll}
              className="text-xs font-medium text-zinc-500 hover:text-zinc-900"
            >
              重新选择文件
            </button>
          </div>

          {hasDuplicates && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="mb-2 text-sm font-medium text-amber-900">
                检测到与现有商品同名的行，请选择处理方式：
              </p>
              <div className="flex flex-wrap gap-4">
                {(
                  [
                    ["skip", "跳过重复项"],
                    ["overwrite", "覆盖已有商品（更新价格、库存、品牌等字段）"],
                    ["new", "全部作为新商品导入"],
                  ] as [BulkImportMode, string][]
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-1.5 text-sm text-amber-900">
                    <input
                      type="radio"
                      name="duplicateMode"
                      value={value}
                      checked={duplicateMode === value}
                      onChange={() => setDuplicateMode(value)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50/80 text-left">
                  <th className="px-3 py-2 text-xs font-medium text-zinc-400">nombre</th>
                  <th className="px-3 py-2 text-xs font-medium text-zinc-400">marca</th>
                  <th className="px-3 py-2 text-xs font-medium text-zinc-400">categoria</th>
                  <th className="px-3 py-2 text-xs font-medium text-zinc-400">subcategoria</th>
                  <th className="px-3 py-2 text-xs font-medium text-zinc-400">color</th>
                  <th className="px-3 py-2 text-xs font-medium text-zinc-400">precio</th>
                  <th className="px-3 py-2 text-xs font-medium text-zinc-400">stock</th>
                  <th className="px-3 py-2 text-xs font-medium text-zinc-400">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((row) => {
                  const rv = validationMap.get(row.key)!;
                  const hasErr = rowHasError(rv);
                  const inputCls = (err?: string) =>
                    `w-full rounded border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-zinc-300 ${
                      err ? "border-red-300 bg-red-50 text-red-900" : "border-zinc-200 text-zinc-900"
                    }`;
                  return (
                    <tr key={row.key} className={hasErr ? "bg-red-50/40" : undefined}>
                      <td className="px-3 py-1.5 align-top">
                        <input
                          value={row.nombre}
                          onChange={(e) => updateField(row.key, "nombre", e.target.value)}
                          className={inputCls(rv.cellErrors.nombre)}
                        />
                        {rv.cellErrors.nombre && (
                          <p className="mt-0.5 text-[11px] text-red-600">{rv.cellErrors.nombre}</p>
                        )}
                      </td>
                      <td className="px-3 py-1.5 align-top">
                        <input
                          value={row.marca}
                          onChange={(e) => updateField(row.key, "marca", e.target.value)}
                          className={inputCls()}
                        />
                      </td>
                      <td className="px-3 py-1.5 align-top">
                        <select
                          value={row.categoriaId}
                          onChange={(e) => updateCategoria(row.key, e.target.value)}
                          className={inputCls(rv.cellErrors.categoria)}
                        >
                          <option value="">
                            {row.categoriaRaw.trim() ? `未匹配：${row.categoriaRaw}` : "未分类"}
                          </option>
                          {parentCategories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        {rv.cellErrors.categoria && (
                          <p className="mt-0.5 text-[11px] text-red-600">{rv.cellErrors.categoria}</p>
                        )}
                      </td>
                      <td className="px-3 py-1.5 align-top">
                        <select
                          value={row.subcategoriaId}
                          onChange={(e) => updateSubcategoria(row.key, e.target.value)}
                          disabled={!row.categoriaId}
                          className={`${inputCls(rv.cellErrors.subcategoria)} disabled:opacity-50`}
                        >
                          <option value="">
                            {row.subcategoriaRaw.trim() ? `未匹配：${row.subcategoriaRaw}` : "无"}
                          </option>
                          {row.categoriaId &&
                            childrenOf(row.categoriaId).map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                        </select>
                        {rv.cellErrors.subcategoria && (
                          <p className="mt-0.5 text-[11px] text-red-600">{rv.cellErrors.subcategoria}</p>
                        )}
                      </td>
                      <td className="px-3 py-1.5 align-top">
                        <input
                          value={row.color}
                          onChange={(e) => updateField(row.key, "color", e.target.value)}
                          placeholder="（可留空）"
                          className={inputCls()}
                        />
                      </td>
                      <td className="px-3 py-1.5 align-top">
                        <input
                          value={row.precio}
                          onChange={(e) => updateField(row.key, "precio", e.target.value)}
                          className={inputCls(rv.cellErrors.precio)}
                        />
                        {rv.cellErrors.precio && (
                          <p className="mt-0.5 text-[11px] text-red-600">{rv.cellErrors.precio}</p>
                        )}
                      </td>
                      <td className="px-3 py-1.5 align-top">
                        <input
                          value={row.stock}
                          onChange={(e) => updateField(row.key, "stock", e.target.value)}
                          className={inputCls(rv.cellErrors.stock)}
                        />
                        {rv.cellErrors.stock && (
                          <p className="mt-0.5 text-[11px] text-red-600">{rv.cellErrors.stock}</p>
                        )}
                      </td>
                      <td className="px-3 py-1.5 align-top">
                        <div className="flex flex-col gap-1">
                          {hasErr && (
                            <span className="inline-flex w-fit items-center rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
                              错误
                            </span>
                          )}
                          {rv.isDuplicate && (
                            <span className="inline-flex w-fit items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                              重复
                            </span>
                          )}
                          {!hasErr && !rv.isDuplicate && (
                            <span className="inline-flex w-fit items-center rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                              正常
                            </span>
                          )}
                          {rv.rowErrors.map((e, i) => (
                            <p key={i} className="text-[11px] text-red-600">
                              {e}
                            </p>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {importResult && "error" in importResult && (
            <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{importResult.error}</p>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              disabled={!canImport}
              onClick={handleConfirmImport}
              className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isImporting ? "导入中…" : "确认导入"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
