import type { Logger, MatterAccessory, MatterAPI } from 'homebridge';
import { MQTTClient } from './mqttClient';

export type Device = {
  topic: string;
  type: string;
  index?: string;
  custom?: string;
  name: string;
};

export type DeviceConfiguration = {
  log: Logger;
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
  deviceSensors?: string;
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
  handlers?: Record<string, ClusterHandlerMap>;
};

export const DEVICE_TYPES: Record<string, TasmotaDeviceDefinition> = {
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
        minLevel: 1,
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
  LIGHTBULB_B_CH: {
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
        update: { path: 'POWER{idx}' },
        on: { cmd: 'POWER{idx} ON' },
        off: { cmd: 'POWER{idx} OFF' },
      },
      levelControl: {
        update: { path: 'Channel{idx}' },
        moveToLevel: { cmd: 'Channel{idx} {value}' },
        moveToLevelWithOnOff: { cmd: 'Channel{idx} {value}' },
      },
    },
  },
  LIGHTBULB_B_CT: {
    deviceType: 'ColorTemperatureLight',
    clusters: {
      onOff: {
        onOff: false,
      },
      levelControl: {
        currentLevel: 254,
        minLevel: 1,
        maxLevel: 254,
      },
      colorControl: {
        colorMode: 2,
        colorTemperatureMireds: 250,
        colorTempPhysicalMinMireds: 147,
        colorTempPhysicalMaxMireds: 454,
        coupleColorTempToLevelMinMireds: 147,
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
      colorControl: {
        update: { path: 'CT' },
        moveToColorTemperatureLogic: { cmd: 'CT {value}', res: { path: 'CT' } },
        stopAllColorMovement: {},
      },
    },
  },
  LIGHTBULB_B_HS: {
    deviceType: 'ExtendedColorLight',
    clusters: {
      onOff: {
        onOff: false,
      },
      levelControl: {
        currentLevel: 254,
        minLevel: 1,
        maxLevel: 254,
      },
      colorControl: {
        colorMode: 0,
        currentHue: 0,
        currentSaturation: 254,
        colorTempPhysicalMinMireds: 147,
        colorTempPhysicalMaxMireds: 454,
        colorTemperatureMireds: 250,
        coupleColorTempToLevelMinMireds: 147,
      },
    },
    handlers: {
      onOff: {
        update: { path: 'POWER{idx}' },
        on: { cmd: 'POWER{idx} ON' },
        off: { cmd: 'POWER{idx} OFF' },
      },
      levelControl: {
        update: { path: 'Channel{idx}' },
        moveToLevelWithOnOff: { cmd: 'Channel{idx} {value}' },
      },
      colorControl: {
        update: { path: 'HSBColor' },
        moveToColorTemperatureLogic: { cmd: 'HSBColor', res: { path: 'HSBColor' } },
        stopAllColorMovement: {},
      },
    },
  },
  BUTTON: {
    deviceType: 'GenericSwitch',
    clusters: {
      switch: {
        currentPosition: 0,
        numberOfPositions: 2,
      },
    },
    handlers: {
      switch: {
        update: { path: 'Button{idx}.Action' },
      },
    },
  },
  BUTTON_SW: {
    deviceType: 'GenericSwitch',
    clusters: {
      switch: {
        currentPosition: 0,
        numberOfPositions: 2,
      },
    },
    handlers: {
      switch: {
        update: { path: 'POWER{idx}' },
      },
    },
  },
  CONTACT: {
    deviceType: 'ContactSensor',
    clusters: {
      booleanState: {
        stateValue: true,
      },
    },
    handlers: {
      booleanState: {
        update: { path: 'Switch{idx}.Action' },
      },
    },
  },
  LOCK: {
    deviceType: 'DoorLock',
    clusters: {
      doorLock: {
        lockState: 2, // unlocked
        lockType: 0, // DeadBolt
        actuatorEnabled: true,
        operatingMode: 0, // Normal
      },
    },
    handlers: {
      doorLock: {
        update: { path: 'POWER{idx}' },
        lockDoor: { cmd: 'POWER{idx} ON', res: { shared: true } },
        unlockDoor: { cmd: 'POWER{idx} OFF', res: { shared: true } },
      },
    },
  },
};

export const SENSOR_TYPES: Record<string, TasmotaDeviceDefinition> = {
  Temperature: {
    deviceType: 'TemperatureSensor',
    clusters: {
      temperatureMeasurement: {
        measuredValue: 2200,
        minMeasuredValue: -5000,
        maxMeasuredValue: 10000,
      },
    },
    handlers: {
      temperatureMeasurement: {
        update: { path: 'Temperature' },
      },
    },
  },
  Humidity: {
    deviceType: 'HumiditySensor',
    clusters: {
      relativeHumidityMeasurement: {
        measuredValue: 5500,
        minMeasuredValue: 0,
        maxMeasuredValue: 10000,
      },
    },
    handlers: {
      relativeHumidityMeasurement: {
        update: { path: 'Humidity' },
      },
    },
  },
};
