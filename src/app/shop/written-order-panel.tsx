"use client";

import { useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { parseWrittenLines, type WrittenLine } from "@/lib/written-items";

/** Línea escrita ya dentro del pedido: la del parser + un id local para React. */
export type WrittenEntry = WrittenLine & { id: string };

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Añade líneas fusionando las que repiten descripción (mismo texto ignorando
 * mayúsculas): pedir dos veces «protector 16 pro max» suma cantidades en vez de
 * dejarle al almacén dos renglones iguales.
 */
export function addWrittenLines(prev: WrittenEntry[], lines: WrittenLine[]): WrittenEntry[] {
  const next = [...prev];
  for (const line of lines) {
    const key = line.description.toLowerCase();
    const existing = next.findIndex((e) => e.description.toLowerCase() === key);
    if (existing >= 0) {
      next[existing] = {
        ...next[existing],
        quantity: Math.min(next[existing].quantity + line.quantity, 999),
        // Si ya se sumó a mano, la sugerencia de cantidad deja de tener sentido
        qtyHint: undefined,
      };
    } else {
      next.push({ ...line, id: newId() });
    }
  }
  return next;
}

/**
 * «Pedido escrito»: caja para pedir cosas que no están en el catálogo.
 * Escribe una línea, Enter, y la línea entra en el pedido. Se puede pegar una
 * lista entera de golpe (WhatsApp, una columna de Excel) y entra línea a línea.
 */
export default function WrittenOrderPanel({
  lines,
  onChange,
  suggestions,
  compact = false,
}: {
  lines: WrittenEntry[];
  onChange: (next: WrittenEntry[]) => void;
  /** Descripciones escritas en pedidos anteriores de esta tienda. */
  suggestions: string[];
  /** true en el panel del móvil: tipografía y alturas algo mayores. */
  compact?: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (q.length < 2) return [];
    return suggestions
      .filter((s) => s.toLowerCase().includes(q) && s.toLowerCase() !== q)
      .slice(0, 5);
  }, [draft, suggestions]);

  function commit(text: string) {
    const parsed = parseWrittenLines(text);
    if (!parsed.length) return;
    onChange(addWrittenLines(lines, parsed));
    setDraft("");
    if (parsed.length > 1) {
      setFlash(t("written.pastedLines", { n: parsed.length }));
      setTimeout(() => setFlash(null), 2500);
    }
    inputRef.current?.focus();
  }

  function setQty(id: string, quantity: number) {
    if (quantity <= 0) {
      onChange(lines.filter((l) => l.id !== id));
      return;
    }
    onChange(
      lines.map((l) => (l.id === id ? { ...l, quantity: Math.min(quantity, 999), qtyHint: undefined } : l))
    );
  }

  const inputSize = compact ? "py-3 text-base" : "py-2 text-sm";

  return (
    <div className="rounded-xl border border-dashed border-paper-300 bg-white/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-paper-900">
          <svg className="h-4 w-4 text-paper-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          {t("written.title")}
        </h3>
        {lines.length > 0 && (
          <span className="rounded-full bg-paper-700 px-2 py-0.5 text-xs font-medium text-white">
            {t("written.lineCount", { n: lines.length })}
          </span>
        )}
      </div>

      <p className="mb-2 text-xs leading-snug text-paper-500">{t("written.hint")}</p>

      <div className="relative">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => setFocused(true)}
            // El blur se retrasa para que el clic en una sugerencia llegue antes
            // de que la lista desaparezca
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit(draft);
              }
            }}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              // Una lista pegada entra entera de golpe; un texto de una línea
              // sigue el camino normal (se puede seguir editando antes de Enter)
              if (/[\n\r]/.test(text.trim())) {
                e.preventDefault();
                commit(text);
              }
            }}
            placeholder={t("written.placeholder")}
            enterKeyHint="done"
            className={`min-w-0 flex-1 rounded-lg border border-paper-200 bg-white/70 px-3 ${inputSize} text-paper-900 placeholder-paper-400 outline-none focus:border-paper-400 focus:ring-2 focus:ring-paper-200`}
          />
          <button
            type="button"
            onClick={() => commit(draft)}
            disabled={!draft.trim()}
            className={`shrink-0 rounded-lg bg-paper-700 px-4 ${inputSize} font-medium text-white transition hover:bg-paper-800 disabled:cursor-not-allowed disabled:opacity-30`}
          >
            {t("written.add")}
          </button>
        </div>

        {focused && matches.length > 0 && (
          <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-paper-200 bg-white shadow-lg">
            <p className="border-b border-paper-100 px-3 py-1.5 text-[11px] uppercase tracking-wider text-paper-400">
              {t("written.recent")}
            </p>
            {matches.map((s) => (
              <button
                key={s}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(s)}
                className="block w-full truncate px-3 py-2 text-left text-sm text-paper-700 hover:bg-paper-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {flash && <p className="mt-2 text-xs font-medium text-green-700">{flash}</p>}

      {lines.length > 0 && (
        <ul className="mt-3 space-y-2">
          {lines.map((line) => (
            <li key={line.id} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm leading-snug text-paper-900">{line.description}</p>
                {line.qtyHint && (
                  <button
                    type="button"
                    onClick={() => setQty(line.id, line.qtyHint!)}
                    title={t("written.qtyHintTitle", { n: line.qtyHint })}
                    className="mt-1 rounded-full border border-accent-200 bg-accent-50 px-2 py-0.5 text-[11px] font-medium text-accent-600 transition hover:bg-accent-100"
                  >
                    {t("written.qtyHintAsk", { n: line.qtyHint })}
                  </button>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => setQty(line.id, line.quantity - 1)}
                  className="flex h-6 w-6 items-center justify-center rounded border border-paper-200 text-xs text-paper-500 hover:bg-paper-100">−</button>
                <span className="w-6 text-center text-xs font-medium tabular-nums text-paper-900">{line.quantity}</span>
                <button type="button" onClick={() => setQty(line.id, line.quantity + 1)}
                  className="flex h-6 w-6 items-center justify-center rounded border border-paper-200 text-xs text-paper-500 hover:bg-paper-100">+</button>
                <button type="button" onClick={() => onChange(lines.filter((l) => l.id !== line.id))}
                  title={t("written.remove")}
                  className="ml-1 text-xs text-paper-400 hover:text-red-400">✕</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
