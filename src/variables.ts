import type { Device } from './tasmotaTypes';

type TemplateVariables = { [key: string]: string };

export class Variables {
  private readonly variables: TemplateVariables;

  constructor(device: Device) {
    const idxNum = Number(device.index);
    const idxValid = !isNaN(idxNum);
    this.variables = {
      deviceName: device.name,
      topic: device.topic,
      stat: 'stat/' + device.topic,
      sensor: 'tele/' + device.topic + '/SENSOR',
      idx: idxValid ? String(idxNum) : '',
      zIdx: idxValid ? String(idxNum - 1) : '',
    };
  }

  private static getByPath(obj: unknown, path: string): unknown {
    return path
      .replace(/\[(\d+)\]/g, '.$1')   // normalize [0] → .0
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

  expand(template: string, value?: string): string {
    return template.replace(/\{(.*?)\}/g, (_, key) => {
      return (key === 'value' ? value : String(this.variables[key])) ?? '';
    });
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

}