import { getServerSession } from "next-auth";

/** Call in Server Components / Route Handlers to get the current session. */
export async function getSession() {
  return getServerSession();
}
