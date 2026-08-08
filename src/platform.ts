import { API, DynamicPlatformPlugin, Logging, PlatformConfig, MatterAccessory, MatterAPI } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import type { Device, DeviceConfiguration } from './tasmotaTypes';
import { TasmotaAccessory } from './tasmotaAccessory';
import { MQTTClient } from './mqttClient';

export class TasmotaMatterPlatform implements DynamicPlatformPlugin {
  private readonly configuredAccessories = new Map<string, MatterAccessory<Device>>();
  private readonly activeAccessories = new Map<string, TasmotaAccessory>();
  private readonly matter: MatterAPI;
  private readonly mqttClient: MQTTClient;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name || 'TasmotaMatter');

    // Check if the user has matter enabled, this means:
    if (!this.api.isMatterAvailable?.() || !this.api.isMatterEnabled?.() || !this.api.matter) {
      throw new Error('Matter is not available / enabled in Homebridge.');
    }

    this.matter = this.api.matter;
    this.mqttClient = new MQTTClient(this.log, this.config);

    this.api.on('didFinishLaunching', async () => await this.discoverTasmotaDevices());
    this.api.on('shutdown', () => this.mqttClient.shutdown());
  }

  // Required for DynamicPlatformPlugin
  configureAccessory(/* accessory: PlatformAccessory */) {}

  // Called when homebridge restores cached Matter accessories from disk at startup.
  configureMatterAccessory(accessory: MatterAccessory) {
    this.configuredAccessories.set(accessory.UUID, accessory as MatterAccessory<Device>);
  }

  private deviceUUID(device: Device): string {
    const identifier =
      `${device.topic}-${device.type}` +
      (device.index !== undefined ? `-${device.index}` : '') +
      (device.custom !== undefined ? device.custom : '');
    return this.matter.uuid.generate(identifier);
  }

  private deviceDescription(device: Device): string {
    const index = device.index === undefined ? '' : `(${device.index})`;
    return `${device.name} (${device.topic}) - ${device.type} ${index}`;
  }

  private deviceConfiguration(device: Device, restoredAccessory?: MatterAccessory<Device>): DeviceConfiguration {
    return {
      log: this.log,
      matter: this.matter,
      mqtt: this.mqttClient,
      uuid: this.deviceUUID(device),
      device,
      logTimeouts: this.config.logTimeouts,
      logUnexpected: this.config.logUnexpected,
      serialNumber: restoredAccessory?.serialNumber,
      manufacturer: restoredAccessory?.manufacturer,
      model: restoredAccessory?.model,
      firmwareRevision: restoredAccessory?.firmwareRevision,
      hardwareRevision: restoredAccessory?.hardwareRevision,
      deviceSensors: restoredAccessory?.context?.deviceSensors,
    };
  }

  private async register(uuid: string, instance: TasmotaAccessory, restored: boolean, description: string) {
    this.activeAccessories.set(uuid, instance);
    await this.matter.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [instance.toAccessory()]);
    this.log.info(`${restored ? 'Restored' : 'Added'} accessory: ${description}`);
  }

  private async discoverTasmotaDevices() {
    const deferredSensors: Array<{ cfg: DeviceConfiguration; restored: boolean; description: string }> = [];
    for (const device of this.config.devices ?? []) {
      const uuid = this.deviceUUID(device);
      const description = this.deviceDescription(device);
      const restoredAccessory = this.configuredAccessories.get(uuid);
      if (restoredAccessory) {
        this.configuredAccessories.delete(uuid);
      }
      const cfg = this.deviceConfiguration(device, restoredAccessory);
      if (device.type === 'SENSOR' && cfg.deviceSensors === undefined) {
        deferredSensors.push({ cfg, restored: restoredAccessory !== undefined, description });
        continue;
      }
      const instance = await TasmotaAccessory.create(cfg);
      if (instance) {
        await this.register(uuid, instance, restoredAccessory !== undefined, description);
      } else {
        this.log.error(`Unable to register accessory: ${description}`);
      }
    }
    for (const accessoryToRemove of this.configuredAccessories.values()) {
      this.activeAccessories.delete(accessoryToRemove.UUID);
      await this.matter.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessoryToRemove]);
      const description = this.deviceDescription(accessoryToRemove.context);
      this.log.info(`Removed accessory: ${description}`);
    }
    void this.registerDeferredSensors(deferredSensors).then(() => this.refreshDeviceInfo());
  }

  private async registerDeferredSensors(deferred: Array<{ cfg: DeviceConfiguration; restored: boolean; description: string }>) {
    await Promise.all(
      deferred.map(async ({ cfg, restored, description }) => {
        const instance = await TasmotaAccessory.create(cfg);
        if (instance) {
          await this.register(cfg.uuid, instance, restored, description);
        } else {
          this.log.error(`Unable to register accessory: ${description}`);
        }
      }),
    );
  }

  private async refreshDeviceInfo() {
    for (const instance of this.activeAccessories.values()) {
      const changed = await instance.refreshInfo();
      if (changed) {
        await this.matter.updatePlatformAccessories([instance.toAccessory()]);
      }
    }
  }
}
