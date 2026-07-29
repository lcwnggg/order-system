import type { MetadataRoute } from "next";
import { getI18n } from "@/lib/i18n/server";

// El manifest es lo que convierte la web en «app instalable». Hace falta
// sobre todo por iOS: Safari solo entrega notificaciones push si la web se
// ha añadido a la pantalla de inicio, y para eso exige un manifest válido.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { t } = await getI18n();
  return {
    name: t("meta.title"),
    short_name: t("meta.shortName"),
    description: t("meta.description"),
    start_url: "/",
    display: "standalone",
    background_color: "#1b2030",
    theme_color: "#1b2030",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // maskable: Android recorta el icono a la forma del sistema; declarar
      // el 512 como maskable evita que salga con un cuadrado blanco detrás.
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
