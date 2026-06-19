import type {
  Logger,
  MatterAPI,
  ClusterStateMap,
  EndpointType,
  ClusterHandlerMap as MatterClusterHandlerMap,
  MatterCommandHandler,
} from 'homebridge';
import type { DeviceConfiguration } from './tasmotaTypes';

type TemplateVariables = { [key: string]: string };

type EndpointMappers = {
  [deviceType: string]: () => EndpointType;
};

type ClusterMappers = {
  [K in keyof ClusterStateMap]?: (value: string, partId?: string) => Promise<void> | void;
};

type ClusterUnmappers = {
  [Cluster in keyof MatterClusterHandlerMap]?: {
    [Command in keyof MatterClusterHandlerMap[Cluster]]?: (
      attributes: MatterCommandAttributes<MatterClusterHandlerMap[Cluster][Command]>
    ) => Promise<void> | void;
  };
};

type MatterCommandAttributes<T> = NonNullable<T> extends MatterCommandHandler<infer Attributes>
  ? Attributes
  : never;

type ValueRange = {
  min: number;
  max: number;
};

type ValueRangeMap = {
  tasmota: ValueRange;
  matter: ValueRange;
};

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

export class TypeMapper {
  private readonly log: Logger;
  private readonly uuid: string;
  private readonly matter: MatterAPI;
  private readonly variables: TemplateVariables;

  private readonly endpointMappers: EndpointMappers = {
    ColorTemperatureLight: () => this.matter.deviceTypes.ColorTemperatureLight,
    ExtendedColorLight: () => this.matter.deviceTypes.ExtendedColorLight.with(
      this.matter.deviceTypes.ExtendedColorLight.requirements.server.mandatory.ColorControl.with('HueSaturation'),
    ),
    GenericSwitch: () => this.matter.deviceTypes.GenericSwitch.with(
      this.matter.deviceTypes.GenericSwitch.requirements.server.mandatory.Switch.with(
        'MomentarySwitch', 'MomentarySwitchRelease', 'MomentarySwitchLongPress', 'MomentarySwitchMultiPress',
      ),
    ),
  };

  private readonly clusterMappers: ClusterMappers = {
    onOff: async (value, partId?: string) => {
      const onOff = (value === 'ON');
      await this.updateState(this.matter.clusterNames.OnOff, { onOff }, partId);
    },
    doorLock: async (value, partId?: string) => {
      const state = value === 'ON' ? 1 : 2;
      await this.updateState(this.matter.clusterNames.DoorLock, { lockState: state }, partId);
    },
    levelControl: async (value, partId?: string) => {
      const currentLevel = this.matterValue(value, VALUE_RANGES.brightness);
      if (currentLevel !== 0) {
        await this.updateState(this.matter.clusterNames.LevelControl, { currentLevel }, partId);
      }
    },
    colorControl: async (value, partId?: string) => {
      const parts = value.split(',').map(val => val.trim());
      if (parts.length === 1) {
        const colorTemperatureMireds = this.matterValue(parts[0], VALUE_RANGES.colorTemperature);
        await this.updateState(this.matter.clusterNames.ColorControl, { colorTemperatureMireds }, partId);
      } else {
        const currentHue = this.matterValue(parts[0], VALUE_RANGES.hue);
        const currentSaturation = this.matterValue(parts[1], VALUE_RANGES.saturation);
        await this.updateState(this.matter.clusterNames.ColorControl, { currentHue, currentSaturation });
      }
    },
    switch: async (value) => {
      await this.emitGesture(value);
    },
    booleanState: async (value, partId?: string) => {
      const isTrue = (value === 'ON');
      await this.updateState(this.matter.clusterNames.BooleanState, { stateValue: isTrue }, partId);
    },
    temperatureMeasurement: async (value, partId?: string) => {
      const measuredValue = Math.round(Number(value) * 100);
      await this.updateState(this.matter.clusterNames.TemperatureMeasurement, { measuredValue: measuredValue }, partId);
    },
    relativeHumidityMeasurement: async (value, partId?: string) => {
      const measuredValue = Math.round(Number(value) * 100);
      await this.updateState(this.matter.clusterNames.RelativeHumidityMeasurement, { measuredValue: measuredValue }, partId);
    },
    valveConfigurationAndControl: async (value, partId?: string) => {
      const currentState = value === 'ON' ? 1 : 0;
      await this.updateState(this.matter.clusterNames.ValveConfigurationAndControl, { currentState: currentState }, partId);
    },
  };

