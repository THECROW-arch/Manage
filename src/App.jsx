import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import Auth from './Auth';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const colorClassMap = {
  'indigo-600': 'bg-indigo-600',
  'pink-600': 'bg-pink-600',
  'green-600': 'bg-green-600',
  'teal-600': 'bg-teal-600',
  'orange-600': 'bg-orange-600',
  'cyan-600': 'bg-cyan-600',
  'purple-600': 'bg-purple-600',
  'rose-600': 'bg-rose-600',
  'amber-600': 'bg-amber-600',
};

// Map Tailwind classes to hex codes for Recharts SVG rendering
const hexColorMap = {
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

const getToday = () => new Date().toISOString().split('T')[0];
const getCurrentMonth = () => new Date().toISOString().slice(0, 7);

export default function App() {
  const [session, setSession] = useState(null);
  const [loadingData, setLoadingData] = useState(true);

  const [salary, setSalary] = useState('');
  const [categories, setCategories] = useState([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  
  const [expenses, setExpenses] = useState([]);
  const [expenseName, setExpenseName] = useState('');
  const [expenseCost, setExpenseCost] = useState('');
  const [expenseCategoryId, setExpenseCategoryId] = useState('');
  
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth());
  const [expenseDate, setExpenseDate] = useState(getToday());

  const [currency, setCurrency] = useState('$');
  const [currencyMode, setCurrencyMode] = useState('preset');

  const [editingCategory, setEditingCategory] = useState(null);
  const [editingExpense, setEditingExpense] = useState(null);
  const [alertMsg, setAlertMsg] = useState('');

  const fetchUserData = async (userId) => {
    setLoadingData(true);
    
    let { data: profile } = await supabase.from('profiles').select('*').eq('user_id', userId).single();
    if (!profile) {
      const { data: newProfile } = await supabase.from('profiles').insert([{ user_id: userId }]).select().single();
      profile = newProfile;
    }
    
    if (profile) {
      setSalary(profile.salary > 0 ? profile.salary.toString() : '');
      if (profile.currency !== undefined) {
        setCurrency(profile.currency);
        if (!['$', '€', '£', 'MAD', ''].includes(profile.currency)) setCurrencyMode('custom');
        else if (profile.currency === '') setCurrencyMode('none');
        else setCurrencyMode(profile.currency);
      }
    }

    let { data: cats } = await supabase.from('categories').select('*').eq('user_id', userId).order('created_at', { ascending: true });
    cats = cats || []; 
    
    if (cats.length === 0) {
      const defaultCats = [
        { user_id: userId, name: 'Needs', percentage: 50, color: 'indigo-600' },
        { user_id: userId, name: 'Wants', percentage: 30, color: 'pink-600' },
        { user_id: userId, name: 'Savings', percentage: 20, color: 'green-600' }
      ];
      const { data: seededCats } = await supabase.from('categories').insert(defaultCats).select();
      cats = seededCats || defaultCats; 
    }
    
    setCategories(cats);
    if (cats.length > 0) setExpenseCategoryId(cats[0].id);

    let { data: expensesData } = await supabase.from('expenses').select('*').eq('user_id', userId).order('expense_date', { ascending: false });
    setExpenses(expensesData || []);
    
    setLoadingData(false);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchUserData(session.user.id);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchUserData(session.user.id);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session || loadingData) return;
    const delayDebounceFn = setTimeout(async () => {
      await supabase.from('profiles').upsert({ 
        user_id: session.user.id, 
        salary: parseFloat(salary) || 0,
        currency: currency 
      });
      for (const cat of categories) {
        if (cat.id) await supabase.from('categories').update({ percentage: Math.round(cat.percentage) }).eq('id', cat.id);
      }
    }, 1000);
    return () => clearTimeout(delayDebounceFn);
  }, [salary, categories, session, loadingData, currency]);

  const monthlyExpenses = expenses.filter(e => e.expense_date && e.expense_date.startsWith(selectedMonth));
  const parsedSalary = parseFloat(salary) || 0;

  const handleSliderChange = (changedId, newValue) => {
    const val = Math.max(0, Math.min(100, Number(newValue)));
    const changedCat = categories.find(c => c.id === changedId);
    const diff = val - changedCat.percentage;
    
    const others = categories.filter(c => c.id !== changedId);
    const othersTotal = others.reduce((sum, c) => sum + c.percentage, 0);
    
    const newCategories = categories.map(c => {
      if (c.id === changedId) return { ...c, percentage: val };
      if (othersTotal === 0) return { ...c, percentage: c.percentage - (diff / others.length) };
      const proportion = c.percentage / othersTotal;
      return { ...c, percentage: c.percentage - (diff * proportion) };
    });
    
    setCategories(newCategories);
  };

  const handleAddCategory = async (e) => {
    e.preventDefault();
    setAlertMsg('');
    if (!newCategoryName.trim()) return;

    const colors = ['teal-600', 'orange-600', 'cyan-600', 'purple-600', 'rose-600', 'amber-600'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    const { data, error } = await supabase.from('categories').insert([{
      user_id: session.user.id, name: newCategoryName.trim(), percentage: 0, color: randomColor
    }]).select();

    if (error) { setAlertMsg("Database Error: " + error.message); return; }
    setCategories([...categories, data[0]]);
    setNewCategoryName('');
  };

  const handleUpdateCategory = async (id, newName) => {
    if (!newName.trim()) return;
    const { error } = await supabase.from('categories').update({ name: newName.trim() }).eq('id', id);
    if (error) { setAlertMsg("Error updating: " + error.message); return; }
    
    setCategories(categories.map(c => c.id === id ? { ...c, name: newName.trim() } : c));
    setEditingCategory(null);
  };

  const handleDeleteCategory = async (id, percentage) => {
    if (categories.length <= 1) {
      setAlertMsg("You must have at least one category to allocate your budget.");
      return;
    }
    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) { setAlertMsg("Database Error: " + error.message); return; }

    const remainingCategories = categories.filter(c => c.id !== id);
    remainingCategories[0].percentage += percentage;
    
    setCategories(remainingCategories);
    setExpenses(expenses.filter(e => e.category_id !== id));
    if (expenseCategoryId === id) setExpenseCategoryId(remainingCategories[0].id);
  };

  const handleAddExpense = async (e) => {
    e.preventDefault();
    setAlertMsg('');
    const cost = parseFloat(expenseCost);
    if (!expenseName || isNaN(cost) || cost <= 0 || !expenseCategoryId || !expenseDate) return;

    if (expenseDate.startsWith(selectedMonth)) {
      const category = categories.find(c => c.id === expenseCategoryId);
      const categoryBase = parsedSalary * (category.percentage / 100);
      const categoryExpenses = monthlyExpenses.filter(e => e.category_id === expenseCategoryId).reduce((sum, e) => sum + parseFloat(e.cost), 0);
      const availableBalance = Math.max(0, categoryBase - categoryExpenses);

      if (cost > availableBalance) {
        setAlertMsg(`Expense exceeds the available balance for ${category.name} this month.`);
        return;
      }
    }

    const { data, error } = await supabase.from('expenses').insert([{
      user_id: session.user.id, 
      name: expenseName, 
      cost: cost, 
      category_id: expenseCategoryId, 
      category: categories.find(c => c.id === expenseCategoryId).name,
      expense_date: expenseDate 
    }]).select();

    if (error) { setAlertMsg("Database Error: " + error.message); return; }

    setExpenses([data[0], ...expenses]);
    setExpenseName('');
    setExpenseCost('');
  };

  const handleUpdateExpense = async (id, updatedExp) => {
    const cost = parseFloat(updatedExp.cost);
    if (!updatedExp.name || isNaN(cost) || cost <= 0 || !updatedExp.expense_date) return;

    const catName = categories.find(c => c.id === updatedExp.category_id)?.name;
    const { error } = await supabase.from('expenses').update({
        name: updatedExp.name, cost: cost, category_id: updatedExp.category_id, category: catName, expense_date: updatedExp.expense_date
    }).eq('id', id);

    if (error) { setAlertMsg("Error: " + error.message); return; }

    setExpenses(expenses.map(e => e.id === id ? { ...e, name: updatedExp.name, cost, category_id: updatedExp.category_id, category: catName, expense_date: updatedExp.expense_date } : e));
    setEditingExpense(null);
  };

  const handleDeleteExpense = async (id) => {
    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (error) { setAlertMsg("Database Error: " + error.message); return; }
    setExpenses(expenses.filter(e => e.id !== id));
  };

  // Generate data for the Recharts Donut Chart
  const chartData = categories.map(cat => {
    const val = parsedSalary * (cat.percentage / 100);
    return {
      name: cat.name,
      value: val,
      color: hexColorMap[cat.color] || '#4b5563'
    };
  }).filter(item => item.value > 0);

  if (!session) return <Auth />;
  if (loadingData) return <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center text-white"><p className="animate-pulse text-indigo-400 font-semibold">Loading data...</p></div>;

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 text-white pb-12 relative">
      <button onClick={() => supabase.auth.signOut()} className="absolute top-4 right-4 bg-gray-700 hover:bg-red-600 px-4 py-2 rounded-md text-sm font-semibold transition">Sign Out</button>
      <h1 className="text-4xl font-semibold mb-6">Salary Allocator</h1>
      
      <div className="w-full max-w-md mb-6 flex justify-between items-center bg-gray-800 p-4 rounded-lg border border-gray-700 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-300">Budget Month</h2>
        <input 
          type="month" 
          value={selectedMonth} 
          onChange={(e) => setSelectedMonth(e.target.value)} 
          className="px-3 py-2 rounded-md bg-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer" 
        />
      </div>

      <div className="w-full max-w-md mb-6 bg-gray-800 p-4 rounded-lg border border-gray-700 shadow-sm">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-lg font-semibold text-gray-300">Currency</h2>
          <div className="flex gap-2">
            <select 
              value={currencyMode} 
              onChange={(e) => {
                const mode = e.target.value;
                setCurrencyMode(mode);
                if (mode === 'none') setCurrency('');
                else if (mode !== 'custom') setCurrency(mode);
              }}
              className="px-3 py-1 rounded-md bg-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="$">$ (USD)</option>
              <option value="€">€ (Euro)</option>
              <option value="£">£ (GBP)</option>
              <option value="MAD">MAD</option>
              <option value="none">None</option>
              <option value="custom">Custom...</option>
            </select>
            {currencyMode === 'custom' && (
              <input 
                type="text" 
                value={currency} 
                onChange={(e) => setCurrency(e.target.value)} 
                placeholder="Sym" 
                maxLength="5"
                className="w-16 px-2 py-1 rounded-md bg-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-center" 
              />
            )}
          </div>
        </div>
        <p className="text-gray-400 text-xs italic">
          Don't see your native currency? We apologize! Please enter a custom symbol or choose 'None'.
        </p>
      </div>

      <div className="w-full max-w-md mb-8">
        <label className="block text-sm font-medium mb-1">Monthly Net Salary</label>
        <input 
          type="number" min="0" step="0.01" value={salary} 
          onChange={(e) => setSalary(e.target.value)} 
          onWheel={(e) => e.target.blur()} 
          onKeyDown={(e) => { if(e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault(); }}
          className="w-full px-3 py-2 rounded-md bg-gray-800 text-white focus:ring-2 focus:ring-indigo-500" 
        />
      </div>

      {chartData.length > 0 && (
        <div className="w-full max-w-md mb-8 bg-gray-800 p-4 rounded-lg border border-gray-700 shadow-sm flex flex-col items-center">
          <h2 className="text-lg font-semibold text-gray-300 mb-4">Budget Breakdown</h2>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Tooltip 
                contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', borderRadius: '0.5rem', color: '#f3f4f6' }}
                itemStyle={{ color: '#f3f4f6' }}
                formatter={(value) => `${currency}${value.toFixed(2)}`}
              />
              <Pie 
                data={chartData} 
                dataKey="value" 
                nameKey="name" 
                cx="50%" 
                cy="50%" 
                innerRadius={60} 
                outerRadius={80} 
                paddingAngle={5} 
                stroke="none"
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="w-full max-w-md grid grid-cols-1 gap-4">
        {categories.map((cat) => {
          const categoryBase = parsedSalary * (cat.percentage / 100);
          const spent = monthlyExpenses.filter(e => e.category_id === cat.id).reduce((sum, e) => sum + parseFloat(e.cost), 0);
          const remaining = Math.max(0, categoryBase - spent).toFixed(2);
          
          return (
            <div key={cat.id} className={`p-4 rounded-md shadow-md relative ${colorClassMap[cat.color] || 'bg-gray-700'}`}>
              <div className="absolute top-2 right-3 flex gap-3">
                <button onClick={() => setEditingCategory({ id: cat.id, name: cat.name })} className="text-white/50 hover:text-white font-bold" title="Edit Category Name">✎</button>
                <button onClick={() => handleDeleteCategory(cat.id, cat.percentage)} className="text-white/50 hover:text-white font-bold" title="Delete Category">✕</button>
              </div>
              
              {editingCategory?.id === cat.id ? (
                <div className="flex gap-2 mb-2 pr-12">
                  <input autoFocus type="text" value={editingCategory.name} onChange={e => setEditingCategory({...editingCategory, name: e.target.value})} className="px-2 py-1 text-black rounded w-full text-sm" />
                  <button onClick={() => handleUpdateCategory(cat.id, editingCategory.name)} className="bg-gray-900/50 hover:bg-gray-900 px-3 rounded font-bold">✓</button>
                </div>
              ) : (
                <h2 className="text-lg font-semibold">{cat.name} ({Math.round(cat.percentage)}%)</h2>
              )}

              <p className="mt-2 text-2xl font-bold">{currency}{remaining}</p>
              <input type="range" min="0" max="100" value={cat.percentage} onChange={(e) => handleSliderChange(cat.id, e.target.value)} className="w-full mt-2" />
            </div>
          );
        })}
      </div>

      <div className="w-full max-w-md mt-4 flex gap-2">
        <input type="text" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="New Category (e.g., Debt)" className="flex-1 px-3 py-2 rounded-md bg-gray-800 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <button onClick={handleAddCategory} className="px-4 py-2 rounded-md bg-gray-700 hover:bg-gray-600 text-white font-semibold transition">Add</button>
      </div>

      <div className="w-full max-w-md mt-8">
        <h2 className="text-2xl font-semibold mb-4">Add Expense</h2>
        {alertMsg && <div className="mb-4 p-3 rounded-md text-sm font-medium bg-red-500/10 border border-red-500/50 text-red-400">{alertMsg}</div>}
        <form onSubmit={handleAddExpense} className="space-y-4">
          <input type="text" value={expenseName} onChange={(e) => { setExpenseName(e.target.value); setAlertMsg(''); }} placeholder="Expense Name" className="w-full px-3 py-2 rounded-md bg-gray-800" required />
          
          <div className="flex gap-2">
            <input type="number" step="0.01" value={expenseCost} onChange={(e) => { setExpenseCost(e.target.value); setAlertMsg(''); }} placeholder="Cost" className="flex-1 px-3 py-2 rounded-md bg-gray-800" required />
            <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} className="w-1/3 px-3 py-2 rounded-md bg-gray-800 text-sm" required />
          </div>

          <select value={expenseCategoryId} onChange={(e) => { setExpenseCategoryId(e.target.value); setAlertMsg(''); }} className="w-full px-3 py-2 rounded-md bg-gray-800">
            {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
          </select>
          <button type="submit" className="w-full py-2 px-4 rounded-md bg-indigo-600 hover:bg-indigo-700">Add Expense</button>
        </form>
      </div>

      <div className="w-full max-w-md mt-6">
        <h3 className="text-xl font-semibold mb-2">Expenses for {new Date(selectedMonth + '-01').toLocaleString('default', { month: 'long', year: 'numeric' })}</h3>
        {monthlyExpenses.length === 0 ? <p className="text-gray-400 text-sm">No expenses logged for this month.</p> : (
          <ul className="space-y-2">
            {monthlyExpenses.map((exp) => (
              <li key={exp.id} className="p-3 rounded-md bg-gray-800 flex flex-col group border border-gray-700">
                {editingExpense?.id === exp.id ? (
                  <div className="flex flex-col gap-2 w-full text-sm">
                    <div className="flex gap-2">
                      <input type="text" value={editingExpense.name} onChange={e => setEditingExpense({...editingExpense, name: e.target.value})} className="px-2 py-1 text-black rounded flex-1" />
                      <input type="date" value={editingExpense.expense_date} onChange={e => setEditingExpense({...editingExpense, expense_date: e.target.value})} className="px-2 py-1 text-black rounded w-1/3" />
                    </div>
                    <div className="flex gap-2">
                      <input type="number" step="0.01" value={editingExpense.cost} onChange={e => setEditingExpense({...editingExpense, cost: e.target.value})} className="px-2 py-1 text-black rounded w-1/3" />
                      <select value={editingExpense.category_id} onChange={e => setEditingExpense({...editingExpense, category_id: e.target.value})} className="px-2 py-1 text-black rounded flex-1">
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <button onClick={() => handleUpdateExpense(exp.id, editingExpense)} className="bg-green-600 hover:bg-green-500 px-3 rounded font-bold text-white">✓</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-between items-center w-full">
                    <div className="flex flex-col">
                      <span><strong>{exp.name}</strong> ({currency}{Number(exp.cost).toFixed(2)})</span>
                      <span className="text-xs text-gray-400">{exp.expense_date}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs uppercase px-2 py-1 bg-gray-700 rounded text-gray-300">{exp.category}</span>
                      <button onClick={() => setEditingExpense({ id: exp.id, name: exp.name, cost: exp.cost, category_id: exp.category_id, expense_date: exp.expense_date })} className="text-indigo-400 hover:text-indigo-300 font-bold" title="Edit Expense">✎</button>
                      <button onClick={() => handleDeleteExpense(exp.id)} className="text-red-400 hover:text-red-300 font-bold" title="Delete Expense">✕</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}