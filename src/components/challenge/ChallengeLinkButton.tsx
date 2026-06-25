"use client";

import { useState } from "react";

export function ChallengeLinkButton({ roundId }: { roundId: string }) {
  const [link, setLink] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function create() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId }),
      });
      const d = await r.json();
      if (d.challengeId) {
        setLink(`${window.location.origin}/challenge/${d.challengeId}`);
      } else {
        setError(d.error ?? "Could not create challenge");
      }
    } catch {
      setError("Network error — try again");
    }
    setLoading(false);
  }

  async function copy() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (link) {
    return (
      <div className="flex gap-2">
        <input
          readOnly
          value={link}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-300 truncate"
        />
        <button
          onClick={copy}
          className="bg-gray-700 hover:bg-gray-600 text-white font-semibold px-4 py-2 rounded-xl transition-colors text-sm shrink-0"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={create}
        disabled={loading}
        className="w-full bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors text-base"
      >
        {loading ? "Creating…" : "Challenge a Friend"}
      </button>
      {error && <p className="text-red-400 text-xs text-center mt-1">{error}</p>}
    </div>
  );
}
