// Credit band enums
export type CreditBand = '300_579' | '580_669' | '670_739' | '740_799' | '800_850';

// Ownership types
export type OwnershipType = 'financed' | 'leased' | 'owned' | 'none';

// Employment types
export type EmploymentType =
    | 'At Home'
    | 'Disability'
    | 'Employed'
    | 'Executive'
    | 'Labourer'
    | 'Management'
    | 'Military'
    | 'Office Staff'
    | 'Other'
    | 'Production'
    | 'Professional'
    | 'Retired'
    | 'Retired - Military'
    | 'Sales'
    | 'Self-Employed'
    | 'Semi Professional'
    | 'Service'
    | 'Social Security'
    | 'Student'
    | 'Trades'
    | 'Unemployed';

// Housing types
export type HousingType = 'Own' | 'Rent' | 'Other';

// Relationship types
export type RelationshipType =
    | 'Spouse'
    | 'Child'
    | 'Parent'
    | 'Sibling'
    | 'Grandparent'
    | 'Relative'
    | 'Domestic Partner'
    | 'Roommate'
    | 'Other';

// User personas
export type Persona = 'consumer' | 'agent' | 'manager' | 'admin' | 'super_admin';

// View types
export type ViewType = 'customer' | 'agent' | 'partner';
