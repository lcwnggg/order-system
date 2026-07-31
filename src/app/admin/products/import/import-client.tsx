"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { bulkImportProducts, type BulkImportMode, type BulkImportRow } from "../actions";
import { isValidBarcodeFormat } from "@/lib/barcode";
import { useI18n } from "@/lib/i18n/client";
import { sortByName } from "@/lib/sort";
import type { Translate } from "@/lib/i18n/translate";

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
const EXPECTED_HEADERS = ["nombre", "marca", "categoria", "subcategoria", "color", "precio", "stock", "codigo_barras"] as const;
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
  codigoBarras: string;
};

type CellKey = "nombre" | "categoria" | "subcategoria" | "precio" | "stock" | "codigo_barras";

type RowValidation = {
  cellErrors: Partial<Record<CellKey, string>>;
  isDuplicate: boolean;
  existingProductId?: string;
};

function normalize(s: string) {
  return s.trim().toLowerCase();
}

function rowHasError(rv: RowValidation) {
  return Object.keys(rv.cellErrors).length > 0;
}

function matchCategoryId(raw: string, candidates: CategoryRow[]): string {
  const name = raw.trim();
  if (name === "") return "";
  // 比较前两边都 trim：CSV 里「Cargadores 」这种尾随空格很常见，
  // 严格相等会让整列分类都匹配不上，用户只能一行行手动改
  const hit = candidates.find((c) => c.name.trim() === name);
  return hit ? hit.id : "";
}

// 第一版只导入普通商品：不做变体分组。同名行（不论是与已有商品同名，
// 还是文件内多行同名）一律标记为“重复”，统一走跳过/覆盖/全部新建。
function validateRows(
  rows: ImportRow[],
  existingProducts: ExistingProduct[],
  t: Translate
): Map<string, RowValidation> {
  const result = new Map<string, RowValidation>();

  const existingByName = new Map<string, ExistingProduct>();
  for (const p of existingProducts) existingByName.set(normalize(p.name), p);

  const seenInFile = new Set<string>();

  for (const row of rows) {
    const cellErrors: Partial<Record<CellKey, string>> = {};
    if (row.nombre.trim() === "") cellErrors.nombre = t("importErr.nameRequired");

    if (row.categoriaRaw.trim() !== "" && !row.categoriaId) {
      cellErrors.categoria = t("importErr.categoryMissing");
    }
    if (row.subcategoriaRaw.trim() !== "" && !row.subcategoriaId) {
      cellErrors.subcategoria = row.categoriaId
        ? t("importErr.subcategoryMissing")
        : t("importErr.selectCategoryFirst");
    }

    const precioNum = Number(row.precio);
    if (row.precio.trim() === "" || isNaN(precioNum) || precioNum <= 0) {
      cellErrors.precio = t("importErr.price");
    }
    if (!/^\d+$/.test(row.stock.trim())) {
      cellErrors.stock = t("importErr.stock");
    }
    // 条码：空的允许；填了就检查格式（只允许数字/字母/连字符）
    if (!isValidBarcodeFormat(row.codigoBarras)) {
      cellErrors.codigo_barras = t("importErr.barcode");
    }

    const norm = normalize(row.nombre);
    const dbMatch = norm !== "" ? existingByName.get(norm) : undefined;
    const fileDup = norm !== "" && seenInFile.has(norm);
    if (norm !== "") seenInFile.add(norm);

    result.set(row.key, {
      cellErrors,
      isDuplicate: !!dbMatch || fileDup,
      existingProductId: dbMatch?.id,
    });
  }

  return result;
}

function buildSubmission(
  rows: ImportRow[],
  validationMap: Map<string, RowValidation>
): BulkImportRow[] {
  return rows.map((row) => {
    const rv = validationMap.get(row.key)!;
    return {
      nombre: row.nombre,
      marca: row.marca.trim() === "" ? null : row.marca,
      categoryId: row.subcategoriaId || row.categoriaId || null,
      precio: Number(row.precio),
      stock: parseInt(row.stock, 10),
      barcode: row.codigoBarras.trim() === "" ? null : row.codigoBarras.trim(),
      isDuplicate: rv.isDuplicate,
      existingProductId: rv.existingProductId,
    };
  });
}

