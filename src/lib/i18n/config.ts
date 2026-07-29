// 语言配置（i18n）
// 采用 cookie 方案而非 /[lang] 路由：这是登录后才用的内部工具，
// 没有 SEO 需求，也不想把 20 多个路由目录挪到 app/[lang] 下、重写所有内部链接。
// cookie 在服务端组件、服务端 action、客户端组件里都能读到，够用且改动最小。

export const LOCALES = ["es", "zh"] as const;

export type Locale = (typeof LOCALES)[number];

/** 店在西班牙，员工日常用西语；老板可在右上角切回中文。 */
export const DEFAULT_LOCALE: Locale = "es";

export const LOCALE_COOKIE = "locale";

/** 语言切换器上显示的名字（各自用本语言写，不翻译）。 */
export const LOCALE_LABELS: Record<Locale, string> = {
  es: "Español",
  zh: "中文",
};

/** <html lang> 与 Intl / toLocaleDateString 用的 BCP 47 标签。 */
export const LOCALE_TAGS: Record<Locale, string> = {
  es: "es-ES",
  zh: "zh-CN",
};

/** 显示日期时用的时区：西语界面按店所在地（西班牙），中文界面沿用原来的北京时间。 */
export const LOCALE_TIME_ZONES: Record<Locale, string> = {
  es: "Europe/Madrid",
  zh: "Asia/Shanghai",
};

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}
