
import type { API, EndpointType, Logger, MatterAccessory, MatterAPI } from 'homebridge';
import type { MQTTClient } from './mqttClient';
import { getMatter } from './utils.js';

export type Device = {
  topic: string;
  type: string;
  index?: string;
  custom?: string;
  name: string;
};

export type TasmotaMatterContext = {
  device: Device;
  uuid: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  firmwareRevision?: string;
  hardwareRevision?: string;
  logTimeouts?: boolean;
  logUnexpected?: boolean;
};

type TemplateVariables = { [key: string]: string };

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
  res?: TasmotaResponse;
};

const READ_TIMEOUT = 1000;
const EXEC_TIMEOUT = 1000;
const RETRY_TIMEOUT = 30000;

export class TasmotaAccessory implements MatterAccessory<TasmotaMatterContext> {
  // Required MatterAccessory properties
  public readonly UUID: string;
  public readonly displayName: string;
  public readonly deviceType: EndpointType;
  public readonly serialNumber: string;
  public readonly manufacturer: string;
  public readonly model: string;
  public readonly firmwareRevision: string;
  public readonly hardwareRevision: string;
  public readonly context: TasmotaMatterContext;
  public readonly clusters?: MatterAccessory<TasmotaMatterContext>['clusters'];
  public readonly handlers?: MatterAccessory<TasmotaMatterContext>['handlers'];
  public readonly parts?: MatterAccessory<TasmotaMatterContext>['parts'];

  private readonly api: API;
  private readonly log: Logger;
  private readonly matter: MatterAPI;
  private readonly mqtt: MQTTClient;
  private readonly variables: TemplateVariables;

  private accessoryInformationRetries = 1;

  private constructor(api: API, log: Logger, context: TasmotaMatterContext, mqtt: MQTTClient) {
    const matter = getMatter(api);

    // required
    this.UUID = context.uuid;
    this.displayName = context.device.name;
    this.deviceType = matter.deviceTypes.OnOffSwitch;
    this.serialNumber = context.serialNumber ?? 'Unknown';
    this.manufacturer = context.manufacturer ?? 'Unknown';
    this.model = context.model ?? 'Unknown';
    this.firmwareRevision = context.firmwareRevision ?? 'Unknown';
    this.hardwareRevision = '1.0';
    this.context = context;
    this.clusters = {
      onOff: {
        onOff: false,
      },
    };
    this.handlers = {
      onOff: {
        on: async () => this.handleOn(),
        off: async () => this.handleOff(),
      },
    };

    this.api = api;
    this.log = log;
    this.matter = matter;
    this.mqtt = mqtt;

    const idxNum = Number(context.device.index);
    const idxValid = !isNaN(idxNum);
    this.variables = {
      deviceName: context.device.name,
      topic: context.device.topic,
      stat: 'stat/' + context.device.topic,
      sensor: 'tele/' + context.device.topic + '/SENSOR',
      idx: idxValid ? String(idxNum) : '',
      zIdx: idxValid ? String(idxNum - 1) : '',
    };

    this.logInfo(`initialized as ${JSON.stringify(context)}.`);
  }

  static async getProperty(mqtt: MQTTClient, topic: string, cmd: string, path?: string, res?: string): Promise<string | undefined> {
    const split = cmd.split(' ');
    const reqTopic = `cmnd/${topic}/${split[0]}`;
    const resTopic = `stat/${topic}/${res || 'RESULT'}`;
    try {
      const response = await mqtt.read(reqTopic, split[1] || '', resTopic, READ_TIMEOUT);
      return mqtt.getValueByPath(response, path || cmd);
    } catch (err) {
      throw `Error reading property ${cmd} from ${topic}: ${err}`;
    }
  }

