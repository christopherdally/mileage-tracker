// Helpers for entries that belong to one of the user's vehicles.

/** Name of a vehicle by id, including ones that have since been removed. */
export function vehicleName(vehicles, id) {
  if (!id) return '';
  return vehicles.find((v) => v.id === id)?.name || '';
}

/** The vehicle for a new entry: the one picked on the form, else the one used most recently, else the first. */
export function defaultVehicleId(liveVehicles, entries, picked) {
  if (!liveVehicles.length) return null;
  const live = new Set(liveVehicles.map((v) => v.id));
  if (picked && live.has(picked)) return picked;
  let last = null;
  for (const e of entries) {
    if (e.vehicleId && live.has(e.vehicleId) && (!last || e.updatedAt > last.updatedAt)) last = e;
  }
  return last ? last.vehicleId : liveVehicles[0].id;
}

/** Choices for an entry's vehicle picker: live vehicles, plus the entry's own if it was removed or never set. */
export function vehicleChoices(liveVehicles, vehicles, currentId) {
  const options = liveVehicles.map((v) => ({ value: v.id, label: v.name }));
  if (!currentId) {
    if (options.length) options.unshift({ value: '', label: 'Not recorded' });
  } else if (!options.some((o) => o.value === currentId)) {
    options.push({ value: currentId, label: `${vehicleName(vehicles, currentId) || 'Unknown vehicle'} (removed)` });
  }
  return options;
}
