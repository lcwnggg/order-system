"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";

/**
 * Forma con la que se guarda una etiqueta escrita a mano: si coincide con una
 * existente salvo por mayúsculas o espacios, gana la existente. Evita acabar con
 * «Xiaomi» y «xiaomi» como dos etiquetas distintas en el desplegable.
 */
export function canonicalTag(value: string, options: string[]): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const key = trimmed.toLowerCase();
  return options.find((o) => o?.trim().toLowerCase() === key)?.trim() ?? trimmed;
}

/**
 * Campo de texto con etiquetas ya usadas.
 *
 * Marca y proveedor son campos que se repiten muchísimo entre productos: se
 * escribían a mano cada vez, con el resultado previsible de tener «Xiaomi»,
 * «xiaomi» y «Xiomi» conviviendo como tres marcas distintas. Aquí las opciones
 * salen de lo que ya existe en la base de datos: se toca y se rellena. Escribir
 * sigue permitido —así se crea una etiqueta nueva sin tener que gestionarlas en
 * otra pantalla— pero si lo tecleado coincide con una existente salvo por
 * mayúsculas o espacios, se guarda con la forma ya existente para no duplicar.
 */
export default function TagPicker({
  value,
  onChange,
  options,
  name,
  placeholder,
  inputId,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  /** Si se indica, se emite un input oculto con este nombre (formularios con FormData). */
  name?: string;
  placeholder?: string;
  inputId?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Opciones limpias y sin repetidos por mayúsculas/minúsculas, en orden alfabético.
  const cleanOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const raw of options) {
      const opt = raw?.trim();
      if (!opt) continue;
      const key = opt.toLowerCase();
      if (!seen.has(key)) seen.set(key, opt);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [options]);

  const query = value.trim().toLowerCase();
  const filtered = useMemo(
    () => (query ? cleanOptions.filter((o) => o.toLowerCase().includes(query)) : cleanOptions),
    [cleanOptions, query]
  );
  const exactMatch = cleanOptions.find((o) => o.toLowerCase() === query);

  // Cerrar al tocar fuera. Sin esto la lista tapa los campos de abajo en el móvil.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const canonical = canonicalTag(value, cleanOptions);

  return (
    <div ref={wrapRef} className="relative">
      {name && <input type="hidden" name={name} value={canonical} />}

      <div className="relative">
        <input
          id={inputId}
          type="text"
          value={value}
          autoComplete="off"
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder={placeholder}
          className="w-full rounded-lg border border-paper-300 py-2 pl-3 pr-9 text-sm text-paper-900 placeholder-paper-500 outline-none focus:border-paper-500 focus:ring-2 focus:ring-paper-300"
        />
        {value ? (
          <button
            type="button"
            onClick={() => { onChange(""); setOpen(false); }}
            aria-label={t("tags.clear")}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1.5 text-paper-400 transition-colors hover:bg-paper-100 hover:text-paper-600"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : (
          cleanOptions.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={t("tags.showAll")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1.5 text-paper-400 transition-colors hover:bg-paper-100 hover:text-paper-600"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )
        )}
      </div>

      {open && (filtered.length > 0 || (query && !exactMatch)) && (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-paper-200 bg-white py-1 shadow-lg">
          {query && !exactMatch && (
            <button
              type="button"
              onClick={() => { onChange(value.trim()); setOpen(false); }}
              className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm text-paper-700 hover:bg-paper-100"
            >
              <span className="text-paper-400">+</span>
              {t("tags.createNew", { name: value.trim() })}
            </button>
          )}
          {filtered.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => { onChange(opt); setOpen(false); }}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-paper-100 ${
                opt.toLowerCase() === query ? "font-semibold text-paper-900" : "text-paper-700"
              }`}
            >
              {opt}
              {opt.toLowerCase() === query && (
                <svg className="h-3.5 w-3.5 text-paper-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Acceso rápido: las etiquetas más usadas, a un toque. Solo con el campo
          vacío —una vez elegida, ocupar espacio con la lista no aporta nada. */}
      {!value && cleanOptions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {cleanOptions.slice(0, 8).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              className="rounded-full bg-paper-100 px-2.5 py-1 text-xs font-medium text-paper-600 transition-colors hover:bg-paper-200 hover:text-paper-900"
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
