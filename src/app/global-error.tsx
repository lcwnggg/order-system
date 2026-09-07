"use client";

/**
 * Última red antes de la pantalla en blanco de Next.
 *
 * El fallback de fábrica dice «This page couldn't load» y nada más: ni el
 * mensaje, ni el fichero, ni el navegador. Con la tienda en un móvil ajeno y
 * por 4G eso no se puede depurar — de ahí esta pantalla, que enseña el error
 * tal cual para poder leerlo por teléfono o mandar una foto.
 *
 * No usa i18n, ni el layout, ni ningún componente de la app: lo que se rompe
 * aquí puede ser justo eso, y un error dentro del manejador de errores vuelve
 * a dejar la página en blanco.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const detail = [error?.name, error?.message].filter(Boolean).join(": ");

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#f4f5f7",
          color: "#1b2030",
          font: "16px/1.5 system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ maxWidth: "34rem", width: "100%" }}>
          <h1 style={{ fontSize: "1.25rem", margin: "0 0 .5rem" }}>
            Algo se ha roto en esta página
          </h1>
          <p style={{ margin: "0 0 1rem", color: "#5b6376" }}>
            Vuelve a intentarlo. Si sigue igual, manda una foto de este texto:
          </p>

          <pre
            style={{
              margin: "0 0 1rem",
              padding: "12px",
              borderRadius: "10px",
              background: "#fff",
              border: "1px solid #dfe3ea",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: "13px",
            }}
          >
            {detail || "Error sin mensaje"}
            {error?.digest ? `\n\ndigest: ${error.digest}` : ""}
            {/* El navegador importa: casi todo lo que solo falla en un móvil es
                una función que ese Safari todavía no trae. */}
            {typeof navigator !== "undefined" ? `\n\n${navigator.userAgent}` : ""}
          </pre>

          <button
            type="button"
            onClick={reset}
            style={{
              padding: "10px 18px",
              borderRadius: "999px",
              border: "none",
              background: "#1b2030",
              color: "#fff",
              fontSize: "15px",
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
