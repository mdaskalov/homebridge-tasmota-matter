# Tasmota Device Definition

To configure a custom Tasmota device, use the `TasmotaDeviceDefinition` JSON format.<br>
The definition is validated on startup, so check the Homebridge logs for possible errors if the device is not added successfully.

## Tasmota Device Definition

Defines the clusters and handlers a device should implement, as well as the Tasmota commands to execute on cluster change or state to be updated on tasmota update.

```json
{
  "deviceType": "<DeviceType>",
  "clusters": {
    "<cluster>": {
      "<attribute>": "value"
    }
  },
  "handlers": {
    "<cluster>": {
      "<command>": {
        "cmd": "<TasmotaCommand>",
        "res": {}
      }
    }
  },
  "updates": {
    "<cluster>": {}
  },
  "parts": [
    {
      "id": "<partId>",
      "displayName": "<name>",
      "handlers": {
        "<cluster>": {
          "<command>": {}
        }
      },
      "updates": {
        "<cluster>": {}
      }
    }
  ]
}

```

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `deviceType` | `string` | Yes | The target Matter/Homebridge accessory type classification (e.g., OnOffLight, Dimmer, Thermostat). |
| `clusters` | `object` | No | Configuration representing `MatterAccessory['clusters']`. Used to initialize attributes and default cluster operational states. |
| `handlers` | `object` | No | Map of Matter clusters to outgoing `TasmotaCommand`. Keyed by `ClusterHandlerMap` cluster names, and sub-keyed by specific commands or action triggers. |
| `updates` | `object` / `array` | No | Map of incoming `ClusterStateMap` attributes to a `TasmotaResponse` object or an array of `TasmotaResponse[]`. Dictates how internal device states are updated. |
| `parts` | `array` | No | An array of `DevicePartsDefinition` object, used to define composed device with multiple independent child endpoints parts. |

### Device Parts Definition (`parts[]`)

Extends the base configuration structure above for unique sub-components:

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Unique identifier for this specific sub-accessory endpoint instance. |
| `displayName` | `string` | No | Optional user-friendly name presented for this sub-accessory endpoint inside Homebridge/Matter frameworks. |

---

## Tasmota Command

Each device handler uses `TasmotaCommand` definitions to communicate with Tasmota.

These are messages sent to the `cmnd` topic of the device. Each command also defines an expected response containing the characteristic value.

Values can be mapped between Tasmota and Homebridge if different values are used. Command definitions may include variables such as `{topic}`. See below for available variables.

```json
{
  "cmd": "POWER{idx} ON",
  "res": { "path": "POWER{idx}" }
}

```

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `cmd` | `string` | Yes | Sends `<Command>` to the device command topic `cmnd/{topic}/...`. The command may include a payload separated by a space. For example, `STATUS 10` sends the message 10 to the topic `cmnd/{topic}/STATUS`. |
| `res` | `object` | No | Awaits a response from Tasmota to confirm command execution. See below for details on how responses are parsed. If not specified, the response is expected on the `stat/{topic}/RESULT` topic with the same value path as the command itself. For example, the command POWER1 will expect the response `{"POWER1":"ON"}` on the `stat/{topic}/RESULT` topic. |

---

## Tasmota Response

When a command is sent to Tasmota, the plugin waits for a response until a timeout is reached. The response is expected on the `<ResponseTopic>`. The value is extracted using the `ValuePath` from the received message, and the Homebridge value is updated accordingly.

```json
{
  "topic": "stat/{topic}/RESULT",
  "path": "POWER{idx}",
  "shared": false
}

```

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `topic` | `string` | No | (optional) Defines the topic where the response should be expected. |
| `path` | `string` | No | (optional) Dot-separated path to extract the value from the response JSON. |
| `shared` | `boolean` | No | (optional) Maps values between Tasmota and Homebridge using a SplitMapping for splitting a value using a separator character or a SwapMapping by defining each possible value.
 |

---

## Value Paths

Value paths are used to extract a value from the command response JSON.

For example, to extract temperature from the following `SENSOR` response, use `AM2301.Temperature`. To extract humidity, use `AM2301.Humidity`.

```json
{"Time":"2024-11-24T15:06:56","AM2301":{"Temperature":23.3,"Humidity":33.8,"DewPoint":6.4},"TempUnit":"C"}

```

---

## Variables

Predefined variables can be used for the `cmd`, `topic`, and `path` properties.

Here are the defined variables:

| Variable | Description |
| --- | --- |
| `deviceName` | Configured device name. |
| `topic` | Configured main topic used to control the device. |
| `idx` | Configured device index. |
| `stat` | Default status topic defined as `stat/{topic}`. |
| `sensor` | Default sensor topic defined as `tele/{topic}/SENSOR`. |

Additionally the type mapper converts cluster attributes to variables which can be used in the tasmota command payload.

For example for the `colorControl` cluster the variables `bri`, `ct`, `hue` and `sat` are defined and can be used as follows:

