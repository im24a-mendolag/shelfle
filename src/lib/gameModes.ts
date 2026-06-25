export const GAME_MODES = [
  {
    label: "Classic",
    path: "/play",
    dbModes: ["solo", "friend"] as const,
    description: "Guess by tags, year, reviews & more",
    accent: true,
  },
  {
    label: "Zoom",
    path: "/zoom",
    dbModes: ["zoom"] as const,
    description: "Guess from a progressively zoomed-out image",
    accent: false,
  },
  {
    label: "Higher/Lower",
    path: "/higherlower",
    dbModes: ["higherlower"] as const,
    description: "Higher or lower — year or price",
    accent: false,
  },
  {
    label: "Achievement",
    path: "/achievement",
    dbModes: ["achievement"] as const,
    description: "Guess the game from one of its Steam achievements",
    accent: false,
  },
  {
    label: "Description",
    path: "/description",
    dbModes: ["description"] as const,
    description: "Guess the game from its store description",
    accent: false,
  },
  {
    label: "Playtime",
    path: "/playtime",
    dbModes: ["playtime"] as const,
    description: "Guess the game from your hours played",
    accent: false,
  },
] as const;

export const CHALLENGE_MODE_LABELS: Record<string, string> = Object.fromEntries(
  GAME_MODES.flatMap((m) => m.dbModes.map((mode) => [mode, m.label]))
);

export const CHALLENGE_MODE_PATHS: Record<string, string> = Object.fromEntries(
  GAME_MODES.flatMap((m) => m.dbModes.map((mode) => [mode, m.path]))
);
