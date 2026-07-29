import type { Locale } from "../config";
import es from "./es";
import zh from "./zh";

/** 所有词条 key（由西语词典推导，西语是这份翻译的基准）。 */
export type TranslationKey = keyof typeof es;

/** 一份完整的词典：少一个 key 或多一个 key 都会编译不过。 */
export type Dictionary = Record<TranslationKey, string>;

const DICTIONARIES: Record<Locale, Dictionary> = { es, zh };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}
