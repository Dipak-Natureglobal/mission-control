// Lifted verbatim from refi-prototype/src/hooks/useForm.js (also mirrored
// in protection-portal). Tiny shared form hook used by every wizard
// screen — returns the current form, a partial-update setter, and a
// reset back to initialState.
import { useState } from 'react';

export function useForm(initialState = {}) {
  const [form, setForm] = useState(initialState);

  const updateForm = (updates) => {
    setForm(prev => ({ ...prev, ...updates }));
  };

  const reset = () => {
    setForm(initialState);
  };

  return [form, updateForm, reset];
}
