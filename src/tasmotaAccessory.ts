import type { API, EndpointType, Logger, MatterAccessory, MatterAPI } from 'homebridge';
import type { MQTTClient } from './mqttClient';
import { DEVICE_TYPES, TasmotaDeviceDefinition, type TasmotaCommand } from './tasmotaDeviceTypes';
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
  deviceDefinition?: TasmotaDeviceDefinition;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  firmwareRevision?: string;
  hardwareRevision?: string;
  logTimeouts?: boolean;
  logUnexpected?: boolean;
};

type TemplateVariables = { [key: string]: string };

const READ_TIMEOUT = 1000;
const EXEC_TIMEOUT = 1000;
const RETRY_TIMEOUT = 30000;

export class TasmotaAccessory implements MatterAccessory<TasmotaMatterContext> {
  private readonly log: Logger;
  private readonly matter: MatterAPI;
  private readonly mqtt: MQTTClient;
  private readonly variables: TemplateVariables;

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

  private accessoryInformationRetries = 1;

  private constructor(log: Logger, context: TasmotaMatterContext, matter: MatterAPI, mqtt: MQTTClient) {
    const idxNum = Number(context.device.index);
    const idxValid = !isNaN(idxNum);
    const definition = context.deviceDefinition!;

    this.log = log;
    this.matter = matter;
    this.mqtt = mqtt;
    this.variables = {
      deviceName: context.device.name,
      topic: context.device.topic,
      stat: 'stat/' + context.device.topic,
      sensor: 'tele/' + context.device.topic + '/SENSOR',
      idx: idxValid ? String(idxNum) : '',
      zIdx: idxValid ? String(idxNum - 1) : '',
    };

    this.UUID = context.uuid;
    this.displayName = context.device.name;
    this.deviceType = matter.deviceTypes[definition.deviceType];
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
        on: async () => {
          await this.exec('on', { cmd: 'POWER{idx}', payload: 'ON' });
        },
        off: async () => {
          await this.exec('off', { cmd: 'POWER{idx}', payload: 'OFF' });
        },
      },
    };

    const topic = this.replaceTemplate('{stat}/RESULT');
    const path = this.replaceTemplate('POWER{idx}');
    this.logInfo(`Configure status-update on topic: ${topic}, path: ${path}`);
    this.mqtt.subscribe(topic, message => {
      const value = this.mqtt.getValueByPath(message, path);
      if (value !== undefined) {
        this.logInfo(`update value: ${value}`);
        const isOn = (value === 'ON');
        this.matter.updateAccessoryState(this.UUID, this.matter.clusterNames.OnOff, { onOff: isOn });
      }
    });
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
    const retriesCount = retries ?? 0;
    try {
      const matter = getMatter(api);
      const device = context.device;
      const topic = device.topic;
      const deviceDefinition = DEVICE_TYPES[device.type];
      if (deviceDefinition !== undefined) {
        context.deviceDefinition = deviceDefinition;
        context.serialNumber = await TasmotaAccessory.getProperty(mqtt, topic, 'STATUS 5', 'StatusNET.Mac', 'STATUS5');
        context.manufacturer = await TasmotaAccessory.getProperty(mqtt, topic, 'MODULE0', 'Module.0') || 'Tasmota';
        context.model = await TasmotaAccessory.getProperty(mqtt, topic, 'Hostname') || 'Unknown';
        context.firmwareRevision = await TasmotaAccessory.getProperty(mqtt, topic, 'STATUS 2', 'StatusFWR.Version', 'STATUS2') || 'Unknown';
        context.firmwareRevision = context.firmwareRevision.split('(')[0];
        return new TasmotaAccessory(log, context, matter, mqtt);
      } else {
        log.error(`Unsupported device type: ${device.type}`);
      }
    } catch (err) {
      if (context.logTimeouts) {
        log.warn(`${context.device.name}: error configuring accessory information: ${err}`);
      }
      if (retriesCount < 3) {
        await new Promise(resolve => setTimeout(resolve, RETRY_TIMEOUT));
        return TasmotaAccessory.create(api, log, context, mqtt, retriesCount + 1);
      }
    }
    log.warn(`Failed creating TasmotaAccessory ${retriesCount}`);
  }

  private async getProperty(cmd: string, path?: string, res?: string): Promise<string | undefined> {
    return await TasmotaAccessory.getProperty(this.mqtt, this.context.device.topic, cmd, path, res);
  }

  private replaceTemplate(template: string): string {
    return template.replace(/\{(.*?)\}/g, (_, key) => this.variables[key] || '');
  }

  private async exec(label: string, command: TasmotaCommand): Promise<string> {
    const split = command.cmd.split(' ');
    const cmd = this.replaceTemplate(split[0]);
    const message = command.payload || split[1] || '';
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

}
