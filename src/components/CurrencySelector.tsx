"use client";

import { useRouter } from "next/navigation";

const CURRENCIES = [
  { code: "eur", label: "EUR €" },
  { code: "usd", label: "USD $" },
  { code: "chf", label: "CHF ₣" },
];

export default function CurrencySelector({ current }: { current: string }) {
  const router = useRouter();

  function select(code: string) {
    router.replace(`?currency=${code}`);
  }

  return (
    <div className="flex gap-1">
      {CURRENCIES.map((c) => (
        <button
          key={c.code}
          onClick={() => select(c.code)}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            current === c.code
              ? "bg-blue-600 text-white"
              : "bg-gray-800 text-gray-400 hover:text-white"
          }`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
