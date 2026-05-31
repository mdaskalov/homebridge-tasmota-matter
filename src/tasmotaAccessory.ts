import type { Logger, MatterAPI, EndpointType, MatterAccessory } from 'homebridge';
import type { MQTTClient } from './mqttClient';
import type { Device, DeviceConfiguration, TasmotaCommand } from './tasmotaTypes';
import { DEVICE_TYPES } from './tasmotaTypes';
import { ValueMapper } from './valueMapper';

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

  static async create(log: Logger, cfg: DeviceConfiguration, retries?: number): Promise<TasmotaAccessory | undefined> {
    const retriesCount = retries ?? 0;
    try {
      cfg.serialNumber ??=
        await TasmotaAccessory.getProperty(cfg, 'STATUS 5', 'StatusNET.Mac', 'STATUS5') ?? cfg.uuid.replace(/-/g, '');
      cfg.manufacturer ??=
        await TasmotaAccessory.getProperty(cfg, 'MODULE0', 'Module.0') ?? 'Tasmota';
      cfg.model ??=
        await TasmotaAccessory.getProperty(cfg, 'Hostname') ?? 'Unknown';
      cfg.firmwareRevision ??=
        (await TasmotaAccessory.getProperty(cfg, 'STATUS 2', 'StatusFWR.Version', 'STATUS2') ?? 'Unknown').split('(')[0];
      cfg.deviceDefinition = DEVICE_TYPES[cfg.device.type];
      if (cfg.deviceDefinition !== undefined) {
        cfg.deviceType = cfg.matter.deviceTypes[cfg.deviceDefinition.deviceType];
        return new TasmotaAccessory(log, cfg);
      } else {
        log.error(`Unsupported device type: ${cfg.device.type}`);
      }
    } catch (err) {
      if (cfg.logTimeouts) {
        log.warn(`${cfg.device.name}: error configuring accessory information (${retriesCount + 1}) : ${err}`);
      }
      if (retriesCount < 2) {
        await new Promise(resolve => setTimeout(resolve, RETRY_TIMEOUT));
        return TasmotaAccessory.create(log, cfg, retriesCount + 1);
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
      const label = `${config.device.name}:${clusterName}`;
      handlers[clusterName] = {};
      configuredClusters += `${first ? '' : ', '}${clusterName}`;
      first = false;
      for (const [command, tasmotaCommand] of Object.entries(clusterCommands as object)) {
        handlers[clusterName][command] = async (args) => {
          const value = ValueMapper.fromMatter(args, clusterName);
          await this.handle(`${label}:${command}`, tasmotaCommand as TasmotaCommand, value);
        };
      }
      const udpate = clusterCommands.update;
      const topic = this.replaceTemplate(udpate.topic || '{stat}/RESULT');
      const path = this.replaceTemplate(udpate.path || '');
      this.mqtt.subscribe(topic, message => {
        const value = this.mqtt.getValueByPath(message, path);
        const matterValue = ValueMapper.toMatter(value, clusterName);
        this.matter.updateAccessoryState(this.UUID, clusterName, matterValue);
      });
    }

    this.log.debug(`${config.device.name}: Configured as ${deviceDefinition.deviceType} with ${configuredClusters} cluster(s)`);

    config.clusters ??= deviceDefinition.clusters;
    config.handlers = handlers;
  }

  private replaceTemplate(template: string, value?: string): string {
    return template.replace(/\{(.*?)\}/g, (_, key) => {
      return (key === 'value' ? value : String(this.variables[key])) ?? '';
    });
  }

  private async handle(label: string, command: TasmotaCommand, value?: string): Promise<string> {
    const [cmd, ...other] = this.replaceTemplate(command.cmd, value).split(' ');
    const message = this.replaceTemplate(other.join(' ') || '', value);
    const reqTopic = `cmnd/${this.context.topic}/${cmd}`;
    const resTopic = this.replaceTemplate(command.res?.topic || '{stat}/RESULT', value);
    const path = this.replaceTemplate(command.res?.path || cmd, value);
    try {
      let response = '';
      await this.mqtt.read(reqTopic, message, resTopic, EXEC_TIMEOUT, (message) => {
        const res = this.mqtt.getValueByPath(message, path);
        if (res === undefined) {
          const msg = `${label} :- expecting ${path}, ignored: ${message}`;
          if (this.logUnexpected === true) {
            this.log.warn(msg);
          } else {
            this.log.debug(msg);
          }
          return false; // ignore
        }
        response = res;
        if (command.res?.shared !== true) {
          return true; // consume
        }
      });
      return response;
    } catch (err) {
      throw `${label} Command "${reqTopic} ${message}: ${err}`;
    }
  }

}
