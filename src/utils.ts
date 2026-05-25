import type { API, MatterAPI } from 'homebridge';

/**
 * Resolve the Matter API. `api.matter` is typed as `MatterAPI | undefined`
 * because Homebridge only loads it on Matter-enabled bridges; in this plugin
 * we only ever construct devices after `isMatterEnabled()` returns true, so
 * we throw here if it's missing — that path indicates a Homebridge bug.
 */
export function getMatter(api: API): MatterAPI {
  if (!api.matter) {
    throw new Error('Matter API is not available — this plugin requires a Matter-enabled Homebridge bridge.');
  }
  return api.matter;
}
