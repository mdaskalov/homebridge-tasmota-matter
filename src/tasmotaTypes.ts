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

export type TasmotaResponse = {
  topic?: string;
  path?: string;
  update?: boolean;
  shared?: boolean;
};

export type TasmotaCommand = {
  cmd: string;
  res?: TasmotaResponse;
};

export type ClusterHandlerMap = {
  update: TasmotaResponse;
  [attribute: string]: TasmotaCommand | TasmotaResponse;
};

export type TasmotaDeviceDefinition = {
  deviceType: string;
  clusters?: MatterAccessory<Device>['clusters'];
  handlers?: {
    [cluster: string]: ClusterHandlerMap
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
        update: { path: 'POWER{idx}' },
        on: { cmd: 'POWER{idx} ON' },
        off: { cmd: 'POWER{idx} OFF' },
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
        update: { path: 'POWER{idx}' },
        on: { cmd: 'POWER{idx} ON' },
        off: { cmd: 'POWER{idx} OFF' },
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
        minLevel: 0,
        maxLevel: 254,
      },
    },
    handlers: {
      onOff: {
        update: { path: 'POWER{idx}' },
        on: { cmd: 'POWER{idx} ON' },
        off: { cmd: 'POWER{idx} OFF' },
      },
      levelControl: {
        update: { path: 'Dimmer' },
        moveToLevel: { cmd: 'Dimmer {value}' },
        moveToLevelWithOnOff: { cmd: 'Dimmer {value}' },
      },
    },
  },
};
