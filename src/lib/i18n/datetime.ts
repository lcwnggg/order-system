import { LOCALE_TAGS, LOCALE_TIME_ZONES, type Locale } from "./config";

// 订单时间的统一格式化。
//
// 为什么不用 new Date(iso).getFullYear() 这种写法：那读的是「运行环境的时区」。
// 这些列表是客户端组件，但同样会在服务端预渲染一遍——服务器通常跑在 UTC，
// 浏览器在马德里/北京，两边算出来的字符串不一样，React 水合时就会报
// hydration mismatch，页面上的时间还会闪一下变成另一个值。
// 这里显式传 timeZone，服务端和客户端算出的结果必然一致。
export function formatDateTime(iso: string, locale: Locale): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LOCALE_TIME_ZONES[locale],
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  // 固定成 2026-07-29 14:05，与语言无关（数字日期两种语言都读得懂）
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

// 按天分组用的「日」键：同样显式带时区，服务端和客户端切出来的那一天必然一致。
export function dayKey(iso: string, locale: Locale): string {
  return formatDateTime(iso, locale).slice(0, 10);
}

/**
 * Cabecera de un grupo de pedidos: «lunes, 25 de agosto de 2026».
 *
 * Aquí sí se traduce (a diferencia de la hora, que va en números): el
 * encabezado de un día se lee de un vistazo mucho mejor con el nombre del día
 * escrito. La zona horaria va explícita por el mismo motivo que arriba.
 */
export function formatDayLabel(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(LOCALE_TAGS[locale], {
    timeZone: LOCALE_TIME_ZONES[locale],
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}
