"use client";

import { signIn, signOut, useSession } from "next-auth/react";

export default function SteamLoginButton() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return <div className="text-gray-400">Loading...</div>;
  }

  if (session) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="flex items-center gap-3">
          {session.user.image && (
            <img
              src={session.user.image}
              alt="avatar"
              className="w-10 h-10 rounded-full"
            />
          )}
          <span className="text-white font-medium">{session.user.name}</span>
        </div>
        <button
          onClick={() => signOut()}
          className="text-sm text-gray-400 hover:text-white underline"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => signIn("steam")}
      className="flex items-center gap-3 bg-[#1b2838] hover:bg-[#2a475e] text-white font-semibold px-6 py-3 rounded-lg transition-colors"
    >
      <img
        src="https://store.steampowered.com/favicon.ico"
        alt="Steam"
        className="w-5 h-5"
      />
      Sign in through Steam
    </button>
  );
}
