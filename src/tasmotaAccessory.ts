import type { Logger, EndpointType, MatterAccessory } from 'homebridge';
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
  private readonly mqtt: MQTTClient;
  private readonly valueMapper: ValueMapper;
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

  private constructor(log: Logger, cfg: DeviceConfiguration) {
    const idxNum = Number(cfg.device.index);
    const idxValid = !isNaN(idxNum);

    this.log = log;
    this.mqtt = cfg.mqtt;
    this.valueMapper = new ValueMapper(log, cfg);
    this.logUnexpected = cfg.logUnexpected;
    this.variables = {
      deviceName: cfg.device.name,
      topic: cfg.device.topic,
      stat: 'stat/' + cfg.device.topic,
      sensor: 'tele/' + cfg.device.topic + '/SENSOR',
      idx: idxValid ? String(idxNum) : '',
      zIdx: idxValid ? String(idxNum - 1) : '',
    };

    if (!cfg.deviceType) {
      throw new Error('Incorrect device type!');
    }

    this.configure(cfg);

    this.UUID = cfg.uuid;
    this.displayName = cfg.device.name;
    this.deviceType = cfg.deviceType;
    this.serialNumber = cfg.serialNumber ?? 'Unknown';
    this.manufacturer = cfg.manufacturer ?? 'Unknown';
    this.model = cfg.model ?? 'Unknown';
    this.firmwareRevision = cfg.firmwareRevision ?? 'Unknown';
    this.hardwareRevision = '1.0';
    this.context = cfg.device;
    this.clusters = cfg.clusters;
    this.handlers = cfg.handlers;
    this.parts = cfg.parts;
  }

  static async getProperty(cfg: DeviceConfiguration, property: string, path?: string, res?: string): Promise<string | undefined> {
    const topic = cfg.device.topic;
    const [cmd, ...rest] = property.split(' ');
    const payload = rest.join(' ');
    const reqTopic = `cmnd/${topic}/${cmd}`;
    const resTopic = `stat/${topic}/${res || 'RESULT'}`;
    try {
      const response = await cfg.mqtt.read(reqTopic, payload || '', resTopic, READ_TIMEOUT);
      return cfg.mqtt.getValueByPath(response, path || property);
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
        if (cfg.deviceDefinition.deviceType === 'GenericSwitch') {
          cfg.deviceType = cfg.matter.deviceTypes.GenericSwitch.with(
            cfg.matter.deviceTypes.GenericSwitch.requirements.SwitchServer,
          );
        } else {
          cfg.deviceType = cfg.matter.deviceTypes[cfg.deviceDefinition.deviceType];
        }
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

  private configure(cfg: DeviceConfiguration, deviceDefinition?: TasmotaDeviceDefinition) {
    deviceDefinition ??= cfg.deviceDefinition;
    if (!deviceDefinition) {
      throw new Error('Incorrect device definition!');
    }
    let configuredClusters = '';
    cfg.clusters ??= deviceDefinition.clusters;
    let first = true;
    const handlers: Record<string, Record<string, (args: unknown) => Promise<void>>> = {};
    for (const [clusterName, clusterCommands] of Object.entries(deviceDefinition.handlers as object)) {
      const clusterHandlers: Record<string, (args: unknown) => Promise<void>> = {};
      const label = `${cfg.device.name}:${clusterName}`;
      configuredClusters += `${first ? '' : ', '}${clusterName}`;
      first = false;
      for (const [command, tasmotaCommand] of Object.entries(clusterCommands as object)) {
        if (command === 'update') {
          const topic = this.replaceTemplate(tasmotaCommand.topic || '{stat}/RESULT');
          const path = this.replaceTemplate(tasmotaCommand.path || '');
          cfg.mqtt.subscribe(topic, message => {
            const value = cfg.mqtt.getValueByPath(message, path);
            this.valueMapper.toMatter(value, clusterName);
          });
        } else {
          clusterHandlers[command] = async (args) => {
            const value = this.valueMapper.fromMatter(args, clusterName);
            await this.handle(`${label}:${command}`, tasmotaCommand, value);
          };
        }
      }
      if (Object.keys(clusterHandlers).length > 0) {
        handlers[clusterName] = clusterHandlers;
      }
    }
    if (Object.keys(handlers).length > 0) {
      cfg.handlers = handlers;
    }

    this.log.debug(`${cfg.device.name}: Configured as ${deviceDefinition.deviceType} with ${configuredClusters} cluster(s)`);
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

  public toAccessory(): MatterAccessory<Device> {
    return {
      UUID: this.UUID,
      displayName: this.displayName,
      deviceType: this.deviceType,
      serialNumber: this.serialNumber,
      manufacturer: this.manufacturer,
      model: this.model,
      firmwareRevision: this.firmwareRevision,
      hardwareRevision: this.hardwareRevision,
      context: this.context,
      clusters: this.clusters,
      handlers: this.handlers,
      parts: this.parts,
    };
  }

}
