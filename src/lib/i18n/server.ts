import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_TAGS, isLocale, type Locale } from "./config";
import { getDictionary, type Dictionary } from "./dictionaries";
import { createTranslate, type Translate } from "./translate";

/** 服务端组件 / 服务端 action 里读当前语言（来自 cookie，默认西语）。 */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export async function getI18n(): Promise<{
  locale: Locale;
  /** BCP 47 标签，给 <html lang> / Intl / toLocaleDateString 用 */
  tag: string;
  dict: Dictionary;
  t: Translate;
}> {
  const locale = await getLocale();
  const dict = getDictionary(locale);
  return { locale, tag: LOCALE_TAGS[locale], dict, t: createTranslate(dict) };
}

/** 只要 t 的场景（服务端 action 里返回本地化报错）。 */
export async function getT(): Promise<Translate> {
  return (await getI18n()).t;
}
