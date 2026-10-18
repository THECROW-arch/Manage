export const hexColorMap = {
  'indigo-600': '#4f46e5',
  'pink-600': '#db2777',
  'green-600': '#16a34a',
  'teal-600': '#0d9488',
  'orange-600': '#ea580c',
  'cyan-600': '#0891b2',
  'purple-600': '#9333ea',
  'rose-600': '#e11d48',
  'amber-600': '#d97706',
};

export const progressiveTaxBrackets = {
  MA: [ // Moroccan Impôt sur le Revenu (IR)
    { min: 0, max: 30000, rate: 0 },
    { min: 30000, max: 50000, rate: 0.10 },
    { min: 50000, max: 60000, rate: 0.20 },
    { min: 60000, max: 80000, rate: 0.30 },
    { min: 80000, max: 180000, rate: 0.34 },
    { min: 180000, max: Infinity, rate: 0.38 }
  ],
  US: [ // US Single Filer (Simplified)
    { min: 0, max: 11600, rate: 0.37 },
    { min: 11600, max: 47150, rate: 0.12 },
    { min: 47150, max: 100525, rate: 0.22 },
    { min: 100525, max: 191950, rate: 0.24 },
    { min: 191950, max: 243725, rate: 0.32 },
    { min: 243725, max: Infinity, rate: 0.35 }
  ],
  US_married: [ // US Married Filing Jointly
    { min: 0, max: 23200, rate: 0.10 },
    { min: 23200, max: 94300, rate: 0.12 },
    { min: 94300, max: 201050, rate: 0.22 },
    { min: 201050, max: 383900, rate: 0.24 },
    { min: 383900, max: 487450, rate: 0.32 },
    { min: 487450, max: 731200, rate: 0.35 },
    { min: 731200, max: Infinity, rate: 0.37 }
  ],
  UK: [ // UK Income Tax
    { min: 0, max: 12570, rate: 0.45 },
    { min: 12570, max: 50270, rate: 0.20 },
    { min: 50270, max: 125140, rate: 0.40 },
    { min: 125140, max: Infinity, rate: 0.45 }
  ]
};
/**
 * Returns the current date in YYYY-MM-DD format.
 */
export const getToday = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
/**
 * Returns the current month in YYYY-MM format.
 */
export const getCurrentMonth = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
};