import { useState, useEffect } from 'react';
import './App.css';
import { supabase } from './supabaseClient';
import Auth from './Auth';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

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

const getToday = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

const getCurrentMonth = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
};

export default function App() {
  const [session, setSession] = useState(null);
  const [loadingData, setLoadingData] = useState(true);

  // Safe Local Storage Retrievals to prevent White Screen Crashes
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('theme') || 'dark'; } 
    catch { return 'dark'; }
  });

  // Inject the theme into the root HTML tag and sync with local storage
  useEffect(() => {
    localStorage.setItem('theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  const [lockedCategories, setLockedCategories] = useState(() => {
    try {
      const saved = localStorage.getItem('lockedCats');
      return saved ? JSON.parse(saved) : [];
    } catch (error) {
      return [];
    }
  });

  const [selectedMonth, setSelectedMonth] = useState(() => {
    try { return localStorage.getItem('selectedMonth') || getCurrentMonth(); }
    catch { return getCurrentMonth(); }
  });

  const [closedMonths, setClosedMonths] = useState([]);
  const [activeTab, setActiveTab] = useState('cashflow'); // 'cashflow', 'portfolio', 'taxes', 'history', 'settings'

  const [salary, setSalary] = useState('');
  const [categories, setCategories] = useState([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryType, setNewCategoryType] = useState('expense');
  const [newCategoryGoal, setNewCategoryGoal] = useState('');

  const [expenses, setExpenses] = useState([]);
  const [expenseName, setExpenseName] = useState('');
  const [expenseCost, setExpenseCost] = useState('');
  const [expenseCategoryId, setExpenseCategoryId] = useState('');
  const [expenseDate, setExpenseDate] = useState(getToday());

  const [assetAdjustments, setAssetAdjustments] = useState([]);
  const [adjAmount, setAdjAmount] = useState('');
  const [adjDate, setAdjDate] = useState(getToday());
  const [adjNote, setAdjNote] = useState('');
  const [adjCatId, setAdjCatId] = useState('');
  const [editingAdj, setEditingAdj] = useState(null);

  const [currency, setCurrency] = useState('$');
  const [currencyMode, setCurrencyMode] = useState('preset');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('All');
  const [editingCategory, setEditingCategory] = useState(null);
  const [editingExpense, setEditingExpense] = useState(null);

  const [alertMsg, setAlertMsg] = useState('');

  const [taxCountry, setTaxCountry] = useState('US');
  const [taxFilingStatus, setTaxFilingStatus] = useState('single');
  const [taxIncomeInput, setTaxIncomeInput] = useState('');
  const [taxEstimateResult, setTaxEstimateResult] = useState(null);

  const [dragState, setDragState] = useState({ id: null, val: 0 });

  const todayMonth = getCurrentMonth();
  const isLockedInPast = selectedMonth < todayMonth && !closedMonths.includes(selectedMonth);

  useEffect(() => { localStorage.setItem('selectedMonth', selectedMonth); }, [selectedMonth]);
  useEffect(() => { localStorage.setItem('lockedCats', JSON.stringify(lockedCategories)); }, [lockedCategories]);
  useEffect(() => { localStorage.setItem('theme', theme); }, [theme]);

  // FIX: Auto-dismiss alerts after 4 seconds so they don't get stuck on screen
  useEffect(() => {
    if (alertMsg) {
      const timer = setTimeout(() => setAlertMsg(''), 4000);
      return () => clearTimeout(timer);
    }
  }, [alertMsg]);

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
      if (profile.tax_country) setTaxCountry(profile.tax_country);
      if (profile.tax_filing_status) setTaxFilingStatus(profile.tax_filing_status);
    }

    let { data: cats } = await supabase.from('categories').select('*').eq('user_id', userId).order('created_at', { ascending: true });
    cats = cats || [];

    if (cats.length === 0) {
      const defaultCats = [
        { user_id: userId, name: 'Needs', percentage: 50, color: 'indigo-600', type: 'expense', target_goal: 0 },
        { user_id: userId, name: 'Wants', percentage: 30, color: 'pink-600', type: 'expense', target_goal: 0 },
        { user_id: userId, name: 'Savings', percentage: 20, color: 'green-600', type: 'asset', target_goal: 50000 }
      ];
      const { data: seededCats } = await supabase.from('categories').insert(defaultCats).select();
      cats = seededCats || defaultCats;
    }

    setCategories(cats);
    if (cats.length > 0) {
      const firstExpenseCat = cats.find(c => c.type !== 'asset') || cats[0];
      setExpenseCategoryId(firstExpenseCat?.id || '');
      const firstAssetCat = cats.find(c => c.type === 'asset');
      if (firstAssetCat) setAdjCatId(firstAssetCat.id);
    }

    let { data: expensesData } = await supabase.from('expenses').select('*').eq('user_id', userId).order('expense_date', { ascending: false });
    setExpenses(expensesData || []);

    let { data: adjData } = await supabase.from('asset_adjustments').select('*').eq('user_id', userId).order('adjustment_date', { ascending: false });
    setAssetAdjustments(adjData || []);

    let { data: closedData } = await supabase.from('closed_months').select('*').eq('user_id', userId);
    setClosedMonths(closedData ? closedData.map(c => c.month) : []);

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
      try {
        await supabase.from('profiles').upsert({
          user_id: session.user.id,
          salary: parseFloat(salary) || 0,
          currency: currency,
          tax_country: taxCountry,
          tax_filing_status: taxFilingStatus
        });

        for (const cat of categories) {
          if (cat.id) await supabase.from('categories').update({ percentage: Math.round(cat.percentage) }).eq('id', cat.id);
        }
      } catch (error) {
        setAlertMsg("Warning: Auto-save failed.");
      }
    }, 1000);

    return () => clearTimeout(delayDebounceFn);
  }, [salary, categories, session, loadingData, currency, taxCountry, taxFilingStatus]);

  useEffect(() => {
    if (salary && !taxIncomeInput) {
      setTaxIncomeInput((parseFloat(salary) * 12).toFixed(2));
    }
  }, [salary, taxIncomeInput]);

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      setSession(null);
      setExpenses([]);
      setCategories([]);
      setAssetAdjustments([]);
      setClosedMonths([]);
      setSalary('');
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const formatCurrency = (amount) => {
    const num = Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return currency.length > 1 ? `${currency} ${num}` : `${currency}${num}`;
  };

  const parsedSalary = parseFloat(salary) || 0;
  const monthlyExpenses = expenses.filter(e => e.expense_date && e.expense_date.startsWith(selectedMonth));
  const expenseCategories = categories.filter(c => c.type !== 'asset');
  const assetCategories = categories.filter(c => c.type === 'asset');

  // History Log Aggregator
  const historyFeed = [
    ...closedMonths.map(m => ({
      id: `cm-${m}`,
      type: 'ledger',
      date: `${m}-28`,
      title: `Ledger Closed`,
      desc: `Finalized budget and executed wealth sweep for ${m}`
    })),
    ...assetAdjustments.map(a => ({
      id: a.id,
      type: 'adjustment',
      date: a.adjustment_date,
      title: a.note || 'Manual Adjustment',
      desc: `${a.amount > 0 ? '+' : ''}${formatCurrency(a.amount)} logged to ${categories.find(c => c.id === a.category_id)?.name || 'Asset'}`
    }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  const toggleIndividualLock = (id) => {
    setAlertMsg('');
    const currentlyLocked = lockedCategories.includes(id);

    if (currentlyLocked) {
      setLockedCategories(lockedCategories.filter(x => x !== id));
    } else {
      const total = categories.reduce((sum, c) => sum + c.percentage, 0);
      if (categories.length - lockedCategories.length === 1 && Math.abs(100 - total) > 0.5) {
        setAlertMsg(`Error: Cannot lock final category. Adjust by ${Math.round(Math.abs(100 - total))}% to hit 100%.`);
        return;
      }
      setLockedCategories([...lockedCategories, id]);
    }
  };
  const handleUnlockAll = () => {
    setLockedCategories([]);
    setAlertMsg("All categories unlocked.");
  };
  const handleSmartLockAll = () => {
    setAlertMsg('');
    const total = categories.reduce((sum, c) => sum + c.percentage, 0);
    const diff = 100 - total;

    // FIX: Silence redundant clicks if already completely locked and balanced
    if (Math.abs(diff) < 0.1) {
      if (lockedCategories.length === categories.length) return;

      setLockedCategories(categories.map(c => c.id));
      setAlertMsg("Perfect Balance: All categories locked at 100%.");
      return;
    }

    const unlocked = categories.filter(c => !lockedCategories.includes(c.id));
    if (unlocked.length === 0) {
      setAlertMsg(`Error: Cannot auto-balance. Board total is ${Math.round(total)}%. Unlock a category to adjust.`);
      return;
    }

    const newCats = [...categories];
    let auditLog = [];
    const othersTotal = unlocked.reduce((sum, c) => sum + c.percentage, 0);

    unlocked.forEach(u => {
      const catIndex = newCats.findIndex(c => c.id === u.id);
      const adjustment = othersTotal === 0 ? (diff / unlocked.length) : (diff * (u.percentage / othersTotal));
      newCats[catIndex].percentage += adjustment;

      const adjRounded = Math.round(adjustment);
      if (adjRounded !== 0) {
        auditLog.push(`${adjRounded > 0 ? 'Added' : 'Decreased'} ${Math.abs(adjRounded)}% ${adjRounded > 0 ? 'to' : 'from'} '${u.name}'`);
      }
    });

    setCategories(newCats);
    setLockedCategories(newCats.map(c => c.id));
    setAlertMsg(auditLog.length > 0 ? `Smart Lock: ${auditLog.join(', ')} to balance board.` : "Smart Lock Applied.");
  };

  const handleSliderChange = (changedId, newValue) => {
    if (isLockedInPast || lockedCategories.includes(changedId)) return;

    let val = Math.max(0, Math.min(100, Number(newValue)));
    const changedCat = categories.find(c => c.id === changedId);
    let diff = val - changedCat.percentage;

    const unlockedOthers = categories.filter(c => c.id !== changedId && !lockedCategories.includes(c.id));
    if (unlockedOthers.length === 0) return;

    const othersTotal = unlockedOthers.reduce((sum, c) => sum + c.percentage, 0);

    if (diff > 0 && diff > othersTotal) {
      diff = othersTotal;
      val = changedCat.percentage + diff;
    }

    const newCategories = categories.map(c => {
      if (c.id === changedId) return { ...c, percentage: val };
      if (lockedCategories.includes(c.id)) return c;

      return {
        ...c,
        percentage: c.percentage - (othersTotal === 0 ? (diff / unlockedOthers.length) : (diff * (c.percentage / othersTotal)))
      };
    });

    setCategories(newCategories);
  };

  const handleCloseMonth = async () => {
    const previousAdj = [...assetAdjustments];
    const previousClosed = [...closedMonths];

    try {
      const newAdjustments = [];
      assetCategories.forEach(cat => {
        const amount = parsedSalary * (cat.percentage / 100);
        if (amount > 0) {
          newAdjustments.push({
            user_id: session.user.id,
            category_id: cat.id,
            amount: amount,
            adjustment_date: `${selectedMonth}-28`,
            note: `Month-End Auto-Sweep (${selectedMonth})`
          });
        }
      });

      if (newAdjustments.length > 0) {
        const { data: insertedAdj, error: adjError } = await supabase.from('asset_adjustments').insert(newAdjustments).select();
        if (adjError) throw adjError;
        setAssetAdjustments([...insertedAdj, ...assetAdjustments]);
      }

      const { error: closeError } = await supabase.from('closed_months').insert([{ user_id: session.user.id, month: selectedMonth }]);
      if (closeError) throw closeError;

      setClosedMonths([...closedMonths, selectedMonth]);
      setSelectedMonth(todayMonth);
      setAlertMsg(`Success: ${selectedMonth} locked and wealth transferred.`);
      window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (error) {
      setAlertMsg("Database Error closing month: " + (error.message || error.details));
      setAssetAdjustments(previousAdj);
      setClosedMonths(previousClosed);
    }
  };

  const handleAddCategory = async (e) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;

    const goalVal = newCategoryType === 'asset' ? (parseFloat(newCategoryGoal) || 0) : 0;
    const colors = ['teal-600', 'orange-600', 'cyan-600', 'purple-600', 'rose-600', 'amber-600'];
    const tempId = Date.now().toString();
    const previousCategories = [...categories];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    setCategories([
      ...categories,
      { id: tempId, user_id: session.user.id, name: newCategoryName.trim(), percentage: 0, color: randomColor, type: newCategoryType, target_goal: goalVal }
    ]);
    setNewCategoryName('');
    setNewCategoryGoal('');

    try {
      const { data, error } = await supabase.from('categories').insert([{
        user_id: session.user.id, name: newCategoryName.trim(), percentage: 0, color: randomColor, type: newCategoryType, target_goal: goalVal
      }]).select();

      if (error) throw error;
      setCategories(current => current.map(c => c.id === tempId ? data[0] : c));
      if (newCategoryType !== 'asset' && !expenseCategoryId) setExpenseCategoryId(data[0].id);
      if (newCategoryType === 'asset' && !adjCatId) setAdjCatId(data[0].id);

    } catch (error) {
      setAlertMsg("Database Error: Failed to add category.");
      setCategories(previousCategories);
    }
  };

  const handleUpdateCategory = async (id, newName, newGoal = 0) => {
    if (!newName.trim()) return;
    const previousCategories = [...categories];
    const safeGoal = parseFloat(newGoal) || 0;

    setCategories(categories.map(c => c.id === id ? { ...c, name: newName.trim(), target_goal: safeGoal } : c));
    setEditingCategory(null);

    try {
      const { error } = await supabase.from('categories').update({ name: newName.trim(), target_goal: safeGoal }).eq('id', id);
      if (error) throw error;
    } catch (error) {
      setAlertMsg("Error updating category.");
      setCategories(previousCategories);
    }
  };

  const handleDeleteCategory = async (id, percentage) => {
    if (categories.length <= 1) return;
    const previousCategories = [...categories];
    const previousExpenses = [...expenses];
    const remainingCategories = categories.filter(c => c.id !== id);

    remainingCategories[0].percentage += percentage;

    setCategories(remainingCategories);
    setLockedCategories(lockedCategories.filter(catId => catId !== id));
    setExpenses(expenses.filter(e => e.category_id !== id));
    if (expenseCategoryId === id) setExpenseCategoryId(remainingCategories.find(c => c.type !== 'asset')?.id || '');

    try {
      const { error } = await supabase.from('categories').delete().eq('id', id);
      if (error) throw error;
    } catch (error) {
      setAlertMsg("Database Error: Failed to delete category.");
      setCategories(previousCategories);
      setExpenses(previousExpenses);
    }
  };

  const handleAddExpense = async (e) => {
    e.preventDefault();
    const cost = parseFloat(expenseCost);
    if (!expenseName || isNaN(cost) || cost <= 0 || !expenseCategoryId || !expenseDate) return;

    if (expenseDate.startsWith(selectedMonth)) {
      const category = categories.find(c => c.id === expenseCategoryId);
      const spentSoFar = monthlyExpenses.filter(e => e.category_id === expenseCategoryId).reduce((sum, e) => sum + parseFloat(e.cost), 0);
      const availableBalance = Math.max(0, (parsedSalary * (category.percentage / 100)) - spentSoFar);

      if (cost > availableBalance) {
        setAlertMsg(`Expense exceeds available balance for ${category.name}.`);
        return;
      }
    }

    const tempId = Date.now().toString();
    const newExpenseObj = {
      id: tempId, user_id: session.user.id, name: expenseName, cost: cost,
      category_id: expenseCategoryId, category: categories.find(c => c.id === expenseCategoryId).name,
      expense_date: expenseDate
    };

    setExpenses([newExpenseObj, ...expenses]);
    setExpenseName('');
    setExpenseCost('');

    try {
      const { data, error } = await supabase.from('expenses').insert([{
        user_id: newExpenseObj.user_id, name: newExpenseObj.name, cost: newExpenseObj.cost,
        category_id: newExpenseObj.category_id, category: newExpenseObj.category, expense_date: newExpenseObj.expense_date
      }]).select();

      if (error) throw error;
      setExpenses(current => current.map(exp => exp.id === tempId ? data[0] : exp));
    } catch (error) {
      setAlertMsg("Database Error: Failed to save expense.");
    }
  };

  const handleUpdateExpense = async (id, updatedExp) => {
    const cost = parseFloat(updatedExp.cost);
    if (!updatedExp.name || isNaN(cost) || cost <= 0 || !updatedExp.expense_date) return;

    const catName = categories.find(c => c.id === updatedExp.category_id)?.name;

    setExpenses(expenses.map(e => e.id === id ? {
      ...e, name: updatedExp.name, cost, category_id: updatedExp.category_id,
      category: catName, expense_date: updatedExp.expense_date
    } : e));
    setEditingExpense(null);

    try {
      const { error } = await supabase.from('expenses').update({
        name: updatedExp.name, cost: cost, category_id: updatedExp.category_id,
        category: catName, expense_date: updatedExp.expense_date
      }).eq('id', id);
      if (error) throw error;
    } catch (error) {
      setAlertMsg("Error updating expense.");
    }
  };

  const handleDeleteExpense = async (id) => {
    setExpenses(expenses.filter(e => e.id !== id));
    try {
      const { error } = await supabase.from('expenses').delete().eq('id', id);
      if (error) throw error;
    } catch (error) {
      setAlertMsg("Database Error: Failed to delete expense.");
    }
  };

  const handleAddAdjustment = async (e) => {
    e.preventDefault();
    const amt = parseFloat(adjAmount);
    if (!adjCatId || isNaN(amt) || !adjDate) return;

    const tempId = Date.now().toString();
    const newAdj = { id: tempId, user_id: session.user.id, category_id: adjCatId, amount: amt, adjustment_date: adjDate, note: adjNote };

    setAssetAdjustments([newAdj, ...assetAdjustments]);
    setAdjAmount('');
    setAdjNote('');

    try {
      const { data, error } = await supabase.from('asset_adjustments').insert([{
        user_id: session.user.id, category_id: adjCatId, amount: amt, adjustment_date: adjDate, note: adjNote
      }]).select();

      if (error) throw error;
      setAssetAdjustments(current => current.map(a => a.id === tempId ? data[0] : a));
    } catch (error) {
      setAlertMsg("Database Error: Failed to save adjustment.");
    }
  };

  const handleUpdateAdjustment = async (id, updatedAdj) => {
    const amt = parseFloat(updatedAdj.amount);
    if (isNaN(amt) || !updatedAdj.adjustment_date) return;

    setAssetAdjustments(assetAdjustments.map(a => a.id === id ? {
      ...a, amount: amt, note: updatedAdj.note, adjustment_date: updatedAdj.adjustment_date, category_id: updatedAdj.category_id
    } : a));
    setEditingAdj(null);

    try {
      const { error } = await supabase.from('asset_adjustments').update({
        amount: amt, note: updatedAdj.note, adjustment_date: updatedAdj.adjustment_date, category_id: updatedAdj.category_id
      }).eq('id', id);
      if (error) throw error;
    } catch (error) {
      setAlertMsg("Error updating adjustment.");
    }
  };

  const handleDeleteAdjustment = async (id) => {
    setAssetAdjustments(assetAdjustments.filter(a => a.id !== id));
    try {
      const { error } = await supabase.from('asset_adjustments').delete().eq('id', id);
      if (error) throw error;
    } catch (error) {
      setAlertMsg("Database Error: Failed to delete adjustment.");
    }
  };

  const calculateTaxMockup = () => {
    const income = parseFloat(taxIncomeInput) || 0;
    let mockRate = 0;
    switch (taxCountry) {
      case 'MA': mockRate = 0.38; break;
      case 'UK': mockRate = 0.20; break;
      case 'CA': mockRate = 0.25; break;
      case 'AU': mockRate = 0.32; break;
      case 'US': default: mockRate = 0.22; break;
    }
    if (taxFilingStatus === 'married') mockRate = Math.max(0, mockRate - 0.05);
    setTaxEstimateResult({
      income,
      owed: income * mockRate,
      net: income - (income * mockRate),
      rate: (mockRate * 100).toFixed(1)
    });
  };

  const totalSpent = monthlyExpenses.reduce((sum, e) => sum + parseFloat(e.cost), 0);
  const totalAutomatedAssets = assetCategories.reduce((sum, cat) => sum + (parsedSalary * (cat.percentage / 100)), 0);
  const totalAllocated = totalSpent + totalAutomatedAssets;
  const totalRemaining = Math.max(0, parsedSalary - totalAllocated);
  const globalPercentUsed = parsedSalary > 0 ? Math.min(100, (totalAllocated / parsedSalary) * 100) : 0;

  const filteredExpenses = monthlyExpenses.filter(exp =>
    exp.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
    (filterCategory === 'All' || exp.category_id === filterCategory)
  );

  const chartData = categories.map(cat => ({
    name: cat.name,
    value: parsedSalary * (cat.percentage / 100),
    color: hexColorMap[cat.color] || '#4b5563'
  })).filter(item => item.value > 0);

  if (!session) return <Auth />;
  if (loadingData) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center ${theme === 'dark' ? 'bg-zinc-950 text-zinc-100' : 'bg-gray-50 text-gray-900'}`}>
        <p className="animate-pulse font-semibold">Loading data...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-zinc-950 text-gray-900 dark:text-zinc-300 font-sans overflow-hidden transition-colors duration-300">
      {/* Enterprise Sidebar */}
      <aside className="w-64 bg-white dark:bg-zinc-900 border-r border-gray-200 dark:border-zinc-800 flex flex-col justify-between shrink-0 hidden md:flex">
        <div>
          <div className="p-6 border-b border-gray-200 dark:border-zinc-800">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">Salary Allocator</h1>
          </div>
          <nav className="flex-1 px-4 space-y-2 mt-6">
            {[
              { id: 'cashflow', name: 'Cash Flow', icon: 'M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
              { id: 'portfolio', name: 'Portfolio', icon: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z' },
              { id: 'taxes', name: 'Tax Center', icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z' },
              { id: 'history', name: 'History Logs', icon: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z' },
              { id: 'settings', name: 'Settings', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setAlertMsg(''); }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all ${activeTab === tab.id
                    ? 'bg-indigo-50 dark:bg-zinc-800 text-indigo-600 dark:text-white'
                    : 'text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-zinc-800/50'
                  }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
                </svg>
                {tab.name}
              </button>
            ))}
          </nav>
        </div>
        <div className="p-4 border-t border-gray-200 dark:border-zinc-800">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium text-gray-500 dark:text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-zinc-800/50 transition-all"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
            </svg>
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-4 md:p-10 relative custom-scrollbar">
        <div className="max-w-7xl mx-auto w-full">

          <header className="md:hidden flex flex-col gap-4 mb-6 pb-4 border-b border-gray-200 dark:border-zinc-800">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Salary Allocator</h1>
            <select
              value={activeTab}
              onChange={(e) => setActiveTab(e.target.value)}
              className="w-full p-2 rounded-md bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-sm"
            >
              <option value="cashflow">Cash Flow</option>
              <option value="portfolio">Portfolio</option>
              <option value="taxes">Tax Center</option>
              <option value="history">History Logs</option>
              <option value="settings">Settings</option>
            </select>
          </header>

          {activeTab === 'cashflow' && (
            <>
              {isLockedInPast && (
                <div className="w-full bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg p-6 mb-8 text-center">
                  <h2 className="text-xl font-bold text-amber-700 dark:text-amber-400 mb-2">Month-End Action Required</h2>
                  <p className="text-amber-600 dark:text-amber-200/80 mb-6 max-w-2xl mx-auto text-sm">
                    You must finalize the <strong>{selectedMonth}</strong> ledger before moving to the current month.
                  </p>
                  <button
                    onClick={handleCloseMonth}
                    className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-white dark:text-zinc-950 font-bold rounded-md transition-all text-sm shadow-md"
                  >
                    Close {selectedMonth} & Transfer Wealth
                  </button>
                </div>
              )}

              <div className="mb-6 flex items-center justify-between">
                <div className={`bg-white dark:bg-zinc-900 p-4 rounded-lg border ${isLockedInPast ? 'border-amber-300 dark:border-amber-500/30' : 'border-gray-200 dark:border-zinc-800'} w-full md:w-64`}>
                  <h2 className="text-xs font-semibold text-gray-500 dark:text-zinc-500 mb-2 uppercase tracking-wider">Budget Month</h2>
                  <input
                    type="month"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    disabled={isLockedInPast}
                    className={`w-full px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 text-gray-900 dark:text-zinc-200 focus:outline-none focus:border-indigo-500 transition-all text-sm ${isLockedInPast ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  />
                </div>
              </div>

              <div className={`grid grid-cols-1 lg:grid-cols-12 gap-8 items-start transition-opacity ${isLockedInPast ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>
                <div className="lg:col-span-5 space-y-6">

                  <div className="w-full bg-white dark:bg-zinc-900 p-6 rounded-lg border border-gray-200 dark:border-zinc-800 relative overflow-hidden">
                    <h2 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-2">Total Available Cash</h2>
                    <div className="flex items-baseline gap-2 mb-4">
                      <span className="text-4xl font-bold text-gray-900 dark:text-white tracking-tight">{formatCurrency(totalRemaining)}</span>
                      <span className="text-xs font-medium text-gray-500 dark:text-zinc-500">left of {formatCurrency(parsedSalary)}</span>
                    </div>
                    <div className="w-full bg-gray-100 dark:bg-zinc-950 rounded-full h-1.5 mb-3 overflow-hidden border border-gray-200 dark:border-zinc-800">
                      <div
                        className={`h-1.5 rounded-full transition-all duration-1000 ease-out ${globalPercentUsed > 85 ? 'bg-rose-500' : 'bg-indigo-500 dark:bg-zinc-400'}`}
                        style={{ width: `${globalPercentUsed}%` }}
                      ></div>
                    </div>
                    <div className="flex justify-between text-xs font-medium text-gray-500 dark:text-zinc-500">
                      <span>{formatCurrency(totalSpent)} Spent / {formatCurrency(totalAutomatedAssets)} Saved</span>
                      <span>{globalPercentUsed.toFixed(0)}% Consumed</span>
                    </div>
                  </div>

                  {chartData.length > 0 && (
                    <div className="w-full bg-white dark:bg-zinc-900 p-6 rounded-lg border border-gray-200 dark:border-zinc-800 flex flex-col items-center">
                      <h2 className="text-sm font-semibold text-gray-700 dark:text-zinc-300 mb-4 w-full text-left">Budget Breakdown</h2>
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Tooltip
                            contentStyle={{
                              backgroundColor: theme === 'dark' ? '#18181b' : '#ffffff',
                              borderColor: theme === 'dark' ? '#27272a' : '#e5e7eb',
                              borderRadius: '0.5rem',
                              color: theme === 'dark' ? '#e4e4e7' : '#111827',
                              fontSize: '12px'
                            }}
                            itemStyle={{ fontWeight: 'bold' }}
                            formatter={(value) => formatCurrency(value)}
                          />
                          <Pie
                            data={chartData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={2}
                            stroke="none"
                          >
                            {chartData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  <div className="space-y-4 mb-2 relative">
                    {alertMsg && (
                      <div className="absolute -top-14 left-0 right-0 z-10 p-3 rounded-md text-sm font-medium border bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-500/20 dark:border-indigo-500/40 dark:text-indigo-200 animate-fade-in shadow-lg">
                        {alertMsg}
                      </div>
                    )}

                    <div className="flex justify-between items-center bg-gray-50 dark:bg-zinc-900 p-2 rounded-lg border border-gray-200 dark:border-zinc-800">
                      <button
                        onClick={handleUnlockAll}
                        disabled={lockedCategories.length === 0}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-2 border ${lockedCategories.length === 0
                            ? 'border-transparent text-gray-400 dark:text-zinc-600 cursor-not-allowed'
                            : 'border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 hover:text-gray-900 dark:hover:text-white shadow-sm'
                          }`}
                      >
                        Unlock All
                      </button>
                      <button
                        onClick={handleSmartLockAll}
                        className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-xs font-bold transition-all flex items-center gap-2 shadow-md"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                        </svg>
                        Smart Lock Board
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4 max-h-[550px] overflow-y-auto pr-2 custom-scrollbar pb-2">
                    {categories.map((cat) => {
                      const categoryBase = parsedSalary * (cat.percentage / 100);
                      const isAsset = cat.type === 'asset';
                      const spent = isAsset ? 0 : monthlyExpenses.filter(e => e.category_id === cat.id).reduce((sum, e) => sum + parseFloat(e.cost), 0);
                      const remaining = isAsset ? categoryBase : Math.max(0, categoryBase - spent);
                      const percentUsed = isAsset ? 100 : (categoryBase > 0 ? Math.min(100, (spent / categoryBase) * 100) : 0);

                      let healthColor = isAsset ? "bg-emerald-500" : "bg-indigo-500";
                      if (!isAsset && percentUsed > 75) healthColor = "bg-amber-500";
                      if (!isAsset && percentUsed >= 90) healthColor = "bg-rose-500";

                      const isDragging = dragState.id === cat.id;
                      const currentPercent = isDragging ? dragState.val : cat.percentage;
                      const delta = (parsedSalary * (currentPercent / 100)) - categoryBase;
                      const isCatLocked = lockedCategories.includes(cat.id);
                      const catHex = hexColorMap[cat.color] || '#52525b';

                      return (
                        <div
                          key={cat.id}
                          style={{ borderTopWidth: '3px', borderTopColor: catHex }}
                          className={`p-5 rounded-lg border-x border-b border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 relative transition-opacity ${isCatLocked ? 'opacity-60' : 'opacity-100'}`}
                        >
                          <div className="absolute top-3 right-4 flex gap-2">
                            <button
                              onClick={() => setEditingCategory({ id: cat.id, name: cat.name, target_goal: cat.target_goal || 0 })}
                              className="text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 font-bold transition-colors text-xs"
                            >
                              ✎
                            </button>
                            <button
                              onClick={() => handleDeleteCategory(cat.id, cat.percentage)}
                              className="text-gray-400 dark:text-zinc-500 hover:text-rose-500 dark:hover:text-rose-400 font-bold transition-colors text-xs"
                            >
                              ✕
                            </button>
                          </div>

                          {editingCategory?.id === cat.id ? (
                            <div className="flex flex-col gap-2 mb-3 pr-10">
                              <input
                                autoFocus
                                type="text"
                                value={editingCategory.name}
                                onChange={e => setEditingCategory({ ...editingCategory, name: e.target.value })}
                                className="px-3 py-1 bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 rounded-md w-full text-xs focus:outline-none"
                              />
                              {isAsset ? (
                                <div className="flex gap-2">
                                  <input
                                    type="number"
                                    value={editingCategory.target_goal}
                                    onChange={e => setEditingCategory({ ...editingCategory, target_goal: e.target.value })}
                                    placeholder="Goal"
                                    className="px-3 py-1 bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 rounded-md flex-1 text-xs focus:outline-none"
                                  />
                                  <button
                                    onClick={() => handleUpdateCategory(cat.id, editingCategory.name, editingCategory.target_goal)}
                                    className="bg-gray-800 dark:bg-zinc-800 text-white px-3 rounded-md font-bold text-xs"
                                  >
                                    ✓
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleUpdateCategory(cat.id, editingCategory.name)}
                                  className="bg-gray-800 dark:bg-zinc-800 text-white px-3 py-1 rounded-md font-bold w-10 self-end text-xs"
                                >
                                  ✓
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 mb-1">
                              <h2 className="text-base font-semibold text-gray-900 dark:text-white">{cat.name}</h2>
                              {isAsset && (
                                <span className="text-[9px] uppercase bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 px-1.5 py-0.5 rounded font-bold tracking-wider">
                                  Asset
                                </span>
                              )}
                            </div>
                          )}

                          <div className="flex items-baseline gap-2 mb-4">
                            <p className="text-2xl font-bold tracking-tight text-gray-900 dark:text-zinc-100">{formatCurrency(remaining)}</p>
                            <span className="text-xs font-medium text-gray-500 dark:text-zinc-500">{isAsset ? 'auto-allocated' : 'remaining'}</span>
                          </div>

                          {!isAsset && (
                            <>
                              <div className="w-full bg-gray-100 dark:bg-zinc-950 rounded-full h-1.5 mb-2 overflow-hidden border border-gray-200 dark:border-zinc-800">
                                <div
                                  className={`h-1.5 rounded-full ${healthColor} transition-all duration-700 ease-out`}
                                  style={{ width: `${percentUsed}%` }}
                                ></div>
                              </div>
                              <div className="flex justify-between text-xs text-gray-500 dark:text-zinc-500 font-medium mb-5">
                                <span>{formatCurrency(spent)} spent</span>
                                <span>{percentUsed.toFixed(0)}% used</span>
                              </div>
                            </>
                          )}
                          {isAsset && <div className="h-5 mb-2"></div>}

                          <div className="pt-4 border-t border-gray-100 dark:border-zinc-800/60">
                            <div className="flex justify-between items-center mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-zinc-500 font-semibold">Allocation</span>
                                <button
                                  onClick={() => toggleIndividualLock(cat.id)}
                                  className={`p-1 rounded transition-all ${isCatLocked
                                      ? 'text-indigo-600 bg-indigo-50 dark:text-zinc-100 dark:bg-zinc-800'
                                      : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:text-zinc-600 dark:hover:text-zinc-300 dark:hover:bg-zinc-800'
                                    }`}
                                >
                                  {isCatLocked ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
                                  ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
                                  )}
                                </button>
                              </div>
                              <span className="text-xs font-bold text-gray-700 dark:text-zinc-300">
                                {Math.round(currentPercent)}%
                                <span className="text-gray-500 dark:text-zinc-500 font-normal ml-1">
                                  ({formatCurrency(categoryBase)}
                                  {isDragging && delta !== 0 && (
                                    <span className={delta > 0 ? "text-emerald-600 dark:text-zinc-300 ml-1" : "text-rose-600 dark:text-zinc-400 ml-1"}>
                                      {delta > 0 ? '+' : '-'}{formatCurrency(Math.abs(delta))}
                                    </span>
                                  )})
                                </span>
                              </span>
                            </div>

                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={currentPercent}
                              disabled={isCatLocked}
                              onChange={(e) => {
                                if (!isLockedInPast && !isCatLocked) {
                                  setDragState(prev => ({ ...prev, val: Number(e.target.value) }));
                                }
                              }}
                              onPointerDown={() => {
                                if (!isLockedInPast && !isCatLocked) {
                                  setDragState({ id: cat.id, val: cat.percentage });
                                }
                              }}
                              onPointerUp={() => {
                                if (!isLockedInPast && dragState.id === cat.id && !isCatLocked) {
                                  handleSliderChange(cat.id, dragState.val);
                                  setDragState({ id: null, val: 0 });
                                }
                              }}
                              className={`w-full accent-indigo-600 dark:accent-zinc-400 ${isCatLocked ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
                            />

                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="w-full bg-white dark:bg-zinc-900 p-5 rounded-lg border border-gray-200 dark:border-zinc-800 mt-4">
                    <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 mb-3 uppercase tracking-wider">Create New Category</h3>
                    <div className="flex gap-2 mb-3">
                      <button
                        onClick={() => setNewCategoryType('expense')}
                        className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-all ${newCategoryType === 'expense'
                            ? 'bg-gray-800 dark:bg-zinc-700 text-white'
                            : 'bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 text-gray-500 dark:text-zinc-500'
                          }`}
                      >
                        Expense
                      </button>
                      <button
                        onClick={() => setNewCategoryType('asset')}
                        className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-all ${newCategoryType === 'asset'
                            ? 'bg-gray-800 dark:bg-zinc-700 text-white'
                            : 'bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 text-gray-500 dark:text-zinc-500'
                          }`}
                      >
                        Wealth Asset
                      </button>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        placeholder="Name (e.g. Groceries)"
                        className="flex-1 px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-indigo-500"
                      />
                      {newCategoryType === 'asset' && (
                        <input
                          type="number"
                          min="0"
                          value={newCategoryGoal}
                          onChange={(e) => setNewCategoryGoal(e.target.value)}
                          placeholder="Goal Target"
                          className="sm:w-1/3 px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-indigo-500"
                        />
                      )}
                      <button
                        onClick={handleAddCategory}
                        className="px-4 py-2 rounded-md bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-800 dark:text-zinc-200 text-sm font-semibold transition-all"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-7 space-y-6">
                  <div className="w-full bg-white dark:bg-zinc-900 p-6 rounded-lg border border-gray-200 dark:border-zinc-800 shadow-sm">
                    <h2 className="text-sm font-semibold mb-4 text-gray-800 dark:text-zinc-200">Quick Log Expense</h2>
                    {expenseCategories.length === 0 ? (
                      <p className="text-gray-500 dark:text-zinc-500 text-sm">Please create an 'Expense' category first.</p>
                    ) : (
                      <form onSubmit={handleAddExpense} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <input
                            type="text"
                            value={expenseName}
                            onChange={(e) => setExpenseName(e.target.value)}
                            placeholder="What did you buy?"
                            className="w-full px-3 py-2.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-indigo-500"
                            required
                          />
                          <input
                            type="number"
                            step="0.01"
                            value={expenseCost}
                            onChange={(e) => setExpenseCost(e.target.value)}
                            placeholder={`Cost (e.g. 50)`}
                            className="w-full px-3 py-2.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-indigo-500"
                            required
                          />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <select
                            value={expenseCategoryId}
                            onChange={(e) => setExpenseCategoryId(e.target.value)}
                            className="w-full px-3 py-2.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-indigo-500"
                          >
                            {expenseCategories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                          </select>
                          <input
                            type="date"
                            value={expenseDate}
                            onChange={(e) => setExpenseDate(e.target.value)}
                            className="w-full px-3 py-2.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-sm focus:outline-none focus:border-indigo-500"
                            required
                          />
                        </div>
                        <button
                          type="submit"
                          className="w-full py-2.5 px-4 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition-all text-sm shadow-md"
                        >
                          Save Expense
                        </button>
                      </form>
                    )}
                  </div>

                  <div className="w-full bg-white dark:bg-zinc-900 p-6 rounded-lg border border-gray-200 dark:border-zinc-800 min-h-[400px]">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-5 gap-4">
                      <h3 className="text-sm font-semibold text-gray-800 dark:text-zinc-200">
                        Transactions ({new Date(selectedMonth + '-01').toLocaleString('default', { month: 'short' })})
                      </h3>
                      {monthlyExpenses.length > 0 && (
                        <div className="flex gap-2 w-full sm:w-auto">
                          <input
                            type="text"
                            placeholder="Search..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full sm:w-40 px-3 py-1.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-xs focus:outline-none focus:border-indigo-500"
                          />
                          <select
                            value={filterCategory}
                            onChange={(e) => setFilterCategory(e.target.value)}
                            className="w-full sm:w-40 px-3 py-1.5 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-800 text-xs focus:outline-none focus:border-indigo-500"
                          >
                            <option value="All">All Categories</option>
                            {expenseCategories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                          </select>
                        </div>
                      )}
                    </div>

                    {filteredExpenses.length === 0 ? (
                      <div className="h-48 flex items-center justify-center border border-gray-200 dark:border-zinc-800/50 border-dashed rounded-md">
                        <p className="text-gray-400 dark:text-zinc-600 text-sm">No expenses match your search.</p>
                      </div>
                    ) : (
                      <ul className="space-y-2 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                        {filteredExpenses.map((exp) => (
                          <li key={exp.id} className="p-3 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-100 dark:border-zinc-800 flex flex-col group transition-all">
                            {editingExpense?.id === exp.id ? (
                              <div className="flex flex-col gap-2 w-full text-xs">
                                <div className="flex gap-2">
                                  <input
                                    type="text"
                                    value={editingExpense.name}
                                    onChange={e => setEditingExpense({ ...editingExpense, name: e.target.value })}
                                    className="px-2 py-1.5 border rounded flex-1 focus:outline-none dark:bg-zinc-900 dark:border-zinc-700"
                                  />
                                  <input
                                    type="date"
                                    value={editingExpense.expense_date}
                                    onChange={e => setEditingExpense({ ...editingExpense, expense_date: e.target.value })}
                                    className="px-2 py-1.5 border rounded w-1/3 focus:outline-none dark:bg-zinc-900 dark:border-zinc-700"
                                  />
                                </div>
                                <div className="flex gap-2">
                                  <input
                                    type="number"
                                    value={editingExpense.cost}
                                    onChange={e => setEditingExpense({ ...editingExpense, cost: e.target.value })}
                                    className="px-2 py-1.5 border rounded w-1/3 focus:outline-none dark:bg-zinc-900 dark:border-zinc-700"
                                  />
                                  <select
                                    value={editingExpense.category_id}
                                    onChange={e => setEditingExpense({ ...editingExpense, category_id: e.target.value })}
                                    className="px-2 py-1.5 border rounded flex-1 focus:outline-none dark:bg-zinc-900 dark:border-zinc-700"
                                  >
                                    {expenseCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                  </select>
                                  <button
                                    onClick={() => handleUpdateExpense(exp.id, editingExpense)}
                                    className="bg-emerald-600 text-white px-3 rounded font-bold"
                                  >
                                    ✓
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex justify-between items-center w-full">
                                <div className="flex flex-col">
                                  <span className="text-gray-900 dark:text-zinc-200 font-medium text-sm">{exp.name}</span>
                                  <span className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
                                    {formatCurrency(exp.cost)} <span className="ml-2">• {exp.expense_date}</span>
                                  </span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-[10px] uppercase px-2 py-1 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded text-gray-500 dark:text-zinc-400">
                                    {exp.category}
                                  </span>
                                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                                    <button
                                      onClick={() => setEditingExpense({ id: exp.id, name: exp.name, cost: exp.cost, category_id: exp.category_id, expense_date: exp.expense_date })}
                                      className="text-gray-400 hover:text-indigo-600 dark:text-zinc-500 dark:hover:text-zinc-300 p-1"
                                    >
                                      ✎
                                    </button>
                                    <button
                                      onClick={() => handleDeleteExpense(exp.id)}
                                      className="text-gray-400 hover:text-rose-500 dark:text-zinc-500 dark:hover:text-rose-400 p-1"
                                    >
                                      ✕
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'portfolio' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start animate-fade-in">
              <div className="lg:col-span-5 space-y-6">
                <div className="w-full bg-white dark:bg-zinc-900 p-6 rounded-lg border border-gray-200 dark:border-zinc-800 shadow-sm">
                  <h2 className="text-sm font-semibold text-gray-800 dark:text-zinc-300 uppercase tracking-wider mb-2">Total Net Wealth Tracker</h2>
                  <p className="text-gray-500 dark:text-zinc-500 text-xs mb-5">Log manual withdrawals or market fluctuations below.</p>

                  {assetCategories.length === 0 ? (
                    <p className="text-amber-600 bg-amber-50 dark:bg-amber-500/10 text-sm font-medium p-3 rounded-md border border-amber-200 dark:border-amber-500/20">
                      Create an "Asset" category to start building wealth.
                    </p>
                  ) : (
                    <form onSubmit={handleAddAdjustment} className="space-y-4 bg-gray-50 dark:bg-zinc-950 p-4 rounded-md border border-gray-200 dark:border-zinc-800">
                      <h3 className="text-gray-800 dark:text-zinc-300 text-sm font-medium mb-1">Log Market Fluctuation</h3>
                      <div className="grid grid-cols-2 gap-3">
                        <select
                          value={adjCatId}
                          onChange={(e) => setAdjCatId(e.target.value)}
                          className="px-3 py-2 rounded-md bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-sm focus:outline-none focus:border-emerald-500"
                        >
                          {assetCategories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                        </select>
                        <input
                          type="number"
                          step="0.01"
                          value={adjAmount}
                          onChange={(e) => setAdjAmount(e.target.value)}
                          placeholder={`Amount (+ or -)`}
                          className="px-3 py-2 rounded-md bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-sm focus:outline-none focus:border-emerald-500"
                          required
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <input
                          type="text"
                          value={adjNote}
                          onChange={(e) => setAdjNote(e.target.value)}
                          placeholder="Note"
                          className="px-3 py-2 rounded-md bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-sm focus:outline-none focus:border-emerald-500"
                        />
                        <input
                          type="date"
                          value={adjDate}
                          onChange={(e) => setAdjDate(e.target.value)}
                          className="px-3 py-2 rounded-md bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-sm focus:outline-none focus:border-emerald-500"
                          required
                        />
                      </div>
                      <button
                        type="submit"
                        className="w-full py-2 px-4 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition-all text-sm shadow-md"
                      >
                        Save Adjustment
                      </button>
                    </form>
                  )}
                </div>

                <div className="w-full bg-white dark:bg-zinc-900 p-6 rounded-lg border border-gray-200 dark:border-zinc-800 min-h-[300px]">
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-zinc-300 tracking-tight mb-4">Adjustment History</h3>
                  {assetAdjustments.length === 0 ? (
                    <p className="text-gray-500 dark:text-zinc-600 text-sm">No adjustments logged yet.</p>
                  ) : (
                    <ul className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                      {assetAdjustments.map((adj) => {
                        const catName = categories.find(c => c.id === adj.category_id)?.name || 'Unknown';
                        return (
                          <li key={adj.id} className="p-3 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 flex justify-between items-center group">
                            <div className="flex flex-col">
                              <span className="text-gray-800 dark:text-zinc-200 font-medium text-sm">{adj.note || 'Manual'}</span>
                              <span className="text-xs text-gray-500 dark:text-zinc-500 mt-0.5">{catName} • {adj.adjustment_date}</span>
                            </div>
                            <span className={`font-mono text-sm font-bold ${adj.amount > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                              {adj.amount > 0 ? '+' : ''}{formatCurrency(Math.abs(adj.amount))}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>

              <div className="lg:col-span-7 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar pb-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {assetCategories.map(cat => {
                    const currentMonthAllocation = parsedSalary * (cat.percentage / 100);
                    const manualAdjTotal = assetAdjustments.filter(a => a.category_id === cat.id).reduce((sum, a) => sum + parseFloat(a.amount), 0);
                    const previewDeposit = (selectedMonth === todayMonth && !closedMonths.includes(todayMonth)) ? currentMonthAllocation : 0;
                    const totalWealth = parseFloat((manualAdjTotal + previewDeposit).toFixed(2));
                    const progressPercentage = cat.target_goal > 0 ? Math.min(100, (totalWealth / cat.target_goal) * 100) : 0;

                    return (
                      <div
                        key={cat.id}
                        style={{ borderTopWidth: '3px', borderTopColor: hexColorMap[cat.color] || '#52525b' }}
                        className="p-6 rounded-lg border-x border-b border-gray-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 relative"
                      >
                        <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">{cat.name}</h2>
                        <p className="text-gray-500 dark:text-zinc-500 text-xs mb-4">Total Accumulated Value</p>
                        <p className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white mb-6">
                          {formatCurrency(totalWealth)}
                        </p>

                        {cat.target_goal > 0 && (
                          <div className="mb-6">
                            <div className="flex justify-between text-[10px] font-medium text-gray-500 dark:text-zinc-400 mb-1.5 uppercase tracking-wider">
                              <span>Goal Progress</span>
                              <span>{progressPercentage.toFixed(1)}% of {formatCurrency(cat.target_goal)}</span>
                            </div>
                            <div className="w-full bg-gray-100 dark:bg-zinc-950 rounded-full h-1.5 overflow-hidden border border-gray-200 dark:border-zinc-800">
                              <div
                                className="h-1.5 rounded-full bg-emerald-500 dark:bg-zinc-400 transition-all duration-1000 ease-out"
                                style={{ width: `${progressPercentage}%` }}
                              ></div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
              <div className="w-full bg-white dark:bg-zinc-900 p-8 rounded-lg border border-gray-200 dark:border-zinc-800">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Action Ledger</h2>
                <p className="text-gray-500 dark:text-zinc-500 text-sm mb-6">
                  A chronological history of your month-end closures and portfolio adjustments.
                </p>

                {historyFeed.length === 0 ? (
                  <p className="text-gray-500 dark:text-zinc-500 text-sm text-center py-10 border border-dashed border-gray-200 dark:border-zinc-800 rounded-md">
                    No historical actions logged yet.
                  </p>
                ) : (
                  <div className="relative border-l-2 border-gray-200 dark:border-zinc-800 ml-3 space-y-8 pb-4">
                    {historyFeed.map((event, idx) => (
                      <div key={`${event.id}-${idx}`} className="relative pl-6">
                        <div className={`absolute -left-1.5 top-1.5 w-3 h-3 rounded-full border-2 border-white dark:border-zinc-900 ${event.type === 'ledger' ? 'bg-indigo-500' : 'bg-emerald-500'}`}></div>
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-1">
                            {event.date}
                          </span>
                          <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-200">{event.title}</h3>
                          <p className="text-sm text-gray-600 dark:text-zinc-400 mt-1">{event.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'taxes' && (
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
                        <option value="CA">Canada</option>
                        <option value="AU">Australia</option>
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
                    onClick={calculateTaxMockup}
                    className="w-full py-2.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition-all text-sm shadow-md"
                  >
                    Calculate API Estimate
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
                      <div className="flex justify-between text-gray-600 dark:text-zinc-400 border-t border-gray-200 dark:border-zinc-800 pt-3">
                        <span>Estimated Tax Liability:</span>
                        <span className="font-mono font-bold text-rose-600 dark:text-white">{formatCurrency(taxEstimateResult.owed)}</span>
                      </div>
                      <div className="flex justify-between text-gray-600 dark:text-zinc-400">
                        <span>Estimated Net Income:</span>
                        <span className="font-mono font-bold text-emerald-600 dark:text-zinc-200">{formatCurrency(taxEstimateResult.net)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
              <div className="w-full bg-white dark:bg-zinc-900 p-8 rounded-lg border border-gray-200 dark:border-zinc-800 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">Account Preferences</h2>

                <div className="space-y-6">
                  <div className="flex items-center justify-between pb-6 border-b border-gray-200 dark:border-zinc-800">
                    <div>
                      <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-200">Theme Preference</h3>
                      <p className="text-xs text-gray-500 dark:text-zinc-500 mt-1">Switch between Light and Dark mode UI.</p>
                    </div>
                    <button
                      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                      className="px-4 py-2 bg-gray-100 dark:bg-zinc-800 rounded-md border border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-zinc-300 shadow-sm font-medium transition-all hover:bg-gray-200 dark:hover:bg-zinc-700"
                    >
                      {theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode'}
                    </button>
                  </div>

                  <div className="pb-6 border-b border-gray-200 dark:border-zinc-800 space-y-4">
                    <div>
                      <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-200 mb-1">Monthly Net Salary</h3>
                      <p className="text-xs text-gray-500 dark:text-zinc-500 mb-3">This baseline is used to calculate all budget percentages.</p>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={salary}
                        onChange={(e) => setSalary(e.target.value)}
                        onWheel={(e) => e.target.blur()}
                        className="w-full md:w-1/2 px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 font-mono"
                      />
                    </div>
                  </div>

                  <div className="pb-2 space-y-4">
                    <div>
                      <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-200 mb-1">Global Currency Display</h3>
                      <p className="text-xs text-gray-500 dark:text-zinc-500 mb-3">Set your preferred symbol for the dashboard.</p>
                      <div className="flex gap-4">
                        <select
                          value={currencyMode}
                          onChange={(e) => {
                            const m = e.target.value;
                            setCurrencyMode(m);
                            setCurrency(m === 'none' ? '' : m === 'custom' ? currency : m);
                          }}
                          className="px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-300 text-sm focus:outline-none focus:border-indigo-500 w-40"
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
                            className="w-24 px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 text-center text-sm"
                          />
                        )}
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}