# MQTTClient: handlers, response handlers, and message sharing

`MQTTClient` (`src/mqttClient.ts`) keeps two separate lists of subscribers per topic:

- `handlers` - registered via `subscribe(topic, callback)`. Used for long-lived, passive
  listeners (e.g. reacting to a relay changing state).
- `responseHandlers` - registered via `subscribe(topic, callback, true)`, which is what
  `read(reqTopic, message, resTopic, timeout, callback?)` uses internally for one-shot
  request/response round trips.

On every incoming message, `responseHandlers` matching the topic are tried first, then
`handlers`. **The callback's return value decides whether the message is consumed:**

```ts
for (const responseHandler of responseHandlers) {
  if ((await responseHandler.callback(message, topic)) === true) {
    return; // consumed - handlers list is never reached for this message
  }
}
for (const handler of handlers) {
  if ((await handler.callback(message, topic)) === true) {
    return;
  }
}
```

- Returning `true` (or omitting the callback entirely - `read()` defaults to `true` when no
  callback is given) **consumes** the message: processing stops immediately, so nothing later
  in either list - including any persistent `handlers` entry on the very same topic - gets to
  see it.
- Returning `false` **shares** the message: it's treated as "not mine", and dispatch continues
  to the next responseHandler/handler.

## Why this matters

Multiple things can be subscribed to the same topic - most commonly `stat/<topic>/RESULT`,
which carries both command responses and organic device-driven state changes (e.g. someone
flips the physical switch, or Tasmota echoes a `POWER1 ON` command). If a one-shot `read()` (or
a raw `subscribe(..., true)`) doesn't filter with a callback, it will swallow the *next* message
on that topic regardless of whether it's actually the answer to its own request - starving any
other listener registered on the same topic of that message.

`TasmotaAccessory.execute()` already does this correctly (`src/tasmotaAccessory.ts`): its
callback returns `false` ("ignore") when the message doesn't contain the path it's waiting for,
letting it flow through, and only returns `true` once it finds its actual answer.

`EnergyMonitor.checkInitialState()` (`src/energyMonitor.ts`) needs something similar: a
one-shot query for the relay's current state at startup, issued on `relayTopic`/`relayPath` -
the *exact* topic a persistent listener is also watching for real ON/OFF transitions. Since
there's no way to distinguish "the reply to my own query" from "an organic state change that
happened to arrive in the same window" by content alone, and either one is equally valid
information, its callback just **reacts inline** (calls `start()` when it sees `ON`) and
returns `false` while it hasn't seen a matching message yet - sharing every unrelated message
with the persistent listener - then `true` once it has one, since by that point it's already
done everything it needed to do with it:

```ts
await this.mqtt.read(reqTopic, '', this.relayTopic, READ_TIMEOUT, async (message) => {
  const value = TypeMapper.getValueByPath(message, this.relayPath);
  if (value === 'ON') {
    this.start();
  }
  return value !== undefined;
});
```

Returning `false` unconditionally would also "work" in the sense of never stealing a message,
but it means `read()` never calls `done(msg)` on a match, so it always falls through to its
timeout path - which also logs an `error`-level "read timeout" on every single call, even a
successful one. Consuming once a real answer arrives avoids that noise for the common case,
while an actually unreachable device still times out and logs normally.

## Rule of thumb

- Need the *next* message on a topic, no matter what it is, and nobody else should see it?
  Plain `read()` with no callback.
- Need to wait for a *specific* message on a topic that other things also legitimately consume
  (command round trips, or a persistent listener on the same topic)? `read()` with a callback
  that does whatever reacting it needs to do inline, returns `false` for messages that aren't a
  usable answer (sharing them with everyone else), and `true` once it has one.
