"use client";

import { useEffect, useRef, useState } from "react";
import { isValidBarcodeFormat } from "@/lib/barcode";

// ─────────────────────────────────────────────────────────────
// 手机摄像头扫码录入条码。
// - @zxing/browser 只在此客户端组件内、且仅在真正开始扫码时动态 import，
//   不会进入 server bundle，也不会进入首屏 client bundle。
// - 桌面端不唤起摄像头，只提示"请用手机打开"。
// ─────────────────────────────────────────────────────────────

function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
  // iPadOS 13+ 默认伪装成 Mac，用触点数量兜底识别
  return navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform);
}

type ScannerControls = { stop: () => void };

function mapCameraError(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "无法使用摄像头：权限被拒绝。请在浏览器设置里允许本站访问摄像头后重试。";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "没有找到可用的摄像头。";
  }
  if (name === "NotReadableError") {
    return "摄像头被其他应用占用，请关闭后重试。";
  }
  return err instanceof Error && err.message ? `摄像头启动失败：${err.message}` : "摄像头启动失败。";
}

// 全屏扫码遮罩：挂载即开始扫码，识别到条码回调 onDetected。
function ScannerOverlay({
  onDetected,
  onClose,
}: {
  onDetected: (text: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let controls: ScannerControls | undefined;
    let done = false;

    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        if (!videoRef.current) return;
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: "environment" } },
          videoRef.current,
          (result) => {
            if (result && !done) {
              done = true;
              const text = result.getText().trim();
              controls?.stop();
              onDetected(text);
            }
          }
        );
        setStarting(false);
        // 若在等待期间已卸载，立即停止
        if (done) controls.stop();
      } catch (err) {
        setError(mapCameraError(err));
        setStarting(false);
      }
    })();

    return () => {
      done = true;
      controls?.stop();
    };
    // onDetected 稳定引用由父组件保证；仅需挂载时启动一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black">
      {/* 顶部栏 */}
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
        <span className="text-sm font-medium text-white/90">扫描条码</span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
          aria-label="关闭扫码"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 视频 + 瞄准框 */}
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          muted
          autoPlay
          playsInline
        />

        {!error && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-36 w-72 max-w-[80vw] rounded-xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
          </div>
        )}

        {starting && !error && (
          <p className="absolute inset-x-0 bottom-24 text-center text-sm text-white/80">
            正在启动摄像头…
          </p>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-sm rounded-xl bg-white p-5 text-center shadow-xl">
              <p className="text-sm text-sage-700">{error}</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 rounded-lg bg-sage-700 px-4 py-2 text-sm font-medium text-white hover:bg-sage-800"
              >
                知道了
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 底部提示 */}
      {!error && (
        <div className="shrink-0 px-6 py-5 text-center">
          <p className="text-sm text-white/80">将条码对准框内，识别成功会自动填入</p>
        </div>
      )}
    </div>
  );
}

// 条码输入框 + 扫码按钮（西班牙语 label，供仓库端商品创建/编辑复用）
export default function BarcodeField({
  value,
  onChange,
  name,
  inputId = "barcode",
}: {
  value: string;
  onChange: (v: string) => void;
  name?: string;
  inputId?: string;
}) {
  const [scanning, setScanning] = useState(false);
  const [desktopHint, setDesktopHint] = useState(false);

  const invalid = !isValidBarcodeFormat(value);

  function handleScanClick() {
    if (isMobileDevice()) {
      setDesktopHint(false);
      setScanning(true);
    } else {
      setDesktopHint(true);
    }
  }

  function handleDetected(text: string) {
    onChange(text);
    setScanning(false);
  }

  return (
    <div>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-sage-700">
        Código de barras
      </label>
      <div className="flex items-stretch gap-2">
        <input
          id={inputId}
          name={name}
          type="text"
          inputMode="text"
          autoComplete="off"
          value={value}
          onChange={(e) => { onChange(e.target.value); setDesktopHint(false); }}
          placeholder="opcional"
          className={`min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm text-sage-900 placeholder-sage-500 outline-none focus:ring-2 ${
            invalid
              ? "border-red-300 bg-red-50 focus:border-red-400 focus:ring-red-100"
              : "border-sage-300 focus:border-sage-500 focus:ring-sage-300"
          }`}
        />
        <button
          type="button"
          onClick={handleScanClick}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-sage-300 bg-white px-3.5 py-2 text-sm font-medium text-sage-700 transition-colors hover:bg-sage-100 active:bg-sage-100"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 5a1 1 0 011-1h1m12 0h1a1 1 0 011 1v1m0 12v1a1 1 0 01-1 1h-1M6 20H5a1 1 0 01-1-1v-1M4 12h16M8 8v8m4-8v8m4-8v8" />
          </svg>
          扫码
        </button>
      </div>

      {invalid && (
        <p className="mt-1.5 text-xs text-red-500">
          条码格式看起来不对（只允许数字、字母、连字符）
        </p>
      )}
      {desktopHint && (
        <p className="mt-1.5 text-xs text-sage-500">
          请在手机上打开此页面使用扫码，桌面端请手动输入。
        </p>
      )}

      {scanning && (
        <ScannerOverlay onDetected={handleDetected} onClose={() => setScanning(false)} />
      )}
    </div>
  );
}
