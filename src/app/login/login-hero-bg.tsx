/** 登录页背景：与全站同一套冷调玻璃渐变（app-bg + 颗粒），居中承载登录卡 */
export default function LoginHeroBg({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate flex min-h-full flex-1 flex-col items-center justify-center overflow-hidden px-6 py-12">
      <div className="app-bg" />
      <div className="app-grain" />
      <div className="relative z-10 flex w-full justify-center">{children}</div>
    </div>
  );
}