function downloadTemplate(templateName: string) {
  const header = EXPECTED_HEADERS.join(",");
  const sampleRows = [
    "Cargador USB-C 20W,Anker,Cargadores,,,15.99,50,8412345678905",
    "Cable USB-C a Lightning,Anker,Cables,,Negro,9.99,30,",
  ];
  const csv = [header, ...sampleRows].join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = templateName;
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
  const { t, tag } = useI18n();
  // Alfabético, igual que en el resto de listas de categorías.
  const sortedCategories = useMemo(() => sortByName(categories, tag), [categories, tag]);
  const parentCategories = useMemo(() => sortedCategories.filter((c) => !c.parent_id), [sortedCategories]);
  function childrenOf(parentId: string) {
    return sortedCategories.filter((c) => c.parent_id === parentId);
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
    () => (rows ? validateRows(rows, existingProducts, t) : new Map<string, RowValidation>()),
    [rows, existingProducts, t]
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
        setFileError(t("import.fileNoSheet"));
        return;
      }
      const ws = wb.Sheets[sheetName];
      const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
      if (grid.length === 0) {
        setFileError(t("import.fileEmpty"));
        return;
      }

      const headerRow = grid[0].map((h) => String(h ?? ""));
      const missing = EXPECTED_HEADERS.filter((h) => !headerRow.includes(h));
      const extra = headerRow.filter((h) => h !== "" && !(EXPECTED_HEADERS as readonly string[]).includes(h));
      if (missing.length > 0 || extra.length > 0) {
        const sep = t("common.listSeparator");
        setFileError(
          t("import.headerMismatch", {
            missing: missing.length ? t("import.headerMissing", { cols: missing.join(sep) }) : "",
            extra: extra.length ? t("import.headerExtra", { cols: extra.join(sep) }) : "",
          })
        );
        return;
      }

      const colIndex = (name: HeaderKey) => headerRow.indexOf(name);
      const dataRows = grid.slice(1).filter((r) => r.some((cell) => String(cell ?? "").trim() !== ""));

      if (dataRows.length === 0) {
        setFileError(t("import.noDataRows"));
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
          codigoBarras: get("codigo_barras"),
        };
      });

      setRows(newRows);
    } catch (err) {
      setFileError(
        err instanceof Error ? t("import.parseFailedWith", { message: err.message }) : t("import.parseFailed")
      );
    }
  }

  function updateField(key: string, field: "nombre" | "marca" | "color" | "precio" | "stock" | "codigoBarras", value: string) {
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
      <div className="rounded-xl glass-strong p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
          <svg className="h-7 w-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-paper-900">{t("import.doneTitle")}</h2>
        <p className="mt-2 text-sm text-paper-600">
          <span className="font-semibold text-green-600">{importResult.imported}</span> {t("import.doneImported")}
          {" · "}
          <span className="font-semibold text-amber-600">{importResult.skipped}</span> {t("import.doneSkipped")}
          {" · "}
          <span className="font-semibold text-red-600">{importResult.failed}</span> {t("import.doneFailed")}
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
            className="rounded-lg border border-paper-200 px-4 py-2 text-sm font-medium text-paper-700 transition-colors hover:bg-paper-100"
          >
            {t("import.continue")}
          </button>
          <Link
            href="/admin/products"
            className="rounded-lg bg-paper-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-paper-800"
          >
            {t("import.backToProducts")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 说明 + 模板下载 */}
      <div className="flex items-center justify-between rounded-xl glass-strong p-5">
        <div>
          <p className="text-sm font-medium text-paper-900">{t("import.step1")}</p>
          <p className="mt-1 text-xs text-paper-500">{t("import.step1Hint")}</p>
        </div>
        <button
          type="button"
          onClick={() => downloadTemplate(t("import.templateFilename"))}
          className="shrink-0 rounded-lg border border-paper-200 bg-white px-4 py-2 text-sm font-medium text-paper-700 transition-colors hover:bg-paper-100"
        >
          {t("import.downloadTemplate")}
        </button>
      </div>

      {/* 上传区域 */}
      <div className="rounded-xl glass-strong p-5">
        <p className="mb-3 text-sm font-medium text-paper-900">{t("import.step2")}</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
          className="block w-full text-sm text-paper-600 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-paper-700 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-paper-800"
        />
        {fileName && <p className="mt-2 text-xs text-paper-500">{t("import.fileSelected", { name: fileName })}</p>}
        {fileError && (
          <p className="mt-3 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{fileError}</p>
        )}
      </div>

      {/* 预览 & 校验 */}
      {rows && rows.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-paper-900">
              {t("import.step3", { n: rows.length })}
              {" · "}
              <span className={rows.every((r) => !rowHasError(validationMap.get(r.key)!)) ? "text-green-600" : "text-red-600"}>
                {t("import.errorRows", { n: rows.filter((r) => rowHasError(validationMap.get(r.key)!)).length })}
              </span>
            </p>
            <button
              type="button"
              onClick={resetAll}
              className="text-xs font-medium text-paper-500 hover:text-paper-900"
            >
              {t("import.reselect")}
            </button>
          </div>

          {hasDuplicates && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="mb-2 text-sm font-medium text-amber-900">
                {t("import.duplicatesTitle")}
              </p>
              <div className="flex flex-wrap gap-4">
                {(
                  [
                    ["skip", t("import.modeSkip")],
                    ["overwrite", t("import.modeOverwrite")],
                    ["new", t("import.modeNew")],
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

          <div className="overflow-x-auto rounded-xl border border-paper-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-paper-100 bg-paper-100/80 text-left">
                  <th className="px-3 py-2 text-xs font-medium text-paper-500">nombre</th>
                  <th className="px-3 py-2 text-xs font-medium text-paper-500">marca</th>
                  <th className="px-3 py-2 text-xs font-medium text-paper-500">categoria</th>
                  <th className="px-3 py-2 text-xs font-medium text-paper-500">subcategoria</th>
                  <th className="px-3 py-2 text-xs font-medium text-paper-500">{t("import.thColorNote")}</th>
                  <th className="px-3 py-2 text-xs font-medium text-paper-500">precio</th>
                  <th className="px-3 py-2 text-xs font-medium text-paper-500">stock</th>
                  <th className="px-3 py-2 text-xs font-medium text-paper-500">codigo_barras</th>
                  <th className="px-3 py-2 text-xs font-medium text-paper-500">{t("import.thStatus")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-100">
                {rows.map((row) => {
                  const rv = validationMap.get(row.key)!;
                  const hasErr = rowHasError(rv);
                  const inputCls = (err?: string) =>
                    `w-full rounded border px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-paper-300 ${
                      err ? "border-red-300 bg-red-50 text-red-900" : "border-paper-200 text-paper-900"
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
                            {row.categoriaRaw.trim()
                              ? t("import.unmatched", { name: row.categoriaRaw })
                              : t("common.uncategorized")}
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
                            {row.subcategoriaRaw.trim()
                              ? t("import.unmatched", { name: row.subcategoriaRaw })
                              : t("import.none")}
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
                          placeholder={t("import.blankAllowed")}
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
                        <input
                          value={row.codigoBarras}
                          onChange={(e) => updateField(row.key, "codigoBarras", e.target.value)}
                          placeholder={t("import.blankAllowed")}
                          className={inputCls(rv.cellErrors.codigo_barras)}
                        />
                        {rv.cellErrors.codigo_barras && (
                          <p className="mt-0.5 text-[11px] text-red-600">{rv.cellErrors.codigo_barras}</p>
                        )}
                      </td>
                      <td className="px-3 py-1.5 align-top">
                        <div className="flex flex-col gap-1">
                          {hasErr && (
                            <span className="inline-flex w-fit items-center rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
                              {t("import.badgeError")}
                            </span>
                          )}
                          {rv.isDuplicate && (
                            <span className="inline-flex w-fit items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                              {t("import.badgeDuplicate")}
                            </span>
                          )}
                          {!hasErr && !rv.isDuplicate && (
                            <span className="inline-flex w-fit items-center rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                              {t("import.badgeOk")}
                            </span>
                          )}
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
              className="rounded-lg bg-paper-700 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-paper-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isImporting ? t("import.importing") : t("import.confirm")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
