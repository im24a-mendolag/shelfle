import NextAuth from "next-auth";
import SteamProvider from "next-auth-steam";
import { NextRequest } from "next/server";
import { authCallbacks } from "@/lib/auth/config";

function buildAuthOptions(req: NextRequest) {
  const baseUrl =
    process.env.NEXTAUTH_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  return {
    providers: [
      SteamProvider(req, {
        clientSecret: process.env.STEAM_API_KEY!,
        callbackUrl: `${baseUrl}/api/auth/callback/steam`,
      }),
    ],
    ...authCallbacks,
  };
}

async function handler(req: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) {
  return NextAuth(req as never, context as never, buildAuthOptions(req));
}

export { handler as GET, handler as POST };
