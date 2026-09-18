import { readFileSync } from 'fs';
import { Logging, PlatformConfig } from 'homebridge';
import { IClientOptions, MqttClient, connect } from 'mqtt';

type TopicCallback = (msg: string, topic: string) => Promise<boolean | void>; // response handler consumes message if not false

type ReadCallback = (msg: string) => Promise<boolean | void>; // true: consume, false: ignore

type TopicHandler = {
  id: string;
  topic: string;
  callback: TopicCallback;
};

export class MQTTClient {
  private responseHandlers: TopicHandler[] = [];
  private handlers: TopicHandler[] = [];
  private client: MqttClient;
  private connectionState: 'connecting' | 'connected' | 'offline' = 'connecting';
  private connectionWaiters: ((connected: boolean) => void)[] = [];

  constructor(
    private log: Logging,
    config: PlatformConfig,
  ) {
    const broker = config.mqttBroker || 'localhost';
    const useTls = !!config.mqttTls;
    const options: IClientOptions = {
      clientId: 'homebridge-tasmota-matter_' + Math.random().toString(16).slice(2, 10),
      protocolId: 'MQTT',
      protocolVersion: 4,
      clean: true,
      reconnectPeriod: 30000,
      connectTimeout: 30000,
      username: config.mqttUsername,
      password: config.mqttPassword,
    };

    if (useTls) {
      options.rejectUnauthorized = config.mqttTlsRejectUnauthorized !== false;
      const caCertPath = config.mqttCaCert as string | undefined;
      if (caCertPath) {
        try {
          options.ca = readFileSync(caCertPath);
        } catch (err) {
          this.log.error('MQTT: Failed to read CA certificate at %s: %s', caCertPath, (err as Error).message);
        }
      }
    }

    this.client = connect((useTls ? 'mqtts://' : 'mqtt://') + broker, options);
    this.client.on('connect', () => {
      this.log.debug('MQTT: Connected to %s', broker);
      this.setConnectionState('connected');
    });
    this.client.on('reconnect', () => this.log.warn('MQTT: Reconnecting to %s...', broker));
    this.client.on('offline', () => {
      this.log.warn('MQTT: Offline - broker %s unreachable', broker);
      this.setConnectionState('offline');
    });
    this.client.on('error', (err) => this.log.error('MQTT: Connection error to %s: %s', broker, err.message));
    this.client.on('message', async (topic, message) => {
      const handlers = this.handlers.filter((h) => this.matchTopic(h, topic));
      const responseHandlers = this.responseHandlers.filter((h) => this.matchTopic(h, topic));
      const handlersCount = handlers.length + responseHandlers.length;
      this.log.debug('MQTT: Message on topic: %s, handler(s): %d (%d response)', topic, handlersCount, responseHandlers.length);
      for (const responseHandler of responseHandlers) {
        if ((await responseHandler.callback(message.toString(), topic)) === true) {
          this.log.debug('MQTT: Message consumed by responseHandler %s', responseHandler.id);
          return;
        }
      }
      for (const handler of handlers) {
        if ((await handler.callback(message.toString(), topic)) === true) {
          this.log.debug('MQTT: Message consumed by Handler %s', handler.id);
          return;
        }
      }
    });
  }

  private setConnectionState(state: 'connected' | 'offline') {
    this.connectionState = state;
    const waiters = this.connectionWaiters;
    this.connectionWaiters = [];
    for (const waiter of waiters) {
      waiter(state === 'connected');
    }
  }

  // Resolves true once connected, or false once the connection is known to be down. While the
  // initial connection attempt is still pending, callers wait here instead of failing right away.
  private waitForConnection(): Promise<boolean> {
    if (this.connectionState !== 'connecting') {
      return Promise.resolve(this.connectionState === 'connected');
    }
    return new Promise((resolve) => this.connectionWaiters.push(resolve));
  }

  shutdown() {
    this.log.debug('MQTT: Shutdown. Remove all handlers');
    const handlers = [...this.handlers, ...this.responseHandlers];
    for (const handler of handlers) {
      this.unsubscribe(handler.id);
    }
    if (this.client) {
      this.client.end();
    }
  }

  matchTopic(handler: TopicHandler, topic: string) {
    if (handler.topic.includes('#')) {
      return topic.startsWith(handler.topic.substring(0, handler.topic.indexOf('#')));
    }
    const topicParts = topic.split('/');
    const handlerTopicParts = handler.topic.split('/');
    if (topicParts.length === handlerTopicParts.length) {
      return topicParts.every((part, idx) => part === handlerTopicParts[idx] || handlerTopicParts[idx] === '+');
    }
    return false;
  }

