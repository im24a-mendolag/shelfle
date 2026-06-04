"use client";

import { signOut } from "next-auth/react";

type Props = {
  name: string;
  image: string | null | undefined;
};

export default function NavUser({ name, image }: Props) {
  return (
    <button
      onClick={() => signOut()}
      className="flex items-center gap-2 text-sm text-gray-300 hover:text-white transition-colors group"
      title="Sign out"
    >
      {image && (
        <img src={image} alt="" className="w-7 h-7 rounded-full flex-shrink-0" />
      )}
      <span className="hidden sm:inline truncate max-w-[120px]">{name}</span>
      <span className="text-gray-600 group-hover:text-gray-400 text-xs">Log out</span>
    </button>
  );
}
