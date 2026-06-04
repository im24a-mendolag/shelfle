"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function FriendLibraryInput({ mode = "both" }: { mode?: "play" | "view" | "both" }) {
  const [input, setInput] = useState("");
  const router = useRouter();

  function viewLibrary() {
    if (!input.trim()) return;
    router.push(`/library?friend=${encodeURIComponent(input.trim())}`);
  }

  function playAgainst() {
    if (!input.trim()) return;
    router.push(`/play?friend=${encodeURIComponent(input.trim())}`);
  }

  const primaryAction = mode === "view" ? viewLibrary : playAgainst;

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && primaryAction()}
        placeholder="Steam ID, URL, or vanity name"
        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
      />
      <div className="flex gap-2">
        {(mode === "both" || mode === "view") && (
          <button
            onClick={viewLibrary}
            disabled={!input.trim()}
            className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium py-2 rounded-lg transition-colors"
          >
            View Library
          </button>
        )}
        {(mode === "both" || mode === "play") && (
          <button
            onClick={playAgainst}
            disabled={!input.trim()}
            className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium py-2 rounded-lg transition-colors"
          >
            Play
          </button>
        )}
      </div>
    </div>
  );
}
