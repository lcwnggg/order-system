"use client";

import { useEffect, useRef, useState } from "react";
import { isValidBarcodeFormat } from "@/lib/barcode";
import { useT } from "@/lib/i18n/client";
import ModalPortal from "@/app/modal-portal";
import type { Translate } from "@/lib/i18n/translate";

// ─────────────────────────────────────────────────────────────
// 手机摄像头扫码录入条码。
// - @zxing/browser 只在此客户端组件内、且仅在真正开始扫码时动态 import，
//   不会进入 server bundle，也不会进入首屏 client bundle。
// - 桌面端不唤起摄像头，只提示"请用手机打开"。
// ─────────────────────────────────────────────────────────────

export function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
  // iPadOS 13+ 默认伪装成 Mac，用触点数量兜底识别
  return navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform);
}

type ScannerControls = { stop: () => void };

// 两次识别尝试之间的间隔。zxing 默认 500ms（每秒只试 2 次），是"对准了却迟迟不识别"的
// 主因之一。调小 = 更跟手，但解码在主线程上跑，配合 TRY_HARDER + 1080p 会更吃 CPU。
// 200ms 是手感与低端机发热/掉帧之间的折中；若旧手机上预览卡顿，把这个值调大即可。
const SCAN_ATTEMPT_INTERVAL_MS = 200;

// 只保留零售场景会用到的一维码格式 + TRY_HARDER：
// 默认不加 hints 时 zxing 会尝试所有格式（含二维码等用不到的格式），既慢又更容易在
// 手抖/光线差时误判或漏判，这是"有时候扫得到有时候扫不到"的主因之一。
async function buildHints() {
  const { BarcodeFormat, DecodeHintType } = await import("@zxing/library");
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.ITF,
    BarcodeFormat.CODABAR,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return hints;
}

function mapCameraError(err: unknown, t: Translate): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return t("camera.denied");
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return t("camera.notFound");
  }
  if (name === "NotReadableError") {
    return t("camera.inUse");
  }
  return err instanceof Error && err.message
    ? t("camera.startFailedWith", { message: err.message })
    : t("camera.startFailed");
}

// 全屏扫码遮罩：挂载即开始扫码，识别到条码回调 onDetected。
export function ScannerOverlay({
  onDetected,
  onClose,
}: {
  onDetected: (text: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  useEffect(() => {
    let controls: ScannerControls | undefined;
    let done = false;

    (async () => {
      try {
        const [{ BrowserMultiFormatReader }, hints] = await Promise.all([
          import("@zxing/browser"),
          buildHints(),
        ]);
        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: SCAN_ATTEMPT_INTERVAL_MS,
        });
        if (!videoRef.current) return;
        controls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: "environment",
              // 分辨率太低时条码的细条纹会糊成一片，尤其在近距离对焦时；
              // 提高期望分辨率能显著提升识别成功率。
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              advanced: [{ focusMode: "continuous" } as unknown as MediaTrackConstraintSet],
            },
          },
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
        if (done) {
          controls.stop();
        } else {
          // 检测是否支持手电筒（仓库光线不足时最常见的失败原因）
          const stream = videoRef.current?.srcObject;
          const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : undefined;
          const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
          if (track && capabilities?.torch) setTorchSupported(true);
        }
      } catch (err) {
        setError(mapCameraError(err, t));
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

  function toggleTorch() {
    const stream = videoRef.current?.srcObject;
    const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : undefined;
    if (!track) return;
    const next = !torchOn;
    track
      .applyConstraints({
        // fillLightMode 是旧草案里的名字，部分浏览器只认它；两个都给以兼容更多机型
        advanced: [
          { torch: next, fillLightMode: next ? "flash" : "off" } as unknown as MediaTrackConstraintSet,
        ],
      })
      .then(() => setTorchOn(next))
      .catch(() => {});
  }

  return (
    <ModalPortal>
    {/* z 必须高于商品编辑弹窗（z-80），否则从"编辑"里点扫码，摄像头画面被弹窗盖住，看起来像没反应 */}
    <div className="fixed inset-0 z-[100] flex flex-col bg-black">
      {/* 顶部栏 */}
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
        <span className="text-sm font-medium text-white/90">{t("scanner.title")}</span>
        <div className="flex items-center gap-2">
          {torchSupported && (
            <button
              type="button"
              onClick={toggleTorch}
              className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
                torchOn ? "bg-amber-400 text-black" : "bg-white/15 text-white hover:bg-white/25"
              }`}
              aria-label={t("scanner.toggleTorch")}
              title={t("scanner.torchHint")}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
            aria-label={t("scanner.close")}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
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
            <div className="h-36 w-72 max-w-[80vw] rounded-xl border-2 border-white/90" />
          </div>
        )}

        {starting && !error && (
          <p className="absolute inset-x-0 bottom-24 text-center text-sm text-white/80">
            {t("scanner.starting")}
          </p>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-sm rounded-xl bg-white p-5 text-center shadow-xl">
              <p className="text-sm text-paper-700">{error}</p>
              <button
                type="button"
                onClick={onClose}
                className="mt-4 rounded-lg bg-paper-700 px-4 py-2 text-sm font-medium text-white hover:bg-paper-800"
              >
                {t("scanner.gotIt")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 底部提示 */}
      {!error && (
        <div className="shrink-0 px-6 py-5 text-center">
          <p className="text-sm text-white/80">{t("scanner.aimHint")}</p>
        </div>
      )}
    </div>
    </ModalPortal>
  );
}

// 条码输入框 + 扫码按钮（供仓库端商品创建/编辑复用）
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
  const t = useT();
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
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-paper-700">
        {t("barcode.label")}
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
          placeholder={t("barcode.placeholder")}
          className={`min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm text-paper-900 placeholder-paper-500 outline-none focus:ring-2 ${
            invalid
              ? "border-red-300 bg-red-50 focus:border-red-400 focus:ring-red-100"
              : "border-paper-300 focus:border-paper-500 focus:ring-paper-300"
          }`}
        />
        <button
          type="button"
          onClick={handleScanClick}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-paper-300 bg-white px-3.5 py-2 text-sm font-medium text-paper-700 transition-colors hover:bg-paper-100 active:bg-paper-100"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 5a1 1 0 011-1h1m12 0h1a1 1 0 011 1v1m0 12v1a1 1 0 01-1 1h-1M6 20H5a1 1 0 01-1-1v-1M4 12h16M8 8v8m4-8v8m4-8v8" />
          </svg>
          {t("barcode.scan")}
        </button>
      </div>

      {invalid && (
        <p className="mt-1.5 text-xs text-red-500">{t("barcode.invalidFormat")}</p>
      )}
      {desktopHint && (
        <p className="mt-1.5 text-xs text-paper-500">{t("barcode.desktopHint")}</p>
      )}

      {scanning && (
        <ScannerOverlay onDetected={handleDetected} onClose={() => setScanning(false)} />
      )}
    </div>
  );
}
