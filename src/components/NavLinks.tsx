"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const MODES = [
  { label: "Classic", href: "/play" },
  { label: "Zoom", href: "/zoom" },
  { label: "Higher/Lower", href: "/higherlower" },
  { label: "Library", href: "/library" },
];

export default function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1">
      {MODES.map(({ label, href }) => {
        const active = pathname === href || pathname.startsWith(href + "?");
        return (
          <Link
            key={href}
            href={href}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              active
                ? "bg-gray-800 text-white"
                : "text-gray-400 hover:text-white hover:bg-gray-800"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