  private readonly clusterUnmappers: ClusterUnmappers = {
    levelControl: {
      moveToLevel: (attrs) => {
        this.setFromMatter('bri', attrs.level, VALUE_RANGES.brightness);
      },
      moveToLevelWithOnOff: (attrs) => {
        this.setFromMatter('bri', attrs.level, VALUE_RANGES.brightness);
      },
    },
    colorControl: {
      moveToColorTemperatureLogic: async (attrs) => {
        this.setFromMatter('ct', attrs.colorTemperatureMireds, VALUE_RANGES.colorTemperature);
        const levelControl = await this.matter.getAccessoryState(this.uuid, this.matter.clusterNames.LevelControl);
        this.setFromMatter('bri', levelControl?.currentLevel ?? 0, VALUE_RANGES.brightness);
        const { hue, sat } = this.miredsToHS(attrs.colorTemperatureMireds);
        this.variables['hue'] = String(hue);
        this.variables['sat'] = String(sat);
      },
      moveToHueAndSaturationLogic: async (attrs) => {
        const levelControl = await this.matter.getAccessoryState(this.uuid, this.matter.clusterNames.LevelControl);
        this.setFromMatter('hue', attrs.hue, VALUE_RANGES.hue);
        this.setFromMatter('sat', attrs.saturation, VALUE_RANGES.saturation);
        this.setFromMatter('bri', levelControl?.currentLevel ?? 0, VALUE_RANGES.brightness);
      },
      moveToHueLogic: (attrs) => {
        this.setFromMatter('hue', attrs.targetHue, VALUE_RANGES.hue);
      },
      moveToSaturationLogic: (attrs) => {
        this.setFromMatter('sat', attrs.targetSaturation, VALUE_RANGES.saturation);
      },
    },
    valveConfigurationAndControl: {
      open: (attrs) => {
        this.variables['onOff'] = attrs.targetLevel === 1 ? 'ON' : 'OFF';
      },
      close: () => {
        this.variables['onOff'] = 'OFF';
      },
    },
  };

  constructor(cfg: DeviceConfiguration) {
    this.log = cfg.log;
    this.uuid = cfg.uuid;
    this.matter = cfg.matter;
    const idxNum = Number(cfg.device.index);
    const idxValid = !isNaN(idxNum);
    this.variables = {
      deviceName: cfg.device.name,
      topic: cfg.device.topic,
      stat: 'stat/' + cfg.device.topic,
      sensor: 'tele/' + cfg.device.topic + '/SENSOR',
      idx: idxValid ? String(idxNum) : '',
      zIdx: idxValid ? String(idxNum - 1) : '',
    };
  }

  private limitValue(value: number, range: ValueRange): number {
    return Math.min(range.max, Math.max(range.min, value));
  }

  private convertValue(value: number, from: ValueRange, to: ValueRange): number {
    const sourceValue = this.limitValue(value, from);
    const ratio = (sourceValue - from.min) / (from.max - from.min);
    return this.limitValue(Math.round(to.min + ratio * (to.max - to.min)), to);
  }

  private matterValue(value: string, ranges: ValueRangeMap): number {
    return this.convertValue(Number(value), ranges.tasmota, ranges.matter);
  }

