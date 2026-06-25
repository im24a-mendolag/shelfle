"use client";

import { useState } from "react";
import { CopyLinkRow } from "@/components/challenge/ChallengeActions";

export function ChallengeLinkButton({ roundId }: { roundId: string }) {
  const [link, setLink] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

  if (link) return <CopyLinkRow url={link} />;

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
