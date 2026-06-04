import type { Metadata } from "next";
import "./globals.css";
import { getServerSession } from "next-auth";
import { authCallbacks } from "@/lib/auth/config";
import SessionProvider from "@/components/SessionProvider";
import Navbar from "@/components/Navbar";

export const metadata: Metadata = {
  title: "Shelfle",
  description: "Guess the game. Off any shelf.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authCallbacks);

  return (
    <html lang="en">
      <body className="bg-gray-950 text-white min-h-screen">
        <SessionProvider>
          <Navbar session={session} />
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
