"use client";

import { useState } from "react";
import { ScannerOverlay, isMobileDevice } from "@/app/admin/products/barcode-scanner";

// 通用扫码按钮：点击唤起全屏扫码，识别到条码回调 onScan。
// 复用商品创建处已有的 ScannerOverlay（@zxing/browser 动态加载，不进首屏包）。
export default function ScanButton({
  onScan,
  label = "扫码",
  className,
}: {
  onScan: (code: string) => void;
  label?: string;
  className?: string;
}) {
  const [scanning, setScanning] = useState(false);
  const [desktopHint, setDesktopHint] = useState(false);

  function handleClick() {
    if (isMobileDevice()) {
      setDesktopHint(false);
      setScanning(true);
    } else {
      setDesktopHint(true);
    }
  }

  function handleDetected(text: string) {
    setScanning(false);
    onScan(text.trim());
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={
          className ??
          "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-paper-300 bg-paper-25 px-3.5 py-1.5 text-xs font-medium text-paper-700 transition-colors hover:border-paper-400 hover:bg-paper-100"
        }
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 5a1 1 0 011-1h1m12 0h1a1 1 0 011 1v1m0 12v1a1 1 0 01-1 1h-1M6 20H5a1 1 0 01-1-1v-1M4 12h16M8 8v8m4-8v8m4-8v8" />
        </svg>
        {label}
      </button>

      {desktopHint && (
        <p className="mt-1.5 w-full font-mono text-[10px] tracking-[0.08em] text-paper-500">
          请在手机上打开使用扫码
        </p>
      )}

      {scanning && (
        <ScannerOverlay onDetected={handleDetected} onClose={() => setScanning(false)} />
      )}
    </>
  );
}
