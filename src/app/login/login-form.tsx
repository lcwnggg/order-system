"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "login" | "register";

function translateAuthError(message: string): string {
  const map: Record<string, string> = {
    "Invalid login credentials": "邮箱或密码不正确",
    "User already registered": "该邮箱已注册，请直接登录",
    "Password should be at least 6 characters":
      "密码至少需要 6 个字符",
    "Unable to validate email address: invalid format": "邮箱格式不正确",
    "Signup requires a valid password": "请输入有效密码",
    "Email not confirmed": "请先查收邮件并点击确认链接",
  };

  return map[message] ?? message;
}

export function LoginForm() {
  const router = useRouter();
  const supabase = createClient();

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    if (mode === "login") {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(translateAuthError(signInError.message));
        setLoading(false);
        return;
      }

      router.push("/");
      router.refresh();
      return;
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (signUpError) {
      setError(translateAuthError(signUpError.message));
      setLoading(false);
      return;
    }

    if (data.session) {
      router.push("/");
      router.refresh();
      return;
    }

    setMessage("注册成功！请查收确认邮件，点击链接后即可登录。");
    setLoading(false);
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-paper-200 bg-paper-25 p-7 sm:p-8">
      <div className="mb-7 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-paper-700">
          <svg className="h-7 w-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold text-paper-900">我的小店</h1>
        <p className="mt-1.5 text-sm text-paper-500">
          {mode === "login" ? "登录你的账号" : "创建新账号"}
        </p>
      </div>

      <div className="mb-6 flex rounded-xl bg-paper-100 p-1">
        <button
          type="button"
          onClick={() => {
            setMode("login");
            setError(null);
            setMessage(null);
          }}
          className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
            mode === "login"
              ? "bg-white text-paper-900"
              : "text-paper-500 hover:text-paper-700"
          }`}
        >
          登录
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("register");
            setError(null);
            setMessage(null);
          }}
          className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
            mode === "register"
              ? "bg-white text-paper-900"
              : "text-paper-500 hover:text-paper-700"
          }`}
        >
          注册
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="mb-1.5 block text-sm font-medium text-paper-700"
          >
            邮箱
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-paper-200 bg-white px-3 py-2.5 text-sm text-paper-900 placeholder:text-paper-500 outline-none focus:border-paper-400 focus:ring-2 focus:ring-paper-200"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="mb-1.5 block text-sm font-medium text-paper-700"
          >
            密码
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              required
              minLength={6}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
              className="w-full rounded-lg border border-paper-200 bg-white px-3 py-2.5 pr-10 text-sm text-paper-900 placeholder:text-paper-500 outline-none focus:border-paper-400 focus:ring-2 focus:ring-paper-200"
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-paper-500 hover:text-paper-600"
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
            >
              {showPassword ? (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        )}

        {message && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-paper-700 py-2.5 text-sm font-medium text-white transition-colors hover:bg-paper-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading
            ? "请稍候…"
            : mode === "login"
              ? "登录"
              : "注册"}
        </button>
      </form>
    </div>
  );
}
