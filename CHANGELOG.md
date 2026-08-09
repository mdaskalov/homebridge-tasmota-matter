# Change Log

All notable changes will be documented in this file.

## v0.0.19
- Fail-closed device creation: a device is only added once all its info queries succeed
- Never unregister accessories to refresh device info

## v0.0.18
- Consolidated device information and sensor reads into a single `create()` step with unified retry
- Removed the deferred sensor registration and separate `refreshInfo()` pass
- Re-create accessories whose cached device information is stale (`Unknown`)
- Stopped persisting `deviceSensors` in the accessory context

## v0.0.16
- Added outlet
- Simplified accessory configuration
- Updated endpoint (deviceType) mappers
- Increased read timeout

## v0.0.14
- Cleanup
- Improved timeout and error handling

## v0.0.12
- Fully implemented RGB and RGBCCT lights
- Implemented multipart device
- Implemented custom device (using JSON definition)
- Separate command and update handlers
- Asynchroneous value mappers

## v0.0.11
- Added water valve (not supported in Home)
- Added door lock
- Added lights with color control (work in progress)
- Reworked type mappers
- Optimized device initialization

## v0.0.10
- Cleanup MQTT client
- Added device variables and template exapand
- Added Dimmable Light using PWM channel (`LIGHTBULB_B_CH`)

## v0.0.9
- Added contact sensor
- Added automatic sensor detection (`SENSOR` type)
- Added Switch as Button (`BUTTON_SW` type) - emits `ON`: `singlePress` or `OFF`: `doublePress`
- Fixed Switch type (works now)

## v0.0.8
- optimized cluster creation and updates
- added BUTTON tasmota device (don't work)
- improved acessory creation

## v0.0.6
- implemented cluster updates
- added value mapper  e94beea
- optimized device initialization
- Available: Switch, Light, Dimmable Light
(Still work in progress!)

## v0.0.5
- Added state updates on MQTT messages
- Simplified device registration
- Added device definitions