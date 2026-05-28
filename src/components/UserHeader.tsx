"use client";

import { signOut, useSession } from "next-auth/react";

export default function UserHeader() {
  const { data: session } = useSession();
  if (!session) return null;

  return (
    <div className="flex items-center gap-3">
      {session.user.image && (
        <img
          src={session.user.image}
          alt="avatar"
          className="w-8 h-8 rounded-full object-cover"
        />
      )}
      <span className="text-sm font-medium text-white">{session.user.name}</span>
      <button
        onClick={() => signOut({ callbackUrl: "/" })}
        className="text-xs text-gray-400 hover:text-white underline"
      >
        Sign out
      </button>
    </div>
  );
}
