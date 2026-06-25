"use client";

import { useState } from "react";

export function CopyLinkRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex gap-2 w-full">
      <input
        readOnly
        value={url}
        className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-300 truncate"
      />
      <button
        onClick={copy}
        className="bg-gray-700 hover:bg-gray-600 text-white font-semibold px-4 py-2.5 rounded-xl transition-colors text-sm shrink-0"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}
