import type { Logger, MatterAPI, ClusterStateMap, EndpointType, ClusterHandlerMap, MatterCommandHandler } from 'homebridge';
import type { DeviceConfiguration } from './tasmotaTypes';
import { ValueRangeKey, tasmotaValue, matterValue, miredsToHS } from './convert';

type TemplateVariables = { [key: string]: string };

type EndpointMappers = {
  [deviceType: string]: () => EndpointType;
};

type TasmotaValueMappers = {
  [K in keyof ClusterStateMap]?: (value: string, partId?: string) => Promise<void> | void;
};

type HandlerArgs<T> = NonNullable<T> extends MatterCommandHandler<infer Attributes> ? Attributes : never;

type Unmapper<Handler> = (attributes: HandlerArgs<Handler>) => Promise<void> | void;

type MatterValueMapper = {
  [Cluster in keyof ClusterHandlerMap]?: {
    [Command in keyof ClusterHandlerMap[Cluster]]?: Unmapper<ClusterHandlerMap[Cluster][Command]>;
  };
};

export class TypeMapper {
  private readonly log: Logger;
  private readonly uuid: string;
  private readonly matter: MatterAPI;
  private readonly variables: TemplateVariables;

  private readonly endpointMappers: EndpointMappers = {
    ColorTemperatureLight: () => this.matter.deviceTypes.ColorTemperatureLight,
    ExtendedColorLight: () =>
      this.matter.deviceTypes.ExtendedColorLight.with(
        this.matter.deviceTypes.ExtendedColorLight.requirements.server.mandatory.ColorControl.with('HueSaturation'),
      ),
    GenericSwitch: () =>
      this.matter.deviceTypes.GenericSwitch.with(
        this.matter.deviceTypes.GenericSwitch.requirements.server.mandatory.Switch.with(
          'MomentarySwitch',
          'MomentarySwitchRelease',
          'MomentarySwitchLongPress',
          'MomentarySwitchMultiPress',
        ),
      ),
  };

  private readonly tasmotaValueMappers: TasmotaValueMappers = {
    onOff: async (value, partId?: string) => {
      const onOff = value === 'ON';
      await this.updateState(this.matter.clusterNames.OnOff, { onOff }, partId);
    },
    doorLock: async (value, partId?: string) => {
      const lockState = value === 'ON' ? 1 : 2;
      await this.updateState(this.matter.clusterNames.DoorLock, { lockState }, partId);
    },
    levelControl: async (value, partId?: string) => {
      const currentLevel = matterValue(value, 'brightness');
      if (currentLevel !== 0) {
        await this.updateState(this.matter.clusterNames.LevelControl, { currentLevel }, partId);
      }
    },
    colorControl: async (value, partId?: string) => {
      const parts = value.split(',').map((val) => val.trim());
      if (parts.length === 1) {
        const colorTemperatureMireds = matterValue(parts[0], 'colorTemperature');
        await this.updateState(this.matter.clusterNames.ColorControl, { colorTemperatureMireds }, partId);
      } else {
        const currentHue = matterValue(parts[0], 'hue');
        const currentSaturation = matterValue(parts[1], 'saturation');
        await this.updateState(this.matter.clusterNames.ColorControl, { currentHue, currentSaturation });
      }
    },
    switch: async (value) => {
      await this.emitGesture(value);
    },
    booleanState: async (value, partId?: string) => {
      const stateValue = value === 'ON';
      await this.updateState(this.matter.clusterNames.BooleanState, { stateValue }, partId);
    },
    temperatureMeasurement: async (value, partId?: string) => {
      const measuredValue = Math.round(Number(value) * 100);
      await this.updateState(this.matter.clusterNames.TemperatureMeasurement, { measuredValue }, partId);
    },
    relativeHumidityMeasurement: async (value, partId?: string) => {
      const measuredValue = Math.round(Number(value) * 100);
      await this.updateState(this.matter.clusterNames.RelativeHumidityMeasurement, { measuredValue }, partId);
    },
    valveConfigurationAndControl: async (value, partId?: string) => {
      const currentState = value === 'ON' ? 1 : 0;
      await this.updateState(this.matter.clusterNames.ValveConfigurationAndControl, { currentState }, partId);
    },
  };

  private readonly matterValueMappers: MatterValueMapper = {
    levelControl: {
      moveToLevel: (attrs) => {
        this.set('bri', attrs.level, 'brightness');
      },
      moveToLevelWithOnOff: (attrs) => {
        this.set('bri', attrs.level, 'brightness');
      },
    },
    colorControl: {
      moveToColorTemperatureLogic: async (attrs) => {
        this.set('ct', attrs.colorTemperatureMireds, 'colorTemperature');
        const levelControl = await this.matter.getAccessoryState(this.uuid, this.matter.clusterNames.LevelControl);
        this.set('bri', levelControl?.currentLevel ?? 0, 'brightness');
        const { hue, sat } = miredsToHS(attrs.colorTemperatureMireds);
        this.set('hue', hue);
        this.set('sat', sat);
      },
      moveToHueAndSaturationLogic: async (attrs) => {
        const levelControl = await this.matter.getAccessoryState(this.uuid, this.matter.clusterNames.LevelControl);
        this.set('hue', attrs.hue, 'hue');
        this.set('sat', attrs.saturation, 'saturation');
        this.set('bri', levelControl?.currentLevel ?? 0, 'brightness');
      },
      moveToHueLogic: (attrs) => {
        this.set('hue', attrs.targetHue, 'hue');
      },
      moveToSaturationLogic: (attrs) => {
        this.set('sat', attrs.targetSaturation, 'saturation');
      },
    },
    valveConfigurationAndControl: {
      open: (attrs) => {
        this.set('onOff', attrs.targetLevel === 1 ? 'ON' : 'OFF');
      },
      close: () => {
        this.set('onOff', 'OFF');
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

  private set(name: string, value: string | number, range?: ValueRangeKey) {
    const useConverter = range !== undefined && typeof value === 'number';
    this.variables[name] = String(useConverter ? tasmotaValue(value, range!) : value);
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
      .replace(/\[(\d+)\]/g, '.$1') // normalize [0] → .0
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
    const tasmotaMapper = this.tasmotaValueMappers[cluster];
    if (!tasmotaMapper) {
      this.log.debug(`No tasmota mapper for ${cluster}`);
    } else if (value !== undefined) {
      await tasmotaMapper(value, partId);
    }
  }

  async fromMatter(attributes: unknown, cluster: string, command: string) {
    const matterMapper = this.matterValueMappers[cluster]?.[command];
    if (matterMapper) {
      await matterMapper(attributes);
    } else {
      this.log.debug(`No matter mapper for ${cluster} / ${command}`);
    }
  }
}
