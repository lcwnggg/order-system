"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/client";
import { IMAGE_BUCKET, uploadThumbnails } from "@/lib/image-upload";
import { THUMB_WIDTHS, isThumbName, thumbName } from "@/lib/supabase-image-loader";

/** Fotos que se generan a la vez. Más no va más rápido: la red del móvil manda. */
const CONCURRENCY = 3;
/** Tope por página del listado de Storage. */
const PAGE = 1000;

type Pending = { fileName: string; widths: number[] };
type Scan = { total: number; pending: Pending[] };
type Progress = { done: number; failed: number; total: number };

/**
 * Mantenimiento de las miniaturas.
 *
 * Cada foto se guarda junto con sus versiones pequeñas (ver
 * `supabase-image-loader.ts`), pero eso empezó a hacerse el 2026-09-02: las
 * fotos anteriores no las tienen y se sirven enteras. Esta pantalla las
 * genera, y sirve igual el día que falte alguna por lo que sea.
 *
 * Se hace desde el navegador y no con un script porque así usa la sesión que
 * ya hay abierta: los mismos permisos con los que se sube una foto normal, sin
 * ninguna clave secreta dando vueltas.
 */
export default function ThumbnailsClient() {
  const t = useT();
  const [scan, setScan] = useState<Scan | null>(null);
  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [running, setRunning] = useState(false);

  const rescan = useCallback(async () => {
    try {
      const names = await listAllObjects();
      const existing = new Set(names);
      const pending: Pending[] = [];
      let total = 0;
      for (const name of names) {
        if (isThumbName(name)) continue;
        total += 1;
        const widths = THUMB_WIDTHS.filter((w) => !existing.has(thumbName(name, w)));
        if (widths.length > 0) pending.push({ fileName: name, widths });
      }
      setScan({ total, pending });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("thumbs.scanFailed"));
    } finally {
      setScanning(false);
    }
  }, [t]);

  useEffect(() => {
    // Fuera del render: la revisión toca estado y el lint de React no deja
    // llamarla en seco desde el efecto.
    const id = setTimeout(() => void rescan(), 0);
    return () => clearTimeout(id);
  }, [rescan]);

  async function generate() {
    if (!scan || scan.pending.length === 0) return;
    const supabase = createClient();
    const queue = [...scan.pending];
    const state: Progress = { done: 0, failed: 0, total: queue.length };
    setProgress({ ...state });
    setRunning(true);

    async function worker() {
      for (;;) {
        const job = queue.shift();
        if (!job) return;
        try {
          const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(job.fileName);
          const response = await fetch(data.publicUrl);
          if (!response.ok) throw new Error(String(response.status));
          const made = await uploadThumbnails(
            supabase,
            job.fileName,
            await response.blob(),
            t,
            job.widths
          );
          if (made === job.widths.length) state.done += 1;
          else state.failed += 1;
        } catch {
          state.failed += 1;
        }
        setProgress({ ...state });
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setRunning(false);
    setScanning(true);
    await rescan();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl glass-strong p-5">
        <p className="text-sm text-paper-600">{t("thumbs.explain")}</p>
      </div>

      <div className="rounded-xl glass-strong p-5">
        {scanning ? (
          <p className="text-sm text-paper-500">{t("thumbs.scanning")}</p>
        ) : error ? (
          <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
        ) : scan ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-paper-900">
                {scan.pending.length === 0
                  ? t("thumbs.allGood", { n: scan.total })
                  : t("thumbs.missing", { n: scan.pending.length, total: scan.total })}
              </p>
              {progress && (
                <p className="mt-1 text-xs text-paper-500">
                  {running
                    ? t("thumbs.working", { done: progress.done + progress.failed, total: progress.total })
                    : t("thumbs.doneMsg", { ok: progress.done, failed: progress.failed })}
                </p>
              )}
            </div>
            {scan.pending.length > 0 && (
              <button
                type="button"
                onClick={generate}
                disabled={running}
                className="shrink-0 rounded-lg bg-paper-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-paper-800 disabled:opacity-50"
              >
                {running ? t("common.processing") : t("thumbs.generate")}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Todos los ficheros del cubo, incluidos los de las carpetas (las fotos de los
 * traspasos van en `transfers/`). Storage devuelve las carpetas como entradas
 * sin `id`, así que se bajan aparte.
 */
async function listAllObjects(path = "", depth = 0): Promise<string[]> {
  if (depth > 2) return [];
  const supabase = createClient();
  const names: string[] = [];
  const folders: string[] = [];

  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage
      .from(IMAGE_BUCKET)
      .list(path, { limit: PAGE, offset });
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const entry of data) {
      const full = path ? `${path}/${entry.name}` : entry.name;
      if (entry.id) names.push(full);
      else folders.push(full);
    }
    if (data.length < PAGE) break;
  }

  for (const folder of folders) {
    names.push(...(await listAllObjects(folder, depth + 1)));
  }
  return names;
}
