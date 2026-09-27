import { useState } from 'react';

function App() {
  const [salary, setSalary] = useState('');
  const [needsPercent, setNeedsPercent] = useState(50);
  const [wantsPercent, setWantsPercent] = useState(30);
  const [savingsPercent, setSavingsPercent] = useState(20);

  // New expense state variables
  const [expenses, setExpenses] = useState([]);
  const [expenseName, setExpenseName] = useState('');
  const [expenseCost, setExpenseCost] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('needs');

  const parsedSalary = parseFloat(salary);
  const isValid = !isNaN(parsedSalary) && parsedSalary >= 0;

  // Calculate dollar amounts dynamically based on current slider percentages
  const needs = isValid ? (parsedSalary * (needsPercent / 100)).toFixed(2) : '0.00';
  const wants = isValid ? (parsedSalary * (wantsPercent / 100)).toFixed(2) : '0.00';
  const savings = isValid ? (parsedSalary * (savingsPercent / 100)).toFixed(2) : '0.00';

  // Proportional balancing logic
  const handleSliderChange = (type, newValue) => {
    const val = Math.min(100, Math.max(0, Number(newValue)));
    const remaining = 100 - val;

    if (type === 'needs') {
      setNeedsPercent(val);
      const ratio = (wantsPercent + savingsPercent > 0) ? wantsPercent / (wantsPercent + savingsPercent) : 0.6;
      setWantsPercent(Math.round(remaining * ratio));
      setSavingsPercent(remaining - Math.round(remaining * ratio));
    } else if (type === 'wants') {
      setWantsPercent(val);
      const ratio = (needsPercent + savingsPercent > 0) ? needsPercent / (needsPercent + savingsPercent) : 0.714;
      setNeedsPercent(Math.round(remaining * ratio));
      setSavingsPercent(remaining - Math.round(remaining * ratio));
    } else {
      setSavingsPercent(val);
      const ratio = (needsPercent + wantsPercent > 0) ? needsPercent / (needsPercent + wantsPercent) : 0.625;
      setNeedsPercent(Math.round(remaining * ratio));
      setWantsPercent(remaining - Math.round(remaining * ratio));
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 text-white">
      <h1 className="text-4xl font-semibold mb-6">Salary Allocator</h1>
      <div className="w-full max-w-md mb-8">
        <label htmlFor="salary" className="block text-sm font-medium mb-1">
          Monthly Net Salary
        </label>
        <input
          id="salary"
          type="number"
          value={salary}
          onChange={(e) => setSalary(e.target.value)}
          placeholder="Enter amount"
          className="w-full px-3 py-2 rounded-md bg-gray-800 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
      <div className="w-full max-w-md grid grid-cols-1 gap-4">
        <div className="p-4 rounded-md bg-indigo-600 shadow-md">
          <h2 className="text-lg font-semibold">Needs ({needsPercent}%)</h2>
          <p className="mt-2 text-2xl font-bold">${needs}</p>
          <input
            type="range"
            min="0"
            max="100"
            value={needsPercent}
            onChange={(e) => handleSliderChange('needs', e.target.value)}
            className="w-full mt-2"
          />
        </div>
        <div className="p-4 rounded-md bg-pink-600 shadow-md">
          <h2 className="text-lg font-semibold">Wants ({wantsPercent}%)</h2>
          <p className="mt-2 text-2xl font-bold">${wants}</p>
          <input
            type="range"
            min="0"
            max="100"
            value={wantsPercent}
            onChange={(e) => handleSliderChange('wants', e.target.value)}
            className="w-full mt-2"
          />
        </div>
        <div className="p-4 rounded-md bg-green-600 shadow-md">
          <h2 className="text-lg font-semibold">Savings/Investments ({savingsPercent}%)</h2>
          <p className="mt-2 text-2xl font-bold">${savings}</p>
          <input
            type="range"
            min="0"
            max="100"
            value={savingsPercent}
            onChange={(e) => handleSliderChange('savings', e.target.value)}
            className="w-full mt-2"
          />
        </div>
      </div>

      {/* Expense Form */}
      <div className="w-full max-w-md mt-8">
        <h2 className="text-2xl font-semibold mb-4">Add Expense</h2>
        <form className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Expense Name</label>
            <input
              type="text"
              value={expenseName}
              onChange={(e) => setExpenseName(e.target.value)}
              placeholder="e.g., Rent"
              className="w-full px-3 py-2 rounded-md bg-gray-800 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Expense Cost</label>
            <input
              type="number"
              value={expenseCost}
              onChange={(e) => setExpenseCost(e.target.value)}
              placeholder="e.g., 1200"
              className="w-full px-3 py-2 rounded-md bg-gray-800 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Category</label>
            <select
              value={expenseCategory}
              onChange={(e) => setExpenseCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-gray-800 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="needs">Needs</option>
              <option value="wants">Wants</option>
              <option value="savings">Savings/Investments</option>
            </select>
          </div>
          {/* Submit button placeholder (no functionality yet) */}
          <button
            type="button"
            className="w-full py-2 px-4 rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
          >
            Add Expense
          </button>
        </form>
      </div>

      {/* Expense List */}
      <div className="w-full max-w-md mt-6">
        <h3 className="text-xl font-semibold mb-2">Expenses</h3>
        <ul className="space-y-2">
          {expenses.map((exp, index) => (
            <li key={index} className="p-2 rounded-md bg-gray-800">
              <span className="font-medium">{exp.name}</span> - ${exp.cost} ({exp.category})
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default App;
