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
}

export type TasmotaCommand = {
  cmd: string;
  payload?: string;
  res?: TasmotaResponse;
};

export type TasmotaCommandDefinition = {
  set?: TasmotaCommand;
  stat?: TasmotaResponse;
};

export type TasmotaDeviceDefinition = {
  deviceType: string,
  clusters: {
    [cluster: string]: { [commandName: string]: TasmotaCommandDefinition }
  }
};

export const DEVICE_TYPES: { [key: string]: TasmotaDeviceDefinition } = {
  SWITCH: {
    deviceType: 'OnOffSwitch',
    clusters: {
      onOff: {
        On: { set: { cmd: 'POWER{idx}', payload: 'ON' } },
        Off: { set: { cmd: 'POWER{idx}', payload: 'OFF' } },
      },
    },
  },
};