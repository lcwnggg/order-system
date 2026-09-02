"use client";

import { useEffect } from "react";
import { originalImageUrl } from "@/lib/supabase-image-loader";

/**
 * Red de seguridad para las fotos: si una miniatura no carga, se pinta el
 * original en su lugar.
 *
 * Las miniaturas se generan al subir la foto, así que las que se subieron
 * antes de que eso existiera no las tienen (hasta pasar por
 * `/admin/products/thumbnails`), y siempre puede faltar alguna por un borrado
 * a mano o por un fallo al subirla. Sin esto, cada hueco sería una foto rota
 * — justo lo que se quiere no volver a ver.
 *
 * Va en el layout y escucha en toda la página en vez de ir pantalla por
 * pantalla: hay una docena de sitios que pintan fotos y cualquiera nuevo
 * queda cubierto sin acordarse de nada. Los errores de `<img>` no burbujean,
 * de ahí el `capture: true`.
 */
export default function ImageFallback() {
  useEffect(() => {
    function handleError(event: Event) {
      const img = event.target;
      if (!(img instanceof HTMLImageElement)) return;
      const original = originalImageUrl(img.currentSrc || img.src);
      if (!original) return; // no era una miniatura: no hay nada mejor que ofrecer
      // `srcset` manda sobre `src`: sin vaciarlo el navegador volvería a elegir
      // la miniatura que acaba de fallar. Y como el original ya no lleva
      // sufijo, `originalImageUrl` devolverá `null` si también falla: no hay
      // manera de entrar en bucle.
      img.srcset = "";
      img.src = original;
    }

    window.addEventListener("error", handleError, true);
    return () => window.removeEventListener("error", handleError, true);
  }, []);

  return null;
}
