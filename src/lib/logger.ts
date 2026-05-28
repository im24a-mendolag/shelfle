import fs from "fs";
import path from "path";

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "app.log");

function write(level: "info" | "warn" | "error", message: string, meta?: unknown) {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta !== undefined ? { meta } : {}),
  });

  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, entry + "\n", "utf8");
  } catch {
    // never crash the app over a logging failure
  }

  // also mirror to console in dev
  if (process.env.NODE_ENV !== "production") {
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn(`[${level.toUpperCase()}] ${message}`, meta ?? "");
  }
}

export const log = {
  info: (message: string, meta?: unknown) => write("info", message, meta),
  warn: (message: string, meta?: unknown) => write("warn", message, meta),
  error: (message: string, meta?: unknown) => write("error", message, meta),
};
