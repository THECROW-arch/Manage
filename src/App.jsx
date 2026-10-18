import { useState, useEffect } from 'react';
import './App.css';
import { supabase } from './supabaseClient';
import Auth from './Auth';
import { PieChart, Pie, Tooltip, ResponsiveContainer } from 'recharts';
import { hexColorMap, progressiveTaxBrackets, getToday, getCurrentMonth } from './utils/constants';
import HistoryTab from './components/HistoryTab';
import TaxCenterTab from './components/TaxCenterTab';
import SettingsTab from './components/SettingsTab';
import Sidebar, { MobileHeader } from './components/Sidebar';
import PortfolioTab from './components/PortfolioTab';
import OccasionsSandboxTab from './components/OccasionsSandboxTab';
import CashFlowTab from './components/CashFlowTab';

/**
 * Main application component orchestrating global state, data fetching, and tab routing.
 */
export default function App() {
  const [session, setSession] = useState(null);
  const [loadingData, setLoadingData] = useState(true);

  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('theme') || 'dark'; }
    catch { return 'dark'; }
  });

  useEffect(() => {
    localStorage.setItem('theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.style.colorScheme = 'dark';
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.style.colorScheme = 'light';
    }
  }, [theme]);

  const [lockedCategories, setLockedCategories] = useState(() => {
    try {
      const saved = localStorage.getItem('lockedCats');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [selectedMonth, setSelectedMonth] = useState(() => {
    try { return localStorage.getItem('selectedMonth') || getCurrentMonth(); }
    catch { return getCurrentMonth(); }
  });

  const [closedMonths, setClosedMonths] = useState([]);
  const [activeTab, setActiveTab] = useState('cashflow');
  const [plannerSubTab, setPlannerSubTab] = useState('occasions'); // 'occasions' | 'sandbox'

  const [salary, setSalary] = useState('');
  const [categories, setCategories] = useState([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryType, setNewCategoryType] = useState('expense');
  const [newCategoryGoal, setNewCategoryGoal] = useState('');
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [exportScope, setExportScope] = useState('month'); // 'month' | 'day'
  const [exportMonth, setExportMonth] = useState(getCurrentMonth());
  const [exportDate, setExportDate] = useState(getToday());
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
  const [currentStreak, setCurrentStreak] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);
  const [taxCountry, setTaxCountry] = useState('US');
  const [taxFilingStatus, setTaxFilingStatus] = useState('single');
  const [taxIncomeInput, setTaxIncomeInput] = useState('');
  const [taxEstimateResult, setTaxEstimateResult] = useState(null);

  const [dragState, setDragState] = useState({ id: null, val: 0 });
  const [isRecurring, setIsRecurring] = useState(false);
  const [isBatched, setIsBatched] = useState(false);
  const [expandedTransactionId, setExpandedTransactionId] = useState(null);
  // Special Occasions (Bundles) States
  const [bundles, setBundles] = useState([]);
  const [bundleName, setBundleName] = useState('');
  const [bundleAllocations, setBundleAllocations] = useState({});
  const [occasionItemInputs, setOccasionItemInputs] = useState({}); // { [bundleId]: { name: '', cost: '' } }

  // Temporary Calculations (Sandbox) States
  const [sandboxSheets, setSandboxSheets] = useState([]);
  const [activeSheetId, setActiveSheetId] = useState(null);
  const [newSheetTitle, setNewSheetTitle] = useState('');
  const [newSheetBudget, setNewSheetBudget] = useState('');
  const [subBucketName, setSubBucketName] = useState('');
  const [subBucketLimit, setSubBucketLimit] = useState('');
  const [sandboxExpName, setSandboxExpName] = useState('');
  const [sandboxExpCost, setSandboxExpCost] = useState('');
  const [sandboxExpBucketId, setSandboxExpBucketId] = useState('MAIN');

  // Read-Only Locking Logic
  const todayMonth = getCurrentMonth();
  const isPastMonth = selectedMonth < todayMonth;
  const isCurrentMonthClosed = closedMonths.includes(todayMonth);
  const isReadOnly = isPastMonth || (selectedMonth === todayMonth && isCurrentMonthClosed);

  useEffect(() => { localStorage.setItem('selectedMonth', selectedMonth); }, [selectedMonth]);
  useEffect(() => { localStorage.setItem('lockedCats', JSON.stringify(lockedCategories)); }, [lockedCategories]);

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
      setCurrentStreak(profile.current_streak || 0);
      setLongestStreak(profile.longest_streak || 0);
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

    let { data: bundlesData } = await supabase
      .from('bundles')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    setBundles(bundlesData || []);

    let { data: sandboxData } = await supabase
      .from('sandbox_sheets')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    setSandboxSheets((sandboxData || []).map(s => ({
      id: s.id, title: s.title, totalBudget: parseFloat(s.total_budget),
      buckets: s.buckets || [], expenses: s.expenses || []
    })));

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
          if (cat.id) await supabase.from('categories').update({ percentage: Number(Number(cat.percentage).toFixed(2)) }).eq('id', cat.id);
        }

        for (const sheet of sandboxSheets) {
          if (sheet.id) {
            await supabase.from('sandbox_sheets').update({
              buckets: sheet.buckets,
              expenses: sheet.expenses
            }).eq('id', sheet.id);
          }
        }
      } catch {
        setAlertMsg("Warning: Auto-save failed.");
      }
    }, 1000);

    return () => clearTimeout(delayDebounceFn);
  }, [salary, categories, sandboxSheets, session, loadingData, currency, taxCountry, taxFilingStatus]);


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

  const handleExportCSV = () => {
    const todayStr = getToday();
    const currentMonthStr = getCurrentMonth();
    const targetPeriod = exportScope === 'month' ? exportMonth : exportDate;

    if ((exportScope === 'month' && exportMonth > currentMonthStr) || (exportScope === 'day' && exportDate > todayStr)) {
      setAlertMsg("Error: Cannot export data for future dates that haven't occurred yet.");
      return;
    }

    const periodMonth = targetPeriod.substring(0, 7);
    const isClosed = closedMonths.includes(periodMonth);

    // 1. Expenses strictly within the selected scope (That Day OR That Month)
    const scopedExps = expenses.filter(e =>
      e.expense_date && (exportScope === 'month' ? e.expense_date.startsWith(exportMonth) : e.expense_date === exportDate)
    );
    const scopedAdjs = assetAdjustments.filter(a =>
      a.adjustment_date && (exportScope === 'month' ? a.adjustment_date.startsWith(exportMonth) : a.adjustment_date === exportDate)
    );

    // 2. Cumulative Month-To-Date expenses (up through the selected day, or the whole month) for accurate Remaining Balance & Utilization!
    const cumulativeMonthExps = expenses.filter(e =>
      e.expense_date &&
      e.expense_date.startsWith(periodMonth) &&
      (exportScope === 'month' ? true : e.expense_date <= exportDate)
    );

    if (scopedExps.length === 0 && scopedAdjs.length === 0) {
      setAlertMsg(`No transactions or adjustments found for ${targetPeriod}.`);
      return;
    }

    const cleanCSV = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;

    // Squash split occasion rows in scopedExps into 1 master entry per occasion
    const groupedScopedExps = [];
    const bundleMap = {};

    scopedExps.forEach(e => {
      if (e.bundle_id) {
        if (!bundleMap[e.bundle_id]) {
          const parentBundle = bundles.find(b => b.id === e.bundle_id);
          bundleMap[e.bundle_id] = {
            id: `bundle_${e.bundle_id}`,
            bundle_id: e.bundle_id,
            name: parentBundle ? `✨ ${parentBundle.name}` : e.name,
            expense_date: e.expense_date,
            cost: 0,
            categorySplits: [],
            items: parentBundle?.items || []
          };
          groupedScopedExps.push(bundleMap[e.bundle_id]);
        }
        bundleMap[e.bundle_id].cost += parseFloat(e.cost);
        bundleMap[e.bundle_id].categorySplits.push(`${e.category}: ${parseFloat(e.cost).toFixed(2)}`);
      } else {
        groupedScopedExps.push(e);
      }
    });

    const periodSpent = scopedExps.reduce((s, e) => s + parseFloat(e.cost), 0);
    const cumulativeMonthSpent = cumulativeMonthExps.reduce((s, e) => s + parseFloat(e.cost), 0);
    const monthlyAssetsAllocated = assetCategories.reduce((s, c) => s + (parsedSalary * (c.percentage / 100)), 0);

    // Cumulative spending (including wealth withdrawals) + automated asset allocation determines true remaining cash
    const trueMonthRemaining = Math.max(0, parsedSalary - cumulativeMonthSpent - monthlyAssetsAllocated);

    const rows = [
      ["=================================================================="],
      ["SALARY ALLOCATOR - OFFICIAL FINANCIAL LEDGER & AUDIT REPORT"],
      ["=================================================================="],
      ["Report Scope", exportScope === 'month' ? `Full Month (${exportMonth})` : `Single Day (${exportDate})`],
      ["Ledger Status", isClosed ? "CLOSED & FINALIZED" : (periodMonth === currentMonthStr ? "ACTIVE (IN PROGRESS)" : "OPEN PAST LEDGER")],
      ["Generated On", todayStr],
      ["Currency", currency || "N/A"],
      [],
      ["--- 1. EXECUTIVE CASH FLOW SUMMARY ---"],
      ["Metric", "Amount", "Notes"],
      ["Monthly Net Salary Baseline", parsedSalary.toFixed(2), "100% Allocation Base"],
      [
        exportScope === 'day' ? `Spent on ${exportDate}` : `Total Month Expenses`,
        `-${periodSpent.toFixed(2)}`,
        `${groupedScopedExps.length} ledger entries`
      ],
      ...(exportScope === 'day' ? [[
        `Cumulative Month-to-Date Spent (Up to ${exportDate})`,
        `-${cumulativeMonthSpent.toFixed(2)}`,
        "Includes prior days in this month"
      ]] : []),
      ["Automated Monthly Savings Allocation", monthlyAssetsAllocated.toFixed(2), `${assetCategories.reduce((s, c) => s + c.percentage, 0)}% of salary`],
      ["True Remaining Monthly Cash", trueMonthRemaining.toFixed(2), `${parsedSalary > 0 ? ((trueMonthRemaining / parsedSalary) * 100).toFixed(1) : 0}% of salary left`],
      [],
      ["--- 2. CATEGORY ALLOCATION & PERFORMANCE BREAKDOWN ---"],
      exportScope === 'day'
        ? ["Category Name", "Type", "Allocation %", "Monthly Budget", `Spent on ${exportDate}`, "Total Spent Month-to-Date", "True Remaining Balance", "True Utilization %"]
        : ["Category Name", "Type", "Allocation %", "Monthly Budget", "Spent in Month", "True Remaining Balance", "True Utilization %"],
      ...categories.map(cat => {
        const catBudget = parsedSalary * (cat.percentage / 100);
        const spentInScope = scopedExps.filter(e => e.category_id === cat.id).reduce((s, e) => s + parseFloat(e.cost), 0);
        const spentMonthToDate = cumulativeMonthExps.filter(e => e.category_id === cat.id).reduce((s, e) => s + parseFloat(e.cost), 0);
        const catRem = Math.max(0, catBudget - spentMonthToDate);
        const util = catBudget > 0 ? ((spentMonthToDate / catBudget) * 100).toFixed(1) + '%' : '0.0%';

        return exportScope === 'day'
          ? [
            cleanCSV(cat.name),
            cat.type === 'asset' ? "Wealth Asset" : "Expense",
            `${parseFloat(cat.percentage).toFixed(1)}%`,
            catBudget.toFixed(2),
            spentInScope.toFixed(2),
            spentMonthToDate.toFixed(2),
            catRem.toFixed(2),
            util
          ]
          : [
            cleanCSV(cat.name),
            cat.type === 'asset' ? "Wealth Asset" : "Expense",
            `${parseFloat(cat.percentage).toFixed(1)}%`,
            catBudget.toFixed(2),
            spentMonthToDate.toFixed(2),
            catRem.toFixed(2),
            util
          ];
      }),
      [],
      ["--- 3. TRANSACTIONS & SPECIAL OCCASIONS LEDGER ---"],
      ["Date", "Entry Type", "Description / Receipt Item", "Total Amount", "Category Funding Breakdown"]
    ];

    const sortedGrouped = [...groupedScopedExps].sort((a, b) => new Date(b.expense_date) - new Date(a.expense_date));

    sortedGrouped.forEach(entry => {
      if (entry.bundle_id) {
        // 1. Master Occasion Row (Only 1 row per Special Occasion!)
        rows.push([
          entry.expense_date,
          "Special Occasion (Master)",
          cleanCSV(`${entry.name} (${entry.items.length} items)`),
          `-${entry.cost.toFixed(2)}`,
          cleanCSV(entry.categorySplits.join(" | "))
        ]);

        // 2. Clean Sub-Rows for each Itemized Receipt inside the Occasion
        entry.items.forEach(item => {
          const itemCategoryBreakdown = Object.entries(item.allocations || {})
            .filter(([, amt]) => parseFloat(amt) > 0)
            .map(([cId, amt]) => `${categories.find(c => c.id === cId)?.name || 'Category'}: ${parseFloat(amt).toFixed(2)}`)
            .join(" | ");

          rows.push([
            entry.expense_date,
            "  ↳ Occasion Receipt Item",
            cleanCSV(`   • ${item.name}`),
            `-${parseFloat(item.cost).toFixed(2)}`,
            cleanCSV(itemCategoryBreakdown)
          ]);
        });
      } else {
        const tags = [
          entry.is_recurring ? "Recurring" : null,
          entry.is_batched ? "Batched" : null
        ].filter(Boolean).join(", ");

        rows.push([
          entry.expense_date,
          tags ? `Expense (${tags})` : "Standard Expense",
          cleanCSV(entry.name),
          `-${parseFloat(entry.cost).toFixed(2)}`,
          cleanCSV(`${entry.category}: ${parseFloat(entry.cost).toFixed(2)}`)
        ]);
      }
    });

    rows.push(
      [],
      ["--- 4. PORTFOLIO & WEALTH ADJUSTMENTS ---"],
      ["Date", "Asset Category", "Adjustment Type / Note", "Amount"]
    );

    if (scopedAdjs.length === 0) {
      rows.push(["None", "N/A", "No wealth adjustments recorded in this period", "0.00"]);
    } else {
      [...scopedAdjs]
        .sort((a, b) => new Date(b.adjustment_date) - new Date(a.adjustment_date))
        .forEach(a => {
          const catName = categories.find(c => c.id === a.category_id)?.name || 'Asset';
          rows.push([
            a.adjustment_date,
            cleanCSV(catName),
            cleanCSV(a.note || 'Manual Adjustment'),
            `${parseFloat(a.amount) >= 0 ? '+' : ''}${parseFloat(a.amount).toFixed(2)}`
          ]);
        });
    }

    const csvContent = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const fileNameDate = exportScope === 'day'
      ? `day_${exportDate}_exported_${todayStr}`
      : `month_${exportMonth}_exported_${todayStr}`;

    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `salary_allocator_${fileNameDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setAlertMsg(`Success: Detailed CSV report for ${targetPeriod} exported.`);
  };

  const formatCurrency = (amount) => {
    const num = Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return currency.length > 1 ? `${currency} ${num}` : `${currency}${num}`;
  };

  const parsedSalary = parseFloat(salary) || 0;
  const monthlyExpenses = expenses.filter(e => e.expense_date && e.expense_date.startsWith(selectedMonth));
  const expenseCategories = categories.filter(c => c.type !== 'asset');
  const assetCategories = categories.filter(c => c.type === 'asset');

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
    if (isReadOnly) return;
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
    if (isReadOnly) return;
    setLockedCategories([]);
    setAlertMsg("All categories unlocked.");
  };

  const handleSmartLockAll = () => {
    if (isReadOnly) return;
    setAlertMsg('');
    const total = categories.reduce((sum, c) => sum + c.percentage, 0);
    const diff = 100 - total;

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
    if (isReadOnly || lockedCategories.includes(changedId)) return;

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
    if (closedMonths.includes(selectedMonth)) {
      setAlertMsg(`Error: ${selectedMonth} is already closed.`);
      return;
    }

    const previousAdj = [...assetAdjustments];
    const previousClosed = [...closedMonths];
    const previousExpenses = [...expenses];

    try {
      // 1. AGGREGATE BATCHED EXPENSES (Grouped by Name)
      const batchedExpenses = monthlyExpenses.filter(e => e.is_batched);
      let newlyAggregated = [];
      let idsToDelete = [];

      if (batchedExpenses.length > 0) {
        const grouped = batchedExpenses.reduce((acc, curr) => {
          const normalizedName = curr.name.trim().toLowerCase();
          const groupKey = `${normalizedName}_${curr.category_id}`;

          acc[groupKey] = acc[groupKey] || [];
          acc[groupKey].push(curr);
          return acc;
        }, {});

        for (const [, exps] of Object.entries(grouped)) {
          const sum = exps.reduce((total, e) => total + parseFloat(e.cost), 0);
          const originalName = exps[0].name.trim();

          newlyAggregated.push({
            user_id: session.user.id,
            name: `${originalName} (Batched x${exps.length})`,
            cost: sum,
            category_id: exps[0].category_id,
            category: exps[0].category,
            expense_date: `${selectedMonth}-28`,
            is_recurring: false,
            is_batched: false
          });
          idsToDelete.push(...exps.map(e => e.id));
        }

        if (idsToDelete.length > 0) await supabase.from('expenses').delete().in('id', idsToDelete);
        if (newlyAggregated.length > 0) {
          const { data, error } = await supabase.from('expenses').insert(newlyAggregated).select();
          if (error) throw error;
          newlyAggregated = data;
        }
      }

      // 2. FORWARD RECURRING EXPENSES TO NEXT MONTH
      const [year, month] = selectedMonth.split('-');
      let nextDate = new Date(year, parseInt(month), 1);
      const nextMonthStr = nextDate.getFullYear() + '-' + String(nextDate.getMonth() + 1).padStart(2, '0');

      const recurringExpenses = monthlyExpenses.filter(e => e.is_recurring);
      let newRecurring = [];
      if (recurringExpenses.length > 0) {
        newRecurring = recurringExpenses.map(e => ({
          user_id: session.user.id,
          name: e.name,
          cost: e.cost,
          category_id: e.category_id,
          category: e.category,
          expense_date: `${nextMonthStr}-01`,
          is_recurring: true,
          is_batched: false
        }));
        const { data, error } = await supabase.from('expenses').insert(newRecurring).select();
        if (error) throw error;
        newRecurring = data;
      }

      // 3. WEALTH SWEEP (Sweeps remaining unspent asset allocation)
      const newAdjustments = [];
      assetCategories.forEach(cat => {
        const allocated = parsedSalary * (cat.percentage / 100);
        const spentFromAsset = monthlyExpenses.filter(e => e.category_id === cat.id).reduce((sum, e) => sum + parseFloat(e.cost), 0);
        const amountToSweep = Math.max(0, allocated - spentFromAsset);

        if (amountToSweep > 0) {
          newAdjustments.push({
            user_id: session.user.id, category_id: cat.id, amount: amountToSweep,
            adjustment_date: `${selectedMonth}-28`, note: `Month-End Auto-Sweep (${selectedMonth})`
          });
        }
      });

      if (newAdjustments.length > 0) {
        const { data, error } = await supabase.from('asset_adjustments').insert(newAdjustments).select();
        if (error) throw error;
        setAssetAdjustments([...data, ...assetAdjustments]);
      }

      // 4. GAMIFICATION: CHECK FOR PERFECT BUDGET MONTH
      let isPerfectMonth = true;
      const expenseCategoriesForCheck = categories.filter(c => c.type !== 'asset');

      expenseCategoriesForCheck.forEach(cat => {
        const categoryBase = parsedSalary * (cat.percentage / 100);
        const spent = monthlyExpenses.filter(e => e.category_id === cat.id).reduce((sum, e) => sum + parseFloat(e.cost), 0);
        if (categoryBase > 0 && spent > categoryBase) {
          isPerfectMonth = false;
        }
      });

      const newStreak = isPerfectMonth ? currentStreak + 1 : 0;
      const newLongest = Math.max(newStreak, longestStreak);

      await supabase.from('profiles').update({
        current_streak: newStreak,
        longest_streak: newLongest
      }).eq('user_id', session.user.id);

      setCurrentStreak(newStreak);
      setLongestStreak(newLongest);

      // 5. FINALIZE MONTH CLOSURE
      const { error: closeError } = await supabase.from('closed_months').insert([{ user_id: session.user.id, month: selectedMonth }]);
      if (closeError) throw closeError;

      setClosedMonths([...closedMonths, selectedMonth]);
      const updatedExpenses = expenses.filter(e => !idsToDelete.includes(e.id));
      setExpenses([...newRecurring, ...newlyAggregated, ...updatedExpenses]);

      setAlertMsg(`Success: Aggregated logs, forwarded bills, and closed ${selectedMonth}.`);
      window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (error) {
      setAlertMsg("Database Error closing month: " + (error.message || error.details));
      setAssetAdjustments(previousAdj);
      setClosedMonths(previousClosed);
      setExpenses(previousExpenses);
    }
  };

  const handleAddCategory = async (e) => {
    e.preventDefault();
    if (isReadOnly || !newCategoryName.trim()) return;

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
    setIsCategoryModalOpen(false);
    try {
      const { data, error } = await supabase.from('categories').insert([{
        user_id: session.user.id, name: newCategoryName.trim(), percentage: 0, color: randomColor, type: newCategoryType, target_goal: goalVal
      }]).select();

      if (error) throw error;
      setCategories(current => current.map(c => c.id === tempId ? data[0] : c));
      if (newCategoryType !== 'asset' && !expenseCategoryId) setExpenseCategoryId(data[0].id);
      if (newCategoryType === 'asset' && !adjCatId) setAdjCatId(data[0].id);

    } catch {
      setAlertMsg("Database Error: Failed to add category.");
      setCategories(previousCategories);
    }
  };

  const handleUpdateCategory = async (id, newName, newGoal = 0) => {
    if (isReadOnly || !newName.trim()) return;
    const previousCategories = [...categories];
    const safeGoal = parseFloat(newGoal) || 0;

    setCategories(categories.map(c => c.id === id ? { ...c, name: newName.trim(), target_goal: safeGoal } : c));
    setEditingCategory(null);

    try {
      const { error } = await supabase.from('categories').update({ name: newName.trim(), target_goal: safeGoal }).eq('id', id);
      if (error) throw error;
    } catch {
      setAlertMsg("Error updating category.");
      setCategories(previousCategories);
    }
  };

  const handleDeleteCategory = async (id, percentage) => {
    if (isReadOnly || categories.length <= 1) return;
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
    } catch {
      setAlertMsg("Database Error: Failed to delete category.");
      setCategories(previousCategories);
      setExpenses(previousExpenses);
    }
  };
  // Helper: Get true available balance (Monthly for Expenses, Lifetime Portfolio for Assets)
  const getCategoryAvailablePool = (catId) => {
    const cat = categories.find(c => c.id === catId);
    if (!cat) return 0;

    // Subtract amounts already promised to OTHER open bundles this month
    const reservedInOpenBundles = bundles
      .filter(b => b.month === selectedMonth && b.status !== 'locked')
      .reduce((sum, b) => sum + (parseFloat(b.target_budget?.[catId]) || 0), 0);

    if (cat.type === 'asset') {
      const currentMonthAllocation = parsedSalary * (cat.percentage / 100);
      const manualAdjTotal = assetAdjustments
        .filter(a => a.category_id === cat.id)
        .reduce((sum, a) => sum + parseFloat(a.amount), 0);
      const spentThisMonth = monthlyExpenses
        .filter(e => e.category_id === cat.id)
        .reduce((sum, e) => sum + parseFloat(e.cost), 0);
      const previewDeposit = (selectedMonth === todayMonth && !closedMonths.includes(todayMonth))
        ? Math.max(0, currentMonthAllocation - spentThisMonth)
        : 0;

      const totalLifetimeWealth = manualAdjTotal + previewDeposit;
      return Math.max(0, parseFloat((totalLifetimeWealth - reservedInOpenBundles).toFixed(2)));
    } else {
      const categoryBase = parsedSalary * (cat.percentage / 100);
      const spentThisMonth = monthlyExpenses
        .filter(e => e.category_id === cat.id)
        .reduce((sum, e) => sum + parseFloat(e.cost), 0);
      return Math.max(0, parseFloat((categoryBase - spentThisMonth - reservedInOpenBundles).toFixed(2)));
    }
  };
  // --- SPECIAL OCCASION (BUNDLE) WORKFLOW ---
  const handleCreateBundle = async (e) => {
    e.preventDefault();
    if (isReadOnly) return;

    if (!bundleName.trim()) {
      setAlertMsg("Please enter a name for the Special Occasion.");
      return;
    }

    let finalAllocations = { ...bundleAllocations };
    const catEl = document.getElementById('temp-bundle-cat');
    const amtEl = document.getElementById('temp-bundle-amt');
    if (catEl && amtEl && catEl.value && parseFloat(amtEl.value) > 0) {
      const addedAmt = parseFloat(amtEl.value);
      const proposedTotal = (finalAllocations[catEl.value] || 0) + addedAmt;
      const maxAvailable = getCategoryAvailablePool(catEl.value);
      const catObj = categories.find(c => c.id === catEl.value);

      if (proposedTotal > maxAvailable) {
        setAlertMsg(`Error: Cannot pull ${formatCurrency(proposedTotal)} from ${catObj?.name}. Max available is ${formatCurrency(maxAvailable)}.`);
        return;
      }
      finalAllocations[catEl.value] = proposedTotal;
      amtEl.value = '';
    }

    if (Object.keys(finalAllocations).length === 0) {
      setAlertMsg("Please allocate a budget from at least one category.");
      return;
    }

    // Final validation check across all staged categories
    for (const [catId, amt] of Object.entries(finalAllocations)) {
      const maxAvailable = getCategoryAvailablePool(catId);
      const catObj = categories.find(c => c.id === catId);
      if (amt > maxAvailable) {
        setAlertMsg(`Error: ${catObj?.name} only has ${formatCurrency(maxAvailable)} available.`);
        return;
      }
    }

    const tempId = crypto.randomUUID();
    const newBundle = {
      id: tempId,
      user_id: session.user.id,
      name: bundleName.trim(),
      month: selectedMonth,
      target_budget: finalAllocations,
      status: 'open',
      items: []
    };

    setBundles(current => [newBundle, ...current]);
    setBundleName('');
    setBundleAllocations({});

    try {
      const { data, error } = await supabase.from('bundles').insert([newBundle]).select();
      if (error) throw error;
      setBundles(current => current.map(b => b.id === tempId ? data[0] : b));
      setAlertMsg(`Success: '${newBundle.name}' occasion created. Add your expenses below!`);
    } catch (error) {
      console.error("Supabase Bundle Error:", error);
      setAlertMsg("Database Error: " + (error.message || "Failed to save bundle."));
      setBundles(current => current.filter(b => b.id !== tempId));
    }
  };
  /**
     * Appends an itemized receipt to an open Special Occasion bundle and validates budget ceilings.
     * @param {string} bundleId - The UUID of the target occasion bundle.
     */
  const handleAddOccasionItem = async (bundleId) => {
    if (isReadOnly) return;
    const input = occasionItemInputs[bundleId] || { name: '', allocations: {} };
    if (!input.name.trim()) {
      setAlertMsg('Item name is required.');
      return;
    }

    const targetBundle = bundles.find(b => b.id === bundleId);
    if (!targetBundle || targetBundle.status === 'locked') return;

    let totalItemCost = 0;
    const cleanAllocations = {};

    for (const [cId, amt] of Object.entries(input.allocations)) {
      const parsed = parseFloat(amt);
      if (!isNaN(parsed) && parsed > 0) {
        cleanAllocations[cId] = parsed;
        totalItemCost += parsed;
      }
    }


    const currentItems = Array.isArray(targetBundle.items) ? targetBundle.items : [];

    // Validate against the bundle's strict category ceilings
    for (const [cId, amt] of Object.entries(cleanAllocations)) {
      const spentSoFar = currentItems.reduce((s, item) => s + (item.allocations?.[cId] || 0), 0);
      const ceiling = parseFloat(targetBundle.target_budget[cId]) || 0;
      if (spentSoFar + amt > ceiling) {
        const catName = categories.find(c => c.id === cId)?.name || 'Category';
        setAlertMsg(`Exceeds budget! Only ${formatCurrency(ceiling - spentSoFar)} left in ${catName} for this trip.`);
        return;
      }
    }

    const newItem = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      cost: totalItemCost,
      allocations: cleanAllocations,
      date: getToday()
    };

    const updatedItems = [...currentItems, newItem];
    setBundles(bundles.map(b => b.id === bundleId ? { ...b, items: updatedItems } : b));
    setOccasionItemInputs({ ...occasionItemInputs, [bundleId]: { name: '', allocations: {} } });

    try {
      const { error } = await supabase.from('bundles').update({ items: updatedItems }).eq('id', bundleId);
      if (error) throw error;
    } catch {
      setAlertMsg("Database Error: Failed to save item to occasion.");
    }
  };

  const handleDeleteOccasionItem = async (bundleId, itemId) => {
    if (isReadOnly) return;
    const targetBundle = bundles.find(b => b.id === bundleId);
    if (!targetBundle || targetBundle.status === 'locked') return;

    const updatedItems = (targetBundle.items || []).filter(i => i.id !== itemId);
    setBundles(bundles.map(b => b.id === bundleId ? { ...b, items: updatedItems } : b));

    try {
      const { error } = await supabase.from('bundles').update({ items: updatedItems }).eq('id', bundleId);
      if (error) throw error;
    } catch {
      setAlertMsg("Error removing item.");
    }
  };

  const handleLockAndFinalizeBundle = async (bundle) => {
    if (isReadOnly || bundle.status === 'locked') return;
    const items = Array.isArray(bundle.items) ? bundle.items : [];
    const totalSpent = items.reduce((s, i) => s + parseFloat(i.cost), 0);

    if (totalSpent <= 0) {
      setAlertMsg("Add at least one expense to this occasion before locking it into Transactions.");
      return;
    }

    // New Math: Sum up the exact item-level category splits
    const finalCategoryTotals = {};
    items.forEach(item => {
      if (item.allocations) {
        Object.entries(item.allocations).forEach(([cId, amt]) => {
          finalCategoryTotals[cId] = (finalCategoryTotals[cId] || 0) + parseFloat(amt);
        });
      }
    });

    const newBundleTransactions = [];
    const newPortfolioWithdrawals = [];

    // Loop through the exact totals we just calculated, NOT the old allocations map
    Object.entries(finalCategoryTotals).forEach(([catId, deductedCost]) => {
      if (deductedCost <= 0) return;

      const catObj = categories.find(c => c.id === catId);
      const isAsset = catObj?.type === 'asset';

      if (isAsset) {
        // Check how much of this asset's current month allocation is still unspent
        const monthlyAssetBase = parsedSalary * ((catObj.percentage || 0) / 100);
        const alreadySpentThisMonth = monthlyExpenses
          .filter(e => e.category_id === catId)
          .reduce((s, e) => s + parseFloat(e.cost), 0);
        const unspentMonthlyAsset = Math.max(0, monthlyAssetBase - alreadySpentThisMonth);

        // Part 1: Absorb what we can from this month's savings allocation
        const absorbedByCurrentMonth = Math.min(deductedCost, unspentMonthlyAsset);
        // Part 2: Any excess comes directly out of lifetime Portfolio wealth!
        const pulledFromLifetimeVault = parseFloat((deductedCost - absorbedByCurrentMonth).toFixed(2));

        if (absorbedByCurrentMonth > 0) {
          newBundleTransactions.push({
            user_id: session.user.id,
            name: `✨ ${bundle.name} (${items.length} items • Monthly ${catObj.name})`,
            cost: absorbedByCurrentMonth,
            category_id: catId,
            category: catObj.name,
            expense_date: `${bundle.month}-${getToday().slice(8, 10)}`,
            is_recurring: false,
            is_batched: false,
            bundle_id: bundle.id
          });
        }

        if (pulledFromLifetimeVault > 0) {
          newPortfolioWithdrawals.push({
            user_id: session.user.id,
            category_id: catId,
            amount: -pulledFromLifetimeVault,
            adjustment_date: `${bundle.month}-${getToday().slice(8, 10)}`,
            note: `✨ ${bundle.name} (Lifetime ${catObj.name} Pull)`
          });
        }
      } else {
        newBundleTransactions.push({
          user_id: session.user.id,
          // We check the keys of finalCategoryTotals to see if it was a split funding
          name: Object.keys(finalCategoryTotals).length > 1
            ? `✨ ${bundle.name} (${items.length} items • ${catObj?.name || 'Split'})`
            : `✨ ${bundle.name} (${items.length} items)`,
          cost: deductedCost,
          category_id: catId,
          category: catObj?.name || 'Special Occasion',
          expense_date: `${bundle.month}-${getToday().slice(8, 10)}`,
          is_recurring: false,
          is_batched: false,
          bundle_id: bundle.id
        });
      }
    });

    try {
      let insertedExps = [];
      if (newBundleTransactions.length > 0) {
        const { data, error: expError } = await supabase.from('expenses').insert(newBundleTransactions).select();
        if (expError) throw expError;
        insertedExps = data;
      }

      let insertedAdjs = [];
      if (newPortfolioWithdrawals.length > 0) {
        const { data, error: adjError } = await supabase.from('asset_adjustments').insert(newPortfolioWithdrawals).select();
        if (adjError) throw adjError;
        insertedAdjs = data;
      }

      const { error: bundleError } = await supabase.from('bundles').update({ status: 'locked' }).eq('id', bundle.id);
      if (bundleError) throw bundleError;

      if (insertedExps.length > 0) setExpenses([...insertedExps, ...expenses]);
      if (insertedAdjs.length > 0) setAssetAdjustments([...insertedAdjs, ...assetAdjustments]);
      setBundles(bundles.map(b => b.id === bundle.id ? { ...b, status: 'locked' } : b));
      setAlertMsg(`Locked! '${bundle.name}' finalized across Cash Flow & Portfolio.`);
    } catch (error) {
      setAlertMsg("Error locking occasion: " + (error.message || "Database error"));
    }
  };

  const handleDeleteBundle = async (bundleId) => {
    if (isReadOnly) return;
    setBundles(bundles.filter(b => b.id !== bundleId));
    setExpenses(expenses.filter(e => e.bundle_id !== bundleId));
    try {
      await supabase.from('expenses').delete().eq('bundle_id', bundleId);
      await supabase.from('bundles').delete().eq('id', bundleId);
    } catch {
      setAlertMsg("Error deleting occasion.");
    }
  };

  // --- SANDBOX / TEMPORARY CALCULATIONS LOGIC ---
  const activeSheet = sandboxSheets.find(s => s.id === activeSheetId) || sandboxSheets[0] || null;

  /**
     * Deletes a sandbox calculation sheet from both local state and the Supabase database.
     * @param {string} sheetId - The UUID of the sandbox sheet to delete.
     */
  const handleDeleteSandboxSheet = async (sheetId) => {
    if (isReadOnly) {
      setAlertMsg("Cannot delete calculation sheets while the ledger is locked.");
      return;
    }
    setSandboxSheets(current => current.filter(x => x.id !== sheetId));
    if (activeSheetId === sheetId) setActiveSheetId(null);
    try {
      const { error } = await supabase.from('sandbox_sheets').delete().eq('id', sheetId);
      if (error) throw error;
    } catch {
      setAlertMsg("Error deleting calculation sheet from database.");
    }
  };

  const handleCreateSandboxSheet = async (e) => {
    e.preventDefault();
    if (isReadOnly) return;
    const budget = parseFloat(newSheetBudget);
    if (!newSheetTitle.trim() || isNaN(budget) || budget <= 0) return;

    const tempId = crypto.randomUUID();
    const newSheet = {
      id: tempId, title: newSheetTitle.trim(), totalBudget: budget,
      buckets: [], expenses: []
    };

    setSandboxSheets([newSheet, ...sandboxSheets]);
    setActiveSheetId(newSheet.id);
    setNewSheetTitle('');
    setNewSheetBudget('');

    try {
      const { error } = await supabase.from('sandbox_sheets').insert([{
        id: tempId, user_id: session.user.id, title: newSheet.title,
        total_budget: newSheet.totalBudget, buckets: newSheet.buckets, expenses: newSheet.expenses
      }]);
      if (error) throw error;
    } catch (error) {
      setAlertMsg("Database Error: Failed to save calculation sheet.");
      setSandboxSheets(current => current.filter(s => s.id !== tempId));
      setActiveSheetId(null);
    }
  };

  const handleAddSubBucket = (e) => {
    e.preventDefault();
    if (!activeSheet) return;
    const limit = parseFloat(subBucketLimit);
    if (!subBucketName.trim() || isNaN(limit) || limit <= 0) return;

    const existingBucketsTotal = activeSheet.buckets.reduce((s, b) => s + b.limit, 0);
    if (existingBucketsTotal + limit > activeSheet.totalBudget) {
      setAlertMsg(`Sub-budget exceeds remaining unallocated budget (${formatCurrency(activeSheet.totalBudget - existingBucketsTotal)}).`);
      return;
    }

    const updatedSheet = {
      ...activeSheet,
      buckets: [...activeSheet.buckets, { id: crypto.randomUUID(), name: subBucketName.trim(), limit }]
    };

    setSandboxSheets(sandboxSheets.map(s => s.id === activeSheet.id ? updatedSheet : s));
    setSubBucketName('');
    setSubBucketLimit('');
  };

  const handleAddSandboxExpense = (e) => {
    e.preventDefault();
    if (!activeSheet) return;
    const cost = parseFloat(sandboxExpCost);
    if (!sandboxExpName.trim() || isNaN(cost) || cost <= 0) return;

    const updatedSheet = {
      ...activeSheet,
      expenses: [
        { id: crypto.randomUUID(), name: sandboxExpName.trim(), cost, bucketId: sandboxExpBucketId },
        ...activeSheet.expenses
      ]
    };

    setSandboxSheets(sandboxSheets.map(s => s.id === activeSheet.id ? updatedSheet : s));
    setSandboxExpName('');
    setSandboxExpCost('');
  };

  const handleExportSandboxCSV = (sheet) => {
    if (!sheet) return;
    const totalSpent = sheet.expenses.reduce((s, e) => s + e.cost, 0);
    const rows = [
      ["Calculation Title", sheet.title],
      ["Total Master Budget", sheet.totalBudget],
      ["Total Imaginary Spent", totalSpent],
      ["Remaining Balance", sheet.totalBudget - totalSpent],
      [],
      ["Sub-Budget / Bucket", "Allocated Limit", "Spent", "Remaining"],
      ...sheet.buckets.map(b => {
        const bSpent = sheet.expenses.filter(e => e.bucketId === b.id).reduce((s, e) => s + e.cost, 0);
        return [b.name.replace(/,/g, ''), b.limit, bSpent, b.limit - bSpent];
      }),
      [],
      ["Item Description", "Assigned Bucket", "Cost"],
      ...sheet.expenses.map(e => {
        const bName = e.bucketId === 'MAIN' ? 'General Pool' : (sheet.buckets.find(b => b.id === e.bucketId)?.name || 'General Pool');
        return [e.name.replace(/,/g, ''), bName.replace(/,/g, ''), e.cost];
      })
    ];

    const csvContent = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `sandbox_${sheet.title.toLowerCase().replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- STANDARD EXPENSE HANDLERS ---
  const handleAddExpense = async (e) => {
    e.preventDefault();
    if (isReadOnly) return;

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
      expense_date: expenseDate, is_recurring: isRecurring, is_batched: isBatched,
      bundle_id: null
    };

    setExpenses([newExpenseObj, ...expenses]);
    setExpenseName('');
    setExpenseCost('');
    setIsRecurring(false);
    setIsBatched(false);

    try {
      const { data, error } = await supabase.from('expenses').insert([{
        user_id: newExpenseObj.user_id, name: newExpenseObj.name, cost: newExpenseObj.cost,
        category_id: newExpenseObj.category_id, category: newExpenseObj.category,
        expense_date: newExpenseObj.expense_date, is_recurring: newExpenseObj.is_recurring,
        is_batched: newExpenseObj.is_batched, bundle_id: null
      }]).select();

      if (error) throw error;
      setExpenses(current => current.map(exp => exp.id === tempId ? data[0] : exp));
    } catch {
      setAlertMsg("Database Error: Failed to save expense.");
    }
  };

  const handleUpdateExpense = async (id, updatedExp) => {
    if (isReadOnly) return;
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
    } catch {
      setAlertMsg("Error updating expense.");
    }
  };

  const handleDeleteExpense = async (id) => {
    if (isReadOnly) return;
    setExpenses(expenses.filter(e => e.id !== id));
    try {
      const { error } = await supabase.from('expenses').delete().eq('id', id);
      if (error) throw error;
    } catch {
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
    } catch {
      setAlertMsg("Database Error: Failed to save adjustment.");
    }
  };

  /**
   * Calculates progressive annual tax liability based on regional brackets and filing status.
   */
  const calculateTaxEstimate = () => {
    const income = parseFloat(taxIncomeInput) || 0;
    let totalTax = 0;
    const breakdownArray = [];

    // Dynamically fetch married vs single brackets
    const bracketKey = taxCountry + (taxFilingStatus === 'married' ? '_married' : '');
    const brackets = progressiveTaxBrackets[bracketKey] || progressiveTaxBrackets[taxCountry] || progressiveTaxBrackets['US'];

    for (const bracket of brackets) {
      if (income > bracket.min) {
        const taxableAmountInBracket = Math.min(income, bracket.max) - bracket.min;
        const taxForBracket = taxableAmountInBracket * bracket.rate;
        totalTax += taxForBracket;

        breakdownArray.push({
          rate: Math.round(bracket.rate * 100),
          amountTaxed: taxableAmountInBracket,
          taxResult: taxForBracket
        });
      }
    }

    const effectiveRate = income > 0 ? (totalTax / income) * 100 : 0;
    setTaxEstimateResult({
      income, owed: totalTax, net: income - totalTax, rate: effectiveRate.toFixed(1), breakdown: breakdownArray
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

  // --- SQUASH MULTIPLE OCCASION ROWS INTO ONE VISUAL BUNDLE ---
  const groupedExpenses = [];
  const bundleGroupMap = {};

  filteredExpenses.forEach(exp => {
    if (exp.bundle_id) {
      if (!bundleGroupMap[exp.bundle_id]) {
        bundleGroupMap[exp.bundle_id] = {
          id: `bundle_${exp.bundle_id}`,
          bundle_id: exp.bundle_id,
          name: bundles.find(b => b.id === exp.bundle_id)?.name || '✨ Special Occasion',
          cost: 0,
          expense_date: exp.expense_date,
          categories_involved: new Set(),
          is_bundle_master: true
        };
        groupedExpenses.push(bundleGroupMap[exp.bundle_id]);
      }
      bundleGroupMap[exp.bundle_id].cost += parseFloat(exp.cost);
      bundleGroupMap[exp.bundle_id].categories_involved.add(exp.category);
    } else {
      groupedExpenses.push(exp);
    }
  });

  groupedExpenses.forEach(g => {
    if (g.is_bundle_master) g.category = Array.from(g.categories_involved).join(' + ');
  });

  const chartData = categories.map(cat => ({
    name: cat.name,
    value: parsedSalary * (cat.percentage / 100),
    fill: hexColorMap[cat.color] || '#4b5563'
  })).filter(item => item.value > 0);

  const wealthHistoryMap = {};
  [...assetAdjustments].reverse().forEach(adj => {
    const month = adj.adjustment_date.substring(0, 7);
    if (!wealthHistoryMap[month]) wealthHistoryMap[month] = 0;
    wealthHistoryMap[month] += parseFloat(adj.amount);
  });

  let runningWealth = 0;
  const wealthHistoryData = Object.keys(wealthHistoryMap).sort().map(month => {
    runningWealth += wealthHistoryMap[month];
    return {
      month: new Date(month + '-01').toLocaleString('default', { month: 'short', year: '2-digit' }),
      wealth: runningWealth
    };
  });

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

      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        setAlertMsg={setAlertMsg}
        currentStreak={currentStreak}
        longestStreak={longestStreak}
        handleLogout={handleLogout}
      />

      <main className="flex-1 overflow-y-auto p-4 md:p-10 relative custom-scrollbar">
        <div className="max-w-7xl mx-auto w-full">

          {alertMsg && (
            <div className="mb-6 p-3 rounded-md text-sm font-medium border bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-500/20 dark:border-indigo-500/40 dark:text-indigo-200 shadow-sm">
              {alertMsg}
            </div>
          )}

          <MobileHeader
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            currentStreak={currentStreak}
          />

          {activeTab === 'cashflow' && (
            <CashFlowTab
              isPastMonth={isPastMonth}
              closedMonths={closedMonths}
              selectedMonth={selectedMonth}
              handleCloseMonth={handleCloseMonth}
              setSelectedMonth={setSelectedMonth}
              isReadOnly={isReadOnly}
              totalRemaining={totalRemaining}
              parsedSalary={parsedSalary}
              globalPercentUsed={globalPercentUsed}
              totalSpent={totalSpent}
              totalAutomatedAssets={totalAutomatedAssets}
              chartData={chartData}
              theme={theme}
              formatCurrency={formatCurrency}
              handleUnlockAll={handleUnlockAll}
              lockedCategories={lockedCategories}
              handleSmartLockAll={handleSmartLockAll}
              categories={categories}
              monthlyExpenses={monthlyExpenses}
              dragState={dragState}
              setDragState={setDragState}
              handleSliderChange={handleSliderChange}
              toggleIndividualLock={toggleIndividualLock}
              setEditingCategory={setEditingCategory}
              handleDeleteCategory={handleDeleteCategory}
              editingCategory={editingCategory}
              handleUpdateCategory={handleUpdateCategory}
              setIsCategoryModalOpen={setIsCategoryModalOpen}
              isCategoryModalOpen={isCategoryModalOpen}
              newCategoryType={newCategoryType}
              setNewCategoryType={setNewCategoryType}
              newCategoryName={newCategoryName}
              setNewCategoryName={setNewCategoryName}
              newCategoryGoal={newCategoryGoal}
              setNewCategoryGoal={setNewCategoryGoal}
              handleAddCategory={handleAddCategory}
              setActiveTab={setActiveTab}
              setPlannerSubTab={setPlannerSubTab}
              handleAddExpense={handleAddExpense}
              expenseName={expenseName}
              setExpenseName={setExpenseName}
              expenseCost={expenseCost}
              setExpenseCost={setExpenseCost}
              expenseCategoryId={expenseCategoryId}
              setExpenseCategoryId={setExpenseCategoryId}
              expenseDate={expenseDate}
              setExpenseDate={setExpenseDate}
              isRecurring={isRecurring}
              setIsRecurring={setIsRecurring}
              isBatched={isBatched}
              setIsBatched={setIsBatched}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              filterCategory={filterCategory}
              setFilterCategory={setFilterCategory}
              filteredExpenses={filteredExpenses}
              expandedTransactionId={expandedTransactionId}
              setExpandedTransactionId={setExpandedTransactionId}
              bundles={bundles}
              handleDeleteExpense={handleDeleteExpense}
              groupedExpenses={groupedExpenses}
            />
          )}

          {activeTab === 'occasions' && (
            <OccasionsSandboxTab
              selectedMonth={selectedMonth}
              plannerSubTab={plannerSubTab}
              setPlannerSubTab={setPlannerSubTab}
              bundleName={bundleName}
              setBundleName={setBundleName}
              categories={categories}
              getCategoryAvailablePool={getCategoryAvailablePool}
              bundleAllocations={bundleAllocations}
              setBundleAllocations={setBundleAllocations}
              handleCreateBundle={handleCreateBundle}
              bundles={bundles}
              occasionItemInputs={occasionItemInputs}
              setOccasionItemInputs={setOccasionItemInputs}
              handleAddOccasionItem={handleAddOccasionItem}
              handleDeleteOccasionItem={handleDeleteOccasionItem}
              handleLockAndFinalizeBundle={handleLockAndFinalizeBundle}
              isReadOnly={isReadOnly}
              handleDeleteBundle={handleDeleteBundle}
              handleCreateSandboxSheet={handleCreateSandboxSheet}
              newSheetTitle={newSheetTitle}
              setNewSheetTitle={setNewSheetTitle}
              newSheetBudget={newSheetBudget}
              setNewSheetBudget={setNewSheetBudget}
              sandboxSheets={sandboxSheets}
              setSandboxSheets={setSandboxSheets}
              activeSheetId={activeSheetId}
              setActiveSheetId={setActiveSheetId}
              activeSheet={activeSheet}
              handleExportSandboxCSV={handleExportSandboxCSV}
              handleAddSubBucket={handleAddSubBucket}
              subBucketName={subBucketName}
              setSubBucketName={setSubBucketName}
              subBucketLimit={subBucketLimit}
              setSubBucketLimit={setSubBucketLimit}
              handleAddSandboxExpense={handleAddSandboxExpense}
              sandboxExpName={sandboxExpName}
              setSandboxExpName={setSandboxExpName}
              sandboxExpCost={sandboxExpCost}
              setSandboxExpCost={setSandboxExpCost}
              sandboxExpBucketId={sandboxExpBucketId}
              setSandboxExpBucketId={setSandboxExpBucketId}
              setAlertMsg={setAlertMsg}
              formatCurrencyFn={formatCurrency}
              handleDeleteSandboxSheet={handleDeleteSandboxSheet}
            />
          )}

          {activeTab === 'portfolio' && (
            <PortfolioTab
              assetCategories={assetCategories}
              handleAddAdjustment={handleAddAdjustment}
              adjCatId={adjCatId}
              setAdjCatId={setAdjCatId}
              adjAmount={adjAmount}
              setAdjAmount={setAdjAmount}
              adjNote={adjNote}
              setAdjNote={setAdjNote}
              adjDate={adjDate}
              setAdjDate={setAdjDate}
              assetAdjustments={assetAdjustments}
              categories={categories}
              formatCurrency={formatCurrency}
              wealthHistoryData={wealthHistoryData}
              theme={theme}
              currency={currency}
              parsedSalary={parsedSalary}
              monthlyExpenses={monthlyExpenses}
              selectedMonth={selectedMonth}
              todayMonth={todayMonth}
              closedMonths={closedMonths}
            />
          )}

          {activeTab === 'history' && <HistoryTab historyFeed={historyFeed} />}

          {activeTab === 'taxes' && (
            <TaxCenterTab
              taxCountry={taxCountry}
              setTaxCountry={setTaxCountry}
              taxFilingStatus={taxFilingStatus}
              setTaxFilingStatus={setTaxFilingStatus}
              currency={currency}
              taxIncomeInput={taxIncomeInput}
              setTaxIncomeInput={setTaxIncomeInput}
              calculateTaxEstimate={calculateTaxEstimate}
              taxEstimateResult={taxEstimateResult}
              formatCurrency={formatCurrency}
            />
          )}

          {activeTab === 'settings' && (
            <SettingsTab
              theme={theme}
              setTheme={setTheme}
              salary={salary}
              setSalary={setSalary}
              currencyMode={currencyMode}
              setCurrencyMode={setCurrencyMode}
              currency={currency}
              setCurrency={setCurrency}
              exportScope={exportScope}
              setExportScope={setExportScope}
              exportMonth={exportMonth}
              setExportMonth={setExportMonth}
              exportDate={exportDate}
              setExportDate={setExportDate}
              handleExportCSV={handleExportCSV}
            />
          )}

        </div>
      </main>
    </div>
  );
}