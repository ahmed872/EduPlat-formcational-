import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Proxy runs on the Node.js runtime (Next 16 default), so it uses the full
// auth instance: its session callback re-checks the account in the database
// (blocked, or signed out by a password reset/change). Protected pages
// whose layout does that check are otherwise reachable by a client-side
// navigation, which re-renders only the page segment, not the layout, and
// many pages rely on the layout for their auth check.
const ROLE_PREFIXES: Record<string, string | null> = {
  "/teacher": "TEACHER_ADMIN",
  "/parent": "PARENT",
  "/student": "STUDENT",
  "/account": null, // any signed-in role
};

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const matchedPrefix = Object.keys(ROLE_PREFIXES).find(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!matchedPrefix) return NextResponse.next();

  const session = req.auth;
  if (!session?.user) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const requiredRole = ROLE_PREFIXES[matchedPrefix];
  if (requiredRole && session.user.role !== requiredRole) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }

  return NextResponse.next();
});

// Next 16 buffers the body of every request that passes through proxy,
// capped at 10 MB (experimental.proxyClientMaxBodySize), which truncated
// video, short and attachment uploads. So Server Action requests (the
// `next-action` header) to the two upload pages, /teacher/courses/<id> and
// /teacher/shorts, skip proxy; everything else under the prefixes still
// passes here. The header is client-controlled, so a skipped request can
// also be a page render: both pages check the session themselves before
// reading data, and every Server Action authenticates itself. Keep this
// exception to those two pages.
export const config = {
  matcher: [
    { source: "/teacher" },
    { source: "/teacher/:path*", missing: [{ type: "header", key: "next-action" }] },
    {
      source: "/teacher/:path((?!courses/[^/]+$|shorts$).*)",
      has: [{ type: "header", key: "next-action" }],
    },
    { source: "/parent/:path*" },
    { source: "/student/:path*" },
    { source: "/account/:path*" },
  ],
};
