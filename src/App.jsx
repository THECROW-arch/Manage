import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import './App.css';
import './i18n';
import { useTranslation } from 'react-i18next';
import { supabase } from './supabaseClient';
import Auth from './Auth';
import { hexColorMap, calculateProgressiveTax, getToday, getCurrentMonth } from './utils/constants';
import { sendRecurringExpenseReminderEmail } from './utils/emailReminderService';
import Sidebar, { MobileHeader } from './components/Sidebar';
import CashFlowTab from './components/CashFlowTab';
import AIAssistantDrawer from './components/AIAssistantDrawer';

const HistoryTab = lazy(() => import('./components/HistoryTab'));
const TaxCenterTab = lazy(() => import('./components/TaxCenterTab'));
const SettingsTab = lazy(() => import('./components/SettingsTab'));
const PortfolioTab = lazy(() => import('./components/PortfolioTab'));
const WealthObjectivesSection = lazy(() => import('./components/WealthObjectivesSection'));
const OccasionsSandboxTab = lazy(() => import('./components/OccasionsSandboxTab'));
const SupportTab = lazy(() => import('./components/SupportTab'));
const DevDashboard = lazy(() => import('./components/DevDashboard'));
const OwnerDashboard = lazy(() => import('./components/OwnerDashboard'));

