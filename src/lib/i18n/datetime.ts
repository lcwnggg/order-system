import { LOCALE_TIME_ZONES, type Locale } from "./config";

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