  private setFromMatter(name: string, value: number, ranges: ValueRangeMap) {
    const numValue = this.convertValue(value, ranges.matter, ranges.tasmota);
    this.variables[name] = String(numValue);
  }

  private miredsToHS(mireds: number): { hue: number; sat: number } {
    // 1. Clamp mireds to your hardware safety bounds and convert to Kelvin
    const clampedMireds = Math.max(147, Math.min(454, mireds));
    const kelvin = 1000000 / clampedMireds;

    // 2. Map Kelvin to RGB approximation curves (Kelvin / 100)
    const temp = kelvin / 100;
    let r = 0, g = 0, b = 0;

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
      hue: Math.round(hue),  // 0 to 360
      sat: Math.round(sat),  // 0 to 100
    };
  }

  private async updateState<K extends keyof ClusterStateMap>(cluster: K, attributes: Partial<ClusterStateMap[K]>, partId?: string) {
    await this.matter.updateAccessoryState(this.uuid, cluster, attributes, partId);
  }

  private async emitGesture(value?: string, position: number = 1, partId?: string) {
    if (value === 'ON') {
      await this.matter.switch.emitGesture(this.uuid, 'singlePress', { position, partId });
    } else if (value === 'OFF') {
      await this.matter.switch.emitGesture(this.uuid, 'doublePress', { position, partId });
    } else if (value === 'SINGLE') {
      await this.matter.switch.emitGesture(this.uuid, 'singlePress', { position, partId });
    } else if (value === 'DOUBLE') {
      await this.matter.switch.emitGesture(this.uuid, 'doublePress', { position, partId });
    } else if (value === 'HOLD') {
      await this.matter.switch.emit(this.uuid, 'press', { position, partId });
    } else if (value === 'CLEAR') {
      await this.matter.switch.emit(this.uuid, 'release', { partId });
    }
  }

  private static getByPath(obj: unknown, path: string): unknown {
    return path
      .replace(/\[(\d+)\]/g, '.$1')   // normalize [0] → .0
      .split('.')
      .filter(Boolean)
      .reduce((acc, key) => {
        if (acc === null || typeof acc !== 'object' || !Object.prototype.hasOwnProperty.call(acc, key)) {
          return undefined;
        }
        return (acc as Record<string, unknown>)[key];
      }, obj);
  }

  static getValueByPath(json: string, path: string): string | undefined {
    try {
      const obj = JSON.parse(json);
      const val = this.getByPath(obj, path);
      if (val === undefined || val === null) {
        return undefined;
      }
      return typeof val === 'object' ? JSON.stringify(val) : String(val);
    } catch {
      return undefined;
    }
  }

  findPath(obj: unknown, targetKey: string, path = ''): string | undefined {
    if (obj === null || typeof obj !== 'object') {
      return undefined;
    }
    for (const [key, value] of Object.entries(obj)) {
      const newPath = path ? `${path}.${key}` : key;
      if (key === targetKey) {
        return newPath;
      }
      const result = this.findPath(value, targetKey, newPath);
      if (result) {
        return result;
      }
    }
  }

  expand(template: string): string {
    return template.replace(/\{(.*?)\}/g, (_, key) => this.variables[key] || '');
  }

  toEndpointType(deviceType: string): EndpointType {
    const endpointMapper = this.endpointMappers[deviceType];
    if (endpointMapper) {
      return endpointMapper();
    }
    return this.matter.deviceTypes[deviceType];
  }

  async toMatter(value: string | undefined, cluster: string, partId?: string) {
    const mapper = this.clusterMappers[cluster];
    if (!mapper) {
      throw new Error(`No value mapper registered for cluster: ${cluster}`);
    } else if (value !== undefined) {
      await mapper(value, partId);
    }
  }

  async fromMatter(attributes: unknown, cluster: string, command: string) {
    const unmapper = this.clusterUnmappers[cluster]?.[command];
    if (unmapper) {
      await unmapper(attributes);
    }
  }
}
