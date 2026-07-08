-- 新用户注册时，自动在 profiles 表创建一行记录
-- 请在 Supabase Dashboard → SQL Editor 中执行此脚本

-- 1. 创建触发器函数
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, role)
  VALUES (NEW.id, 'store');
  RETURN NEW;
END;
$$;

-- 2. 绑定到 auth.users 表的 INSERT 事件
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
