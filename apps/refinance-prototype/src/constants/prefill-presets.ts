const PREFILL_PRESETS = [
  {
    label: "Jamie Rivera · Jeep Wrangler",
    payload: {
      applicant: { firstName: "Jamie", lastName: "Rivera", phone: "5555550142", email: "jamie.rivera@example.com" },
      vehicle: { year: 2025, make: "Jeep", model: "Wrangler", trim: "Rubicon", mileage: 14000, condition: "Used" },
    },
  },
  {
    label: "Sanders couple · Camry (w/ co-app)",
    payload: {
      applicant: { firstName: "Tom", lastName: "Sanders", phone: "5555550187", email: "tom.sanders@example.com" },
      coApplicant: { firstName: "Jill", lastName: "Sanders", phone: "5555550188", email: "jill.sanders@example.com", relationship: "Spouse" },
      vehicle: { year: 2023, make: "Toyota", model: "Camry", trim: "Se", mileage: 32000, condition: "Used" },
    },
  },
  {
    label: "Alex Chen · Tesla (new, VIN)",
    payload: {
      applicant: { firstName: "Alex", lastName: "Chen", phone: "5555550199", email: "alex.chen@example.com" },
      vehicle: { vin: "5YJ3E1EA7KF317000", year: 2026, make: "Tesla", model: "Model 3", trim: "", mileage: 100, condition: "New" },
    },
  },
  {
    label: "Morgan Lee · Ford F-150",
    payload: {
      applicant: { firstName: "Morgan", lastName: "Lee", phone: "5555550170", email: "morgan.lee@example.com" },
      vehicle: { year: 2022, make: "Ford", model: "F-150", trim: "Xlt", mileage: 48000, condition: "Used" },
    },
  },
];
// Legacy alias so existing references keep working.
const VEHICLE_PRESETS = PREFILL_PRESETS;

// ---------- Validators ----------

export type PrefillPayload = {
  vehicle?: {
    vin?: string; year?: number; make?: string; model?: string;
    trim?: string; mileage?: number; condition?: string;
  };
  applicant?: { firstName?: string; lastName?: string; phone?: string; email?: string };
  coApplicant?: {
    firstName?: string; lastName?: string; phone?: string;
    email?: string; relationship?: string;
  };
};

// Filters user input to numeric-only (with optional decimal).
function sanitizeNumeric(v: string, { decimal = true }: { decimal?: boolean } = {}): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  s = decimal ? s.replace(/[^0-9.]/g, "") : s.replace(/[^0-9]/g, "");
  if (decimal) {
    const firstDot = s.indexOf(".");
    if (firstDot !== -1) {
      s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
    }
  }
  return s;
}

// Parses a flexible date string. Accepts digits only (no separator required)
// in formats like MMDDYYYY, MDYYYY, MDDYYYY, MMDDYY, MDYY, as well as slashed
// forms like M/D/YY or MM/DD/YYYY. Returns { month, day, year, date } or null.
function parseFlexDate(v: string): { month: number; day: number; year: number; date: Date } | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  let mm, dd, yy;
  if (s.includes("/") || s.includes("-") || s.includes(".")) {
    const parts = s.split(/[/.-]/);
    if (parts.length !== 3) return null;
    [mm, dd, yy] = parts;
    if (!/^\d+$/.test(mm) || !/^\d+$/.test(dd) || !/^\d+$/.test(yy)) return null;
  } else {
    if (!/^\d+$/.test(s)) return null;
    if (s.length === 8) {
      // MMDDYYYY
      mm = s.slice(0, 2); dd = s.slice(2, 4); yy = s.slice(4);
    } else if (s.length === 7) {
      // Assume MDDYYYY (single-digit month, 2-digit day, 4-digit year)
      mm = s.slice(0, 1); dd = s.slice(1, 3); yy = s.slice(3);
    } else if (s.length === 6) {
      // MDYYYY (single-digit month, single-digit day, 4-digit year)
      mm = s.slice(0, 1); dd = s.slice(1, 2); yy = s.slice(2);
    } else if (s.length === 5) {
      // MDDYY or MMDYY — assume MDDYY (single-digit month, 2-digit day, 2-digit year)
      mm = s.slice(0, 1); dd = s.slice(1, 3); yy = s.slice(3);
    } else if (s.length === 4) {
      // MDYY
      mm = s.slice(0, 1); dd = s.slice(1, 2); yy = s.slice(2);
    } else {
      return null;
    }
  }
  const month = parseInt(mm, 10);
  const day = parseInt(dd, 10);
  let year = parseInt(yy, 10);
  if (isNaN(month) || isNaN(day) || isNaN(year)) return null;
  if (yy.length === 2) year = year > 50 ? 1900 + year : 2000 + year;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (year < 1900 || year > 2100) return null;
  const d = new Date(year, month - 1, day);
  if (d.getMonth() + 1 !== month || d.getDate() !== day) return null;
  return { month, day, year, date: d };
}