```json
"colorControl": {
  "moveToColorTemperatureLogic": { "cmd": "CT {ct}", "res": { "path": "CT" } },
  "moveToHueAndSaturationLogic": { "cmd": "HSBColor {hue},{sat},{bri}", "res": { "path": "HSBColor" } },
  "moveToHueLogic": { "cmd": "HSBColor1 {hue}", "res": { "path": "HSBColor" } },
  "moveToSaturationLogic": { "cmd": "HSBColor2 {sat}", "res": { "path": "HSBColor" } },
},
```

Note that the answer of the command `HSBColor1` is expected on the default topic (`stat/{topic}/RESULT`) as `HSBColor` - not as `HSBColor1`.

## Examples

### Single Relay as a Switch
The simplest definition of a relay as `OnOffSwitch` device with `onOff` cluster:

```json
{
  "deviceType": "OnOffSwitch",
  "clusters": {
    "onOff": {
       "onOff": false
    }
  },
  "handlers": {
    "onOff": {
      "on": { "cmd": "POWER ON" },
      "off": { "cmd": "POWER OFF" }
    }
  },
  "updates": {
    "onOff": { "path": "POWER" }
  }
}
```

### Multiple Relays on a Single Device
Define two relays on the same device as separate `Switch` services. The device type is `BridgedNode` by default when `parts` is defined.

```json
{
  "DeviceType": "BridgedNode",
  "parts": [
    {
      "id": "switch-1",
      "displayName": "Switch 1",
      "deviceType": "OnOffSwitch",
      "clusters": {
        "onOff": {
          "onOff": false
        }
      },
      "handlers": {
        "onOff": {
          "on": { "cmd": "POWER1 ON" },
          "off": { "cmd": "POWER1 OFF" }
        }
      },
      "updates": {
        "onOff": { "path": "POWER1" }
      }
    },
    {
      "id": "switch-2",
      "displayName": "Switch 2",
      "deviceType": "OnOffSwitch",
      "clusters": {
        "onOff": {
          "onOff": false
        }
      },
      "handlers": {
        "onOff": {
          "on": { "cmd": "POWER2 ON" },
          "off": { "cmd": "POWER2 OFF" }
        }
      },
      "updates": {
        "onOff": { "path": "POWER2" }
      }
    }
  ]
}
```

### Dimmable White Light
Define a white dimmable light on an RGBW light-strip (4 channels) as a service `Lightbulb` with `On` and `Brightness` characteristics:

```json
{
  "deviceType": "OnOffLight",
  "clusters": {
    "onOff": {
      "onOff": false
    },
    "levelControl": {
      "currentLevel": 254,
      "minLevel": 1,
      "maxLevel": 254
    }
  },
  "handlers": {
    "onOff": {
      "on": { "cmd": "POWER ON" },
      "off": { "cmd": "POWER OFF" }
    },
    "levelControl": {
      "moveToLevelWithOnOff": { "cmd": "Dimmer {bri}" }
    }
  },
  "updates": {
    "onOff": { "path": "POWER" },
    "levelControl": { "path": "Dimmer" }
  }
}
```

### RGB Lightbulb
Control an RGB lightbulb using the `HSBColor` command as a service `Lightbulb` with `On`, `Hue`, `Saturation`, and `Brightness` characteristics.<br>
In this example, an index mapping is used to extract values from the `HSBColor` response.<br>
For example, in the response `{"HSBColor":"238,100,79"}`, the values are: Hue: 238, Saturation: 100, and Brightness: 79.

```json
{
  "deviceType": "ExtendedColorLight",
  "clusters": {
    "onOff": {
      "onOff": false
    },
    "levelControl": {
      "currentLevel": 254,
      "minLevel": 1,
      "maxLevel": 254
    },
    "colorControl": {
      "colorMode": 0,
      "currentHue": 0,
      "currentSaturation": 254,
      "colorTempPhysicalMinMireds": 147,
      "colorTempPhysicalMaxMireds": 454,
      "colorTemperatureMireds": 250,
      "coupleColorTempToLevelMinMireds": 147
    }
  },
  "handlers": {
    "onOff": {
      "on": { "cmd": "POWER ON" },
      "off": { "cmd": "POWER OFF" }
    },
    "levelControl": {
      "moveToLevelWithOnOff": { "cmd": "HSBColor3 {bri}", "res": { "path": "HSBColor" } }
    },
    "colorControl": {
      "moveToColorTemperatureLogic": { "cmd": "CT {ct}", "res": { "path": "CT" } },
      "moveToHueAndSaturationLogic": { "cmd": "HSBColor {hue},{sat},{bri}", "res": { "path": "HSBColor" } },
      "moveToHueLogic": { "cmd": "HSBColor1 {hue}", "res": { "path": "HSBColor" } },
      "moveToSaturationLogic": { "cmd": "HSBColor2 {sat}", "res": { "path": "HSBColor" } },
      "stopAllColorMovement": null
    }
  },
  "updates": {
    "onOff": { "path": "POWER" },
    "levelControl": { "path": "Dimmer" },
    "colorControl": [ { "path": "HSBColor" }, { "path": "CT" } ]
  }
}
```