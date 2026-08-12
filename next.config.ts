import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Las miniaturas las encoge Supabase, no el optimizador de Vercel: ese
    // tiene cuota mensual y al agotarse devolvía 402 dejando toda la web sin
    // fotos. El porqué y el cómo, en src/lib/supabase-image-loader.ts.
    // (Con loader propio `remotePatterns` deja de usarse: no hay dominio que
    // autorizar porque las URLs ya no pasan por Next.)
    loader: "custom",
    loaderFile: "./src/lib/supabase-image-loader.ts",
  },
  async headers() {
    return [
      {
        // El service worker no se puede cachear: si el navegador sirve una
        // versión vieja, los avisos push dejan de llegar y no hay forma de
        // enterarse desde fuera.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
