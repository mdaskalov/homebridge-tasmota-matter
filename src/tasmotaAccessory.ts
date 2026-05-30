import type { Logger, MatterAPI, EndpointType, MatterAccessory } from 'homebridge';
import type { MQTTClient } from './mqttClient';
import type { Device, DeviceConfiguration, TasmotaCommandDefinition } from './tasmotaTypes';
import { DEVICE_TYPES } from './tasmotaTypes';

type TemplateVariables = { [key: string]: string };

const READ_TIMEOUT = 1000;
const EXEC_TIMEOUT = 1000;
const RETRY_TIMEOUT = 30000;

export class TasmotaAccessory implements MatterAccessory<Device> {
  private readonly log: Logger;
  private readonly matter: MatterAPI;
  private readonly mqtt: MQTTClient;
  private readonly logUnexpected?: boolean;
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
  public readonly context: Device;
  public readonly clusters?: MatterAccessory<Device>['clusters'];
  public readonly handlers?: MatterAccessory<Device>['handlers'];
  public readonly parts?: MatterAccessory<Device>['parts'];

  private constructor(log: Logger, config: DeviceConfiguration) {
    const idxNum = Number(config.device.index);
    const idxValid = !isNaN(idxNum);

    this.log = log;
    this.matter = config.matter;
    this.mqtt = config.mqtt;
    this.logUnexpected = config.logUnexpected;
    this.variables = {
      deviceName: config.device.name,
      topic: config.device.topic,
      stat: 'stat/' + config.device.topic,
      sensor: 'tele/' + config.device.topic + '/SENSOR',
      idx: idxValid ? String(idxNum) : '',
      zIdx: idxValid ? String(idxNum - 1) : '',
    };

    if (!config.deviceType) {
      throw new Error('Incorrect device type!');
    }

    this.configure(config);

    this.UUID = config.uuid;
    this.displayName = config.device.name;
    this.deviceType = config.deviceType;
    this.serialNumber = config.serialNumber ?? 'Unknown';
    this.manufacturer = config.manufacturer ?? 'Unknown';
    this.model = config.model ?? 'Unknown';
    this.firmwareRevision = config.firmwareRevision ?? 'Unknown';
    this.hardwareRevision = '1.0';
    this.context = config.device;
    this.clusters = config.clusters;
    this.handlers = config.handlers;
    this.parts = config.parts;
  }

  static async getProperty(config: DeviceConfiguration, property: string, path?: string, res?: string): Promise<string | undefined> {
    const topic = config.device.topic;
    const [cmd, ...rest] = property.split(' ');
    const payload = rest.join(' ');
    const reqTopic = `cmnd/${topic}/${cmd}`;
    const resTopic = `stat/${topic}/${res || 'RESULT'}`;
    try {
      const response = await config.mqtt.read(reqTopic, payload || '', resTopic, READ_TIMEOUT);
      return config.mqtt.getValueByPath(response, path || property);
    } catch (err) {
      throw `Error reading property ${property} from ${topic}: ${err}`;
    }
  }

  static async create(log: Logger, config: DeviceConfiguration, retries?: number): Promise<TasmotaAccessory | undefined> {
    const retriesCount = retries ?? 0;
    try {
      config.serialNumber ??=
        await TasmotaAccessory.getProperty(config, 'STATUS 5', 'StatusNET.Mac', 'STATUS5') ?? config.uuid.replace(/-/g, '');
      config.manufacturer ??=
        await TasmotaAccessory.getProperty(config, 'MODULE0', 'Module.0') ?? 'Tasmota';
      config.model ??=
        await TasmotaAccessory.getProperty(config, 'Hostname') ?? 'Unknown';
      config.firmwareRevision ??=
        (await TasmotaAccessory.getProperty(config, 'STATUS 2', 'StatusFWR.Version', 'STATUS2') ?? 'Unknown').split('(')[0];
      config.deviceDefinition = DEVICE_TYPES[config.device.type];
      if (config.deviceDefinition !== undefined) {
        config.deviceType = config.matter.deviceTypes[config.deviceDefinition.deviceType];
        return new TasmotaAccessory(log, config);
      } else {
        log.error(`Unsupported device type: ${config.device.type}`);
      }
    } catch (err) {
      if (config.logTimeouts) {
        log.warn(`${config.device.name}: error configuring accessory information (${retriesCount + 1}) : ${err}`);
      }
      if (retriesCount < 2) {
        await new Promise(resolve => setTimeout(resolve, RETRY_TIMEOUT));
        return TasmotaAccessory.create(log, config, retriesCount + 1);
      }
    }
  }

