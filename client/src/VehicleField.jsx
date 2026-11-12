import { useStore } from './store.js';
import { Field } from './ui.jsx';
import { vehicleChoices } from './vehicles.js';

/** Vehicle picker for a journey or fuel entry. Hidden while there is nothing to choose between. */
export function VehicleField({ value, onChange }) {
  const { liveVehicles, vehicles } = useStore();
  const options = vehicleChoices(liveVehicles, vehicles, value);
  if (options.length < 2) return null;
  return (
    <Field label="Vehicle">
      {(id) => (
        <select id={id} value={value || ''} onChange={(e) => onChange(e.target.value || null)}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
}
