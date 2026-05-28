import NextAuth from "next-auth";
import SteamProvider from "next-auth-steam";
import { NextRequest } from "next/server";
import { authCallbacks } from "@/lib/auth/config";

function buildAuthOptions(req: NextRequest) {
  return {
    providers: [
      SteamProvider(req, {
        clientSecret: process.env.STEAM_API_KEY!,
        callbackUrl: `${process.env.NEXTAUTH_URL}/api/auth/callback/steam`,
      }),
    ],
    ...authCallbacks,
  };
}

async function handler(req: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) {
  return NextAuth(req as never, context as never, buildAuthOptions(req));
}

export { handler as GET, handler as POST };
