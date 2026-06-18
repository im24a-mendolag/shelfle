"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { GAME_MODES } from "@/lib/gameModes";

type Friend = { steamId: string; displayName: string; avatarUrl: string };

function PlayDropdown({ friend }: { friend: Friend }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1 rounded transition-colors flex items-center gap-1"
      >
        Play
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden min-w-[110px]">
          {GAME_MODES.map((mode) => (
            <Link
              key={mode.label}
              href={`${mode.path}?friend=${encodeURIComponent(friend.steamId)}&friendName=${encodeURIComponent(friend.displayName)}&friendAvatar=${encodeURIComponent(friend.avatarUrl)}`}
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm text-white hover:bg-gray-700 transition-colors"
            >
              {mode.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FriendsList({ friends }: { friends: Friend[] }) {
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? friends.filter((f) =>
        f.displayName.toLowerCase().startsWith(search.trim().toLowerCase())
      )
    : friends;

  return (
    <div className="flex flex-col gap-3 h-full">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search friends…"
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
      />
      <div className="flex flex-col divide-y divide-gray-800 overflow-y-auto max-h-[480px]">
        {filtered.length === 0 ? (
          <p className="py-6 text-sm text-gray-500 text-center">No friends found.</p>
        ) : (
          filtered.map((friend) => (
            <div
              key={friend.steamId}
              className="flex items-center gap-3 px-2 py-2.5 hover:bg-gray-800 rounded transition-colors"
            >
              {friend.avatarUrl && (
                <img src={friend.avatarUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />
              )}
              <span className="flex-1 text-sm font-medium truncate min-w-0">{friend.displayName}</span>
              <div className="flex gap-1.5 flex-shrink-0">
                <PlayDropdown friend={friend} />
                <Link
                  href={`/library?friend=${encodeURIComponent(friend.steamId)}`}
                  className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-2.5 py-1 rounded transition-colors"
                >
                  Library
                </Link>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
