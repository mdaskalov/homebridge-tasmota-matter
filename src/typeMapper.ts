import type { Logger, MatterAPI, ClusterStateMap, EndpointType } from 'homebridge';
import type { DeviceConfiguration } from './tasmotaTypes';

type ClusterMappers = {
  [K in keyof ClusterStateMap]?: (value: string | undefined, partId?: string) => void;
};

type ClusterUnmappers = {
  [K in keyof ClusterStateMap]?: (attributes: unknown) => string;
};

export class TypeMapper {
  private readonly log: Logger;
  private readonly uuid: string;
  private readonly matter: MatterAPI;

  constructor(cfg: DeviceConfiguration) {
    this.log = cfg.log;
    this.uuid = cfg.uuid;
    this.matter = cfg.matter;
  }

  async updateState<K extends keyof ClusterStateMap>(cluster: K, attributes: Partial<ClusterStateMap[K]>, partId?: string) {
    await this.matter.updateAccessoryState(this.uuid, cluster, attributes, partId);
  }

  private async emitGesture(value?: string, position: number = 1, partId?: string) {
    if (value === 'SINGLE') {
      await this.matter.switch.emitGesture(this.uuid, 'singlePress', { position, partId });
    } else if (value === 'DOUBLE') {
      await this.matter.switch.emitGesture(this.uuid, 'doublePress', { position, partId });
    } else if (value === 'HOLD') {
      await this.matter.switch.emit(this.uuid, 'press', { position, partId });
    } else if (value === 'CLEAR') {
      await this.matter.switch.emit(this.uuid, 'release', { partId });
    }
  }

  private readonly mappers: ClusterMappers = {
    onOff: (value, partId?: string) => {
      const onOff = (value === 'ON');
      this.updateState(this.matter.clusterNames.OnOff, { onOff }, partId);
    },
    levelControl: (value, partId?: string) => {
      const currentLevel = Math.round((Number(value) / 100) * 254);
      if (currentLevel !== 0) {
        this.updateState(this.matter.clusterNames.LevelControl, { currentLevel }, partId);
      }
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
    levelControl: (attrs) => {
      const { level } = attrs as { level?: number };
      return String(Math.round(((level ?? 0) / 254) * 100));
    },
  };

  deviceType(deviceType: string): EndpointType {
    if (deviceType === 'GenericSwitch') {
      return this.matter.deviceTypes.GenericSwitch.with(
        this.matter.deviceTypes.GenericSwitch.requirements.server.mandatory.Switch,
      );
    } else if (deviceType === 'TemperatureSensor') {
      return this.matter.deviceTypes.TemperatureSensor.with(
        this.matter.deviceTypes.TemperatureSensor.requirements.server.mandatory.TemperatureMeasurement,
      );
    } else if (deviceType === 'HumiditySensor') {
      return this.matter.deviceTypes.HumiditySensor.with(
        this.matter.deviceTypes.HumiditySensor.requirements.server.mandatory.RelativeHumidityMeasurement,
      );
    } else {
      return this.matter.deviceTypes[deviceType];
    }
  }

  toMatter<K extends keyof ClusterStateMap>(value: string | undefined, cluster: string, partId?: string) {
    const key = cluster as K;
    const mapper = this.mappers[key];
    if (!mapper) {
      throw new Error(`No value mapper registered for cluster: ${cluster}`);
    }
    if (value !== undefined) {
      mapper(value, partId);
    }
  }

  fromMatter(attributes: unknown, cluster: string): string | undefined {
    const unmapper = this.unmappers[cluster as keyof ClusterStateMap];
    if (unmapper) {
      return unmapper(attributes);
    }
  }
}