import type { EndpointType, MatterAccessory, MatterAPI } from 'homebridge';
import { MQTTClient } from './mqttClient';

export type Device = {
  topic: string;
  type: string;
  index?: string;
  custom?: string;
  name: string;
};

export type DeviceConfiguration = {
  matter: MatterAPI;
  mqtt: MQTTClient;
  uuid: string,
  device: Device;
  logTimeouts?: boolean;
  logUnexpected?: boolean;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  firmwareRevision?: string;
  hardwareRevision?: string;
  deviceDefinition?: TasmotaDeviceDefinition;
  deviceType?: EndpointType;
  clusters?: MatterAccessory<Device>['clusters'];
  handlers?: MatterAccessory<Device>['handlers'];
  parts?: MatterAccessory<Device>['parts'];
};

export type SplitMapping = {
  separator?: string;
  index: number;
};

export type SwapMapping = {
  from: string;
  to: string;
};

export type Mapping = SplitMapping | SwapMapping[]

export type TasmotaResponse = {
  topic?: string;
  path?: string;
  update?: boolean;
  shared?: boolean;
  mapping?: Mapping;
};

export type TasmotaCommand = {
  cmd: string;
  res?: TasmotaResponse;
};

export type TasmotaCommandDefinition = {
  set?: TasmotaCommand;
  stat?: TasmotaResponse;
};

export type TasmotaDeviceDefinition = {
  deviceType: string;
  clusters?: MatterAccessory<Device>['clusters'];
  handlers?: {
    [cluster: string]: {
      [commandName: string]: TasmotaCommandDefinition
    }
  }
};

export const DEVICE_TYPES: { [key: string]: TasmotaDeviceDefinition } = {
  SWITCH: {
    deviceType: 'OnOffSwitch',
    clusters: {
      onOff: {
        onOff: false,
      },
    },
    handlers: {
      onOff: {
        on: { set: { cmd: 'POWER{idx} ON' } },
        off: { set: { cmd: 'POWER{idx} OFF' } },
      },
    },
  },
  LIGHTBULB: {
    deviceType: 'OnOffLight',
    clusters: {
      onOff: {
        onOff: false,
      },
    },
    handlers: {
      onOff: {
        on: { set: { cmd: 'POWER{idx} ON' } },
        off: { set: { cmd: 'POWER{idx} OFF' } },
      },
    },
  },
  LIGHTBULB_B: {
    deviceType: 'DimmableLight',
    clusters: {
      onOff: {
        onOff: false,
      },
      levelControl: {
        currentLevel: 254,
        minLevel: 1,
        maxLevel: 254,
      },
    },
    handlers: {
      onOff: {
        on: { set: { cmd: 'POWER{idx} ON' } },
        off: { set: { cmd: 'POWER{idx} OFF' } },
      },
      levelControl: {
        moveToLevelWithOnOff: { set: { cmd: 'Channel{idx} {arg.level}' } },
      },
    },
  },
};