const readUserStorage = (prefix, uid, fallback) => {
  if (!uid) return fallback;
  try {
    const saved = localStorage.getItem(`${prefix}_${uid}`);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
};

/**
 * Main application component orchestrating global state, data fetching, and tab routing.
 */
export default function App() {
  const { t, i18n } = useTranslation();
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState('');

  // Logout Confirmation State
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const logoutDialogRef = useRef(null);

  useEffect(() => {
    if (showLogoutConfirm) {
      logoutDialogRef.current?.focus();
    }
  }, [showLogoutConfirm]);

  useEffect(() => {
    const lang = i18n.resolvedLanguage || i18n.language || 'en';
    document.documentElement.dir = lang.startsWith('ar') ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [i18n.resolvedLanguage, i18n.language]);

  const [session, setSession] = useState(null);
  const [loadingData, setLoadingData] = useState(true);

  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('theme') || 'dark'; }
    catch { return 'dark'; }
  });

  useEffect(() => {
    try { localStorage.setItem('theme', theme); } catch (e) { console.warn(e); }
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

  // Persisted Active Tab State (Survives Refreshes)
  const [activeTab, setActiveTab] = useState(() => {
    try { return localStorage.getItem('activeTab') || 'cashflow'; }
    catch { return 'cashflow'; }
  });

  useEffect(() => {
    try { localStorage.setItem('activeTab', activeTab); }
    catch (e) { console.warn('Failed to persist activeTab:', e); }
  }, [activeTab]);

  const [plannerSubTab, setPlannerSubTab] = useState('occasions');

  // Support Tab Persisted Draft & Submission State (Isolated by authenticated user ID)
  const [supportDraft, setSupportDraft] = useState({ userId: null, subject: '', category: 'general', message: '' });
  const [submittingTicketUserId, setSubmittingTicketUserId] = useState(null);

  const [salary, setSalary] = useState('');
  const [username, setUsername] = useState('');
  const [userRole, setUserRole] = useState('customer');
  const [subscriptionTier, setSubscriptionTier] = useState('free');
  const [upgradePromptFeature, setUpgradePromptFeature] = useState(null);
  const [emailRemindersEnabled, setEmailRemindersEnabled] = useState(true);
  const [lastReminderPeriod, setLastReminderPeriod] = useState(null);
  const [isSendingReminder, setIsSendingReminder] = useState(false);

  const hasProAccess = useMemo(() => {
    const cleanRole = String(userRole || '').trim().toLowerCase();
    const cleanTier = String(subscriptionTier || 'free').trim().toLowerCase();
    if (['owner', 'dev', 'special'].includes(cleanRole)) return true;
    return ['pro', 'pro_monthly', 'pro_yearly', 'enterprise'].includes(cleanTier);
  }, [userRole, subscriptionTier]);

  const localizedUpgradeFeatureName = useMemo(() => {
    if (!upgradePromptFeature) return '';
    const featureMap = {
      visual_excel_reports: t('pro_feature_visual_excel', 'Visual Dashboard Excel Reports'),
      unlimited_sandbox_sheets: t('pro_feature_unlimited_sandbox', 'Unlimited Sandbox Calculation Sheets'),
      multi_goal_objectives: t('pro_feature_multi_objectives', 'Multi-Goal Wealth Objectives')
    };
    return featureMap[upgradePromptFeature] || t(upgradePromptFeature, upgradePromptFeature);
  }, [upgradePromptFeature, t]);
  const [categories, setCategories] = useState([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryType, setNewCategoryType] = useState('expense');
  const [newCategoryGoal, setNewCategoryGoal] = useState('');
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [exportScope, setExportScope] = useState('month');
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

  const [currency, setCurrency] = useState('$');
  const [currencyMode, setCurrencyMode] = useState('$');
  const [customCurrency, setCustomCurrency] = useState('');
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
  const [occasionItemInputs, setOccasionItemInputs] = useState({});

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

  // Account-Scoped States for Income Boosts, Wealth Objectives, Expense Metadata, & Last-Added Expense
  const activeUserId = session?.user?.id || null;
  const [boostOverridesByUser, setBoostOverridesByUser] = useState({});
  const [objectivesByUser, setObjectivesByUser] = useState({});
  const [lastExpenseByUser, setLastExpenseByUser] = useState({});
  const [metaOverridesByUser, setMetaOverridesByUser] = useState({});

  // Read-Only Locking Logic
  const todayMonth = getCurrentMonth();
  const isPastMonth = selectedMonth < todayMonth;
  const isCurrentMonthClosed = closedMonths.some(c => c.month === todayMonth);
  const isReadOnly = isPastMonth || (selectedMonth === todayMonth && isCurrentMonthClosed);

  useEffect(() => {
    try { localStorage.setItem('selectedMonth', selectedMonth); }
    catch (e) { console.warn('Failed to save selectedMonth:', e); }
  }, [selectedMonth]);

  useEffect(() => {
    try { localStorage.setItem('lockedCats', JSON.stringify(lockedCategories)); }
    catch (e) { console.warn('Failed to save lockedCats:', e); }
  }, [lockedCategories]);

  useEffect(() => {
    if (alertMsg) {
      const timer = setTimeout(() => setAlertMsg(''), 4000);
      return () => clearTimeout(timer);
    }
  }, [alertMsg]);

  const [draftHydratedUserId, setDraftHydratedUserId] = useState(null);

  const fetchUserData = async (userId, isBackgroundSync = false) => {
    window.__activeUserId = userId;
    if (window.__fetchingUserId === userId) return;
    if (isBackgroundSync && window.__loadedUserId === userId) return;
    window.__fetchingUserId = userId;
    const isStale = () => window.__activeUserId !== userId;

    if (window.__loadedUserId !== userId) {
      setLoadingData(true);
    }
    try {
      let { data: profile } = await supabase.from('profiles').select('*').eq('user_id', userId).single();
      if (isStale()) return;

      if (!profile) {
        const { data: authData } = await supabase.auth.getUser();
        if (isStale()) return;
        const registeredUsername = authData?.user?.user_metadata?.username || `user_${userId.slice(0, 8)}`;

        const { data: newProfile } = await supabase.from('profiles').insert([{
          user_id: userId,
          username: registeredUsername,
          role: 'user',
          subscription_tier: 'free'
        }]).select().single();
        if (isStale()) return;

        profile = newProfile;
      }

      if (profile) {
        const loadedRole = profile.role || 'user';
        const loadedTier = profile.subscription_tier || 'free';
        setUserRole(loadedRole);
        setSubscriptionTier(loadedTier);

        // Validate saved tab access against loaded role safely
        setActiveTab(currentTab => {
          if (currentTab === 'dev_dashboard' && loadedRole !== 'dev' && loadedRole !== 'owner') return 'cashflow';
          if (currentTab === 'owner_dashboard' && loadedRole !== 'owner') return 'cashflow';
          return currentTab;
        });

        // Hydrate isolated support draft for this user safely before enabling persistence
        let loadedDraft = { userId, subject: '', category: 'general', message: '' };
        try {
          const savedDraft = localStorage.getItem(`supportDraft_${userId}`);
          if (savedDraft) {
            const parsed = JSON.parse(savedDraft);
            loadedDraft = {
              userId,
              subject: parsed?.subject || '',
              category: parsed?.category || 'general',
              message: parsed?.message || ''
            };
          }
        } catch { /* ignore */ }
        setSupportDraft(loadedDraft);
        setDraftHydratedUserId(userId);

        setSalary(profile.salary > 0 ? profile.salary.toString() : '');
        if (profile.currency !== undefined) {
          setCurrency(profile.currency);
          if (!['$', '€', '£', 'MAD', ''].includes(profile.currency)) {
            setCurrencyMode('custom');
            setCustomCurrency(profile.currency);
          }
          else if (profile.currency === '') setCurrencyMode('none');
          else setCurrencyMode(profile.currency);
        }
        if (profile.tax_country) setTaxCountry(profile.tax_country);
        if (profile.username) setUsername(profile.username);
        if (profile.tax_filing_status) setTaxFilingStatus(profile.tax_country === 'US' ? profile.tax_filing_status : 'single');
        setCurrentStreak(profile.current_streak || 0);
        setLongestStreak(profile.longest_streak || 0);
        setEmailRemindersEnabled(profile.email_reminders_enabled ?? true);
        setLastReminderPeriod(profile.last_reminder_period || null);
        // Hydrate monthly income boosts & wealth objectives from Supabase (falling back to localStorage if DB is empty)
        const localBoosts = readUserStorage('managed_monthly_boosts', userId, {});
        const dbBoosts =
          profile.monthly_boosts &&
            typeof profile.monthly_boosts === 'object' &&
            !Array.isArray(profile.monthly_boosts)
            ? profile.monthly_boosts
            : {};
        const mergedBoosts = Object.keys(dbBoosts).length > 0 ? dbBoosts : localBoosts;
        setBoostOverridesByUser(prev => ({ ...prev, [userId]: mergedBoosts }));

        const localObjectives = readUserStorage('managed_wealth_objectives', userId, []);
        const dbObjectives = Array.isArray(profile.wealth_objectives) ? profile.wealth_objectives : [];
        const mergedObjectives = dbObjectives.length > 0 ? dbObjectives : localObjectives;
        setObjectivesByUser(prev => ({ ...prev, [userId]: mergedObjectives }));
      }

      let { data: cats } = await supabase.from('categories').select('*').eq('user_id', userId).order('created_at', { ascending: true });
      if (isStale()) return;
      cats = cats || [];

      if (cats.length === 0) {
        const defaultCats = [
          { user_id: userId, name: 'Needs', percentage: 50, color: 'emerald-600', type: 'expense', target_goal: 0 },
          { user_id: userId, name: 'Wants', percentage: 30, color: 'pink-600', type: 'expense', target_goal: 0 },
          { user_id: userId, name: 'Savings', percentage: 20, color: 'green-600', type: 'asset', target_goal: 50000 }
        ];
        const { data: seededCats } = await supabase.from('categories').insert(defaultCats).select();
        if (isStale()) return;
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
      if (isStale()) return;
      const loadedExpenses = expensesData || [];
      setExpenses(loadedExpenses);

      const localMeta = readUserStorage('managed_expense_meta', userId, {});
      const hydratedMeta = { ...localMeta };
      loadedExpenses.forEach(exp => {
        if (!exp?.id) return;
        const existingMeta = hydratedMeta[exp.id] || {};
        hydratedMeta[exp.id] = {
          ...existingMeta,
          recurrenceType: exp.recurrence_type || existingMeta.recurrenceType || 'monthly',
          skippedPeriods: Array.isArray(exp.skipped_periods)
            ? exp.skipped_periods
            : (existingMeta.skippedPeriods || []),
          lastEditedAt: exp.last_edited_at || existingMeta.lastEditedAt || null
        };
      });
      setMetaOverridesByUser(prev => ({ ...prev, [userId]: hydratedMeta }));

      let { data: bundlesData } = await supabase
        .from('bundles')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (isStale()) return;
      setBundles(bundlesData || []);

      let { data: sandboxData } = await supabase
        .from('sandbox_sheets')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (isStale()) return;

      setSandboxSheets((sandboxData || []).map(s => ({
        id: s.id, title: s.title, totalBudget: parseFloat(s.total_budget),
        buckets: s.buckets || [], expenses: s.expenses || []
      })));

      let { data: adjData } = await supabase.from('asset_adjustments').select('*').eq('user_id', userId).order('adjustment_date', { ascending: false });
      if (isStale()) return;
      setAssetAdjustments(adjData || []);

      let { data: closedData } = await supabase.from('closed_months').select('*').eq('user_id', userId);
      if (isStale()) return;
      setClosedMonths(closedData || []);

      window.__loadedUserId = userId;
      setLoadingData(false);
    } finally {
      if (window.__fetchingUserId === userId) {
        window.__fetchingUserId = null;
      }
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchUserData(session.user.id, false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setShowRecoveryModal(true);
      }
      setSession(session);
      if (session) {
        if (event === 'TOKEN_REFRESHED') return;
        fetchUserData(session.user.id, true);
      } else {
        window.__activeUserId = null;
        window.__fetchingUserId = null;
        window.__loadedUserId = null;
        setDraftHydratedUserId(null);
        setSupportDraft({ userId: null, subject: '', category: 'general', message: '' });
        setBoostOverridesByUser({});
        setObjectivesByUser({});
        setLastExpenseByUser({});
        setMetaOverridesByUser({});
      }
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, []);



  const handleLogoutRequest = () => {
    setShowLogoutConfirm(true);
  };

  const confirmLogout = async () => {
    try {
      window.__activeUserId = null;
      window.__fetchingUserId = null;
      await supabase.auth.signOut();
      setSession(null);
      setExpenses([]);
      setCategories([]);
      setAssetAdjustments([]);
      setClosedMonths([]);
      setSalary('');
      setUserRole('customer');
      setSubscriptionTier('free');
      setDraftHydratedUserId(null);
      setSupportDraft({ userId: null, subject: '', category: 'general', message: '' });
      setBoostOverridesByUser({});
      setObjectivesByUser({});
      setLastExpenseByUser({});
      setMetaOverridesByUser({});
      setShowLogoutConfirm(false);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const formatCurrency = useCallback((val) => {
    const num = Number(val) || 0;
    const formatted = num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const isPrefix = ['$', '€', '£', '¥'].includes(currency);
    if (i18n.language === 'ar') {
      return `${formatted} ${currency}`;
    }
    return isPrefix ? `${currency}${formatted}` : `${formatted} ${currency}`;
  }, [currency, i18n.language]);

  // Pure Account-Scoped State Updaters & Persistence Effects
  const monthlyIncomeBoosts = useMemo(() => {
    if (!activeUserId) return {};
    return boostOverridesByUser[activeUserId] ?? readUserStorage('managed_monthly_boosts', activeUserId, {});
  }, [activeUserId, boostOverridesByUser]);

  const setMonthlyIncomeBoosts = (updater) => {
    if (!activeUserId) return;
    setBoostOverridesByUser(prev => {
      const current = prev[activeUserId] ?? readUserStorage('managed_monthly_boosts', activeUserId, {});
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...prev, [activeUserId]: next };
    });
  };

  useEffect(() => {
    if (!activeUserId) return;
    if (!Object.prototype.hasOwnProperty.call(boostOverridesByUser, activeUserId)) return;
    try {
      localStorage.setItem(
        `managed_monthly_boosts_${activeUserId}`,
        JSON.stringify(boostOverridesByUser[activeUserId])
      );
    } catch (e) {
      console.warn('Failed to save monthlyIncomeBoosts:', e);
    }
  }, [boostOverridesByUser, activeUserId]);

  const wealthObjectives = useMemo(() => {
    if (!activeUserId) return [];
    return objectivesByUser[activeUserId] ?? readUserStorage('managed_wealth_objectives', activeUserId, []);
  }, [activeUserId, objectivesByUser]);

  const setWealthObjectives = (updater) => {
    if (!activeUserId) return;
    setObjectivesByUser(prev => {
      const current = prev[activeUserId] ?? readUserStorage('managed_wealth_objectives', activeUserId, []);
      const next = typeof updater === 'function' ? updater(current) : updater;
      return { ...prev, [activeUserId]: next };
    });
  };

  useEffect(() => {
    if (!activeUserId) return;
    if (!Object.prototype.hasOwnProperty.call(objectivesByUser, activeUserId)) return;
    try {
      localStorage.setItem(
        `managed_wealth_objectives_${activeUserId}`,
        JSON.stringify(objectivesByUser[activeUserId])
      );
    } catch (e) {
      console.warn('Failed to save wealthObjectives:', e);
    }
  }, [objectivesByUser, activeUserId]);

  useEffect(() => {
    if (!session || loadingData) return;

    const delayDebounceFn = setTimeout(async () => {
      try {
        await supabase.from('profiles').upsert({
          user_id: session.user.id,
          salary: parseFloat(salary) || 0,
          currency: currency,
          tax_country: taxCountry,
          tax_filing_status: taxFilingStatus,
          monthly_boosts: monthlyIncomeBoosts,
          wealth_objectives: wealthObjectives,
          email_reminders_enabled: emailRemindersEnabled,
          last_reminder_period: lastReminderPeriod
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
        setAlertMsg(t('warn_autosave_failed'));
      }
    }, 1000);

    return () => clearTimeout(delayDebounceFn);
  }, [
    salary,
    categories,
    sandboxSheets,
    session,
    loadingData,
    currency,
    taxCountry,
    taxFilingStatus,
    monthlyIncomeBoosts,
    wealthObjectives,
    emailRemindersEnabled,
    lastReminderPeriod,
    t
  ]);

  const expenseMetaMap = useMemo(() => {
    if (!activeUserId) return {};
    return metaOverridesByUser[activeUserId] ?? readUserStorage('managed_expense_meta', activeUserId, {});
  }, [activeUserId, metaOverridesByUser]);

  const updateExpenseMeta = (expId, patch, syncToDb = true) => {
    if (!activeUserId || !expId) return;
    setMetaOverridesByUser(prev => {
      const current = prev[activeUserId] ?? readUserStorage('managed_expense_meta', activeUserId, {});
      const mergedEntry = { ...(current[expId] || {}), ...patch };
      const next = {
        ...current,
        [expId]: mergedEntry
      };
      return { ...prev, [activeUserId]: next };
    });

    if (syncToDb) {
      const dbPatch = {};
      if (patch.recurrenceType !== undefined) dbPatch.recurrence_type = patch.recurrenceType;
      if (patch.skippedPeriods !== undefined) dbPatch.skipped_periods = patch.skippedPeriods;
      if (patch.lastEditedAt !== undefined) dbPatch.last_edited_at = patch.lastEditedAt;

      if (Object.keys(dbPatch).length > 0) {
        supabase
          .from('expenses')
          .update(dbPatch)
          .eq('id', expId)
          .eq('user_id', activeUserId)
          .then(({ error }) => {
            if (error) console.warn('Failed to sync expense metadata to Supabase:', error.message);
          });
      }
    }
  };

  useEffect(() => {
    if (!activeUserId) return;
    if (!Object.prototype.hasOwnProperty.call(metaOverridesByUser, activeUserId)) return;
    try {
      localStorage.setItem(
        `managed_expense_meta_${activeUserId}`,
        JSON.stringify(metaOverridesByUser[activeUserId])
      );
    } catch (e) {
      console.warn('Failed to save expense metadata:', e);
    }
  }, [metaOverridesByUser, activeUserId]);

  const isExpenseSkippedForCurrentPeriod = (exp, targetMonth = selectedMonth, targetDay = getToday()) => {
    if (!exp?.is_recurring) return false;
    const meta = expenseMetaMap[exp.id];
    if (!meta || !Array.isArray(meta.skippedPeriods)) return false;
    const freq = meta.recurrenceType || 'monthly';
    const mKey = targetMonth || selectedMonth;
    const periodKey = freq === 'daily'
      ? targetDay
      : freq === 'yearly'
        ? mKey.slice(0, 4)
        : mKey;
    return meta.skippedPeriods.includes(periodKey);
  };

  const lastAddedExpenseId = activeUserId
    ? (lastExpenseByUser[activeUserId] ?? (() => {
      try {
        return localStorage.getItem(`managed_last_expense_${activeUserId}`) || null;
      } catch {
        return null;
      }
    })())
    : null;

  const recordLastAddedExpenseId = (expId) => {
    if (!activeUserId || !expId) return;
    setLastExpenseByUser(prev => ({ ...prev, [activeUserId]: String(expId) }));
  };

  useEffect(() => {
    if (!activeUserId) return;
    if (!Object.prototype.hasOwnProperty.call(lastExpenseByUser, activeUserId)) return;
    try {
      localStorage.setItem(`managed_last_expense_${activeUserId}`, String(lastExpenseByUser[activeUserId]));
    } catch { /* ignore */ }
  }, [lastExpenseByUser, activeUserId]);

  const baseSalary = parseFloat(salary) || 0;
  const currentMonthBoost = parseFloat(monthlyIncomeBoosts[selectedMonth]) || 0;
  const parsedSalary = baseSalary + currentMonthBoost;

  const handleAddMonthlyBoost = (amountToAdd) => {
    if (isReadOnly) return;
    const num = parseFloat(amountToAdd);
    if (isNaN(num)) return;
    setMonthlyIncomeBoosts(prev => {
      const current = parseFloat(prev[selectedMonth]) || 0;
      const updatedVal = Math.max(0, Number((current + num).toFixed(2)));
      const next = { ...prev };
      if (updatedVal === 0) delete next[selectedMonth];
      else next[selectedMonth] = updatedVal;
      return next;
    });
  };

  const handleClearMonthlyBoost = () => {
    if (isReadOnly) return;
    setMonthlyIncomeBoosts(prev => {
      const next = { ...prev };
      delete next[selectedMonth];
      return next;
    });
  };

  const monthlyExpenses = expenses.filter(e => e.expense_date && e.expense_date.startsWith(selectedMonth));
  const activeMonthlyExpenses = monthlyExpenses.filter(e => !isExpenseSkippedForCurrentPeriod(e, selectedMonth));
  const assetCategories = categories.filter(c => c.type === 'asset');

  /**
   * Shared creation handler for Wealth Objectives used by both the Portfolio form and Sterling AI.
   * Enforces the 1-objective Free Tier limit consistently across both creation paths.
   */
  const handleCreateWealthObjective = ({ name, targetAmount, autoPulls = {} }) => {
    if (isReadOnly) {
      return { ok: false, code: 'read_only', error: `The ledger for **${selectedMonth}** is closed and read-only.` };
    }
    if (!hasProAccess && wealthObjectives.length >= 1) {
      setUpgradePromptFeature('multi_goal_objectives');
      return {
        ok: false,
        code: 'pro_limit',
        error: 'Free accounts include **1 Wealth Objective**. Upgrade to **MANAGED Pro** for unlimited multi-goal Wealth Objectives!'
      };
    }
    const cleanName = String(name || '').trim();
    const targetNum = parseFloat(targetAmount);
    if (!cleanName || isNaN(targetNum) || targetNum <= 0) {
      return { ok: false, code: 'invalid', error: 'Please provide a valid objective name and target amount.' };
    }
    const newObjective = {
      id: crypto.randomUUID(),
      name: cleanName,
      targetAmount: targetNum,
      manualSaved: 0,
      autoPulls: autoPulls || {},
      appliedMonths: [],
      history: [],
      createdAt: getToday()
    };
    setWealthObjectives(prev => [newObjective, ...prev]);
    return { ok: true, objective: newObjective };
  };

  /**
   * Sends a confirmation reminder email for recurring expenses in the active period.
   * @param {boolean} isManualTrigger - Whether triggered manually by user button click.
   */
  const handleSendRecurringReminder = async (isManualTrigger = true) => {
    if (!session?.user?.email || isSendingReminder) return false;
    const unconfirmedRecurring = activeMonthlyExpenses
      .filter(exp => exp.is_recurring)
      .map(exp => ({
        ...exp,
        recurrenceType: expenseMetaMap[exp.id]?.recurrenceType || 'monthly'
      }));

    if (unconfirmedRecurring.length === 0) {
      if (isManualTrigger) {
        setAlertMsg(
          t('err_no_unconfirmed_recurring', {
            period: selectedMonth,
            defaultValue: `All recurring expenses for ${selectedMonth} are already confirmed or skipped.`
          })
        );
      }
      return false;
    }

    setIsSendingReminder(true);
    try {
      const res = await sendRecurringExpenseReminderEmail({
        userId: session.user.id,
        recipientEmail: session.user.email,
        username: username || session.user.email.split('@')[0],
        periodKey: selectedMonth,
        pendingExpenses: unconfirmedRecurring,
        formatCurrency
      });

      if (res.ok) {
        setLastReminderPeriod(selectedMonth);
        if (isManualTrigger) {
          setAlertMsg(
            t('succ_reminder_sent', {
              email: session.user.email,
              count: unconfirmedRecurring.length,
              defaultValue: `Confirmation reminder email queued for ${session.user.email} (${unconfirmedRecurring.length} recurring item(s)).`
            })
          );
        }
        return true;
      } else if (isManualTrigger && res.error) {
        setAlertMsg(res.error);
      }
      return false;
    } finally {
      setIsSendingReminder(false);
    }
  };
 // Automatically trigger one recurring expense reminder email per period when enabled
  const autoReminderAttemptedRef = useRef({});
  useEffect(() => {
    if (!session?.user?.email || loadingData || isReadOnly) return;
    if (!emailRemindersEnabled) return;
    if (lastReminderPeriod === selectedMonth) return;

    const attemptKey = `${session.user.id}_${selectedMonth}`;
    if (autoReminderAttemptedRef.current[attemptKey]) return;

    const unconfirmedRecurring = activeMonthlyExpenses
      .filter(exp => exp.is_recurring)
      .map(exp => ({
        ...exp,
        recurrenceType: expenseMetaMap[exp.id]?.recurrenceType || 'monthly'
      }));

    if (unconfirmedRecurring.length === 0) return;

    autoReminderAttemptedRef.current[attemptKey] = true;

    let cancelled = false;
    sendRecurringExpenseReminderEmail({
      userId: session.user.id,
      recipientEmail: session.user.email,
      username: username || session.user.email.split('@')[0],
      periodKey: selectedMonth,
      pendingExpenses: unconfirmedRecurring,
      formatCurrency
    }).then((res) => {
      if (!cancelled && res?.ok) {
        setLastReminderPeriod(selectedMonth);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    session,
     username,
    loadingData,
    isReadOnly,
    emailRemindersEnabled,
    lastReminderPeriod,
    selectedMonth,
    activeMonthlyExpenses,
    expenseMetaMap,
    formatCurrency
  ]);
  const handleExportData = async (exportFormat) => {
    if (exportFormat === 'visual' && !hasProAccess) {
      setUpgradePromptFeature('visual_excel_reports');
      return;
    }
    const todayStr = getToday();
    const currentMonthStr = getCurrentMonth();
    const targetPeriod = exportScope === 'month' ? exportMonth : exportDate;

    if ((exportScope === 'month' && exportMonth > currentMonthStr) || (exportScope === 'day' && exportDate > todayStr)) {
      setAlertMsg(t('err_export_future'));
      return;
    }

    const periodMonth = targetPeriod.substring(0, 7);
    const periodDay = exportScope === 'day' ? exportDate : todayStr;
    const exportMonthBoost = parseFloat(monthlyIncomeBoosts[periodMonth]) || 0;
    const exportSalary = baseSalary + exportMonthBoost;

    const scopedExps = expenses.filter(
      e =>
        e.expense_date &&
        !isExpenseSkippedForCurrentPeriod(e, periodMonth, periodDay) &&
        (exportScope === 'month' ? e.expense_date.startsWith(exportMonth) : e.expense_date === exportDate)
    );
    const scopedAdjs = assetAdjustments.filter(
      a => a.adjustment_date && (exportScope === 'month' ? a.adjustment_date.startsWith(exportMonth) : a.adjustment_date === exportDate)
    );
    const cumulativeMonthExps = expenses.filter(
      e =>
        e.expense_date &&
        !isExpenseSkippedForCurrentPeriod(e, periodMonth, periodDay) &&
        e.expense_date.startsWith(periodMonth) &&
        (exportScope === 'month' ? true : e.expense_date <= exportDate)
    );

    if (scopedExps.length === 0 && scopedAdjs.length === 0) {
      setAlertMsg(t('err_export_empty', { period: targetPeriod }));
      return;
    }

    const groupedScopedExps = [];
    const bundleMap = {};
    scopedExps.forEach(e => {
      if (e.bundle_id) {
        if (!bundleMap[e.bundle_id]) {
          const parentBundle = bundles.find(b => b.id === e.bundle_id);
          bundleMap[e.bundle_id] = {
            id: `bundle_${e.bundle_id}`,
            bundle_id: e.bundle_id,
            name: parentBundle ? ` ${parentBundle.name}` : e.name,
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

    const assetCategoriesList = categories.filter(c => c.type === 'asset');
    const expenseCategoryIdsForExport = categories.filter(c => c.type !== 'asset').map(c => c.id);
    const periodSpent = scopedExps
      .filter(e => expenseCategoryIdsForExport.includes(e.category_id))
      .reduce((s, e) => s + parseFloat(e.cost), 0);
    const cumulativeMonthSpent = cumulativeMonthExps
      .filter(e => expenseCategoryIdsForExport.includes(e.category_id))
      .reduce((s, e) => s + parseFloat(e.cost), 0);
    const monthlyAssetsAllocated = assetCategoriesList.reduce((s, c) => s + (exportSalary * (c.percentage / 100)), 0);
    const cumulativeExpenseCatSpent = cumulativeMonthExps
      .filter(e => categories.find(c => c.id === e.category_id)?.type !== 'asset')
      .reduce((s, e) => s + parseFloat(e.cost), 0);
    const trueMonthRemaining = Math.max(0, exportSalary - cumulativeExpenseCatSpent - monthlyAssetsAllocated);

    const reportData = {
      targetPeriod,
      exportScope,
      currency: currency === 'none' ? '' : currency,
      parsedSalary: exportSalary,
      periodSpent,
      cumulativeMonthSpent,
      monthlyAssetsAllocated,
      trueMonthRemaining,
      categories,
      groupedScopedExps,
      scopedExps,
      cumulativeMonthExps,
      scopedAdjs,
      closedMonths
    };

    try {
      const { generateFormalAudit, generateVisualDashboard } = await import('./utils/excelGenerator');
      if (exportFormat === 'formal') {
        await generateFormalAudit(reportData);
        setAlertMsg(t('succ_export_formal', { period: targetPeriod }));
      } else {
        await generateVisualDashboard(reportData);
        setAlertMsg(t('succ_export_visual', { period: targetPeriod }));
      }
    } catch (error) {
      console.error(error);
      setAlertMsg(t('err_export_failed'));
    }
  };

  const historyFeed = [
    ...closedMonths.map(record => {
      const [year, month] = record.month.split('-');
      const nextDate = new Date(year, parseInt(month), 1);
      const nextMonthStr = nextDate.getFullYear() + '-' + String(nextDate.getMonth() + 1).padStart(2, '0') + '-01';
      return {
        id: `cm-${record.month}`,
        type: 'ledger',
        date: nextMonthStr,
        title: 'Ledger Closed',
        desc: `Finalized budget and executed wealth sweep for ${record.month}`
      };
    }),
    ...assetAdjustments.map(a => ({
      id: a.id,
      type: 'adjustment',
      date: a.adjustment_date,
      title: a.note || t('manual_adjustment'),
      desc: `${a.amount > 0 ? '+' : ''}${formatCurrency(a.amount)} logged to ${categories.find(c => c.id === a.category_id)?.name || t('asset_fallback')}`
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
        setAlertMsg(t('err_lock_final_cat', { diff: Math.round(Math.abs(100 - total)) }));
        return;
      }
      setLockedCategories([...lockedCategories, id]);
    }
  };

  const handleUnlockAll = () => {
    if (isReadOnly) return;
    setLockedCategories([]);
    setAlertMsg(t('msg_all_unlocked'));
  };

  const handleSmartLockAll = () => {
    if (isReadOnly) return;
    setAlertMsg('');
    const total = categories.reduce((sum, c) => sum + c.percentage, 0);
    const diff = 100 - total;

    if (Math.abs(diff) < 0.1) {
      if (lockedCategories.length === categories.length) return;
      setLockedCategories(categories.map(c => c.id));
      setAlertMsg(t('msg_perfect_balance'));
      return;
    }

    const unlocked = categories.filter(c => !lockedCategories.includes(c.id));
    if (unlocked.length === 0) {
      setAlertMsg(t('err_cannot_autobalance', { total: Math.round(total) }));
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
        auditLog.push(
          adjRounded > 0
            ? t('smart_lock_added', { pct: Math.abs(adjRounded), name: u.name })
            : t('smart_lock_decreased', { pct: Math.abs(adjRounded), name: u.name })
        );
      }
    });

    setCategories(newCats);
    setLockedCategories(newCats.map(c => c.id));
    setAlertMsg(auditLog.length > 0 ? t('msg_smart_lock_summary', { details: auditLog.join(', ') }) : t('msg_smart_lock_applied'));
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
    if (closedMonths.some(c => c.month === selectedMonth)) {
      setAlertMsg(t('err_month_already_closed', { month: selectedMonth }));
      return;
    }

    const [year, month] = selectedMonth.split('-');
    const nextDate = new Date(year, parseInt(month), 1);
    const nextMonthStamp = nextDate.getFullYear() + '-' + String(nextDate.getMonth() + 1).padStart(2, '0') + '-01';

    const previousAdj = [...assetAdjustments];
    const previousClosed = [...closedMonths];
    const previousExpenses = [...expenses];

    try {
      // 1. AGGREGATE BATCHED EXPENSES
      const batchedExpenses = activeMonthlyExpenses.filter(e => e.is_batched);
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

        const closedMonthEndStamp = `${selectedMonth}-28`;
        for (const [, exps] of Object.entries(grouped)) {
          const sum = exps.reduce((total, e) => total + parseFloat(e.cost), 0);
          newlyAggregated.push({
            user_id: session.user.id, name: `${exps[0].name.trim()} (Batched x${exps.length})`, cost: sum,
            category_id: exps[0].category_id, category: exps[0].category,
            expense_date: closedMonthEndStamp,
            is_recurring: false, is_batched: false
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

      // 2. FORWARD RECURRING EXPENSES (Monthly/Daily -> nextMonthStamp; Yearly -> nextYearStamp)
      const recurringExpenses = monthlyExpenses.filter(e => e.is_recurring);
      let newRecurring = [];
      if (recurringExpenses.length > 0) {
        const nextYearStamp = `${Number(year) + 1}-${String(month).padStart(2, '0')}-01`;
        const recPayloads = recurringExpenses.map(e => {
          const sourceFreq = expenseMetaMap[e.id]?.recurrenceType || 'monthly';
          const targetDate = sourceFreq === 'yearly' ? nextYearStamp : nextMonthStamp;
          return {
            user_id: session.user.id,
            name: e.name,
            cost: e.cost,
            category_id: e.category_id,
            category: e.category,
            expense_date: targetDate,
            is_recurring: true,
            is_batched: false,
            recurrence_type: sourceFreq,
            skipped_periods: []
          };
        });
        const { data, error } = await supabase.from('expenses').insert(recPayloads).select();
        if (error) throw error;
        newRecurring = data || [];
        newRecurring.forEach((insertedRow, idx) => {
          const sourceExp = recurringExpenses[idx];
          const sourceFreq = sourceExp ? expenseMetaMap[sourceExp.id]?.recurrenceType : null;
          if (insertedRow?.id && sourceFreq) {
            updateExpenseMeta(insertedRow.id, { recurrenceType: sourceFreq });
          }
        });
      }

      // 3. WEALTH SWEEP
      const newAdjustments = [];
      assetCategories.forEach(cat => {
        const allocated = parsedSalary * (cat.percentage / 100);
        const spentFromAsset = activeMonthlyExpenses.filter(e => e.category_id === cat.id).reduce((sum, e) => sum + parseFloat(e.cost), 0);
        const amountToSweep = Math.max(0, allocated - spentFromAsset);

        if (amountToSweep > 0) {
          newAdjustments.push({
            user_id: session.user.id, category_id: cat.id, amount: amountToSweep,
            adjustment_date: nextMonthStamp,
            note: `Month-End Auto-Sweep (${selectedMonth})`
          });
        }
      });

      if (newAdjustments.length > 0) {
        const { data, error } = await supabase.from('asset_adjustments').insert(newAdjustments).select();
        if (error) throw error;
        setAssetAdjustments([...data, ...assetAdjustments]);
      }

      // 4. GAMIFICATION (Excludes skipped recurring expenses from the perfect-month check)
      let isPerfectMonth = true;
      const expenseCategoriesForCheck = categories.filter(c => c.type !== 'asset');
      expenseCategoriesForCheck.forEach(cat => {
        const categoryBase = parsedSalary * (cat.percentage / 100);
        const spent = activeMonthlyExpenses.filter(e => e.category_id === cat.id).reduce((sum, e) => sum + parseFloat(e.cost), 0);
        if (categoryBase > 0 && spent > categoryBase) isPerfectMonth = false;
      });

      const newStreak = isPerfectMonth ? currentStreak + 1 : 0;
      const newLongest = Math.max(newStreak, longestStreak);
      await supabase.from('profiles').update({ current_streak: newStreak, longest_streak: newLongest }).eq('user_id', session.user.id);
      setCurrentStreak(newStreak);
      setLongestStreak(newLongest);

      // 5. FINALIZE MONTH CLOSURE & SAVE SNAPSHOT
      const newClosedRecord = { user_id: session.user.id, month: selectedMonth, category_snapshot: categories };
      const { data: closedData, error: closeError } = await supabase.from('closed_months').insert([newClosedRecord]).select();
      if (closeError) throw closeError;

      setClosedMonths([...closedMonths, closedData[0]]);
      const updatedExpenses = expenses.filter(e => !idsToDelete.includes(e.id));
      setExpenses([...newRecurring, ...newlyAggregated, ...updatedExpenses]);

      const nextMonthYYYYMM = nextMonthStamp.slice(0, 7);
      setSelectedMonth(nextMonthYYYYMM);

      setAlertMsg(t('succ_month_closed', { month: selectedMonth }));
      window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (error) {
      setAlertMsg(t('err_db_closing_month', { error: error.message || error.details }));
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
    const tempId = crypto.randomUUID();
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
      setAlertMsg(t('err_db_add_cat'));
      setCategories(previousCategories);
    }
  };

  const handleUpdateCategory = async (id, newName, newGoal = 0) => {
    if (isReadOnly || !newName.trim()) return false;
    const previousCategories = [...categories];
    const safeGoal = parseFloat(newGoal) || 0;

    setCategories(categories.map(c => c.id === id ? { ...c, name: newName.trim(), target_goal: safeGoal } : c));
    setEditingCategory(null);

    try {
      const { error } = await supabase.from('categories').update({ name: newName.trim(), target_goal: safeGoal }).eq('id', id);
      if (error) throw error;
      return true;
    } catch {
      setAlertMsg(t('err_update_cat'));
      setCategories(previousCategories);
      return false;
    }
  };

  const handleDeleteCategory = async (id, percentage) => {
    if (isReadOnly) return false;
    if (categories.length <= 1) {
      setAlertMsg(t('err_min_one_cat', 'You must keep at least one category in your budget. You can rename it instead!'));
      return false;
    }
    const previousCategories = [...categories];
    const previousExpenses = [...expenses];
    const remainingCategories = categories.filter(c => c.id !== id).map(c => ({ ...c }));

    remainingCategories[0].percentage = Math.min(100, Number((remainingCategories[0].percentage + percentage).toFixed(2)));

    setCategories(remainingCategories);
    setLockedCategories(lockedCategories.filter(catId => catId !== id));
    setExpenses(expenses.filter(e => e.category_id !== id));
    if (expenseCategoryId === id) setExpenseCategoryId(remainingCategories.find(c => c.type !== 'asset')?.id || '');

    try {
      const { error } = await supabase.from('categories').delete().eq('id', id);
      if (error) throw error;
      return true;
    } catch {
      setAlertMsg(t('err_db_delete_cat'));
      setCategories(previousCategories);
      setExpenses(previousExpenses);
      return false;
    }
  };

  const getCategoryAvailablePool = (catId) => {
    const cat = categories.find(c => c.id === catId);
    if (!cat) return 0;

    const reservedInOpenBundles = bundles
      .filter(b => b.month === selectedMonth && b.status !== 'locked')
      .reduce((sum, b) => sum + (parseFloat(b.target_budget?.[catId]) || 0), 0);

    if (cat.type === 'asset') {
      const currentMonthAllocation = parsedSalary * (cat.percentage / 100);
      const manualAdjTotal = assetAdjustments
        .filter(a => a.category_id === cat.id)
        .reduce((sum, a) => sum + parseFloat(a.amount), 0);
      const spentThisMonth = activeMonthlyExpenses
        .filter(e => e.category_id === cat.id)
        .reduce((sum, e) => sum + parseFloat(e.cost), 0);
      const previewDeposit = (selectedMonth === todayMonth && !closedMonths.some(c => c.month === todayMonth))
        ? Math.max(0, currentMonthAllocation - spentThisMonth)
        : 0;

      const totalLifetimeWealth = manualAdjTotal + previewDeposit;
      return Math.max(0, parseFloat((totalLifetimeWealth - reservedInOpenBundles).toFixed(2)));
    } else {
      const categoryBase = parsedSalary * (cat.percentage / 100);
      const spentThisMonth = activeMonthlyExpenses
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
      setAlertMsg(t('err_enter_occasion_name'));
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
        setAlertMsg(t('err_pull_exceeds', {
          requested: formatCurrency(proposedTotal),
          category: catObj?.name || t('category_fallback'),
          available: formatCurrency(maxAvailable)
        }));
        return;
      }
      finalAllocations[catEl.value] = proposedTotal;
      amtEl.value = '';
    }

    if (Object.keys(finalAllocations).length === 0) {
      setAlertMsg(t('err_allocate_at_least_one'));
      return;
    }

    for (const [catId, amt] of Object.entries(finalAllocations)) {
      const maxAvailable = getCategoryAvailablePool(catId);
      const catObj = categories.find(c => c.id === catId);
      if (amt > maxAvailable) {
        setAlertMsg(t('err_cat_only_has', {
          category: catObj?.name || t('category_fallback'),
          available: formatCurrency(maxAvailable)
        }));
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
      setAlertMsg(t('succ_occasion_created', { name: newBundle.name }));
    } catch (error) {
      console.error('Supabase Bundle Error:', error);
      setAlertMsg(t('err_db_save_bundle', { error: error.message || 'Failed to save bundle.' }));
      setBundles(current => current.filter(b => b.id !== tempId));
    }
  };

  const handleAddOccasionItem = async (bundleId) => {
    if (isReadOnly) return;
    const input = occasionItemInputs[bundleId] || { name: '', allocations: {} };
    if (!input.name.trim()) {
      setAlertMsg(t('err_item_name_req'));
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

    for (const [cId, amt] of Object.entries(cleanAllocations)) {
      const spentSoFar = currentItems.reduce((s, item) => s + (item.allocations?.[cId] || 0), 0);
      const ceiling = parseFloat(targetBundle.target_budget[cId]) || 0;
      if (spentSoFar + amt > ceiling) {
        const catName = categories.find(c => c.id === cId)?.name || t('category_fallback');
        setAlertMsg(t('err_exceeds_trip_budget', {
          remaining: formatCurrency(ceiling - spentSoFar),
          category: catName
        }));
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
      setAlertMsg(t('err_db_save_occasion_item'));
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
      setAlertMsg(t('err_remove_item'));
    }
  };

  const handleLockAndFinalizeBundle = async (bundle) => {
    if (isReadOnly || bundle.status === 'locked') return;
    const items = Array.isArray(bundle.items) ? bundle.items : [];
    const totalSpentInBundle = items.reduce((s, i) => s + parseFloat(i.cost), 0);

    if (totalSpentInBundle <= 0) {
      setAlertMsg(t('err_add_one_expense_before_lock'));
      return;
    }

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

    Object.entries(finalCategoryTotals).forEach(([catId, deductedCost]) => {
      if (deductedCost <= 0) return;

      const catObj = categories.find(c => c.id === catId);
      const isAsset = catObj?.type === 'asset';

      if (isAsset) {
        const monthlyAssetBase = parsedSalary * ((catObj.percentage || 0) / 100);
        const alreadySpentThisMonth = activeMonthlyExpenses
          .filter(e => e.category_id === catId)
          .reduce((s, e) => s + parseFloat(e.cost), 0);
        const unspentMonthlyAsset = Math.max(0, monthlyAssetBase - alreadySpentThisMonth);

        const absorbedByCurrentMonth = Math.min(deductedCost, unspentMonthlyAsset);
        const pulledFromLifetimeVault = parseFloat((deductedCost - absorbedByCurrentMonth).toFixed(2));

        if (absorbedByCurrentMonth > 0) {
          newBundleTransactions.push({
            user_id: session.user.id,
            name: ` ${bundle.name} (${items.length} items • Monthly ${catObj.name})`,
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
            note: ` ${bundle.name} (Lifetime ${catObj.name} Pull)`
          });
        }
      } else {
        newBundleTransactions.push({
          user_id: session.user.id,
          name: Object.keys(finalCategoryTotals).length > 1
            ? ` ${bundle.name} (${items.length} items • ${catObj?.name || 'Split'})`
            : ` ${bundle.name} (${items.length} items)`,
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
      setAlertMsg(t('succ_bundle_locked', { name: bundle.name }));
    } catch (error) {
      setAlertMsg(t('err_locking_occasion', { error: error.message || 'Database error' }));
    }
  };

  const handleDeleteBundle = async (bundleId) => {
    if (isReadOnly) return false;
    const prevBundles = [...bundles];
    setBundles(current => current.filter(b => b.id !== bundleId));
    try {
      const { error } = await supabase.from('bundles').delete().eq('id', bundleId);
      if (error) throw error;
      return true;
    } catch {
      setBundles(prevBundles);
      setAlertMsg(t('err_del_bundle', 'Failed to delete special occasion.'));
      return false;
    }
  };

  const handleDeleteSandboxSheet = async (sheetId) => {
    if (isReadOnly) return false;
    const previousIndex = sandboxSheets.findIndex(s => s.id === sheetId);
    const deletedSheet = sandboxSheets[previousIndex];
    if (!deletedSheet) return false;

    const previousActiveSheetId = activeSheetId;
    const nextFallbackId = sandboxSheets.find(s => s.id !== sheetId)?.id ?? null;

    setSandboxSheets(current => current.filter(s => s.id !== sheetId));
    if (previousActiveSheetId === sheetId) {
      setActiveSheetId(nextFallbackId);
    }

    try {
      const { error } = await supabase.from('sandbox_sheets').delete().eq('id', sheetId);
      if (error) throw error;
      return true;
    } catch {
      setSandboxSheets(current => {
        if (current.some(s => s.id === sheetId)) return current;
        const restored = [...current];
        restored.splice(previousIndex, 0, deletedSheet);
        return restored;
      });
      if (previousActiveSheetId === sheetId) {
        setActiveSheetId(current => (current === nextFallbackId ? previousActiveSheetId : current));
      }
      setAlertMsg(t('err_del_sheet'));
      return false;
    }
  };

  const activeSheet = sandboxSheets.find(s => s.id === activeSheetId) || sandboxSheets[0] || null;

  const handleCreateSandboxSheet = async (e) => {
    e.preventDefault();
    if (isReadOnly) return;
    if (!hasProAccess && sandboxSheets.length >= 1) {
      setUpgradePromptFeature('unlimited_sandbox_sheets');
      return;
    }
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
    } catch {
      setAlertMsg(t('err_save_sandbox_db'));
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
      setAlertMsg(t('err_sub_budget_exceeds', { remaining: formatCurrency(activeSheet.totalBudget - existingBucketsTotal) }));
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
    const totalSpentInSheet = sheet.expenses.reduce((s, e) => s + e.cost, 0);
    const rows = [
      [t('csv_calc_title'), sheet.title],
      [t('csv_total_master_budget'), sheet.totalBudget],
      [t('csv_total_imaginary_spent'), totalSpentInSheet],
      [t('csv_remaining_balance'), sheet.totalBudget - totalSpentInSheet],
      [],
      [t('csv_sub_budget_bucket'), t('csv_allocated_limit'), t('spent'), t('remaining')],
      ...sheet.buckets.map(b => {
        const bSpent = sheet.expenses.filter(e => e.bucketId === b.id).reduce((s, e) => s + e.cost, 0);
        return [b.name.replace(/,/g, ''), b.limit, bSpent, b.limit - bSpent];
      }),
      [],
      [t('csv_item_desc'), t('csv_assigned_bucket'), t('cost_simple_placeholder')],
      ...sheet.expenses.map(e => {
        const bName = e.bucketId === 'MAIN' ? t('general_pool_short') : (sheet.buckets.find(b => b.id === e.bucketId)?.name || t('general_pool_short'));
        return [e.name.replace(/,/g, ''), bName.replace(/,/g, ''), e.cost];
      })
    ];

    const csvContent = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `sandbox_${sheet.title.toLowerCase().replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // --- STANDARD EXPENSE HANDLERS ---
  const handleAddExpense = async (e, pendingFreq = null) => {
    e.preventDefault();
    if (isReadOnly) return null;

    const cost = parseFloat(expenseCost);
    if (!expenseName || isNaN(cost) || cost <= 0 || !expenseCategoryId || !expenseDate) return null;

    const selectedCatObj = categories.find(c => c.id === expenseCategoryId);
    if (!selectedCatObj) return null;

    if (expenseDate.startsWith(selectedMonth)) {
      const availableBalance = getCategoryAvailablePool(expenseCategoryId);
      if (cost > availableBalance) {
        setAlertMsg(t('err_exp_exceeds_avail', { category: selectedCatObj.name }));
        return null;
      }
    }

    const tempId = crypto.randomUUID();
    const newExpenseObj = {
      id: tempId,
      user_id: session.user.id,
      name: expenseName,
      cost: cost,
      category_id: expenseCategoryId,
      category: selectedCatObj.name,
      expense_date: expenseDate,
      is_recurring: isRecurring,
      is_batched: isBatched,
      bundle_id: null
    };

    if (isRecurring && pendingFreq) {
      updateExpenseMeta(tempId, { recurrenceType: pendingFreq });
    }

    setExpenses([newExpenseObj, ...expenses]);
    setExpenseName('');
    setExpenseCost('');
    setIsRecurring(false);
    setIsBatched(false);

    try {
      const { data, error } = await supabase.from('expenses').insert([{
        user_id: newExpenseObj.user_id,
        name: newExpenseObj.name,
        cost: newExpenseObj.cost,
        category_id: newExpenseObj.category_id,
        category: newExpenseObj.category,
        expense_date: newExpenseObj.expense_date,
        is_recurring: newExpenseObj.is_recurring,
        is_batched: newExpenseObj.is_batched,
        recurrence_type: newExpenseObj.is_recurring ? (pendingFreq || 'monthly') : 'monthly',
        skipped_periods: [],
        bundle_id: null
      }]).select();

      if (error) throw error;
      if (data && data.length > 0) {
        const savedRow = data[0];
        if (isRecurring && pendingFreq) {
          updateExpenseMeta(savedRow.id, { recurrenceType: pendingFreq });
        }
        recordLastAddedExpenseId(savedRow.id);
        setExpenses(current => current.map(exp => exp.id === tempId ? savedRow : exp));
        return savedRow;
      }
      return null;
    } catch {
      setExpenses(current => current.filter(exp => exp.id !== tempId));
      setAlertMsg(t('err_db_save_exp'));
      return null;
    }
  };

  const handleUpdateExpense = async (id, updatedExp) => {
    if (isReadOnly) return false;
    const existingExp = expenses.find(e => e.id === id);
    if (!existingExp) return false;

    const cost = parseFloat(updatedExp.cost);
    if (!updatedExp.name?.trim() || isNaN(cost) || cost <= 0) return false;

    const targetCat = categories.find(c => c.id === updatedExp.category_id);
    if (!targetCat) return false;

    if (existingExp.expense_date?.startsWith(selectedMonth)) {
      const spentByOthers = activeMonthlyExpenses
        .filter(e => e.category_id === targetCat.id && e.id !== id)
        .reduce((sum, e) => sum + parseFloat(e.cost), 0);
      const availableBalance = Math.max(0, (parsedSalary * (targetCat.percentage / 100)) - spentByOthers);
      if (cost > availableBalance) {
        setAlertMsg(t('err_exp_exceeds_avail', { category: targetCat.name }));
        return false;
      }
    }

    const editedStamp = getToday();
    const previousExpenses = [...expenses];

    setExpenses(expenses.map(e => e.id === id ? {
      ...e,
      name: updatedExp.name.trim(),
      cost,
      category_id: targetCat.id,
      category: targetCat.name,
      is_recurring: Boolean(updatedExp.is_recurring),
      is_batched: Boolean(updatedExp.is_batched),
      last_edited_at: editedStamp
    } : e));
    setEditingExpense(null);

    try {
      const { error } = await supabase.from('expenses').update({
        name: updatedExp.name.trim(),
        cost,
        category_id: targetCat.id,
        category: targetCat.name,
        is_recurring: Boolean(updatedExp.is_recurring),
        is_batched: Boolean(updatedExp.is_batched),
        last_edited_at: editedStamp
      }).eq('id', id);
      if (error) throw error;
      return true;
    } catch {
      setExpenses(previousExpenses);
      setAlertMsg(t('err_update_exp', 'Failed to update expense.'));
      return false;
    }
  };

  const handleDeleteExpense = async (id) => {
    if (isReadOnly) return false;
    const prevExpenses = [...expenses];
    setExpenses(expenses.filter(exp => exp.id !== id));
    try {
      const { error } = await supabase.from('expenses').delete().eq('id', id);
      if (error) throw error;
      return true;
    } catch {
      setExpenses(prevExpenses);
      setAlertMsg(t('err_del_exp', 'Failed to delete expense.'));
      return false;
    }
  };

  const handleAddAdjustment = async (e) => {
    e.preventDefault();
    const amt = parseFloat(adjAmount);
    if (!adjCatId || isNaN(amt) || !adjDate) return;

    const tempId = crypto.randomUUID();
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
      setAlertMsg(t('err_db_save_adj'));
    }
  };

  const calculateTaxEstimate = () => {
    const income = parseFloat(taxIncomeInput) || 0;
    setTaxEstimateResult(calculateProgressiveTax(income, taxCountry, taxFilingStatus));
  };

  const expenseCategoryIds = categories.filter(c => c.type !== 'asset').map(c => c.id);
  const totalSpent = activeMonthlyExpenses
    .filter(e => expenseCategoryIds.includes(e.category_id))
    .reduce((sum, e) => sum + parseFloat(e.cost), 0);

  const totalAutomatedAssets = assetCategories.reduce((sum, cat) => sum + (parsedSalary * (cat.percentage / 100)), 0);
  const totalAllocated = totalSpent + totalAutomatedAssets;
  const totalRemaining = Math.max(0, parsedSalary - totalAllocated);
  const globalPercentUsed = parsedSalary > 0 ? Math.min(100, (totalAllocated / parsedSalary) * 100) : 0;

  const filteredExpenses = monthlyExpenses.filter(exp =>
    exp.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
    (filterCategory === 'All' || exp.category_id === filterCategory)
  );

  const groupedExpenses = [];
  const bundleGroupMap = {};

  filteredExpenses.forEach(exp => {
    if (exp.bundle_id) {
      if (!bundleGroupMap[exp.bundle_id]) {
        bundleGroupMap[exp.bundle_id] = {
          id: `bundle_${exp.bundle_id}`,
          bundle_id: exp.bundle_id,
          name: bundles.find(b => b.id === exp.bundle_id)?.name || t('special_occasion_fallback'),
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

  const wealthHistoryData = Object.keys(wealthHistoryMap)
    .sort()
    .reduce((acc, month) => {
      const prevWealth = acc.length > 0 ? acc[acc.length - 1].wealth : 0;
      const nextWealth = prevWealth + wealthHistoryMap[month];
      acc.push({
        month: new Date(month + '-01').toLocaleString(i18n.language || 'default', { month: 'short', year: '2-digit' }),
        wealth: nextWealth
      });
      return acc;
    }, []);

  if (!session) return <Auth />;
  if (loadingData) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center ${theme === 'dark' ? 'bg-zinc-950 text-zinc-100' : 'bg-gray-50 text-gray-900'}`}>
        <p className="animate-pulse font-semibold">{t('loading_data')}</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-zinc-950 text-gray-900 dark:text-zinc-300 font-sans overflow-hidden transition-colors duration-300">

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div
          ref={logoutDialogRef}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in outline-none"
          role="dialog"
          aria-modal="true"
          aria-labelledby="logout-dialog-title"
          tabIndex={-1}
          onKeyDown={(e) => { if (e.key === 'Escape') setShowLogoutConfirm(false); }}
        >
          <div className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 shadow-2xl p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
              </svg>
            </div>
            <h2 id="logout-dialog-title" className="text-xl font-black text-gray-900 dark:text-white mb-2">
              {t('sign_out', 'Sign Out')}
            </h2>
            <p className="text-sm text-gray-500 dark:text-zinc-400 mb-6">
              {t('confirm_sign_out_prompt', 'Are you sure you want to securely sign out of your account?')}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                autoFocus
                onClick={() => setShowLogoutConfirm(false)}
                className="px-5 py-2.5 rounded-lg font-bold text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-colors w-1/2"
              >
                {t('cancel', 'Cancel')}
              </button>
              <button
                onClick={confirmLogout}
                className="px-5 py-2.5 rounded-lg font-bold text-sm bg-rose-600 text-white hover:bg-rose-700 transition-colors w-1/2 shadow-sm"
              >
                {t('sign_out', 'Sign Out')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Password Recovery Forced Modal */}
      {showRecoveryModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in" role="dialog" aria-modal="true">
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 shadow-2xl p-6">
            <h2 className="text-xl font-black text-gray-900 dark:text-white mb-2">
              {t('auth_subtitle_recovery', 'Reset Your Password')}
            </h2>
            <p className="text-sm text-gray-500 dark:text-zinc-400 mb-6">
              {t('auth_recovery_prompt', 'Please enter a new, secure password to complete your recovery.')}
            </p>
            <form onSubmit={async (e) => {
              e.preventDefault();
              const { error } = await supabase.auth.updateUser({ password: recoveryPassword });
              if (error) {
                alert(t('err_password_update', 'Failed to update password: ') + error.message);
              } else {
                alert(t('succ_password_update', 'Password updated successfully!'));
                setShowRecoveryModal(false);
              }
            }}>
              <input
                type="password"
                value={recoveryPassword}
                onChange={(e) => setRecoveryPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 mb-4 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 text-gray-900 dark:text-white"
                placeholder={t('new_password', 'New Password')}
                aria-label={t('new_password', 'New Password')}
                required minLength={6}
              />
              <button
                type="submit"
                className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-bold shadow-md"
              >
                {t('save_password', 'Save Password')}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MANAGED Pro Feature Gate Modal */}
      {upgradePromptFeature && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pro-upgrade-title"
          onKeyDown={(e) => { if (e.key === 'Escape') setUpgradePromptFeature(null); }}
        >
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl border border-amber-300 dark:border-amber-500/40 shadow-2xl p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto mb-4 font-black text-xl">
              ★
            </div>
            <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 mb-2">
              {t('pro_feature_badge', 'MANAGED Pro Feature')}
            </span>
            <h2 id="pro-upgrade-title" className="text-xl font-black text-gray-900 dark:text-white mb-2">
              {t('pro_unlock_title', {
                feature: localizedUpgradeFeatureName,
                defaultValue: `Unlock ${localizedUpgradeFeatureName}`
              })}
            </h2>
            <p className="text-xs text-gray-600 dark:text-zinc-400 mb-6 leading-relaxed">
              {t(
                'pro_upgrade_desc',
                'Your account is currently on the Free Tier. Upgrade to MANAGED Pro (or request a Special VIP pass from an administrator in Support) to unlock unlimited Sandbox sheets, Visual Dashboard Excel reports, and multi-goal Wealth Objectives.'
              )}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setUpgradePromptFeature(null)}
                className="flex-1 py-2.5 rounded-lg font-bold text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-colors"
              >
                {t('maybe_later', 'Maybe Later')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setUpgradePromptFeature(null);
                  setActiveTab('support');
                }}
                className="flex-1 py-2.5 rounded-lg font-bold text-xs bg-emerald-700 hover:bg-emerald-800 text-white shadow-sm transition-colors"
              >
                {t('request_pro_access', 'Request Pro Access')}
              </button>
            </div>
          </div>
        </div>
      )}

      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        setAlertMsg={setAlertMsg}
        currentStreak={currentStreak}
        longestStreak={longestStreak}
        handleLogout={handleLogoutRequest}
        username={username}
        userRole={userRole}
        subscriptionTier={subscriptionTier}
        hasProAccess={hasProAccess}
      />
      <main className="flex-1 overflow-y-auto p-4 md:p-10 relative custom-scrollbar">
        <div className="max-w-7xl mx-auto w-full">

          {alertMsg && (
            <div className="mb-6 p-3 rounded-md text-sm font-medium border bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/20 dark:border-emerald-500/40 dark:text-emerald-200 shadow-sm">
              {alertMsg}
            </div>
          )}

          <MobileHeader
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            setAlertMsg={setAlertMsg}
            currentStreak={currentStreak}
            longestStreak={longestStreak}
            userRole={userRole}
            username={username}
            handleLogout={handleLogoutRequest}
            subscriptionTier={subscriptionTier}
            hasProAccess={hasProAccess}
          />

          <Suspense fallback={<div className="py-12 text-center text-xs font-semibold text-gray-500 dark:text-zinc-400 animate-pulse">{t('loading_data')}</div>}>

            {activeTab === 'cashflow' && (
              <CashFlowTab
                key={activeUserId || 'guest'}
                userId={activeUserId}
                expenseMetaMap={expenseMetaMap}
                updateExpenseMeta={updateExpenseMeta}
                isExpenseSkippedForCurrentPeriod={isExpenseSkippedForCurrentPeriod}
                isPastMonth={isPastMonth}
                closedMonths={closedMonths}
                selectedMonth={selectedMonth}
                handleCloseMonth={handleCloseMonth}
                setSelectedMonth={setSelectedMonth}
                isReadOnly={isReadOnly}
                totalRemaining={totalRemaining}
                parsedSalary={parsedSalary}
                baseSalary={baseSalary}
                currentMonthBoost={currentMonthBoost}
                handleAddMonthlyBoost={handleAddMonthlyBoost}
                handleClearMonthlyBoost={handleClearMonthlyBoost}
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
                editingExpense={editingExpense}
                setEditingExpense={setEditingExpense}
                handleUpdateExpense={handleUpdateExpense}
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
              <>
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
                  monthlyExpenses={activeMonthlyExpenses}
                  selectedMonth={selectedMonth}
                  todayMonth={todayMonth}
                  closedMonths={closedMonths}
                />
                <WealthObjectivesSection
                  wealthObjectives={wealthObjectives}
                  setWealthObjectives={setWealthObjectives}
                  onCreateWealthObjective={handleCreateWealthObjective}
                  categories={categories}
                  parsedSalary={parsedSalary}
                  selectedMonth={selectedMonth}
                  isReadOnly={isReadOnly}
                  hasProAccess={hasProAccess}
                  onRequireProUpgrade={setUpgradePromptFeature}
                  formatCurrency={formatCurrency}
                  getCategoryAvailablePool={getCategoryAvailablePool}
                  onManualContributeToObjective={async ({ objectiveName, categoryId, amount }) => {
                    if (isReadOnly) {
                      setAlertMsg(t('err_month_locked', 'This month is closed and read-only.'));
                      return false;
                    }
                    const catObj = categories.find(c => c.id === categoryId);
                    if (!catObj) return false;
                    const avail = getCategoryAvailablePool(categoryId);
                    if (amount > avail) {
                      setAlertMsg(t('err_exp_exceeds_avail', { category: catObj.name }));
                      return false;
                    }
                    const today = getToday();
                    const alignedDate = today.startsWith(selectedMonth) ? today : `${selectedMonth}-01`;
                    const payload = {
                      user_id: session.user.id,
                      name: `Objective: ${objectiveName}`,
                      cost: amount,
                      category_id: categoryId,
                      category: catObj.name,
                      expense_date: alignedDate,
                      is_recurring: false,
                      is_batched: false,
                      bundle_id: null
                    };
                    const { data, error } = await supabase.from('expenses').insert([payload]).select();
                    if (error || !data || data.length === 0) {
                      setAlertMsg('Failed to record manual contribution.');
                      return false;
                    }
                    recordLastAddedExpenseId(data[0].id);
                    setExpenses(prev => [data[0], ...prev]);
                    return true;
                  }}
                />
              </>
            )}

            {activeTab === 'history' && <HistoryTab historyFeed={historyFeed} />}

            {activeTab === 'taxes' && (
              <TaxCenterTab
                taxCountry={taxCountry}
                setTaxCountry={(country) => {
                  setTaxCountry(country);
                  setTaxFilingStatus('single');
                  setTaxIncomeInput('');
                  setTaxEstimateResult(null);
                }}
                taxFilingStatus={taxFilingStatus}
                setTaxFilingStatus={setTaxFilingStatus}
                taxIncomeInput={taxIncomeInput}
                setTaxIncomeInput={setTaxIncomeInput}
                calculateTaxEstimate={calculateTaxEstimate}
                taxEstimateResult={taxEstimateResult}
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
                customCurrency={customCurrency}
                setCustomCurrency={setCustomCurrency}
                setCurrency={setCurrency}
                exportScope={exportScope}
                setExportScope={setExportScope}
                exportMonth={exportMonth}
                setExportMonth={setExportMonth}
                exportDate={exportDate}
                setExportDate={setExportDate}
                handleExportData={handleExportData}
                emailRemindersEnabled={emailRemindersEnabled}
                setEmailRemindersEnabled={setEmailRemindersEnabled}
                onSendRecurringReminder={() => handleSendRecurringReminder(true)}
                isSendingReminder={isSendingReminder}
                userEmail={session?.user?.email || ''}
              />
            )}
            {activeTab === 'support' && (
              <SupportTab
                session={session}
                username={username}
                supportDraft={supportDraft}
                setSupportDraft={setSupportDraft}
                draftHydratedUserId={draftHydratedUserId}
                isSubmittingTicket={submittingTicketUserId === session?.user?.id}
                setSubmittingTicketUserId={setSubmittingTicketUserId}
              />
            )}
            {activeTab === 'dev_dashboard' && (userRole === 'dev' || userRole === 'owner') && (
              <DevDashboard />
            )}

            {activeTab === 'owner_dashboard' && userRole === 'owner' && (
              <OwnerDashboard />
            )}
          </Suspense>
        </div>

        <AIAssistantDrawer
          key={activeUserId || 'guest'}
          userId={activeUserId}
          lastAddedExpenseId={lastAddedExpenseId}
          parsedSalary={parsedSalary}
          salary={salary}
          setSalary={setSalary}
          currency={currency}
          setCurrency={setCurrency}
          setCurrencyMode={setCurrencyMode}
          setCustomCurrency={setCustomCurrency}
          totalSpent={totalSpent}
          totalRemaining={totalRemaining}
          totalAutomatedAssets={totalAutomatedAssets}
          categories={categories}
          expenses={expenses}
          monthlyExpenses={activeMonthlyExpenses}
          assetAdjustments={assetAdjustments}
          selectedMonth={selectedMonth}
          setSelectedMonth={setSelectedMonth}
          isReadOnly={isReadOnly}
          formatCurrency={formatCurrency}
          taxCountry={taxCountry}
          setTaxCountry={setTaxCountry}
          taxFilingStatus={taxFilingStatus}
          setTaxFilingStatus={setTaxFilingStatus}
          theme={theme}
          setTheme={setTheme}
          setActiveTab={setActiveTab}
          handleSmartLockAll={handleSmartLockAll}
          handleUnlockAll={handleUnlockAll}
          handleSliderChange={handleSliderChange}
          handleDeleteExpense={handleDeleteExpense}
          handleUpdateExpense={handleUpdateExpense}
          handleDeleteCategory={handleDeleteCategory}
          handleUpdateCategory={handleUpdateCategory}
          lockedCategories={lockedCategories}
          toggleIndividualLock={toggleIndividualLock}
          bundles={bundles}
          handleDeleteBundle={handleDeleteBundle}
          sandboxSheets={sandboxSheets}
          handleDeleteSandboxSheet={handleDeleteSandboxSheet}
          wealthObjectives={wealthObjectives}
          setWealthObjectives={setWealthObjectives}
          onCreateWealthObjective={handleCreateWealthObjective}
          currentMonthBoost={currentMonthBoost}
          handleAddMonthlyBoost={handleAddMonthlyBoost}
          handleClearMonthlyBoost={handleClearMonthlyBoost}
          onDirectCreateBundle={async ({ name, allocations }) => {
            if (isReadOnly) return { ok: false, error: `The ledger for **${selectedMonth}** is closed and read-only.` };
            for (const [catId, amt] of Object.entries(allocations)) {
              const avail = getCategoryAvailablePool(catId);
              const catObj = categories.find(c => c.id === catId);
              if (amt > avail) {
                return {
                  ok: false,
                  error: `Cannot pull **${formatCurrency(amt)}** from **${catObj?.name || 'Category'}** because it only has **${formatCurrency(avail)}** available.`
                };
              }
            }
            const newBundle = {
              id: crypto.randomUUID(),
              user_id: session.user.id,
              name: name.trim(),
              month: selectedMonth,
              target_budget: allocations,
              status: 'open',
              items: []
            };
            const { data, error } = await supabase.from('bundles').insert([newBundle]).select();
            if (error || !data || data.length === 0) {
              return { ok: false, error: 'Database error while creating Special Occasion bundle.' };
            }
            setBundles(prev => [data[0], ...prev]);
            return { ok: true, bundle: data[0] };
          }}
          onDirectCreateSandbox={async ({ title, totalBudget }) => {
            if (isReadOnly) return { ok: false, error: `The ledger for **${selectedMonth}** is read-only.` };
            if (!hasProAccess && sandboxSheets.length >= 1) {
              setUpgradePromptFeature('unlimited_sandbox_sheets');
              return { ok: false, error: 'Free accounts include **1 Sandbox Sheet**. Upgrade to **MANAGED Pro** for unlimited Sandbox sheets!' };
            }
            const tempId = crypto.randomUUID();
            const newSheet = { id: tempId, title: title.trim(), totalBudget, buckets: [], expenses: [] };
            const { error } = await supabase.from('sandbox_sheets').insert([{
              id: tempId,
              user_id: session.user.id,
              title: newSheet.title,
              total_budget: newSheet.totalBudget,
              buckets: [],
              expenses: []
            }]);
            if (error) return { ok: false, error: 'Database error while creating Sandbox sheet.' };
            setSandboxSheets(prev => [newSheet, ...prev]);
            setActiveSheetId(tempId);
            return { ok: true, sheet: newSheet };
          }}
          onPrefillExpense={({ name, cost, categoryId, isRecurring: rec, isBatched: bat }) => {
            setActiveTab('cashflow');
            setExpenseName(name);
            setExpenseCost(cost);
            if (categoryId) setExpenseCategoryId(categoryId);
            setIsRecurring(Boolean(rec));
            setIsBatched(Boolean(bat));
          }}
          onDirectLogExpense={async ({ name, cost, categoryId, expenseDate: expDate, isRecurring: rec, isBatched: bat }) => {
            if (isReadOnly) {
              return { ok: false, error: `The ledger for **${selectedMonth}** is closed and read-only.` };
            }
            if (!expDate || !expDate.startsWith(selectedMonth)) {
              return { ok: false, error: `Expense date must belong to the active month (**${selectedMonth}**).` };
            }

            const catObj = categories.find(c => c.id === categoryId);
            if (!catObj) return { ok: false, error: 'Could not find a matching category.' };

            const availableBalance = getCategoryAvailablePool(categoryId);
            if (cost > availableBalance) {
              return {
                ok: false,
                error: `Cannot log **${formatCurrency(cost)}** because **${catObj.name}** only has **${formatCurrency(availableBalance)}** available this month.`
              };
            }

            const payload = {
              user_id: session.user.id,
              name,
              cost,
              category_id: categoryId,
              category: catObj.name,
              expense_date: expDate,
              is_recurring: Boolean(rec),
              is_batched: Boolean(bat),
              bundle_id: null
            };

            const { data, error } = await supabase.from('expenses').insert([payload]).select();
            if (error || !data || data.length === 0) {
              return { ok: false, error: 'Database error while saving expense. Please try again.' };
            }

            setExpenses(prev => [data[0], ...prev]);
            recordLastAddedExpenseId(data[0].id);
            return { ok: true, expense: data[0], newRemaining: Math.max(0, availableBalance - cost) };
          }}
          onDirectCreateCategory={async ({ name, type = 'expense', percentage = 0, targetGoal = 0 }) => {
            if (isReadOnly) return { ok: false, error: `The ledger for **${selectedMonth}** is locked and read-only.` };
            const cleanName = (name || '').trim();
            if (!cleanName) return { ok: false, error: 'Please provide a valid category name.' };

            const exists = categories.some(c => c.name.toLowerCase() === cleanName.toLowerCase());
            if (exists) return { ok: false, error: `A category named **${cleanName}** already exists.` };

            const colors = ['teal-600', 'orange-600', 'cyan-600', 'purple-600', 'rose-600', 'amber-600', 'emerald-600'];
            const randomColor = colors[Math.floor(Math.random() * colors.length)];
            const safeGoal = type === 'asset' ? (parseFloat(targetGoal) || 0) : 0;
            const desiredPct = Math.max(0, Math.min(100, parseFloat(percentage) || 0));

            const { data, error } = await supabase.from('categories').insert([{
              user_id: session.user.id,
              name: cleanName,
              percentage: 0,
              color: randomColor,
              type,
              target_goal: safeGoal
            }]).select();

            if (error || !data || data.length === 0) {
              return { ok: false, error: 'Database error while creating category.' };
            }

            const createdCat = data[0];
            let updatedList = [...categories, createdCat];

            if (desiredPct > 0) {
              const totalExistingPct = categories.reduce((s, c) => s + (Number(c.percentage) || 0), 0);
              const unallocatedRoom = Math.max(0, Number((100 - totalExistingPct).toFixed(2)));
              const unlockedOthers = categories.filter(c => !lockedCategories.includes(c.id));
              const othersTotal = unlockedOthers.reduce((s, c) => s + (Number(c.percentage) || 0), 0);

              const actualPct = othersTotal > 0
                ? Math.min(desiredPct, othersTotal + unallocatedRoom)
                : Math.min(desiredPct, unallocatedRoom);

              const pctToTakeFromUnlocked = Math.max(0, actualPct - unallocatedRoom);

              updatedList = updatedList.map(c => {
                if (c.id === createdCat.id) return { ...c, percentage: Number(actualPct.toFixed(2)) };
                if (lockedCategories.includes(c.id) || othersTotal <= 0) return c;
                const reduction = pctToTakeFromUnlocked * ((Number(c.percentage) || 0) / othersTotal);
                return { ...c, percentage: Math.max(0, Number(((Number(c.percentage) || 0) - reduction).toFixed(2))) };
              });

              const newTotal = updatedList.reduce((s, c) => s + (Number(c.percentage) || 0), 0);
              if (newTotal > 100) {
                const excess = Number((newTotal - 100).toFixed(2));
                updatedList = updatedList.map(c =>
                  c.id === createdCat.id
                    ? { ...c, percentage: Math.max(0, Number((c.percentage - excess).toFixed(2))) }
                    : c
                );
              }
            }

            setCategories(updatedList);
            if (type !== 'asset' && !expenseCategoryId) setExpenseCategoryId(createdCat.id);
            if (type === 'asset' && !adjCatId) setAdjCatId(createdCat.id);
            return { ok: true, category: updatedList.find(c => c.id === createdCat.id) || createdCat };
          }}
        />
      </main >
    </div >
  );
}