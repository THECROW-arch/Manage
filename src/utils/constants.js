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
  MA: [ // Moroccan Impôt sur le Revenu (IR), 2026, MAD
    { min: 0, max: 40000, rate: 0 },
    { min: 40000, max: 60000, rate: 0.10 },
    { min: 60000, max: 80000, rate: 0.20 },
    { min: 80000, max: 100000, rate: 0.30 },
    { min: 100000, max: 180000, rate: 0.34 },
    { min: 180000, max: Infinity, rate: 0.37 }
  ],
  US: [ // US Single Filer, 2026, USD
    { min: 0, max: 12400, rate: 0.10 },
    { min: 12400, max: 50400, rate: 0.12 },
    { min: 50400, max: 105700, rate: 0.22 },
    { min: 105700, max: 201775, rate: 0.24 },
    { min: 201775, max: 256225, rate: 0.32 },
    { min: 256225, max: 640600, rate: 0.35 },
    { min: 640600, max: Infinity, rate: 0.37 }
  ],
  US_married: [ // US Married Filing Jointly, 2026, USD
    { min: 0, max: 24800, rate: 0.10 },
    { min: 24800, max: 100800, rate: 0.12 },
    { min: 100800, max: 211400, rate: 0.22 },
    { min: 211400, max: 403550, rate: 0.24 },
    { min: 403550, max: 512450, rate: 0.32 },
    { min: 512450, max: 768700, rate: 0.35 },
    { min: 768700, max: Infinity, rate: 0.37 }
  ],
  UK: [ // UK Income Tax
    { min: 0, max: 12570, rate: 0 },
    { min: 12570, max: 50270, rate: 0.20 },
    { min: 50270, max: 125140, rate: 0.40 },
    { min: 125140, max: Infinity, rate: 0.45 }
  ]
};

export const taxCurrencies = { US: 'USD', UK: 'GBP', MA: 'MAD' };

export const calculateProgressiveTax = (income, country, filingStatus) => {
  // Joint filing is supported only by the US schedule.
  const bracketKey = country === 'US' && filingStatus === 'married' ? 'US_married' : country;
  let brackets = progressiveTaxBrackets[bracketKey] || progressiveTaxBrackets.US;
  if (country === 'UK') {
    const allowance = Math.max(0, 12570 - Math.max(0, income - 100000) / 2);
    // The basic-rate band remains £37,700 wide as the allowance tapers.
    const basicRateEnd = allowance + 37700;
    brackets = brackets.map((bracket, index) => {
      if (index === 0) return { ...bracket, max: allowance };
      if (index === 1) return { ...bracket, min: allowance, max: basicRateEnd };
      if (index === 2) return { ...bracket, min: basicRateEnd };
      return bracket;
    });
  }

  let owed = 0;
  const breakdown = [];
  for (const bracket of brackets) {
    if (income > bracket.min) {
      const amountTaxed = Math.min(income, bracket.max) - bracket.min;
      const taxResult = amountTaxed * bracket.rate;
      owed += taxResult;
      breakdown.push({ rate: Math.round(bracket.rate * 100), amountTaxed, taxResult });
    }
  }
  return { income, owed, net: income - owed, rate: (income > 0 ? owed / income * 100 : 0).toFixed(1), breakdown };
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
