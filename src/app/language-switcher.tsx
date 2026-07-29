"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LOCALES, LOCALE_LABELS } from "@/lib/i18n/config";
import { setLocale } from "@/lib/i18n/actions";
import { useI18n } from "@/lib/i18n/client";

/**
 * 语言切换：写 cookie 后 router.refresh()，服务端组件按新语言重渲染。
 * className 可覆盖，方便在深色/浅色不同的头部里复用。
 */
export default function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className={`inline-flex shrink-0 items-center gap-1.5 ${className ?? ""}`}>
      <span className="sr-only">{t("lang.label")}</span>
      <svg className="h-3.5 w-3.5 shrink-0 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-9c2.5 2.7 2.5 15.3 0 18M3.6 9h16.8M3.6 15h16.8" />
      </svg>
      <select
        value={locale}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          startTransition(async () => {
            await setLocale(next);
            router.refresh();
          });
        }}
        className="cursor-pointer appearance-none bg-transparent text-xs font-medium outline-none disabled:opacity-50"
      >
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {LOCALE_LABELS[code]}
          </option>
        ))}
      </select>
    </label>
  );
}
