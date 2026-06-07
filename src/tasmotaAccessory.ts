import type { Logger, EndpointType, MatterAccessory } from 'homebridge';
import type { MQTTClient } from './mqttClient';
import type { Device, DeviceConfiguration, TasmotaCommand } from './tasmotaTypes';
import { DEVICE_TYPES, SENSOR_TYPES } from './tasmotaTypes';
import { TypeMapper } from './typeMapper';
import { Variables } from './variables';

const READ_TIMEOUT = 1000;
const EXEC_TIMEOUT = 1000;
const RETRY_TIMEOUT = 30000;

export class TasmotaAccessory implements MatterAccessory<Device> {
  private readonly log: Logger;
  private readonly mqtt: MQTTClient;
  private readonly typeMapper: TypeMapper;
  private readonly logUnexpected?: boolean;
  private readonly variables: Variables;

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

  private constructor(cfg: DeviceConfiguration) {
    this.log = cfg.log;
    this.mqtt = cfg.mqtt;
    this.typeMapper = new TypeMapper(cfg);
    this.logUnexpected = cfg.logUnexpected;
    this.variables = new Variables(cfg.device);

    if (cfg.device.type === 'SENSOR') {
      this.configureSensors(cfg);
    } else {
      this.configure(cfg);
    }

    if (!cfg.deviceType) {
      throw new Error('Incorrect device type!');
    }

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
      return Variables.getValueByPath(response, path || property);
    } catch (err) {
      throw new Error(`Error reading property ${property} from ${topic}: ${err}`);
    }
  }

  static async create(cfg: DeviceConfiguration, retries?: number): Promise<TasmotaAccessory | undefined> {
    const retriesCount = retries ?? 0;
    try {
      cfg.serialNumber ??=
        await this.getProperty(cfg, 'STATUS 5', 'StatusNET.Mac', 'STATUS5') ?? cfg.uuid.replace(/-/g, '');
      cfg.manufacturer ??=
        await this.getProperty(cfg, 'MODULE0', 'Module.0') ?? 'Tasmota';
      cfg.model ??=
        await this.getProperty(cfg, 'Hostname') ?? 'Unknown';
      cfg.firmwareRevision ??=
        (await this.getProperty(cfg, 'STATUS 2', 'StatusFWR.Version', 'STATUS2') ?? 'Unknown').split('(')[0];
      if (cfg.device.type === 'SENSOR') {
        cfg.sensors = await this.getProperty(cfg, 'STATUS 10', 'StatusSNS', 'STATUS10');
      }
    } catch (err) {
      if (cfg.logTimeouts) {
        cfg.log.warn(`${cfg.device.name}: error configuring accessory information (${retriesCount + 1}): ${err}`);
      }
      if (retriesCount < 2) {
        await new Promise(resolve => setTimeout(resolve, RETRY_TIMEOUT));
        return this.create(cfg, retriesCount + 1);
      }
      return undefined;
    }
    try {
      return new TasmotaAccessory(cfg);
    } catch (err) {
      cfg.log.error(`Device of type ${cfg.device.type} not created: ${err}`);
    }
  }

  private configure(cfg: DeviceConfiguration) {
    const deviceDefinition = DEVICE_TYPES[cfg.device.type];
    if (!deviceDefinition) {
      throw new Error('Incorrect device definition!');
    }
    cfg.deviceType = this.typeMapper.deviceType(deviceDefinition.deviceType);
    const configuredClusters: string[] = [];
    cfg.clusters ??= deviceDefinition.clusters;
    const handlers: MatterAccessory<Device>['handlers'] = {};
    for (const [clusterName, clusterCommands] of Object.entries(deviceDefinition.handlers as object)) {
      const clusterHandlers: Record<string, (args: unknown) => Promise<void>> = {};
      const label = `${cfg.device.name}:${clusterName}`;
      configuredClusters.push(clusterName);
      for (const [command, tasmotaCommand] of Object.entries(clusterCommands as object)) {
        if (command === 'update') {
          const topic = this.variables.expand(tasmotaCommand.topic || '{stat}/RESULT');
          const path = this.variables.expand(tasmotaCommand.path || '');
          cfg.mqtt.subscribe(topic, message => {
            const value = Variables.getValueByPath(message, path);
            this.typeMapper.toMatter(value, clusterName);
          });
        } else {
          clusterHandlers[command] = async (args) => {
            const value = this.typeMapper.fromMatter(args, clusterName);
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

    this.log.debug(`${cfg.device.name}: Configured as ${deviceDefinition.deviceType} with ${configuredClusters.join(', ')} cluster(s)`);
  }

  private configureSensors(cfg: DeviceConfiguration) {
    const sensors = JSON.parse(cfg.sensors || '');
    if (sensors === undefined) {
      throw new Error('Unable to parse sensors informtaion');
    }
    const parts: MatterAccessory<Device>['parts'] = [];
    for (const [sensorType, sensorDefinition] of Object.entries(SENSOR_TYPES)) {
      const path = this.variables.findPath(sensors, sensorType);
      if (path) {
        this.log.info(`${cfg.device.name}: Added ${sensorType} sensor`);
        const partId = `${sensorType}Sensor`;
        const sensor = {
          id: partId,
          displayName: sensorType,
          deviceType: this.typeMapper.deviceType(sensorDefinition.deviceType),
          clusters: sensorDefinition.clusters!,
        };
        parts.push(sensor);
        for (const [clusterName, clusterCommands] of Object.entries(sensorDefinition.handlers as object)) {
          for (const [command, tasmotaCommand] of Object.entries(clusterCommands as object)) {
            if (command === 'update') {
              const topic = this.variables.expand(tasmotaCommand.topic || '{sensor}');
              cfg.mqtt.subscribe(topic, message => {
                const value = Variables.getValueByPath(message, path);
                this.typeMapper.toMatter(value, clusterName, partId);
              });
            }
          }
        }
      }
    }
    if (parts.length > 0) {
      cfg.deviceType = cfg.matter.deviceTypes.BridgedNode;
      cfg.parts = parts;
    } else {
      throw new Error('No sensors found');
    }
  }

  private async handle(label: string, command: TasmotaCommand, value?: string): Promise<string> {
    const [cmd, ...other] = this.variables.expand(command.cmd, value).split(' ');
    const message = this.variables.expand(other.join(' ') || '', value);
    const reqTopic = `cmnd/${this.context.topic}/${cmd}`;
    const resTopic = this.variables.expand(command.res?.topic || '{stat}/RESULT', value);
    const path = this.variables.expand(command.res?.path || cmd, value);
    try {
      let response = '';
      await this.mqtt.read(reqTopic, message, resTopic, EXEC_TIMEOUT, (message) => {
        const res = Variables.getValueByPath(message, path);
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
      throw new Error(`${label} Command "${reqTopic} ${message}: ${err}`);
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
