declare module 'blinker-platform/components' {
  import type { FC, ReactNode, ComponentType } from 'react';

  // FormFields.jsx — Field, PhoneField, SelectField, TextAreaField
  export const Field: FC<{
    label?: string;
    value?: string | number | null;
    onChange: (value: string) => void;
    placeholder?: string;
    prefix?: string;
    error?: string | null;
    icon?: ComponentType<{ className?: string }>;
    inputMode?: string;
    maxLength?: number;
    type?: string;
    optional?: boolean;
  }>;

  export const PhoneField: FC<{
    label?: string;
    value?: string | null;
    onChange: (value: string) => void;
    error?: string | null;
  }>;

  export const SelectField: FC<{
    label?: string;
    value?: string | null;
    onChange: (value: string) => void;
    options: string[] | Array<{ value: string; label: string }>;
    error?: string | null;
  }>;

  export const TextAreaField: FC<{
    label?: string;
    value?: string | null;
    onChange: (value: string) => void;
    placeholder?: string;
    rows?: number;
    error?: string | null;
  }>;

  // WizardShell.jsx — WizardShell, ScreenHeader, WizardFooter, Footer
  export const WizardShell: FC<{
    children: ReactNode;
    progress?: number;
    stepIndex?: number;
    stepTotal?: number;
    onBack?: () => void;
  }>;

  export const ScreenHeader: FC<{
    icon?: ComponentType<{ className?: string }>;
    eyebrow?: string;
    title?: string;
    subtitle?: string;
  }>;

  export const WizardFooter: FC<{
    onNext: () => void;
    disabled?: boolean;
    nextLabel?: string;
    secondary?: ReactNode;
  }>;

  export const Footer: FC<{
    onNext: () => void;
    disabled?: boolean;
    nextLabel?: string;
    secondary?: ReactNode;
  }>;

  // DevPanel.jsx — DevPanel, Section, Segmented
  export const DevPanel: FC<{ open: boolean; children?: ReactNode }>;
  export const Section: FC<{ label?: string; children?: ReactNode }>;
  export const Segmented: FC<{
    value: string;
    onChange: (value: string) => void;
    options: string[] | Array<{ v: string; l: string }>;
  }>;

  // NotesPanel.jsx
  export const NotesPanel: FC<{
    contactId?: string | null;
    opportunityId?: string | null;
    authorId?: string;
    showTags?: boolean;
    selectedTagIds?: string[];
    onTagAdd?: (tagId: string) => void;
    onTagRemove?: (tagId: string) => void;
    onTagCreate?: (tag: { id: string; label: string; color?: string }) => void;
    canAddTags?: boolean;
    canCreateTags?: boolean;
    sessionCreatedTags?: Array<{ id: string; label: string; color?: string }>;
    orgId?: string | null;
    persona?: string;
    trackingPrefix?: string;
  }>;

  // JsonPeek.jsx
  export const JsonPeek: FC<{ label?: string; data?: object | null }>;

  // AddressBlock.jsx
  export const AddressBlock: FC<{ form: object; update: (patch: object) => void }>;

  // RelationshipPicker.jsx — stores label-as-id (id === label per prototype comment)
  export const RelationshipPicker: FC<{
    label?: string;
    value?: string;
    onChange: (value: string) => void;
    otherText?: string;
    options?: Array<{ id: string; label: string }>;
  }>;
}

declare module 'blinker-platform/api' {
  export const blinkerApi: {
    notes: {
      list(opts: {
        contact_id?: string | null;
        opportunity_id?: string | null;
      }): Array<{ body: string }>;
      add(note: {
        body: string;
        contact_id?: string | null;
        opportunity_id?: string | null;
        author_id?: string;
        author_persona?: string;
      }): void;
    };
  };
}

declare module 'blinker-platform/utils' {
  export function estimateMileageFromAge(year: number): number;
  export function computeAnnualMileageEstimate(mileage: number, year: number): number;
  export const YEARS: number[];
  export function getMakes(year: number): string[];
  export function getModelsForYearMake(year: number, make: string): string[];
  export function getTrimsForYearMakeModel(year: number, make: string, model: string): string[];
}

declare module 'blinker-platform/telemetry' {
  export function track(event: string, data?: Record<string, string | number | boolean | null | undefined | string[]>): void;
}
