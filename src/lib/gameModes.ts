export const GAME_MODES = [
  {
    label: "Classic",
    path: "/play",
    description: "Guess by tags, year, reviews & more",
    accent: true,
  },
  {
    label: "Zoom",
    path: "/zoom",
    description: "Guess from a progressively zoomed-out image",
    accent: false,
  },
  {
    label: "Higher/Lower",
    path: "/higherlower",
    description: "Higher or lower — year or price",
    accent: false,
  },
  {
    label: "Achievement",
    path: "/achievement",
    description: "Guess the game from one of its Steam achievements",
    accent: false,
  },
  {
    label: "Description",
    path: "/description",
    description: "Guess the game from its store description",
    accent: false,
  },
  {
    label: "Playtime",
    path: "/playtime",
    description: "Guess the game from your hours played",
    accent: false,
  },
] as const;
