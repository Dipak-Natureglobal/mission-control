import { useState } from 'react';

// Lifted from refi-prototype to keep the substrate identical across Blinker apps.
// Tiny custom hook — partial updates merge into existing state, no controlled-input ceremony.
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
