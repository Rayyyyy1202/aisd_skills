'use client';

import { AVAILABLE_MODELS } from '../lib/agent';

interface ModelPickerProps {
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
  compact?: boolean;
}

export default function ModelPicker({ value, onChange, disabled, compact }: ModelPickerProps) {
  return (
    <label className={compact ? 'model-picker model-picker-compact' : 'model-picker'}>
      <span className="model-picker-label">Model</span>
      <select
        className="model-picker-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {AVAILABLE_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );
}
