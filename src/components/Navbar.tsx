import Link from "next/link";
import NavLinks from "@/components/NavLinks";
import NavUser from "@/components/NavUser";
import type { Session } from "next-auth";

type Props = { session: Session | null };

export default function Navbar({ session }: Props) {
  return (
    <header className="sticky top-0 z-30 border-b border-gray-800 bg-gray-950/90 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
        <Link
          href="/"
          className="text-lg font-bold tracking-tight text-white hover:text-gray-300 transition-colors flex-shrink-0"
        >
          Shelfle
        </Link>

        {session?.user && (
          <>
            <div className="flex-1">
              <NavLinks />
            </div>
            <NavUser
              name={session.user.name ?? ""}
              image={session.user.image}
            />
          </>
        )}
      </div>
    </header>
  );
}
