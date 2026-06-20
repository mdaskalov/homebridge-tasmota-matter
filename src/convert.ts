type ValueRange = {
  min: number;
  max: number;
};

type ValueRangeMap = {
  tasmota: ValueRange;
  matter: ValueRange;
};

export type ValueRangeKey = keyof typeof VALUE_RANGES;

const VALUE_RANGES = {
  brightness: {
    tasmota: { min: 0, max: 100 },
    matter: { min: 1, max: 254 },
  },
  colorTemperature: {
    tasmota: { min: 153, max: 500 },
    matter: { min: 147, max: 454 },
  },
  hue: {
    tasmota: { min: 0, max: 360 },
    matter: { min: 0, max: 254 },
  },
  saturation: {
    tasmota: { min: 0, max: 100 },
    matter: { min: 0, max: 254 },
  },
} as const satisfies Record<string, ValueRangeMap>;

function limitValue(value: number, range: ValueRange): number {
  return Math.min(range.max, Math.max(range.min, value));
}

function convertValue(value: number, from: ValueRange, to: ValueRange): number {
  const sourceValue = limitValue(value, from);
  const ratio = (sourceValue - from.min) / (from.max - from.min);
  return limitValue(Math.round(to.min + ratio * (to.max - to.min)), to);
}

export function matterValue(value: string, range: ValueRangeKey): number {
  return convertValue(Number(value), VALUE_RANGES[range].tasmota, VALUE_RANGES[range].matter);
}

export function tasmotaValue(value: number, range: ValueRangeKey): number {
  return convertValue(value, VALUE_RANGES[range].matter, VALUE_RANGES[range].tasmota);
}

export function miredsToHS(mireds: number): { hue: number; sat: number } {
  // 1. Clamp mireds to your hardware safety bounds and convert to Kelvin
  const clampedMireds = Math.max(147, Math.min(454, mireds));
  const kelvin = 1000000 / clampedMireds;

  // 2. Map Kelvin to RGB approximation curves (Kelvin / 100)
  const temp = kelvin / 100;
  let r = 0,
    g = 0,
    b = 0;

  // --- Calculate Red ---
  if (temp <= 66) {
    r = 255;
  } else {
    r = temp - 60;
    r = 329.698727446 * Math.pow(r, -0.1332047592);
  }

  // --- Calculate Green ---
  if (temp <= 66) {
    g = temp;
    g = 99.4708025861 * Math.log(g) - 161.1195681661;
  } else {
    g = temp - 60;
    g = 288.1221695283 * Math.pow(g, -0.0755148492);
  }

  // --- Calculate Blue ---
  if (temp >= 66) {
    b = 255;
  } else {
    if (temp <= 19) {
      b = 0;
    } else {
      b = temp - 10;
      b = 138.5177312231 * Math.log(b) - 305.0447927307;
    }
  }

  // Clamp RGB to standard 0-255 boundaries and normalize to 0-1
  r = Math.max(0, Math.min(255, r)) / 255;
  g = Math.max(0, Math.min(255, g)) / 255;
  b = Math.max(0, Math.min(255, b)) / 255;

  // 3. Convert RGB to HSB/HSV geometry
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  // --- Calculate Hue ---
  let hue = 0;
  if (delta !== 0) {
    if (max === r) {
      hue = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
      hue = 60 * ((b - r) / delta + 2);
    } else if (max === b) {
      hue = 60 * ((r - g) / delta + 4);
    }

    if (hue < 0) {
      hue += 360;
    }
  }

  // --- Calculate Saturation ---
  const sat = max === 0 ? 0 : (delta / max) * 100;

  return {
    hue: Math.round(hue), // 0 to 360
    sat: Math.round(sat), // 0 to 100
  };
}
