import { useState } from 'react';

function App() {
  const [salary, setSalary] = useState('');
  const [needsPercent, setNeedsPercent] = useState(50);
  const [wantsPercent, setWantsPercent] = useState(30);
  const [savingsPercent, setSavingsPercent] = useState(20);

  const parsedSalary = parseFloat(salary);
  const isValid = !isNaN(parsedSalary) && parsedSalary >= 0;

  const needs = isValid ? (parsedSalary * 0.5).toFixed(2) : '0.00';
  const wants = isValid ? (parsedSalary * 0.3).toFixed(2) : '0.00';
  const savings = isValid ? (parsedSalary * 0.2).toFixed(2) : '0.00';

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
            onChange={(e) => setNeedsPercent(Number(e.target.value))}
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
            onChange={(e) => setWantsPercent(Number(e.target.value))}
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
            onChange={(e) => setSavingsPercent(Number(e.target.value))}
            className="w-full mt-2"
          />
        </div>
      </div>
    </div>
  );
}

export default App;
