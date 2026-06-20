import type { TasmotaCommand, TasmotaResponse } from '../tasmotaTypes';

interface DeviceSchema {
  deviceType: string;
  clusters?: {
    [cluster: string]: {
      [attribute: string]: unknown;
    };
  };
  handlers?: {
    [cluster: string]: {
      [command: string]: TasmotaCommand;
    };
  };
  updates?: {
    [cluster: string]: TasmotaResponse | TasmotaResponse[];
  };
}

export interface DevicePartsSchema extends DeviceSchema {
  id: string;
  displayName?: string;
}

export interface TasmotaDeviceSchema extends DeviceSchema {
  parts?: DevicePartsSchema[];
}
