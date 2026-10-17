// Website-only extension. The five datasets used by iOS remain unchanged.
import {sanitizeState} from './planner.mjs?v=20261018b';

export function withCulture(data, culture) {
  return {...data, culture,
    events: [...data.events, ...culture.events],
    places: {...data.places, places: [...data.places.places, ...culture.places]}};
}

// A deliberate preset switch changes only this extension, not the saved weekend.
export function selectCulturePreset(rawState, data, presetId) {
  const state = sanitizeState(rawState, data);
  const preset = data.culture?.presets.find(x => x.id === presetId);
  if (!preset) return state;
  const extensionIds = new Set([...data.culture.events, ...data.culture.places].map(x => x.id));
  state.selected = [...state.selected.filter(id => !extensionIds.has(id)), ...preset.ids];
  return sanitizeState(state, data);
}
