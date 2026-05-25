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
  private readonly configuredUUIDs: string[];
  public readonly configuredAccessories: Map<string, MatterAccessory<TasmotaMatterContext>> = new Map();

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.mqttClient = new MQTTClient(this.log, this.config);
    this.matter = getMatter(this.api);
    this.configuredUUIDs = (this.config.devices ?? []).map(device => this.deviceUUID(device));

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
    if (this.configuredUUIDs.includes(accessory.UUID)) {
      const tasmotaAccessory = accessory as MatterAccessory<TasmotaMatterContext>;
      this.configuredAccessories.set(accessory.UUID, tasmotaAccessory);
      const device = tasmotaAccessory.context.device;
      if (device) {
        this.log.info('Restore cached accessory: %s (%s) - %s',
          device.name, device.topic,
          device.type + (device.index === undefined ? '' : `(${device.index})`),
        );
      }
    } else {
      this.log.info(`Removing accessory ${accessory.displayName}.`);
      void this.matter.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }

  deviceUUID(device: Device): string {
    const identificator = `${device.topic}-${device.type}` +
      (device.index !== undefined ? `-${device.index}` : '') +
      (device.custom !== undefined ? device.custom : '');
    return this.matter.uuid.generate(identificator);
  }

  private async discoverTasmotaDevices() {
    for (const device of this.config.devices ?? []) {
      const uuid = this.deviceUUID(device);
      const restored = this.configuredAccessories.get(uuid);
      if (!restored) {
        const context: TasmotaMatterContext = {
          uuid,
          device,
          logTimeouts: this.config.logTimeouts,
          logUnexpected: this.config.logUnexpected,
        };
        const description = device.type + (device.index === undefined ? '' : `(${device.index})`);
        const accessory = await TasmotaAccessory.create(this.api, this.log, context, this.mqttClient);
        if (accessory) {
          this.configuredAccessories.set(accessory.UUID, accessory);
          await this.matter.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          this.log.info(`Added accessory: ${device.name} ${device.topic} - ${description}`);
        } else {
          this.log.info(`Unable to add accessory: ${device.name} ${device.topic} - ${description}`);
        }
      }
    }
  }

}
