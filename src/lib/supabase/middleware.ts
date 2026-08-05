import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { checkUser } from "./auth";

/**
 * Redirigir SIN perder por el camino las cookies de sesión.
 *
 * `NextResponse.redirect()` crea una respuesta limpia: no lleva nada de lo que
 * Supabase acabara de escribir en `base`. Y si en esta misma petición tocó
 * renovar el token, ahí iba el par nuevo —Supabase ya ha dado el viejo por
 * gastado—, así que tirarlo deja al navegador con un token que ya no sirve.
 * A la siguiente petición: sesión cerrada sin motivo aparente. De ahí que
 * cualquier redirección de aquí tenga que arrastrar las cookies.
 */
function redirectPreservingSession(
  request: NextRequest,
  base: NextResponse,
  pathname: string
) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  const response = NextResponse.redirect(url);
  for (const cookie of base.cookies.getAll()) response.cookies.set(cookie);
  return response;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const auth = await checkUser(supabase);
  const { pathname } = request.nextUrl;

  /**
   * Una server action viaja como POST a la propia URL. Redirigirla desde aquí
   * no lleva a nadie a «/login»: el POST se reenvía allí, donde esa acción no
   * existe, y Next responde «Server action not found». Es decir, la acción no
   * llega a ejecutarse y el formulario se pierde sin dar ni un aviso —así se
   * evaporaban los productos recién añadidos—. Se dejan pasar: todas las
   * acciones comprueban permisos por su cuenta y devuelven un error visible.
   */
  const isServerAction = request.method === "POST" && request.headers.has("next-action");

  // /transfers 也要挡：页面里虽然自己 redirect 了，但少一条就等于少一层防线，
  // 而且未登录的人会先看到一次服务端渲染再被弹走
  const isGuarded =
    pathname === "/" ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/shop") ||
    pathname.startsWith("/transfers");

  // Solo se echa a quien de verdad no tiene sesión. Con "unavailable" la sesión
  // sigue siendo buena y solo falla la comprobación: se deja pasar y ya se
  // reintenta en la siguiente petición.
  if (auth.status === "signed-out" && isGuarded && !isServerAction) {
    return redirectPreservingSession(request, supabaseResponse, "/login");
  }

  if (auth.status === "signed-in" && pathname === "/login") {
    return redirectPreservingSession(request, supabaseResponse, "/");
  }

  return supabaseResponse;
}
