"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * Saca un diálogo del árbol y lo cuelga de <body>.
 *
 * Hace falta de verdad: la cáscara de la aplicación (`app-shell`) es una tarjeta
 * `.glass` con `backdrop-filter` y `overflow-hidden`. Un elemento con
 * `position: fixed` dentro de un antepasado con filtro NO se posiciona respecto
 * a la ventana, sino respecto a esa tarjeta, y encima queda recortado por su
 * `overflow-hidden` y sus esquinas redondeadas. En el móvil, donde la cáscara es
 * mucho más alta que la pantalla, el resultado es que el «modal» aparece
 * desplazado fuera de la vista: parece que el botón de editar no hace nada.
 *
 * Montando el diálogo en <body> vuelve a ser fijo respecto a la ventana.
 * También se bloquea el scroll del fondo mientras está abierto.
 */
export default function ModalPortal({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  // En el servidor no hay <body> donde colgarlo. No hay riesgo de descuadre al
  // hidratar: estos diálogos solo se montan cuando alguien los abre.
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