  static async create(api: API, log: Logger, context: TasmotaMatterContext, mqtt: MQTTClient, retries?: number):
    Promise<TasmotaAccessory | undefined> {
    try {
      const topic = context.device.topic;
      context.serialNumber = await TasmotaAccessory.getProperty(mqtt, topic, 'STATUS 5', 'StatusNET.Mac', 'STATUS5');
      context.manufacturer = await TasmotaAccessory.getProperty(mqtt, topic, 'MODULE0', 'Module.0') || 'Tasmota';
      context.model = await TasmotaAccessory.getProperty(mqtt, topic, 'Hostname') || 'Unknown';
      context.firmwareRevision = await TasmotaAccessory.getProperty(mqtt, topic, 'STATUS 2', 'StatusFWR.Version', 'STATUS2') || 'Unknown';
      context.firmwareRevision = context.firmwareRevision.split('(')[0];
      return new TasmotaAccessory(api, log, context, mqtt);
    } catch (err) {
      if (context.logTimeouts) {
        log.debug(`${context.device.name}: error configuring accessory information: ${err}`);
      }
      const retriesCount = retries ?? 0;
      if (retriesCount <= 3) {
        setTimeout(() => {
          return TasmotaAccessory.create(api, log, context, mqtt, retriesCount + 1);
        }, RETRY_TIMEOUT);
      }
    }
  }

  private async getProperty(cmd: string, path?: string, res?: string): Promise<string | undefined> {
    return await TasmotaAccessory.getProperty(this.mqtt, this.context.device.topic, cmd, path, res);
  }

  private replaceTemplate(template: string): string {
    return template.replace(/\{(.*?)\}/g, (_, key) => this.variables[key] || '');
  }

  private async exec(command: TasmotaCommand, label: string, payload?: string): Promise<string> {
    const split = command.cmd.split(' ');
    const cmd = this.replaceTemplate(split[0]);
    const message = payload || split[1] || '';
    const reqTopic = `cmnd/${this.context.device.topic}/${cmd}`;
    const resTopic = this.replaceTemplate(command.res?.topic || '{stat}/RESULT');
    const path = this.replaceTemplate(command.res?.path || cmd);

    try {
      let response = '';
      await this.mqtt.read(reqTopic, message, resTopic, EXEC_TIMEOUT, (message) => {
        const res = this.mqtt.getValueByPath(message, path);
        if (res === undefined) {
          const msg = `${this.context.device.name}:${label} expecting ${path}, ignored: ${message}`;
          if (this.context.logUnexpected === true) {
            this.logWarn(msg);
          } else {
            this.logDebug(msg);
          }
          return false; // ignore this message and wait
        }
        response = res;
        if (command.res?.shared !== true) {
          return true; // consume message
        }
      });
      return response;
    } catch (err) {
      throw `${this.context.device.name}:${label} Command "${reqTopic} ${message}: ${err}`;
    }
  }

  private logInfo(message: string, ...args: unknown[]): void {
    this.log.info(`${this.displayName}: ${message}`, ...args);
  }

  private logError(message: string, ...args: unknown[]): void {
    this.log.error(`${this.displayName}: ${message}`, ...args);
  }

  private logDebug(message: string, ...args: unknown[]): void {
    this.log.debug(`${this.displayName}: ${message}`, ...args);
  }

  private logWarn(message: string, ...args: unknown[]): void {
    this.log.warn(`${this.displayName}: ${message}`, ...args);
  }

  private async updateState(cluster: string, attributes: Record<string, unknown>, partId?: string): Promise<void> {
    await this.matter.updateAccessoryState(this.UUID, cluster, attributes, partId);
    this.log.debug(`[${this.displayName}] Updated ${cluster} state:`, attributes);
  }

  private async handleOn(): Promise<void> {
    this.logInfo('turning on.');
    this.exec({ cmd: 'POWER{idx}' }, 'handleOn', 'ON');
  }

  private async handleOff(): Promise<void> {
    this.logInfo('turning off.');
    this.exec({ cmd: 'POWER{idx}' }, 'handleOff', 'OFF');
  }

  public async updateOnOffState(isOn: boolean): Promise<void> {
    await this.updateState(this.matter.clusterNames.OnOff, { onOff: isOn });
  }
}
