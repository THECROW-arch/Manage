import { useState } from 'react';
import { supabase } from './supabaseClient';
import { useTranslation } from 'react-i18next';

/**
 * Renders the authentication portal (Sign In / Sign Up), username validation,
 * Terms of Service modal overlay, and secure Password Recovery flow.
 */
export default function Auth() {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false); // New Phase 9 State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  
  // ToS States
  const [acceptedToS, setAcceptedToS] = useState(false);
  const [showToS, setShowToS] = useState(false);

  /**
   * Handles Phase 9 password recovery logic.
   * Sends a reset link to the provided email if registered.
   */
  const handlePasswordRecovery = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    try {
      if (!email.trim()) {
        throw new Error(t('auth_err_email_req', 'Email is required for password recovery.'));
      }

      // NOTE: For this to securely route back to your app, ensure your Site URL
      // in the Supabase Dashboard -> Auth -> URL Configuration is correct!
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/`,
      });

      if (error) throw error;
      
      setSuccessMsg(t('auth_succ_recovery', 'If an account exists, a password reset link has been sent.'));
      // Keep them on the recovery screen so they can read the message
    } catch (error) {
      setErrorMsg(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    try {
      if (isSignUp) {
        if (!acceptedToS) {
          throw new Error(t('auth_err_tos'));
        }
        if (!username.trim() || username.length < 3 || username.length > 20) {
          throw new Error(t('auth_err_username_length'));
        }
        if (username.includes(' ')) {
          throw new Error(t('auth_err_username_spaces'));
        }
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
          throw new Error(t('auth_err_username_chars'));
        }

        // Securely ask the database script if the username exists without exposing the table
        const { data: isAvailable, error: rpcError } = await supabase
          .rpc('check_username_available', { requested_username: username.trim() });

        if (rpcError) throw new Error(t('auth_err_rpc'));
        
        if (!isAvailable) {
          throw new Error(t('auth_err_username_taken', { username: username.trim() }));
        }

        // Pass the username securely into Supabase's auth metadata
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { username: username.trim() }
          }
        });

        if (error) throw error;

        // Outsmart Supabase's Email Enumeration Protection
        if (data?.user && data.user.identities && data.user.identities.length === 0) {
          throw new Error(t('auth_err_email_taken'));
        }
        setSuccessMsg(t('auth_success_Verify'));
        setIsSignUp(false);
        setPassword('');
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) {
          if (error.message.toLowerCase().includes('invalid login credentials')) {
            throw new Error(t('auth_err_invalid_creds'));
          }
          throw error;
        }
      }
    } catch (error) {
      setErrorMsg(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-zinc-950 p-4 transition-colors duration-300">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-xl border border-gray-200 dark:border-zinc-800 p-8 relative overflow-hidden">
        
        {/* Language Switcher on Auth Screen */}
        <div className="flex justify-end mb-4">
          <select
            value={i18n.resolvedLanguage || 'en'}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
            className="px-2.5 py-1 rounded-md bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-800 text-gray-700 dark:text-zinc-300 text-xs focus:outline-none focus:border-indigo-500"
          >
            <option value="en">English</option>
            <option value="fr">Français</option>
            <option value="es">Español</option>
            <option value="ar">العربية</option>
          </select>
        </div>

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight mb-2">{t('app_title')}</h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 font-medium">
            {isRecovering 
                ? t('auth_subtitle_recovery', 'Reset your password') 
                : isSignUp ? t('auth_subtitle_signup') : t('auth_subtitle_signin')}
          </p>
        </div>

        {/* Notifications */}
        {errorMsg && (
          <div className="mb-6 p-3 rounded-md text-sm font-medium border bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-400">
            {errorMsg}
          </div>
        )}
        {successMsg && (
          <div className="mb-6 p-4 rounded-md text-sm font-medium border bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-400">
            {successMsg}
          </div>
        )}

        {/* Password Recovery View */}
        {isRecovering ? (
            <form onSubmit={handlePasswordRecovery} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">{t('auth_email_label')}</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('auth_email_placeholder')}
                    className="w-full px-4 py-2.5 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors text-sm"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed dark:disabled:bg-zinc-700 text-white font-bold transition-all shadow-md mt-2"
                >
                  {loading ? t('auth_processing') : t('auth_send_reset_btn', 'Send Reset Link')}
                </button>
            </form>
        ) : (
            /* Auth Form (Sign In / Sign Up) */
            <form onSubmit={handleAuth} className="space-y-4">
            {isSignUp && (
                <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">{t('auth_username_label')}</label>
                <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={t('auth_username_placeholder')}
                    className="w-full px-4 py-2.5 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors text-sm"
                    required={isSignUp}
                />
                </div>
            )}

            <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">{t('auth_email_label')}</label>
                <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth_email_placeholder')}
                className="w-full px-4 py-2.5 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors text-sm"
                required
                />
            </div>

            <div>
                <div className="flex justify-between items-center mb-1.5">
                    <label className="block text-xs font-bold text-gray-700 dark:text-zinc-300 uppercase tracking-wider">{t('auth_password_label')}</label>
                    {!isSignUp && (
                        <button
                            type="button"
                            onClick={() => {
                                setIsRecovering(true);
                                setErrorMsg('');
                                setSuccessMsg('');
                            }}
                            className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                            {t('auth_forgot_pwd', 'Forgot password?')}
                        </button>
                    )}
                </div>
                <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 rounded-lg bg-gray-50 dark:bg-zinc-950 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-white focus:outline-none focus:border-indigo-500 transition-colors text-sm"
                required
                />
            </div>

            {/* Terms of Service Consent */}
            {isSignUp && (
                <div className="pt-2 pb-2">
                <label className="flex items-start gap-3 cursor-pointer">
                    <input
                    type="checkbox"
                    checked={acceptedToS}
                    onChange={(e) => setAcceptedToS(e.target.checked)}
                    className="mt-1 w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 bg-white dark:bg-zinc-900 cursor-pointer"
                    />
                    <span className="text-xs text-gray-500 dark:text-zinc-400 leading-tight">
                    {t('auth_tos_prefix')}{' '}
                    <button type="button" onClick={() => setShowToS(true)} className="text-indigo-600 dark:text-indigo-400 font-bold hover:underline">
                        {t('auth_tos_link')}
                    </button>{' '}
                    {t('auth_tos_suffix')}
                    </span>
                </label>
                </div>
            )}

            <button
                type="submit"
                disabled={loading || (isSignUp && !acceptedToS)}
                className="w-full py-3 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed dark:disabled:bg-zinc-700 text-white font-bold transition-all shadow-md mt-2"
            >
                {loading ? t('auth_processing') : isSignUp ? t('auth_create_account_btn') : t('auth_signin_btn')}
            </button>
            </form>
        )}

        <div className="mt-6 text-center">
            {isRecovering ? (
                <button
                type="button"
                onClick={() => {
                  setIsRecovering(false);
                  setErrorMsg('');
                  setSuccessMsg('');
                }}
                className="text-sm font-medium text-gray-600 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
              >
                {t('auth_back_to_signin', '← Back to Sign In')}
              </button>
            ) : (
                <button
                    type="button"
                    onClick={() => {
                    setIsSignUp(!isSignUp);
                    setErrorMsg('');
                    setSuccessMsg('');
                    }}
                    className="text-sm font-medium text-gray-600 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                >
                    {isSignUp ? t('auth_switch_to_signin') : t('auth_switch_to_signup')}
                </button>
            )}
        </div>
      </div>

      {/* Terms of Service Modal Overlay */}
      {showToS && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-xl border border-gray-200 dark:border-zinc-800 shadow-2xl flex flex-col max-h-[80vh]">
            <div className="p-5 border-b border-gray-200 dark:border-zinc-800 flex justify-between items-center bg-gray-50 dark:bg-zinc-950 rounded-t-xl">
              <h2 className="font-bold text-gray-900 dark:text-white uppercase tracking-wider text-sm">{t('tos_title')}</h2>
              <button onClick={() => setShowToS(false)} className="text-gray-400 hover:text-rose-500 font-bold">✕</button>
            </div>
            
            <div className="p-6 overflow-y-auto custom-scrollbar space-y-4 text-sm text-gray-600 dark:text-zinc-400">
              <p><strong>{t('tos_1_title')}</strong><br/>{t('tos_1_body')}</p>
              <p><strong>{t('tos_2_title')}</strong><br/>{t('tos_2_body')}</p>
              <p><strong>{t('tos_3_title')}</strong><br/>{t('tos_3_body')}</p>
              <p><strong>{t('tos_4_title')}</strong><br/>{t('tos_4_body')}</p>
              <p><strong>{t('tos_5_title')}</strong><br/>{t('tos_5_body')}</p>
              <p><strong>{t('tos_6_title')}</strong><br/>{t('tos_6_body')}</p>
            </div>

            <div className="p-5 border-t border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-950 rounded-b-xl flex justify-end">
              <button 
                onClick={() => { setAcceptedToS(true); setShowToS(false); }}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md font-bold text-sm shadow transition-colors"
              >
                {t('tos_agree_btn')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}