import type { Logger, MatterAPI } from 'homebridge';
import type { MQTTClient } from './mqttClient';

const POLL_INTERVAL = 30000; // min 10s
const INITIAL_POLL_DELAY = 2000;

export type EnergyMonitorOptions = {
  log: Logger;
  mqtt: MQTTClient;
  matter: MatterAPI;
  uuid: string;
  topic: string;
  channelIndex?: number;
  partId?: string;
};

function pickValue(energy: Record<string, unknown>, field: string, channelIndex?: number): number | undefined {
  const value = energy[field];
  const raw = Array.isArray(value) ? value[channelIndex ?? 0] : value;
  return raw === undefined || raw === null ? undefined : Number(raw);
}

export function initialElectricalClusterState(energy: Record<string, unknown>, channelIndex?: number) {
  const voltage = pickValue(energy, 'Voltage', channelIndex) ?? 0;
  const current = pickValue(energy, 'Current', channelIndex) ?? 0;
  const power = pickValue(energy, 'Power', channelIndex) ?? 0;
  const total = pickValue(energy, 'Total', channelIndex) ?? 0;
  return {
    electricalPowerMeasurement: {
      voltage: Math.round(voltage * 1000),
      activeCurrent: Math.round(current * 1000),
      activePower: Math.round(power * 1000),
    },
    electricalEnergyMeasurement: {
      cumulativeEnergyImported: { energy: Math.round(total * 1_000_000) },
    },
  };
}

export class EnergyMonitor {
  private readonly log: Logger;
  private readonly mqtt: MQTTClient;
  private readonly matter: MatterAPI;
  private readonly uuid: string;
  private readonly topic: string;
  private readonly channelIndex?: number;
  private readonly partId?: string;

  private pollTimer?: ReturnType<typeof setInterval>;
  private startTimer?: ReturnType<typeof setTimeout>;
  private lastVoltage = 0;
  private lastTotal?: number;

  constructor(options: EnergyMonitorOptions) {
    this.log = options.log;
    this.mqtt = options.mqtt;
    this.matter = options.matter;
    this.uuid = options.uuid;
    this.topic = options.topic;
    this.channelIndex = options.channelIndex;
    this.partId = options.partId;
  }

  setOnOff(onOff: boolean): void {
    if (onOff) {
      this.start();
    } else {
      void this.stop();
    }
  }

  private start(): void {
    if (this.pollTimer || this.startTimer) {
      return;
    }
    this.startTimer = setTimeout(() => {
      this.startTimer = undefined;
      void this.poll();
      this.pollTimer = setInterval(() => void this.poll(), POLL_INTERVAL);
    }, INITIAL_POLL_DELAY);
  }

  private async stop(): Promise<void> {
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = undefined;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    await this.pushElectrical(this.lastVoltage, 0, 0);
  }

  private async pushElectrical(voltage: number, current: number, power: number): Promise<void> {
    await this.matter.updateAccessoryState(
      this.uuid,
      'electricalPowerMeasurement',
      {
        voltage: Math.round(voltage * 1000),
        activeCurrent: Math.round(current * 1000),
        activePower: Math.round(power * 1000),
      },
      this.partId,
    );
  }

  private async poll(): Promise<void> {
    try {
      const reqTopic = `cmnd/${this.topic}/STATUS`;
      const resTopic = `stat/${this.topic}/STATUS10`;
      const message = await this.mqtt.read(reqTopic, '10', resTopic);
      if (!message) {
        return;
      }
      const energy = JSON.parse(message)?.StatusSNS?.ENERGY as Record<string, unknown> | undefined;
      if (!energy || typeof energy !== 'object') {
        return;
      }
      await this.applyEnergy(energy);
    } catch (err) {
      this.log.debug(`EnergyMonitor: poll failed for ${this.topic}: ${err}`);
    }
  }

  private async applyEnergy(energy: Record<string, unknown>): Promise<void> {
    const voltage = pickValue(energy, 'Voltage', this.channelIndex) ?? this.lastVoltage;
    const current = pickValue(energy, 'Current', this.channelIndex) ?? 0;
    const power = pickValue(energy, 'Power', this.channelIndex) ?? 0;
    this.lastVoltage = voltage;

    await this.pushElectrical(voltage, current, power);

    const total = pickValue(energy, 'Total', this.channelIndex);
    if (total !== undefined && total !== this.lastTotal) {
      this.lastTotal = total;
      await this.matter.updateAccessoryState(
        this.uuid,
        'electricalEnergyMeasurement',
        {
          cumulativeEnergyImported: { energy: Math.round(total * 1_000_000) },
        },
        this.partId,
      );
    }
  }
}
