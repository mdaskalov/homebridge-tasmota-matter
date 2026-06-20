import type { Logger, MatterAccessory, MatterAPI, ClusterStateMap, ClusterHandlerMap } from 'homebridge';
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
  uuid: string;
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

export interface DeviceDefinition {
  deviceType: string;
  clusters?: MatterAccessory<Device>['clusters'];
  handlers?: {
    [K in keyof ClusterHandlerMap]?: Partial<Record<keyof ClusterHandlerMap[K], TasmotaCommand>>;
  };
  updates?: Partial<Record<keyof ClusterStateMap, TasmotaResponse | TasmotaResponse[]>>;
}

export interface DevicePartsDefinition extends DeviceDefinition {
  id: string;
  displayName?: string;
}

export interface TasmotaDeviceDefinition extends DeviceDefinition {
  parts?: DevicePartsDefinition[];
}

export type TasmotaSensorDefinition = {
  clusters?: MatterAccessory<Device>['clusters'];
  updates?: Partial<Record<keyof ClusterStateMap, string>>;
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
        on: { cmd: 'POWER{idx} ON' },
        off: { cmd: 'POWER{idx} OFF' },
      },
    },
    updates: {
      onOff: { path: 'POWER{idx}' },
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
        on: { cmd: 'POWER{idx} ON' },
        off: { cmd: 'POWER{idx} OFF' },
      },
    },
    updates: {
      onOff: { path: 'POWER{idx}' },
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
        on: { cmd: 'POWER{idx} ON' },
        off: { cmd: 'POWER{idx} OFF' },
      },
      levelControl: {
        moveToLevelWithOnOff: { cmd: 'Dimmer{idx} {bri}' },
      },
    },
    updates: {
      onOff: { path: 'POWER{idx}' },
      levelControl: { path: 'Dimmer{idx}' },
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
        on: { cmd: 'POWER{idx} ON' },
        off: { cmd: 'POWER{idx} OFF' },
      },
      levelControl: {
        moveToLevelWithOnOff: { cmd: 'Channel{idx} {bri}' },
      },
    },
    updates: {
      onOff: { path: 'POWER{idx}' },
      levelControl: { path: 'Channel{idx}' },
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
        on: { cmd: 'POWER{idx} ON' },
        off: { cmd: 'POWER{idx} OFF' },
      },
      levelControl: {
        moveToLevelWithOnOff: { cmd: 'Dimmer{idx} {bri}' },
      },
      colorControl: {
        moveToColorTemperatureLogic: { cmd: 'CT {ct}', res: { path: 'CT' } },
        stopAllColorMovement: undefined,
      },
    },
    updates: {
      onOff: { path: 'POWER{idx}' },
      levelControl: { path: 'Dimmer{idx}' },
      colorControl: { path: 'CT' },
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
        on: { cmd: 'POWER{idx} ON' },
        off: { cmd: 'POWER{idx} OFF' },
      },
      levelControl: {
        moveToLevelWithOnOff: { cmd: 'Dimmer{idx} {bri}' },
      },
      colorControl: {
        moveToColorTemperatureLogic: { cmd: 'HSBColor {hue},{sat},{bri}', res: { path: 'HSBColor' } },
        moveToHueAndSaturationLogic: { cmd: 'HSBColor {hue},{sat},{bri}', res: { path: 'HSBColor' } },
        moveToHueLogic: { cmd: 'HSBColor1 {hue}', res: { path: 'HSBColor' } },
        moveToSaturationLogic: { cmd: 'HSBColor2 {sat}', res: { path: 'HSBColor' } },
        stopAllColorMovement: undefined,
      },
    },
    updates: {
      onOff: { path: 'POWER{idx}' },
      levelControl: { path: 'Dimmer{idx}' },
      colorControl: { path: 'HSBColor' },
    },
  },
  LIGHTBULB_B_HS_CT: {
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
        on: { cmd: 'POWER{idx} ON' },
        off: { cmd: 'POWER{idx} OFF' },
      },
      levelControl: {
        moveToLevelWithOnOff: { cmd: 'HSBColor3 {bri}', res: { path: 'HSBColor' } },
      },
      colorControl: {
        moveToColorTemperatureLogic: { cmd: 'CT {ct}', res: { path: 'CT' } },
        moveToHueAndSaturationLogic: { cmd: 'HSBColor {hue},{sat},{bri}', res: { path: 'HSBColor' } },
        moveToHueLogic: { cmd: 'HSBColor1 {hue}', res: { path: 'HSBColor' } },
        moveToSaturationLogic: { cmd: 'HSBColor2 {sat}', res: { path: 'HSBColor' } },
        stopAllColorMovement: undefined,
      },
    },
    updates: {
      onOff: { path: 'POWER{idx}' },
      levelControl: { path: 'Dimmer' },
      colorControl: [{ path: 'HSBColor' }, { path: 'CT' }],
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
    updates: {
      switch: { path: 'Button{idx}.Action' },
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
    updates: {
      switch: { path: 'POWER{idx}' },
    },
  },
  CONTACT: {
    deviceType: 'ContactSensor',
    clusters: {
      booleanState: {
        stateValue: true,
      },
    },
    updates: {
      booleanState: { path: 'Switch{idx}.Action' },
    },
  },
  VALVE: {
    deviceType: 'WaterValve',
    clusters: {
      valveConfigurationAndControl: {
        currentState: 0, //Closed
        targetState: 0, // Closed
        openDuration: null,
        defaultOpenDuration: null,
      },
    },
    handlers: {
      valveConfigurationAndControl: {
        open: { cmd: 'POWER{idx} ON', res: { shared: true } },
        close: { cmd: 'POWER{idx} OFF', res: { shared: true } },
      },
    },
    updates: {
      valveConfigurationAndControl: { path: 'POWER{idx}' },
    },
  },
  LOCK: {
    deviceType: 'DoorLock',
    clusters: {
      doorLock: {
        lockState: 2, // Unlocked
        lockType: 0, // DeadBolt
        actuatorEnabled: true,
        operatingMode: 0, // Normal
      },
    },
    handlers: {
      doorLock: {
        lockDoor: { cmd: 'POWER{idx} ON', res: { shared: true } },
        unlockDoor: { cmd: 'POWER{idx} OFF', res: { shared: true } },
      },
    },
    updates: {
      doorLock: { path: 'POWER{idx}' },
    },
  },
};

export const SENSOR_TYPES: Record<string, TasmotaSensorDefinition> = {
  TemperatureSensor: {
    clusters: {
      temperatureMeasurement: {
        measuredValue: 2200,
        minMeasuredValue: -5000,
        maxMeasuredValue: 10000,
      },
    },
    updates: {
      temperatureMeasurement: 'Temperature',
    },
  },
  HumiditySensor: {
    clusters: {
      relativeHumidityMeasurement: {
        measuredValue: 5500,
        minMeasuredValue: 0,
        maxMeasuredValue: 10000,
      },
    },
    updates: {
      relativeHumidityMeasurement: 'Humidity',
    },
  },
};
