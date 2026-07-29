import type { NextConfig } from "next";

// El hostname de Supabase se deriva de NEXT_PUBLIC_SUPABASE_URL para no tener
// que mantenerlo sincronizado a mano aquí y en el .env. Si cambias de proyecto
// o de entorno Supabase, next/image se ajusta solo. Falla claro si falta la var.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!supabaseUrl) {
  throw new Error("Falta NEXT_PUBLIC_SUPABASE_URL (necesaria para next/image remotePatterns)");
}
const supabaseHost = new URL(supabaseUrl).hostname;

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: supabaseHost,
        pathname: "/storage/v1/object/public/**",
      },
    ],
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
