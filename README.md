<p allign="center">

<img src="https://raw.githubusercontent.com/homebridge/branding/latest/logos/homebridge-color-round-stylized.png" width="150">

</p>

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![npm](https://img.shields.io/npm/dt/homebridge-tasmota-matter.svg)](https://www.npmjs.com/package/homebridge-tasmota-matter)
[![npm](https://img.shields.io/npm/v/homebridge-tasmota-matter.svg)](https://www.npmjs.com/package/homebridge-tasmota-matter)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/mdaskalov/homebridge-tasmota-matter.svg)](https://github.com/mdaskalov/homebridge-tasmota-matter/pulls)
[![GitHub issues](https://img.shields.io/github/issues/mdaskalov/homebridge-tasmota-matter.svg)](https://github.com/mdaskalov/homebridge-tasmota-matter/issues)

# Homebridge Tasmota Matter

This Homebridge plugin can controll [Tasmota](https://tasmota.github.io/docs) devices connected to a MQTT broker using Matter.

Devices flashed with Tasmota firmware (Outlet Switch, Lightbulb, RGB Stripe, Button, Contact Sensor, Valve, Lock Mechanism, Sensor, etc.) are suported directly.

# Installation

* Flash your device(s) with Tasmota
* Install homebridge `npm install -g homebridge`
* Install the plugin `npm install -g homebridge-tasmota-matter`
* Alternatively use the great [Homebridge Config UI X](https://github.com/oznu/homebridge-config-ui-x) plugin to install and configure

# Configuration

``` json
{
    "name": "TasmotaMatter",
    "tasmotaDevices": [
        {
            "topic": "sonoff",
            "type": "SWITCH",
            "name": "SonoffTM"
        },
        {
            "topic": "sonoff",
            "type": "SENSOR",
            "name": "SonoffTM TH Sensor"
        },
        {
            "topic": "sonoff-4ch",
            "type": "SWITCH",
            "index": 2,
            "name": "Sonoff 4CH Channel 2"
        }
    ],
    "mqttBroker": "raspi2",
    "logTimeouts": false,
    "logUnexpected": false,
    "platform": "TasmotaMatter"
}
```

`tasmotaDevices` - Tasmota flashed devices

* `topic` - Topic to control the device as configured in the "Configure MQTT" menu on the device web interface.
* `type` - Device type (`SWITCH`, `LIGHTBULB`, `BUTTON`, `CONTACT`, `VALVE`, `LOCK`, `SENSOR`, `CUSTOM`, etc.).
* `index` - (optional) Optional index used to control the device (`POWER1`, `POWER2`, `Switch1`, `Switch2`, etc.).
* `custom` - (optional) Custom device definition (when `type='CUSTOM'`) as a JSON string.
* `name` - Accessory name to be used in the Home application. Should be unique.

`mqttBroker` - MQTT Broker hostname if not localhost.

`mqttUsername` - MQTT Broker username if password protected.

`mqttPassword` - MQTT Broker password if password protected.

`zigbee2tasmotaTopic` - Zigbee2Tasmota gateway/bridge base topic (default: zbbridge).

`zigbee2mqttTopic` - Zigbee2MQTT gateway/bridge base topic (default: zigbee2mqtt).

`logTimeouts` - (optional) Log MQTT command response timeouts (default: false).

`logUnexpected` - (optional) Log unexpected response messages while waiting for an MQTT command response (default: false).

