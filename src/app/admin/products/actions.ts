"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { error: string } | { success: true };

async function requireWarehouse() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "warehouse") return null;
  return supabase;
}

export async function addProduct(
  _prevState: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await requireWarehouse();
  if (!supabase) return { error: "无权限" };

  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim();
  const price = parseFloat(formData.get("price") as string);
  const stock = parseInt(formData.get("stock") as string, 10);
  // image_url is uploaded client-side; the form passes the resulting public URL
  const image_url = (formData.get("image_url") as string) || null;

  if (!name) return { error: "商品名称不能为空" };
  if (isNaN(price) || price < 0) return { error: "请输入有效价格" };
  if (isNaN(stock) || stock < 0) return { error: "请输入有效库存数量" };

  const { error } = await supabase
    .from("products")
    .insert({ name, description, price, stock, image_url });

  if (error) return { error: error.message };

  revalidatePath("/admin/products");
  return { success: true };
}

export async function updateProduct(
  id: string,
  fields: {
    name: string;
    description: string;
    price: number;
    stock: number;
    newImageUrl?: string;
  }
): Promise<ActionResult> {
  const supabase = await requireWarehouse();
  if (!supabase) return { error: "无权限" };

  const { name, description, price, stock, newImageUrl } = fields;
  if (!name) return { error: "商品名称不能为空" };
  if (isNaN(price) || price < 0) return { error: "请输入有效价格" };
  if (isNaN(stock) || stock < 0) return { error: "请输入有效库存数量" };

  const updateData: Record<string, unknown> = {
    name,
    description: description.trim() || null,
    price,
    stock,
  };
  if (newImageUrl !== undefined) updateData.image_url = newImageUrl;

  const { error } = await supabase.from("products").update(updateData).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/products");
  revalidatePath("/shop");
  return { success: true };
}

export async function deleteProduct(id: string): Promise<ActionResult> {
  const supabase = await requireWarehouse();
  if (!supabase) return { error: "无权限" };

  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/admin/products");
  return { success: true };
}
