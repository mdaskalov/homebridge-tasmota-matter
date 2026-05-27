import {
  API,
  DynamicPlatformPlugin,
  Logging,
  PlatformConfig,
  MatterAccessory,
  MatterAPI,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { Device, TasmotaAccessory, TasmotaMatterContext } from './tasmotaAccessory';
import { MQTTClient } from './mqttClient';
import { getMatter } from './utils.js';

export class TasmotaMatterPlatform implements DynamicPlatformPlugin {
  public readonly mqttClient: MQTTClient;
  private readonly matter!: MatterAPI;
  private readonly configuredAccessories: Map<string, MatterAccessory<TasmotaMatterContext>> = new Map();

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.mqttClient = new MQTTClient(this.log, this.config);
    this.matter = getMatter(this.api);

    this.log.debug('Finished initializing platform:', this.config.name || 'TasmotaMatter');

    // Does the user have a version of Homebridge that is compatible with matter?
    if (!this.api.isMatterAvailable?.()) {
      this.log.warn('Matter is not available in this version of Homebridge. Please update Homebridge to use this plugin.');
    }

    // Check if the user has matter enabled, this means:
    if (!this.api.isMatterEnabled?.()) {
      this.log.warn('Matter is not enabled in Homebridge. Please enable Matter in the Homebridge settings to use this plugin.');
      return;
    }

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
    this.configuredAccessories.set(accessory.UUID, accessory as MatterAccessory<TasmotaMatterContext>);
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
      const restoredAccessory = this.configuredAccessories.get(uuid);
      if (restoredAccessory) {
        this.configuredAccessories.delete(uuid);
      }
      const context = restoredAccessory ? restoredAccessory.context : {
        uuid,
        device,
        logTimeouts: this.config.logTimeouts,
        logUnexpected: this.config.logUnexpected,
      };
      const accessory = await TasmotaAccessory.create(this.api, this.log, context, this.mqttClient);
      const description = this.deviceDescription(context.device);
      if (accessory) {
        await this.matter.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.log.info(`${restoredAccessory ? 'Restored' : 'Added'} accessory: ${description}`);
      } else {
        this.log.error(`Unable to register accessory: ${description}`);
      }
    }
    for (const accessoryToRemove of this.configuredAccessories.values()) {
      const description = this.deviceDescription(accessoryToRemove.context.device);
      await this.matter.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessoryToRemove]);
      this.log.info(`Removed accessory: ${description}`);
    }
  }
}
