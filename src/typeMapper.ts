import type {
  Logger,
  MatterAPI,
  ClusterStateMap,
  EndpointType,
  ClusterHandlerMap as MatterClusterHandlerMap,
  MatterCommandHandler,
} from 'homebridge';
import type { DeviceConfiguration } from './tasmotaTypes';

type EndpointMappers = {
  [deviceType: string]: () => EndpointType;
};

type ClusterMappers = {
  [K in keyof ClusterStateMap]?: (value: string, partId?: string) => void;
};

type ClusterUnmappers = {
  [Cluster in keyof MatterClusterHandlerMap]?: {
    [Command in keyof MatterClusterHandlerMap[Cluster]]?: (
      attributes: MatterCommandAttributes<MatterClusterHandlerMap[Cluster][Command]>
    ) => Promise<string | undefined> | string | undefined;
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

  constructor(cfg: DeviceConfiguration) {
    this.log = cfg.log;
    this.uuid = cfg.uuid;
    this.matter = cfg.matter;
  }

  private limitValue(value: number, range: ValueRange): number {
    return Math.min(range.max, Math.max(range.min, value));
  }

  private convertValue(value: number, from: ValueRange, to: ValueRange): number {
    const sourceValue = this.limitValue(value, from);
    const ratio = (sourceValue - from.min) / (from.max - from.min);
    return this.limitValue(Math.round(to.min + ratio * (to.max - to.min)), to);
  }

  private toMatterValue(value: string, ranges: ValueRangeMap): number {
    return this.convertValue(Number(value), ranges.tasmota, ranges.matter);
  }

  private fromMatterValue(value: number, ranges: ValueRangeMap): number {
    return this.convertValue(value, ranges.matter, ranges.tasmota);
  }

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
    TemperatureSensor: () => this.matter.deviceTypes.TemperatureSensor.with(
      this.matter.deviceTypes.TemperatureSensor.requirements.server.mandatory.TemperatureMeasurement,
    ),
    HumiditySensor: () => this.matter.deviceTypes.HumiditySensor.with(
      this.matter.deviceTypes.HumiditySensor.requirements.server.mandatory.RelativeHumidityMeasurement,
    ),
  };

  private readonly mappers: ClusterMappers = {
    onOff: (value, partId?: string) => {
      const onOff = (value === 'ON');
      this.updateState(this.matter.clusterNames.OnOff, { onOff }, partId);
    },
    doorLock: (value, partId?: string) => {
      const state = value === 'ON' ? 1 : 2;
      this.updateState(this.matter.clusterNames.DoorLock, { lockState: state }, partId);
    },
    levelControl: (value, partId?: string) => {
      const currentLevel = this.toMatterValue(value, VALUE_RANGES.brightness);
      if (currentLevel !== 0) {
        this.updateState(this.matter.clusterNames.LevelControl, { currentLevel }, partId);
      }
    },
    colorControl: (value, partId?: string) => {
      const colorTemperatureMireds = this.toMatterValue(value, VALUE_RANGES.colorTemperature);
      this.updateState(this.matter.clusterNames.ColorControl, { colorTemperatureMireds }, partId);
    },
    switch: (value) => {
      this.emitGesture(value);
    },
    booleanState: (value, partId?: string) => {
      const isOpen = (value === 'ON');
      this.updateState(this.matter.clusterNames.BooleanState, { stateValue: !isOpen }, partId);
    },
    temperatureMeasurement: (value, partId?: string) => {
      const measuredValue = Math.round(Number(value) * 100);
      this.updateState(this.matter.clusterNames.TemperatureMeasurement, { measuredValue: measuredValue }, partId);
    },
    relativeHumidityMeasurement: (value, partId?: string) => {
      const measuredValue = Math.round(Number(value) * 100);
      this.updateState(this.matter.clusterNames.RelativeHumidityMeasurement, { measuredValue: measuredValue }, partId);
    },
  };

  private readonly unmappers: ClusterUnmappers = {
    levelControl: {
      moveToLevel: (attrs) => {
        return String(this.fromMatterValue(attrs.level, VALUE_RANGES.brightness));
      },
      moveToLevelWithOnOff: (attrs) => {
        return String(this.fromMatterValue(attrs.level, VALUE_RANGES.brightness));
      },
    },
    colorControl: {
      moveToColorTemperatureLogic: (attrs) => {
        return String(this.fromMatterValue(attrs.colorTemperatureMireds, VALUE_RANGES.colorTemperature));
      },
      moveToColorLogic: (attrs) => {
        const xFloat = (attrs.targetX / 65535).toFixed(4);
        const yFloat = (attrs.targetY / 65535).toFixed(4);
        return `${xFloat},${yFloat}`;
      },
      moveToHueAndSaturationLogic: async (attrs) => {
        const levelControl = await this.matter.getAccessoryState(this.uuid, this.matter.clusterNames.LevelControl);
        const hueDegrees = this.fromMatterValue(attrs.hue, VALUE_RANGES.hue);
        const saturationPercent = this.fromMatterValue(attrs.saturation, VALUE_RANGES.saturation);
        const brightnessPercent = this.fromMatterValue(levelControl?.currentLevel ?? 0, VALUE_RANGES.brightness);
        return `${hueDegrees},${saturationPercent},${brightnessPercent}`;
      },
      moveToHueLogic: async (attrs) => {
        return String(this.fromMatterValue(attrs.targetHue, VALUE_RANGES.hue));
      },
      moveToSaturationLogic: async (attrs) => {
        return String(this.fromMatterValue(attrs.targetSaturation, VALUE_RANGES.saturation));
      },
    },
  };

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

  toEndpointType(deviceType: string): EndpointType {
    const endpointMapper = this.endpointMappers[deviceType];
    if (endpointMapper) {
      return endpointMapper();
    }
    return this.matter.deviceTypes[deviceType];
  }

  toMatter(value: string | undefined, cluster: string, partId?: string) {
    const key = cluster as keyof ClusterStateMap;
    const mapper = this.mappers[key];
    if (!mapper) {
      throw new Error(`No value mapper registered for cluster: ${cluster}`);
    }
    if (value !== undefined) {
      mapper(value, partId);
    }
  }

  async fromMatter(attributes: unknown, cluster: string, command: string): Promise<string | undefined> {
    const clusterUnmappers = this.unmappers[cluster as keyof MatterClusterHandlerMap];
    const unmapper = clusterUnmappers?.[command as keyof typeof clusterUnmappers] as
      | ((attributes: unknown) => Promise<string | undefined> | string | undefined)
      | undefined;
    if (unmapper) {
      return await unmapper(attributes);
    }
  }
}
