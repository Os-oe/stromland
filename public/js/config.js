// Stil-Anker-Konstanten — eingefroren laut CONCEPT.md. Nicht "verbessern".

// Paletten (Himmel→Boden). Semantik: [0..3] Himmel-Gradient (Zenit→Horizont),
// [4] Licht-/Glut-Ton (Horizontlicht, Landlicht), [5] Kamm-Tint, [6] Boden/Vordergrund.
export const PALETTES = {
  dawn:  ['#1c3c6c', '#2b4d68', '#337882', '#d7aa94', '#e8c4a0', '#5a4a5c', '#2e2a3a'],
  day:   ['#a8c8dc', '#c5d8e2', '#e9eef2', '#8fae9e', '#6d8f7b', '#4a6b5a', '#33454a'],
  dusk:  ['#2A1470', '#591D76', '#932885', '#F5406D', '#FFAF36', '#3d2a4a', '#1a1230'],
  night: ['#070B34', '#141852', '#2B2F77', '#483475', '#6B4984', '#855988', '#0a0e26'],
};

export const COMPOSITION = {
  horizon: 0.65,        // 62–68 % Bildhöhe
  ridgeCount: 6,        // 5–7 Parallax-Ridgelines
  vignette: 0.13,       // 10–15 %
  grainOpacity: 0.05,   // halbiert (Review: „TV-Static erschlägt die Strichlagen")
};

// Warmes Schwarz / kein reines Weiß
export const WARM_BLACK = '#0d0b10';
export const WARM_WHITE = '#f4efe6';

// EIN gesättigter Akzent pro Szene: Amber-Glut (Preis)
export const AMBER = '#ffb03b';

// Normalisierungs-Anker (MW) für Daten→Bild
export const NORMS = {
  solar: 45000,      // Sommer-Peak DE ~40–50 GW
  wind_onshore: 40000,
  wind_offshore: 9000,
  fossil: 30000,
  biomass: 5500,
  hydro: 5000,
  pumped: 6000,
  price: [0, 250],   // €/MWh → Amber 0..1
};

// Live-Rhythmus (ms)
export const REFRESH = {
  power: 5 * 60 * 1000,
  context: 15 * 60 * 1000,
  frequency: 20 * 1000,
};

// Frequenz-Puffer läuft ~75 s hinter Echtzeit (flüssig durchanimiert)
export const FREQ_LAG_S = 75;

// Adaptives Partikel-Budget
export const PARTICLES = {
  min: 220,
  max: 1400,
  mobileMax: 650,
};
