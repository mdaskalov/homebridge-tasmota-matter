import {
  API,
  DynamicPlatformPlugin,
  Logging,
  PlatformConfig,
  MatterAccessory,
  MatterAPI,
} from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import type { Device, DeviceConfiguration } from './tasmotaTypes';
import { TasmotaAccessory } from './tasmotaAccessory';
import { MQTTClient } from './mqttClient';

export class TasmotaMatterPlatform implements DynamicPlatformPlugin {
  private readonly configuredAccessories: Map<string, MatterAccessory<Device>> = new Map();
  private readonly matter: MatterAPI;
  private readonly mqttClient: MQTTClient;

  constructor(public readonly log: Logging, public readonly config: PlatformConfig, public readonly api: API) {
    this.log.debug('Finished initializing platform:', this.config.name || 'TasmotaMatter');

    // Check if the user has matter enabled, this means:
    if (!this.api.isMatterAvailable?.() || !this.api.isMatterEnabled?.() || !this.api.matter) {
      throw new Error('Matter is not available / enabled in Homebridge.');
    }

    this.matter = this.api.matter;
    this.mqttClient = new MQTTClient(this.log, this.config);

    this.api.on('didFinishLaunching', async () => {
      await this.discoverTasmotaDevices();
    });

    this.api.on('shutdown', () => {
      this.mqttClient.shutdown();
    });
  }

  // Required for DynamicPlatformPlugin
  configureAccessory(/* accessory: PlatformAccessory */) {
  }

  // Called when homebridge restores cached Matter accessories from disk at startup.
  configureMatterAccessory(accessory: MatterAccessory) {
    this.configuredAccessories.set(accessory.UUID, accessory as MatterAccessory<Device>);
  }

  private deviceUUID(device: Device): string {
    const identificator = `${device.topic}-${device.type}` +
      (device.index !== undefined ? `-${device.index}` : '') +
      (device.custom !== undefined ? device.custom : '');
    return this.matter.uuid.generate(identificator);
  }

  private deviceDescription(device: Device): string {
    const index = device.index === undefined ? '' : `(${device.index})`;
    return `${device.name} ${device.topic} - ${device.type} ${index}`;
  }

  private async discoverTasmotaDevices() {
    for (const device of this.config.devices ?? []) {
      const uuid = this.deviceUUID(device);
      const description = this.deviceDescription(device);
      const restoredAccessory = this.configuredAccessories.get(uuid);
      if (restoredAccessory) {
        this.configuredAccessories.delete(uuid);
      }
      const deviceConfiguration: DeviceConfiguration = {
        matter: this.matter,
        mqtt: this.mqttClient,
        uuid,
        device,
        logTimeouts: this.config.logTimeouts,
        logUnexpected: this.config.logUnexpected,
        serialNumber: restoredAccessory?.serialNumber,
        manufacturer: restoredAccessory?.manufacturer,
        model: restoredAccessory?.model,
        firmwareRevision: restoredAccessory?.firmwareRevision,
        hardwareRevision: restoredAccessory?.hardwareRevision,
        clusters: restoredAccessory?.clusters,
      };
      const accessory = await TasmotaAccessory.create(this.log, deviceConfiguration);
      if (accessory) {
        await this.matter.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.log.info(`${restoredAccessory ? 'Restored' : 'Added'} accessory: ${description}`);
      } else {
        this.log.error(`Unable to register accessory: ${description}`);
      }
    }
    for (const accessoryToRemove of this.configuredAccessories.values()) {
      await this.matter.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessoryToRemove]);
      const description = this.deviceDescription(accessoryToRemove.context);
      this.log.info(`Removed accessory: ${description}`);
    }
  }
}
