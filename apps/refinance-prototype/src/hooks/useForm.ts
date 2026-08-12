import { useState } from 'react';

export function useForm<T>(
  initialState: T
): [T, (updates: Partial<T>) => void, () => void] {
  const [form, setForm] = useState<T>(initialState);

  const updateForm = (updates: Partial<T>) => {
    setForm((prev) => ({ ...prev, ...updates }));
  };

  const reset = () => {
    setForm(initialState);
  };

  return [form, updateForm, reset];
}
