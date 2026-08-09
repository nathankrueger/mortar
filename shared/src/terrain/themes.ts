// Visual themes rolled per match seed. Purely cosmetic — the sim never reads these.

export type WeatherKind = 'clear' | 'rain' | 'snow';

export interface TerrainTheme {
  id: string;
  name: string;
  weather: WeatherKind;
  /** Sky gradient, top → horizon. */
  skyTop: number;
  skyMid: number;
  skyHorizon: number;
  sunColor: number;
  /** 0..1 horizontal position of the sun/moon. */
  sunX: number;
  /** 0..1 vertical position (fraction of screen height). */
  sunY: number;
  moon: boolean;
  cloudTint: number;
  cloudAlpha: number;
  /** Terrain strata, surface → deep. */
  grass: number;
  soilTop: number;
  soilDeep: number;
  /** Ambient DOM/UI accent for this theme. */
  accent: number;
}

export const THEMES: readonly TerrainTheme[] = [
  {
    id: 'daybreak',
    name: 'Daybreak',
    weather: 'clear',
    skyTop: 0x7ab3e8,
    skyMid: 0xa8cdf0,
    skyHorizon: 0xe8f2f7,
    sunColor: 0xfff3c9,
    sunX: 0.74,
    sunY: 0.24,
    moon: false,
    cloudTint: 0xffffff,
    cloudAlpha: 0.9,
    grass: 0x7cb46a,
    soilTop: 0x8a6f4d,
    soilDeep: 0x4c3a28,
    accent: 0x4f9cf9,
  },
  {
    id: 'dusk',
    name: 'Golden Dusk',
    weather: 'clear',
    skyTop: 0x35406e,
    skyMid: 0xb96a8c,
    skyHorizon: 0xf6b57a,
    sunColor: 0xffd9a0,
    sunX: 0.22,
    sunY: 0.38,
    moon: false,
    cloudTint: 0xf3c9d6,
    cloudAlpha: 0.85,
    grass: 0x9a8a52,
    soilTop: 0x7d5b41,
    soilDeep: 0x3d2c22,
    accent: 0xff9e6d,
  },
  {
    id: 'overcast',
    name: 'Overcast',
    weather: 'rain',
    skyTop: 0x54626f,
    skyMid: 0x76858f,
    skyHorizon: 0xa5b1b8,
    sunColor: 0xd8dee2,
    sunX: 0.6,
    sunY: 0.2,
    moon: false,
    cloudTint: 0x9aa6ad,
    cloudAlpha: 0.95,
    grass: 0x5e7f5a,
    soilTop: 0x6b5d4c,
    soilDeep: 0x37302a,
    accent: 0x8fb7d1,
  },
  {
    id: 'winter',
    name: 'Winterfield',
    weather: 'snow',
    skyTop: 0x9db4c9,
    skyMid: 0xc3d3e0,
    skyHorizon: 0xeef3f7,
    sunColor: 0xfdfdf4,
    sunX: 0.68,
    sunY: 0.22,
    moon: false,
    cloudTint: 0xe7eef4,
    cloudAlpha: 0.95,
    grass: 0xe9f1f4,
    soilTop: 0x8d867c,
    soilDeep: 0x4a453f,
    accent: 0xa8c6e8,
  },
  {
    id: 'midnight',
    name: 'Midnight',
    weather: 'clear',
    skyTop: 0x0c1330,
    skyMid: 0x1b2a52,
    skyHorizon: 0x3c4f7d,
    sunColor: 0xe8ecf5,
    sunX: 0.78,
    sunY: 0.2,
    moon: true,
    cloudTint: 0x33415f,
    cloudAlpha: 0.7,
    grass: 0x40597a,
    soilTop: 0x3a3f52,
    soilDeep: 0x181b26,
    accent: 0x7f9fe8,
  },
];

export function themeFor(index: number): TerrainTheme {
  return THEMES[((index % THEMES.length) + THEMES.length) % THEMES.length];
}

/** 0xRRGGBB → "#rrggbb" for canvas2d contexts. */
export function cssColor(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}
