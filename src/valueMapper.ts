import type { Logger, ClusterStateMap, MatterAPI } from 'homebridge';
import type { DeviceConfiguration } from './tasmotaTypes';
import type { MQTTClient } from './mqttClient';

type ClusterMappers = {
  [K in keyof ClusterStateMap]?: (value: string | undefined) => void;
};

type ClusterUnmappers = {
  [K in keyof ClusterStateMap]?: (attributes: unknown) => string;
};

export class ValueMapper {
  private readonly log: Logger;
  private readonly uuid: string;
  private readonly matter: MatterAPI;

  constructor(log: Logger, config: DeviceConfiguration) {
    this.log = log;
    this.uuid = config.uuid;
    this.matter = config.matter;
  }

  async updateState<K extends keyof ClusterStateMap>(cluster: K, attributes: Partial<ClusterStateMap[K]>) {
    await this.matter.updateAccessoryState(this.uuid, cluster, attributes);
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
    onOff: (value) => {
      const onOff = (value === 'ON');
      this.updateState(this.matter.clusterNames.OnOff, { onOff });
    },
    levelControl: (value) => {
      const currentLevel = Math.round((Number(value) / 100) * 254);
      if (currentLevel !== 0) {
        this.updateState(this.matter.clusterNames.LevelControl, { currentLevel });
      }
    },
    switch: (value) => {
      this.emitGesture(value);
    },
  };

  private readonly unmappers: ClusterUnmappers = {
    levelControl: (attrs) => {
      const { level } = attrs as { level?: number };
      return String(Math.round(((level ?? 0) / 254) * 100));
    },
  };

  toMatter<K extends keyof ClusterStateMap>(value: string | undefined, cluster: string) {
    const key = cluster as K;
    const mapper = this.mappers[key];
    if (!mapper) {
      throw new Error(`No value mapper registered for cluster: ${cluster}`);
    }
    if (value !== undefined) {
      mapper(value);
    }
  }

  fromMatter(attributes: unknown, cluster: string): string | undefined {
    const unmapper = this.unmappers[cluster as keyof ClusterStateMap];
    if (unmapper) {
      return unmapper(attributes);
    }
  }
}