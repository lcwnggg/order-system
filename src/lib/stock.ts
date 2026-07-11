// 统一库存读取口径：
// - 有变体的商品(has_variants = true)：真实库存在 product_variants.stock，
//   products.stock 恒为 0，因此总库存 = 各颜色库存之和。
// - 无变体的商品：库存 = products.stock。

export type ProductStock = { has_variants: boolean; stock: number };
export type VariantStock = { stock: number };

/** 商品总库存：有变体则为各颜色库存之和，否则为 products.stock。 */
export function getTotalStock(product: ProductStock, variants: VariantStock[]): number {
  if (product.has_variants) return variants.reduce((sum, v) => sum + v.stock, 0);
  return product.stock;
}

/** 是否库存告急：有变体时任一颜色 ≤5 即告急；无变体时库存 ≤5。 */
export function isLowStock(product: ProductStock, variants: VariantStock[]): boolean {
  if (product.has_variants) {
    return variants.length > 0 && variants.some((v) => v.stock <= 5);
  }
  return product.stock <= 5;
}