  private configure(config: DeviceConfiguration) {
    const deviceDefinition = config.deviceDefinition;
    if (!deviceDefinition) {
      throw new Error('Incorrect device definition!');
    }
    const handlers: Record<string, Record<string, (args: unknown) => Promise<void>>> = {};
    let first = true;
    let configuredClusters = '';
    for (const [clusterName, clusterCommands] of Object.entries(deviceDefinition.handlers as object)) {
      handlers[clusterName] = {};
      configuredClusters += `${first ? '' : ', '}${clusterName}`;
      first = false;
      for (const [command, tasmotaCommand] of Object.entries(clusterCommands as object)) {
        this.logWarn(`Command: ${command} :- ${JSON.stringify(tasmotaCommand)}`);
        handlers[clusterName][command] = async (args) => {
          await this.handle(command, tasmotaCommand as TasmotaCommandDefinition, args);
        };
      }
    }

    this.logInfo(`Configured as ${deviceDefinition.deviceType} with ${configuredClusters} cluster(s)`);

    const topic = this.replaceTemplate('{stat}/RESULT');
    const path = this.replaceTemplate('POWER{idx}');
    this.logDebug(`Status-updates on topic: ${topic}, path: ${path}`);
    this.mqtt.subscribe(topic, message => {
      const value = this.mqtt.getValueByPath(message, path);
      if (value !== undefined) {
        this.logInfo(`update value: ${value}`);
        const isOn = (value === 'ON');
        this.matter.updateAccessoryState(this.UUID, this.matter.clusterNames.OnOff, { onOff: isOn });
      }
    });

    config.clusters ??= deviceDefinition.clusters;
    config.handlers = handlers;
  }

  private replaceTemplate(template: string, args?: unknown): string {
    return template.replace(/\{(.*?)\}/g, (_, key) => {
      if (key.startsWith('arg.') && typeof args === 'object' && args !== null) {
        this.logWarn(`Args: ${JSON.stringify(args)}`);
        return String((args as Record<string, unknown>)[key.slice(4)] ?? '');
      }
      return String(this.variables[key] ?? '');
    });
  }

  private async handle(label: string, commandDefinition: TasmotaCommandDefinition, args: unknown): Promise<string> {
    const command = commandDefinition.set;
    if (!command) {
      return '';
    }
    const split = command.cmd.split(' ');
    const cmd = this.replaceTemplate(split[0], args);
    const message = this.replaceTemplate(split[1] || '', args);
    const reqTopic = `cmnd/${this.context.topic}/${cmd}`;
    const resTopic = this.replaceTemplate(command.res?.topic || '{stat}/RESULT', args);
    const path = this.replaceTemplate(command.res?.path || cmd, args);
    try {
      let response = '';
      this.logWarn(`sending ${message} to ${reqTopic}`);
      await this.mqtt.read(reqTopic, message, resTopic, EXEC_TIMEOUT, (message) => {
        const res = this.mqtt.getValueByPath(message, path);
        if (res === undefined) {
          const msg = `${this.context.name}:${label} expecting ${path}, ignored: ${message}`;
          if (this.logUnexpected === true) {
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
      throw `${this.context.name}:${label} Command "${reqTopic} ${message}: ${err}`;
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
