import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next 16 renamed the `middleware` convention to `proxy`. Supabase's published
 * Next.js guide still says `middleware.ts` — this is the same logic under the
 * current convention.
 *
 * Refreshes the auth session on every matched request and redirects
 * unauthenticated traffic away from the dashboard.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getClaims() validates the JWT rather than trusting whatever the cookie
  // says. Do not swap this for getSession() — that returns unverified data.
  const { data } = await supabase.auth.getClaims();

  const isProtected = ["/dashboard", "/onboarding"].some((path) =>
    request.nextUrl.pathname.startsWith(path),
  );

  if (!data?.claims && isProtected) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // Must return this exact response object so refreshed auth cookies survive.
  return response;
}

export const config = {
  // Without a matcher the proxy runs on every request including static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
