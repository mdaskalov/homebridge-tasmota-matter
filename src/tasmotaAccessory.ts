import type { Logger, EndpointType, MatterAccessory } from 'homebridge';
import type { MQTTClient } from './mqttClient';
import type { Device, DeviceConfiguration, TasmotaCommand, TasmotaResponse, DeviceDefinition } from './tasmotaTypes';
import { DEVICE_TYPES, SENSOR_TYPES } from './tasmotaTypes';
import { TypeMapper } from './typeMapper';

const READ_TIMEOUT = 1000;
const EXEC_TIMEOUT = 1000;
const RETRY_TIMEOUT = 30000;

interface AccessoryConfig {
  displayName: string;
  deviceType: EndpointType;
  context: Device;
  clusters: MatterAccessory<Device>['clusters'];
  handlers: MatterAccessory<Device>['handlers'];
  parts: MatterAccessory<Device>['parts'];
}

type UpdateHandler = {
  cluster: string;
  res: TasmotaResponse;
};

export class TasmotaAccessory implements MatterAccessory<Device> {
  private readonly log: Logger;
  private readonly mqtt: MQTTClient;
  private readonly typeMapper: TypeMapper;
  private readonly logUnexpected?: boolean;

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

    const accessoryConfig = this.configure(cfg);

    this.UUID = cfg.uuid;
    this.displayName = accessoryConfig.displayName;
    this.deviceType = accessoryConfig.deviceType;
    this.serialNumber = cfg.serialNumber ?? 'Unknown';
    this.manufacturer = cfg.manufacturer ?? 'Unknown';
    this.model = cfg.model ?? 'Unknown';
    this.firmwareRevision = cfg.firmwareRevision ?? 'Unknown';
    this.hardwareRevision = '1.0';
    this.context = accessoryConfig.context;
    this.clusters = accessoryConfig.clusters;
    this.handlers = accessoryConfig.handlers;
    this.parts = accessoryConfig.parts;
  }

  static async getProperty(cfg: DeviceConfiguration, property: string, path?: string, res?: string): Promise<string | undefined> {
    const topic = cfg.device.topic;
    const [cmd, ...rest] = property.split(' ');
    const payload = rest.join(' ');
    const reqTopic = `cmnd/${topic}/${cmd}`;
    const resTopic = `stat/${topic}/${res || 'RESULT'}`;
    try {
      const response = await cfg.mqtt.read(reqTopic, payload || '', resTopic, READ_TIMEOUT);
      return TypeMapper.getValueByPath(response, path || property);
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
        cfg.deviceSensors = await this.getProperty(cfg, 'STATUS 10', 'StatusSNS', 'STATUS10');
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

  private configureHandlers(cfg: DeviceConfiguration, device: DeviceDefinition): MatterAccessory<Device>['handlers'] | undefined {
    const handlers: MatterAccessory<Device>['handlers'] = {};
    for (const [clusterName, clusterHandlerMap] of Object.entries(device.handlers ?? {})) {
      const clusterHandlers: Record<string, (args: unknown) => Promise<void>> = {};
      for (const [command, tasmotaCommand] of Object.entries(clusterHandlerMap)) {
        clusterHandlers[command] = async (args) => {
          if (tasmotaCommand !== undefined) {
            await this.typeMapper.fromMatter(args, clusterName, command);
            await this.handle(`${cfg.device.name}:${clusterName}:${command}`, tasmotaCommand);
          }
        };
      }
      if (Object.keys(clusterHandlers).length > 0) {
        handlers[clusterName] = clusterHandlers;
      }
    }
    return Object.keys(handlers).length > 0 ? handlers : undefined;
  }

  private configureUpdateHandlers(cfg: DeviceConfiguration, handlers: UpdateHandler[], partId?: string) {
    for (const handler of handlers) {
      cfg.mqtt.subscribe(this.typeMapper.expand(handler.res.topic || '{stat}/RESULT'), message => {
        const value = TypeMapper.getValueByPath(message, this.typeMapper.expand(handler.res.path || ''));
        this.typeMapper.toMatter(value, handler.cluster, partId);
      });
    }
  }

  private configureUpdates(cfg: DeviceConfiguration, device: DeviceDefinition, partId?: string) {
    const handlers: UpdateHandler[] = [];
    for (const [cluster, tasmotaResponse] of Object.entries(device.updates ?? {})) {
      if (Array.isArray(tasmotaResponse)) {
        tasmotaResponse.forEach(response => {
          handlers.push({ cluster, res: response });
        });
      } else if (tasmotaResponse !== undefined) {
        handlers.push({ cluster, res: tasmotaResponse });
      }
    }
    this.configureUpdateHandlers(cfg, handlers, partId);
  }

  private configure(cfg: DeviceConfiguration): AccessoryConfig {
    const device = DEVICE_TYPES[cfg.device.type];
    if (device) {
      if (Array.isArray(device.parts) && device.parts.length > 0) {
        const parts: MatterAccessory<Device>['parts'] = [];
        device.parts.forEach((partDef, index) => {
          const partID = partDef.id;
          const part = {
            id: partID,
            displayName: partDef.displayName || `${cfg.device.name}-part${index + 1}`,
            deviceType: this.typeMapper.toEndpointType(partDef.deviceType),
            clusters: partDef.clusters!,
            handlers: this.configureHandlers(cfg, partDef),
          };
          this.configureUpdates(cfg, partDef, partID);
          parts.push(part);
        });
        return {
          displayName: cfg.device.name,
          deviceType: cfg.matter.deviceTypes.BridgedNode,
          context: cfg.device,
          clusters: undefined,
          handlers: undefined,
          parts: parts,
        };
      } else {
        this.configureUpdates(cfg, device);
        return {
          displayName: cfg.device.name,
          deviceType: this.typeMapper.toEndpointType(device.deviceType),
          context: cfg.device,
          clusters: device.clusters,
          handlers: this.configureHandlers(cfg, device),
          parts: undefined,
        };
      }
    } else if (cfg.device.type === 'SENSOR') {
      const parts: MatterAccessory<Device>['parts'] = [];
      const deviceSensors = JSON.parse(cfg.deviceSensors || '');
      if (deviceSensors !== undefined) {
        for (const [deviceType, sensorDefinition] of Object.entries(SENSOR_TYPES)) {
          const partId = `${deviceType}Part`;
          const handlers: UpdateHandler[] = [];
          for (const [cluster, updatePath] of Object.entries(sensorDefinition.updates ?? {})) {
            const path = this.typeMapper.findPath(deviceSensors, updatePath);
            if (path) {
              handlers.push({ cluster, res: { topic: '{sensor}', path } });
            }
          }
          if (handlers.length > 0) {
            this.configureUpdateHandlers(cfg, handlers, partId);
            parts.push({
              id: partId,
              displayName: deviceType,
              deviceType: this.typeMapper.toEndpointType(deviceType),
              clusters: sensorDefinition.clusters!,
            });
          }
        }
      }
      if (parts.length === 0) {
        throw new Error('Unable to autodetect sensors informtaion');
      }
      return {
        displayName: cfg.device.name,
        deviceType: cfg.matter.deviceTypes.BridgedNode,
        context: cfg.device,
        clusters: undefined,
        handlers: undefined,
        parts: parts,
      };
    }

    throw new Error('Incorrect device definition!');
  }

  private async handle(label: string, command: TasmotaCommand): Promise<string> {
    const [cmd, ...other] = this.typeMapper.expand(command.cmd).split(' ');
    const message = this.typeMapper.expand(other.join(' ') || '');
    const reqTopic = `cmnd/${this.context.topic}/${cmd}`;
    const resTopic = this.typeMapper.expand(command.res?.topic || '{stat}/RESULT');
    const path = this.typeMapper.expand(command.res?.path || cmd);
    try {
      let response = '';
      await this.mqtt.read(reqTopic, message, resTopic, EXEC_TIMEOUT, (message) => {
        const res = TypeMapper.getValueByPath(message, path);
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
