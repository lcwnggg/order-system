"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_LOCALE, LOCALE_TAGS, type Locale } from "./config";
import type { Dictionary } from "./dictionaries";
import { createTranslate, type Translate } from "./translate";

type I18nValue = { locale: Locale; tag: string; t: Translate };

const I18nContext = createContext<I18nValue | null>(null);

/**
 * 词典由根 layout（服务端）读 cookie 后作为 prop 传下来，
 * 客户端包里因此只会带上「当前这一种语言」的词条，而不是全部语言。
 */
export function I18nProvider({
  locale,
  dict,
  children,
}: {
  locale: Locale;
  dict: Dictionary;
  children: ReactNode;
}) {
  const value = useMemo<I18nValue>(
    () => ({ locale, tag: LOCALE_TAGS[locale], t: createTranslate(dict) }),
    [locale, dict]
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  // 理论上不会发生（Provider 在根 layout）；真发生时回退成 key 而不是整页崩掉
  if (!ctx) {
    return {
      locale: DEFAULT_LOCALE,
      tag: LOCALE_TAGS[DEFAULT_LOCALE],
      t: (key) => key,
    };
  }
  return ctx;
}

/** 大多数组件只需要 t。 */
export function useT(): Translate {
  return useI18n().t;
}
