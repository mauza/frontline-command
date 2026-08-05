// Design tokens for Frontline Command.
//
// The previous look was a cream-and-brass editorial brochure: 130 one-off hex
// literals, 23 font sizes, 13 letterspacings and no radius, shadow or motion
// anywhere. This file is the single source for all of it now.

// One breakpoint for the whole app. Previously the Landing (<850), the
// WarRoom/Lobby (<900) and the Board (<700) each picked their own, which left a
// 700-899 band where the board sat in desktop mode inside a stacked dashboard.
export const NARROW = 1100;

export const color = {
  // Surfaces, darkest to lightest.
  bgDeep: "#0B0A1A",
  bg: "#12102B",
  surface: "#1B1740",
  surface2: "#262056",
  surfaceHi: "#322A6B",
  border: "#3D3480",
  borderSoft: "#2C2662",

  // Brand + accents.
  violet: "#7C3AED",
  violetHi: "#9F6BFF",
  violetDeep: "#4C1D95",
  magenta: "#E935C1",
  cyan: "#22D3EE",
  lime: "#A3E635",
  tangerine: "#FF9F1C",
  hotPink: "#FF3D81",

  // Semantic.
  success: "#34D399",
  danger: "#FF4D5E",
  warn: "#FBBF24",

  // Text. Ratios are against `surface`.
  text: "#F4F1FF", // 13.8:1
  textSoft: "#B8B0E8", // 7.2:1
  textDim: "#8B82C4", // 4.6:1 - the floor, never go dimmer
  onAccent: "#FFFFFF",
} as const;

// Map/power identity. Brighter than the old muted set so the board reads as a
// game board, and reused for UI chrome so a power looks the same everywhere.
export const powerColor: Record<string, string> = {
  "Soviet Union": "#FF4757",
  Germany: "#94A3C4",
  "United Kingdom": "#FF9F1C",
  Japan: "#FFE14D",
  "United States": "#4ADE80",
};

export const radius = { sm: 8, md: 14, lg: 20, pill: 999 } as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const font = {
  display: "'Bricolage Grotesque Variable', 'Inter Variable', system-ui, sans-serif",
  body: "'Inter Variable', system-ui, -apple-system, sans-serif",
} as const;

// Eight steps, three weights, two letterspacings, 12px floor. Replaces 54
// distinct rendered combinations.
export const type = {
  display: {
    fontFamily: font.display,
    fontSize: 40,
    lineHeight: 44,
    fontWeight: "800",
    letterSpacing: -0.8,
  },
  h1: {
    fontFamily: font.display,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "700",
    letterSpacing: -0.45,
  },
  h2: {
    fontFamily: font.display,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "700",
    letterSpacing: -0.22,
  },
  h3: {
    fontFamily: font.display,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "600",
  },
  body: { fontFamily: font.body, fontSize: 15, lineHeight: 23, fontWeight: "400" },
  bodyEm: {
    fontFamily: font.body,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: "600",
  },
  label: {
    fontFamily: font.body,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "700",
    letterSpacing: 0.65,
  },
  micro: { fontFamily: font.body, fontSize: 12, lineHeight: 16, fontWeight: "500" },
} as const;

// Hard offset shadows: what makes game UI feel tactile rather than flat.
export const shadow = {
  button: `0 4px 0 ${color.violetDeep}, 0 8px 20px -6px rgba(124,58,237,.5)`,
  buttonHover: `0 5px 0 ${color.violetDeep}, 0 12px 26px -6px rgba(124,58,237,.6)`,
  buttonPressed: `0 0px 0 ${color.violetDeep}, 0 2px 8px -4px rgba(124,58,237,.5)`,
  card: "inset 0 1px 0 rgba(255,255,255,.07), 0 12px 32px -12px rgba(0,0,0,.7)",
  raised: "inset 0 1px 0 rgba(255,255,255,.09), 0 18px 44px -14px rgba(0,0,0,.8)",
} as const;

export const motion = {
  fast: "120ms cubic-bezier(.2,0,0,1)",
  base: "220ms cubic-bezier(.2,0,0,1)",
  slow: "400ms cubic-bezier(.2,0,0,1)",
  bounce: "420ms cubic-bezier(.34,1.56,.64,1)",
} as const;
