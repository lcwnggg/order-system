// 条码格式校验（第一版，宽松）
// 覆盖常见条码：EAN-13/EAN-8/UPC-A（纯数字）以及 Code128（可含字母/连字符）。
// 只允许数字、字母、连字符；空值视为合法（条码是可选字段）。
// 注意：这里只做"格式明显错误"的拦截，不校验校验位、不做唯一性检查。

const BARCODE_PATTERN = /^[0-9A-Za-z-]{4,48}$/;

export function isValidBarcodeFormat(raw: string | null | undefined): boolean {
  const v = (raw ?? "").trim();
  if (v === "") return true; // 空 = 允许
  return BARCODE_PATTERN.test(v);
}

// 去除首尾空白，空字符串归一化为 null，便于写入可空的 products.barcode
export function normalizeBarcode(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  return v === "" ? null : v;
}
