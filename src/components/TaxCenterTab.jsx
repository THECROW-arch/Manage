/**
 * Provides a multi-region progressive tax calculator for estimating annual liability.
 */
export default function TaxCenterTab({
  taxCountry,
  setTaxCountry,
  taxFilingStatus,
  setTaxFilingStatus,
  currency,
  taxIncomeInput,
  setTaxIncomeInput,
  calculateTaxEstimate,
  taxEstimateResult,
  formatCurrency
}) {
  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      <div className="w-full bg-white dark:bg-zinc-900 p-8 rounded-lg border border-gray-200 dark:border-zinc-800 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Annual Tax Estimator</h2>
        <p className="text-gray-500 dark:text-zinc-500 text-sm mb-6">Select your region to estimate liability based on progressive brackets.</p>

        <div className="space-y-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-2">Country</label>
              <select
                value={taxCountry}
                onChange={(e) => setTaxCountry(e.target.value)}
                className="w-full px-3 py-2.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 text-sm"
              >
                <option value="US">United States</option>
                <option value="UK">United Kingdom</option>
                <option value="MA">Morocco</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-2">Filing Status</label>
              <select
                value={taxFilingStatus}
                onChange={(e) => setTaxFilingStatus(e.target.value)}
                className="w-full px-3 py-2.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 text-sm"
              >
                <option value="single">Single</option>
                <option value="married">Married Filing Jointly</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
              Est. Annual Income ({currency})
            </label>
            <input
              type="number"
              value={taxIncomeInput}
              onChange={(e) => setTaxIncomeInput(e.target.value)}
              className="w-full px-3 py-2.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 text-gray-900 dark:text-white font-mono focus:outline-none focus:border-indigo-500"
            />
          </div>

          <button
            onClick={calculateTaxEstimate}
            className="w-full py-2.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition-all text-sm shadow-md"
          >
            Calculate Progressive Tax
          </button>
        </div>

        {taxEstimateResult && (
          <div className="mb-8 p-5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-zinc-300 mb-4">Estimated Tax Breakdown</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between text-gray-600 dark:text-zinc-400">
                <span>Gross Annual Income:</span>
                <span className="font-mono text-gray-900 dark:text-zinc-200">{formatCurrency(taxEstimateResult.income)}</span>
              </div>

              <div className="py-3 my-3 border-y border-gray-200 dark:border-zinc-800 space-y-2">
                <p className="text-xs font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-wider mb-2">Bracket Calculation</p>
                {taxEstimateResult.breakdown.map((row, idx) => (
                  <div key={idx} className="flex justify-between text-xs text-gray-600 dark:text-zinc-400">
                    {row.label ? (
                      <span>{row.label}</span>
                    ) : (
                      <span>{row.rate}% applied to {formatCurrency(row.amountTaxed)}</span>
                    )}
                    <span className="font-mono">{row.taxResult < 0 ? '-' : ''}{formatCurrency(Math.abs(row.taxResult))}</span>
                  </div>
                ))}
              </div>

              <div className="flex justify-between text-gray-600 dark:text-zinc-400">
                <span>Estimated Tax Liability:</span>
                <span className="font-mono font-bold text-rose-600 dark:text-white">{formatCurrency(taxEstimateResult.owed)}</span>
              </div>
              <div className="flex justify-between text-gray-600 dark:text-zinc-400">
                <span>Estimated Net Income:</span>
                <span className="font-mono font-bold text-emerald-600 dark:text-zinc-200">{formatCurrency(taxEstimateResult.net)}</span>
              </div>
              <div className="flex justify-between text-gray-600 dark:text-zinc-400 border-t border-gray-200 dark:border-zinc-800 pt-3">
                <span>Effective Tax Rate:</span>
                <span className="font-mono font-bold text-gray-900 dark:text-zinc-200">{taxEstimateResult.rate}%</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}