  handlersCount(topic: string): { handlersCount: number; responseHandlersCount: number } {
    const responseHandlersCount = this.responseHandlers.filter((h) => this.matchTopic(h, topic)).length;
    const handlersCount = responseHandlersCount + this.handlers.filter((h) => this.matchTopic(h, topic)).length;
    return { handlersCount, responseHandlersCount: responseHandlersCount };
  }

  subscribe(topic: string, callback: TopicCallback, response = false): string | undefined {
    if (this.client) {
      const id = crypto.randomUUID();
      const handler: TopicHandler = { id, topic, callback };
      if (response) {
        this.responseHandlers.push(handler);
      } else {
        this.handlers.push(handler);
      }
      const { responseHandlersCount, handlersCount } = this.handlersCount(topic);
      if (handlersCount === 1) {
        this.log.debug(
          'MQTT: Subscribed topic: %s, %s: %s, handler(s): %d (%d response)',
          topic,
          response ? 'responseHandler' : 'Handler',
          id,
          handlersCount,
          responseHandlersCount,
        );
        this.client.subscribe(topic);
      } else {
        this.log.debug(
          'MQTT: Added %s: %s, on: %s, handler(s): %d (%d response)',
          response ? 'responseHandler' : 'Handler',
          id,
          topic,
          handlersCount,
          responseHandlersCount,
        );
      }
      return id;
    }
    return undefined;
  }

  unsubscribe(id: string) {
    let response = true;
    let handler = this.responseHandlers.find((h) => h.id === id);
    if (!handler) {
      response = false;
      handler = this.handlers.find((h) => h.id === id);
    }
    if (handler) {
      if (response) {
        this.responseHandlers = this.responseHandlers.filter((h) => h.id !== id);
      } else {
        this.handlers = this.handlers.filter((h) => h.id !== id);
      }
      const { responseHandlersCount, handlersCount } = this.handlersCount(handler.topic);
      if (handlersCount === 0) {
        this.client.unsubscribe(handler.topic);
        this.log.debug(
          'MQTT: Unsubscribed topic: %s, %s: %s, handler(s): %d (%d response)',
          handler.topic,
          response ? 'responseHandler' : 'Handler',
          handler.id,
          handlersCount,
          responseHandlersCount,
        );
      } else {
        this.log.debug(
          'MQTT: Removed %s: %s on %s, handler(s): %d (%d response)',
          response ? 'responseHandler' : 'Handler',
          handler.id,
          handler.topic,
          handlersCount,
          responseHandlersCount,
        );
      }
    } else {
      this.log.warn('MQTT: Cannot unsubscribe %s - not found', id);
    }
  }

  publish(topic: string, message: string) {
    if (!this.client.connected) {
      this.log.error('MQTT: Cannot publish to %s - not connected to broker', topic);
      return;
    }
    this.client.publish(topic, message);
    this.log.debug('MQTT: Published: %s %s', topic, message);
  }

  read(reqTopic: string, message?: string, resTopic?: string, timeout?: number, callback?: ReadCallback): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
      const topic = resTopic ?? reqTopic;
      const ms = timeout ?? 5000;
      let timeoutTimer: NodeJS.Timeout | undefined;
      let handlerId: string | undefined;

      const done = (value: string | undefined, errorMsg?: string) => {
        clearTimeout(timeoutTimer);
        timeoutTimer = undefined;
        if (handlerId) {
          this.unsubscribe(handlerId);
          handlerId = undefined;
        }
        if (errorMsg) this.log.error(errorMsg);
        resolve(value);
      };

      this.waitForConnection().then((connected) => {
        if (!connected) {
          done(undefined, `MQTT: Cannot read ${topic} - not connected to broker`);
          return;
        }

        timeoutTimer = setTimeout(() => done(undefined, `MQTT: Read timeout after ${ms}ms on ${topic}`), ms);
        handlerId = this.subscribe(
          topic,
          async (msg) => {
            try {
              const cbResult = callback ? await callback(msg) : true;
              if (cbResult !== false) done(msg);
              return cbResult;
            } catch (err) {
              done(undefined, `MQTT: Callback error: ${err}`);
              return true;
            }
          },
          true,
        );

        if (message !== undefined) {
          this.publish(reqTopic, message);
        }
      });
    });
  }
}
