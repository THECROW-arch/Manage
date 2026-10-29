import React, { useState } from 'react';
import { getToday, getCurrentMonth } from '../utils/constants';
import { useTranslation } from 'react-i18next';
import { supabase } from '../supabaseClient'; // Ensure supabase client is imported

/**
 * Renders the user account preferences, theme toggle, baseline salary configuration,
 * global currency/language selectors, custom-scoped Excel data export controls,
 * and advanced security settings (Password Update, Data Wipe, Account Deletion).
 * @param {Object} props - Component properties
 */
export default function SettingsTab({
  theme,
  setTheme,
  salary,
  setSalary,
  handleUpdateProfile,
  currencyMode,
  setCurrencyMode,
  setCurrency,
  customCurrency,
  setCustomCurrency,
  exportScope,
  setExportScope,
  exportMonth,
  setExportMonth,
  exportDate,
  setExportDate,
  handleExportData
}) {
  const { t, i18n } = useTranslation();

  // --- Phase 9: Security State ---
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState({ text: '', type: '' });
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  /**
   * Handles updating the user's password via Supabase Auth.
   */
  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    setPasswordMsg({ text: '', type: '' });

    if (newPassword.length < 6) {
      setPasswordMsg({ text: t('err_password_short', 'Password must be at least 6 characters.'), type: 'error' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ text: t('err_password_mismatch', 'Passwords do not match.'), type: 'error' });
      return;
    }

    setIsUpdatingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setIsUpdatingPassword(false);

    if (error) {
      setPasswordMsg({ text: error.message, type: 'error' });
    } else {
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMsg({ text: t('succ_password_update', 'Password updated successfully.'), type: 'success' });
      setTimeout(() => setPasswordMsg({ text: '', type: '' }), 4000);
    }
  };

  /**
   * Triggers a hard deletion of all user financial data (Expenses, Assets, Bundles, Sandbox).
   * Irreversible action requiring strict confirmation.
   */
  /**
   * Triggers a hard deletion of all user financial data.
   * Checks for partial failures to prevent false success messages.
   */
  const handleWipeData = async () => {
    if (!window.confirm(t('confirm_wipe_data', 'WARNING: This will permanently delete all your financial data, expenses, and history. This action cannot be undone. Are you absolutely sure?'))) {
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    try {
      const results = await Promise.all([
        supabase.from('expenses').delete().eq('user_id', session.user.id),
        supabase.from('asset_adjustments').delete().eq('user_id', session.user.id),
        supabase.from('bundles').delete().eq('user_id', session.user.id),
        supabase.from('sandbox_sheets').delete().eq('user_id', session.user.id),
        supabase.from('closed_months').delete().eq('user_id', session.user.id),
      ]);

      // Explicitly check if any of the delete operations returned an error
      const hasError = results.some(res => res.error !== null);
      if (hasError) {
        console.error("Partial wipe failure:", results.filter(r => r.error));
        alert(t('err_data_wipe_partial', 'Failed to completely wipe data. Some records may remain. Please try again.'));
        return;
      }

      alert(t('succ_data_wiped', 'All financial data has been successfully wiped.'));
      window.location.reload();
    } catch (error) {
      console.error(error);
      alert(t('err_data_wipe', 'An error occurred while wiping data.'));
    }
  };

  /**
   * Triggers permanent account deletion via Supabase RPC (Requires custom RPC setup in DB).
   */
  const handleDeleteAccount = async () => {
    if (!window.confirm(t('confirm_delete_account', 'DANGER: This will permanently delete your entire account, profile, and all associated data. You will be logged out immediately. Are you sure?'))) {
      return;
    }

    // NOTE: Supabase client-side JS cannot delete users directly for security reasons.
    // You must create a SECURITY DEFINER function in the database to handle this.
    const { error } = await supabase.rpc('delete_user_account');

    if (error) {
      console.error(error);
      alert(t('err_account_delete', 'Failed to delete account. Ensure the database RPC is configured.'));
    } else {
      await supabase.auth.signOut();
      window.location.reload();
    }
  };


  return (
    <div className="max-w-2xl mx-auto space-y-8 pb-12">
      {/* --- Existing Account Preferences --- */}
      <div className="bg-white dark:bg-zinc-900 rounded-md p-6 border border-gray-200 dark:border-zinc-800 shadow-sm space-y-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-zinc-800 pb-3">
          {t('account_preferences')}
        </h2>

        <div className="flex items-center justify-between pb-6 border-b border-gray-100 dark:border-zinc-800">
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-200">{t('theme_preference')}</h3>
            <p className="text-xs text-gray-500 dark:text-zinc-500">{t('theme_desc')}</p>
          </div>
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="px-4 py-2 rounded-md bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 text-gray-800 dark:text-zinc-200 text-sm font-bold transition-all border border-gray-300 dark:border-zinc-700 flex items-center gap-2"
          >
            {theme === 'dark' ? (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4 text-amber-400">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4 text-indigo-600">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
              </svg>
            )}
            {theme === 'dark' ? t('light_mode') : t('dark_mode')}
          </button>
        </div>

        <div className="pb-6 border-b border-gray-100 dark:border-zinc-800">
          <label className="block text-sm font-bold text-gray-900 dark:text-zinc-200 mb-1">
            {t('monthly_net_salary')}
          </label>
          <p className="text-xs text-gray-500 dark:text-zinc-500 mb-3">
            {t('salary_desc')}
          </p>
          <input
            type="number"
            value={salary}
            onChange={(e) => setSalary(e.target.value)}
            onBlur={handleUpdateProfile}
            placeholder={t('enter_amount')}
            className="w-full sm:w-64 px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 font-semibold"
          />
        </div>

        <div className="pb-2 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-200 mb-1">{t('global_currency')}</h3>
              <p className="text-xs text-gray-500 dark:text-zinc-500 mb-3">{t('currency_desc')}</p>
              <div className="flex gap-4">
                <select
                  value={currencyMode}
                  onChange={(e) => {
                    const m = e.target.value;
                    setCurrencyMode(m);
                    setCurrency(m === 'none' ? '' : m === 'custom' ? customCurrency : m);
                  }}
                  className="px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-300 text-sm focus:outline-none focus:border-indigo-500 w-full"
                >
                  <option value="$">$ (USD)</option>
                  <option value="€">€ (Euro)</option>
                  <option value="£">£ (GBP)</option>
                  <option value="MAD">MAD</option>
                  <option value="none">{t('none')}</option>
                  <option value="custom">{t('custom')}</option>
                </select>

                {currencyMode === 'custom' && (
                  <input
                    type="text"
                    value={customCurrency}
                    onChange={(e) => {
                      setCustomCurrency(e.target.value);
                      setCurrency(e.target.value);
                    }}
                    placeholder="Sym"
                    maxLength="5"
                    className="w-24 px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 text-center text-sm"
                  />
                )}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-200 mb-1">{t('app_language')}</h3>
              <p className="text-xs text-gray-500 dark:text-zinc-500 mb-3">{t('language_desc')}</p>
              <select
                value={i18n.resolvedLanguage || 'en'}
                onChange={(e) => i18n.changeLanguage(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-300 text-sm focus:outline-none focus:border-indigo-500"
              >
                <option value="en">English</option>
                <option value="fr">Français</option>
                <option value="es">Español</option>
                <option value="ar">العربية (Arabic)</option>
              </select>
            </div>
          </div>
        </div>

        <div className="pt-6 border-t border-gray-100 dark:border-zinc-800">
          <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-200 mb-1">
            {t('data_portability')}
          </h3>
          <p className="text-xs text-gray-500 dark:text-zinc-500 mb-4">
            {t('export_desc')}
          </p>

          <div className="bg-gray-50 dark:bg-zinc-950 p-4 rounded-md border border-gray-200 dark:border-zinc-800 space-y-4">
            <div className="flex gap-2">
              <button
                onClick={() => setExportScope('month')}
                className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${exportScope === 'month'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'bg-white dark:bg-zinc-900 text-gray-600 dark:text-zinc-400 border border-gray-200 dark:border-zinc-800'
                  }`}
              >
                {t('whole_month_report')}
              </button>
              <button
                onClick={() => setExportScope('day')}
                className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${exportScope === 'day'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'bg-white dark:bg-zinc-900 text-gray-600 dark:text-zinc-400 border border-gray-200 dark:border-zinc-800'
                  }`}
              >
                {t('specific_day_report')}
              </button>
            </div>

            {exportScope === 'month' ? (
              <div>
                <label className="block text-[10px] font-bold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-1">
                  {t('select_month')} ({t('up_to')} {getCurrentMonth()})
                </label>
                <input
                  type="month"
                  value={exportMonth}
                  max={getCurrentMonth()}
                  onChange={(e) => setExportMonth(e.target.value)}
                  className="w-full sm:w-64 px-3 py-2 rounded-md bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-white text-sm font-semibold focus:outline-none focus:border-indigo-500"
                />
              </div>
            ) : (
              <div>
                <label className="block text-[10px] font-bold text-gray-400 dark:text-zinc-500 uppercase tracking-wider mb-1">
                  {t('select_date')} ({t('up_to')} {getToday()})
                </label>
                <input
                  type="date"
                  value={exportDate}
                  max={getToday()}
                  onChange={(e) => setExportDate(e.target.value)}
                  className="w-full sm:w-64 px-3 py-2 rounded-md bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-white text-sm font-semibold focus:outline-none focus:border-indigo-500"
                />
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-4 mt-4 w-full">
            <button
              onClick={() => handleExportData('formal')}
              className="flex-1 py-3 bg-gray-800 hover:bg-gray-900 text-white rounded-md text-sm font-bold transition-all shadow-md flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4 shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              {t('export_formal_btn')}
            </button>
            <button
              onClick={() => handleExportData('visual')}
              className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-sm font-bold transition-all shadow-md flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4 shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
              {t('export_visual_btn')}
            </button>
          </div>
        </div>
      </div>

      {/* --- Phase 9: Security & Authentication --- */}
      <div className="bg-white dark:bg-zinc-900 rounded-md p-6 border border-gray-200 dark:border-zinc-800 shadow-sm space-y-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-zinc-800 pb-3">
          {t('security_auth', 'Security & Authentication')}
        </h2>

        <form onSubmit={handleUpdatePassword} className="space-y-4">
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-200 mb-1">{t('update_password', 'Update Password')}</h3>
            <p className="text-xs text-gray-500 dark:text-zinc-500 mb-4">{t('password_desc', 'Ensure your account stays secure by using a strong password.')}</p>

            {passwordMsg.text && (
              <div className={`mb-4 p-3 rounded-md text-xs font-semibold ${passwordMsg.type === 'error' ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                {passwordMsg.text}
              </div>
            )}

            <div className="space-y-3 max-w-sm">
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('new_password', 'New Password')}
                className="w-full px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-sm focus:outline-none focus:border-indigo-500 text-gray-900 dark:text-white"
                required
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('confirm_password', 'Confirm New Password')}
                className="w-full px-3 py-2 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-sm focus:outline-none focus:border-indigo-500 text-gray-900 dark:text-white"
                required
              />
              <button
                type="submit"
                disabled={isUpdatingPassword}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm font-bold transition-all shadow-md disabled:opacity-50"
              >
                {isUpdatingPassword ? t('updating', 'Updating...') : t('save_password', 'Save Password')}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* --- Phase 9: Danger Zone --- */}
      <div className="bg-white dark:bg-zinc-900 rounded-md p-6 border border-rose-200 dark:border-rose-900/50 shadow-sm space-y-6 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-1 h-full bg-rose-500"></div>
        <h2 className="text-lg font-bold text-rose-600 dark:text-rose-500 border-b border-gray-100 dark:border-zinc-800 pb-3">
          {t('danger_zone', 'Danger Zone')}
        </h2>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-gray-100 dark:border-zinc-800">
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-200">{t('wipe_financial_data', 'Wipe Financial Data')}</h3>
            <p className="text-xs text-gray-500 dark:text-zinc-500 mt-1 max-w-sm">
              {t('wipe_data_desc', 'Permanently delete all expenses, assets, bundles, and history. Your categories and profile will remain.')}
            </p>
          </div>
          <button
            onClick={handleWipeData}
            className="px-4 py-2 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-500/20 border border-rose-200 dark:border-rose-500/30 rounded-md text-sm font-bold transition-colors whitespace-nowrap"
          >
            {t('wipe_data_btn', 'Wipe Data')}
          </button>
        </div>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-200">{t('delete_account', 'Delete Account')}</h3>
            <p className="text-xs text-gray-500 dark:text-zinc-500 mt-1 max-w-sm">
              {t('delete_account_desc', 'Permanently delete your profile and all associated data. This action cannot be reversed.')}
            </p>
          </div>
          <button
            onClick={handleDeleteAccount}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-md text-sm font-bold transition-colors shadow-md whitespace-nowrap"
          >
            {t('delete_account_btn', 'Delete Account')}
          </button>
        </div>
      </div>

    </div>
  );
}