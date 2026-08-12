const MOCK_OFFERS = [
  {
    id: "sg_a", lender: "Pinnacle Credit Union",
    apr: 6.49, term: 60, monthly: 389, savings: 67,
    disclaimer: "APR based on 720+ FICO, verified income. Subject to final approval.",
  },
  {
    id: "sg_b", lender: "Horizon Bank",
    apr: 6.99, term: 72, monthly: 342, savings: 114,
    disclaimer: "72-month term. Longer terms may increase total interest paid.",
  },
  {
    id: "sg_c", lender: "FirstMark Financial",
    apr: 7.25, term: 48, monthly: 462, savings: 0,
    disclaimer: "48-month term available for qualified borrowers.",
  },
];

const MOCK_PROTECTION_PLANS = [
  {
    id: "best",
    tier: "Best",
    name: "Blinker Exclusionary Plan",
    monthlyPrice: 322.43,
    term: "36 months",
    mileage: "40,000 miles",
    tagline: "Most comprehensive coverage available",
    covered: ["Engine", "Transmission", "A/C", "Fuel System", "Electrical", "High-tech Options", "Seals and Gaskets", "Cooling System", "Transfer Case", "Drive Axle"],
  },
  {
    id: "better",
    tier: "Better",
    name: "Blinker Premium Plan",
    monthlyPrice: 222.43,
    term: "36 months",
    mileage: "40,000 miles",
    tagline: "Enhanced powertrain + electrical protection",
    covered: ["Engine", "Transmission", "A/C", "Electrical", "Cooling System", "Drive Axle"],
  },
  {
    id: "good",
    tier: "Good",
    name: "Blinker Powertrain Plan",
    monthlyPrice: 122.43,
    term: "24 months",
    mileage: "30,000 miles",
    tagline: "Essential powertrain protection",
    covered: ["Engine", "Transmission", "Drive Axle", "Transfer Case"],
  },
];

const MOCK_INSURANCE_QUOTES = [
  { carrier: "Progressive", logo: "PROGRESSIVE", monthlyQuoted: 273 },
  { carrier: "Nationwide", logo: "Nationwide", monthlyQuoted: 279 },
  { carrier: "Travelers", logo: "TRAVELERS", monthlyQuoted: 285 },
  { carrier: "Safeco", logo: "Safeco Insurance", monthlyQuoted: 291 },
];

const MOCK_INSURANCE_SAVINGS = {
  bestCarrier: "Progressive",
  currentCarrier: "State Farm",
  currentMonthly: 298,
  bestMonthly: 273,
  monthlySavings: 25,   // 298 - 273
  annualSavings: 300,    // 25 * 12
  coverageChecks: [
    { label: "Exceeds State Minimums", pass: true },
    { label: "Review Deductible", pass: false },
    { label: "Price compared to market", pass: false },
  ],
};

export {
  MOCK_OFFERS,
  MOCK_PROTECTION_PLANS,
  MOCK_INSURANCE_QUOTES,
  MOCK_INSURANCE_SAVINGS,
};
