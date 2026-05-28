import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";

/** Callbacks shared between the route handler and getServerSession calls. */
export const authCallbacks: Pick<NextAuthOptions, "callbacks" | "secret"> = {
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    jwt({ token, profile }) {
      if (profile) {
        const p = profile as Record<string, string>;
        token.steamId = p.steamid;
        token.name = p.personaname;
        token.picture = p.avatarfull;
      }
      return token as JWT;
    },
    session({ session, token }) {
      session.user.steamId = token.steamId;
      session.user.name = token.name ?? null;
      session.user.image = token.picture ?? null;
      return session;
    },
  },
};