const validators = {
  required: (v: string | null): string | null => (!v || v.trim() === "") ? "Required" : null,
  email: (v: string): string | null => {
    if (!v) return null;
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? null : "Enter a valid email address";
  },
  usPhone: (v: string): string | null => {
    if (!v) return null;
    const digits = v.replace(/\D/g, "");
    return digits.length === 10 ? null : "Enter a 10-digit US phone number";
  },
  ssn: (v: string): string | null => {
    if (!v) return null;
    const digits = v.replace(/\D/g, "");
    return digits.length === 9 ? null : "SSN must be 9 digits";
  },
  zip: (v: string): string | null => {
    if (!v) return null;
    return /^\d{5}(-\d{4})?$/.test(v.trim()) ? null : "Enter a 5-digit ZIP code";
  },
  state2: (v: string): string | null => {
    if (!v) return null;
    return /^[A-Za-z]{2}$/.test(v.trim()) ? null : "Use the 2-letter state abbreviation";
  },
  vin: (v: string): string | null => {
    if (!v) return null;
    const upper = v.trim().toUpperCase();
    if (upper.length !== 17) return "VIN must be exactly 17 characters";
    if (/[IOQ]/.test(upper)) return "VIN cannot contain I, O, or Q";
    if (!/^[A-HJ-NPR-Z0-9]+$/.test(upper)) return "VIN can only contain letters and digits";
    return null;
  },
  flexDate: (v: string): string | null => {
    if (!v) return null;
    return parseFlexDate(v) ? null : "Enter a valid date";
  },
  flexDateInPast: (v: string): string | null => {
    if (!v) return null;
    const parsed = parseFlexDate(v);
    if (!parsed) return "Enter a valid date";
    if (parsed.date > new Date()) return "Date must be in the past";
    return null;
  },
  positiveCurrency: (v: string): string | null => {
    if (v === "") return null;
    if (!/^\d*\.?\d*$/.test(v)) return "Enter a number";
    const n = Number(v);
    if (Number.isNaN(n)) return "Enter a number";
    if (n <= 0) return "Must be greater than 0";
    return null;
  },
  positiveInt: (v: string): string | null => {
    if (v === "") return null;
    if (!/^\d+$/.test(v)) return "Enter a whole number";
    const n = Number(v);
    if (Number.isNaN(n) || n <= 0) return "Must be greater than 0";
    return null;
  },
};

function parseDob(str: string): Date | null {
  const parsed = parseFlexDate(str);
  return parsed ? parsed.date : null;
}

function ageYears(dobStr: string): number | null {
  const dob = parseDob(dobStr);
  if (!dob || isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const md = today.getMonth() - dob.getMonth();
  if (md < 0 || (md === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

function dobAdult(v: string): string | null {
  const fmt = validators.flexDateInPast(v);
  if (fmt) return fmt;
  const age = ageYears(v);
  if (age === null) return "Enter a valid date";
  if (age < 18) return "Applicant must be 18 or older";
  if (age > 110) return "Enter a valid date of birth";
  return null;
}

// Phone formatter: given any string, keep up to 10 digits and render
// as (###) ###-####. Returns both the digits and display form.
function formatPhoneDisplay(digits: string): string {
  const d = String(digits || "").replace(/\D/g, "").slice(0, 10);
  if (d.length === 0) return "";
  if (d.length < 4) return "(" + d;
  if (d.length < 7) return "(" + d.slice(0, 3) + ") " + d.slice(3);
  return "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6);
}

// ---------- Sequence ----------


export {
  PREFILL_PRESETS,
  VEHICLE_PRESETS,
};
