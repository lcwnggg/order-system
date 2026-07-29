import type { Dictionary, TranslationKey } from "./dictionaries";

export type TranslateVars = Record<string, string | number>;

/** t("shop.itemCount", { n: 3 })，词条里用 {n} 占位。 */
export type Translate = (key: TranslationKey, vars?: TranslateVars) => string;

export function createTranslate(dict: Dictionary): Translate {
  return (key, vars) => {
    const template = dict[key];
    // 缺词条时回退成 key 本身：比渲染出 undefined 更容易定位问题
    if (template === undefined) return key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in vars ? String(vars[name]) : match
    );
  };
}
