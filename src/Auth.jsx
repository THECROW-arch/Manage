import { useState } from 'react';
import { supabase } from './supabaseClient';

export default function Auth() {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  
  // Custom Alert State
  const [alertMsg, setAlertMsg] = useState('');
  const [alertType, setAlertType] = useState(''); // 'success' or 'error'

  const handleAuth = async (e) => {
    e.preventDefault();
    setAlertMsg(''); // Clear previous messages
    
    if (!email || !password) {
      setAlertType('error');
      setAlertMsg("Please enter both an email and a password.");
      return;
    }
    
    setLoading(true);
    
    if (isLogin) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setAlertType('error');
        setAlertMsg(error.message);
      }
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setAlertType('error');
        setAlertMsg(error.message);
      } else {
        setAlertType('success');
        setAlertMsg("Success! You are now registered.");
      }
    }
    
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 text-white">
      <div className="w-full max-w-md bg-gray-800 p-8 rounded-xl shadow-lg border border-gray-700">
        <h1 className="text-3xl font-bold mb-6 text-center text-indigo-400">
          {isLogin ? 'Welcome Back' : 'Create Account'}
        </h1>
        <p className="text-gray-400 text-center mb-6">
          {isLogin ? 'Sign in to access your salary allocations.' : 'Sign up to start tracking your budget.'}
        </p>

        {/* Custom UI Alert Box */}
        {alertMsg && (
          <div className={`mb-6 p-4 rounded-md text-sm font-medium border ${
            alertType === 'error' 
              ? 'bg-red-500/10 border-red-500/50 text-red-400' 
              : 'bg-green-500/10 border-green-500/50 text-green-400'
          }`}>
            {alertMsg}
          </div>
        )}
        
        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2 rounded-lg bg-gray-700 border border-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="you@example.com"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password (6+ characters)</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 rounded-lg bg-gray-700 border border-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="••••••••"
              required
            />
          </div>
          
          <div className="mt-6">
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 px-4 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition font-semibold disabled:opacity-50"
            >
              {loading ? 'Processing...' : (isLogin ? 'Sign In' : 'Sign Up')}
            </button>
          </div>
        </form>

        <div className="mt-6 text-center border-t border-gray-700 pt-4">
          <button 
            onClick={() => {
              setIsLogin(!isLogin);
              setAlertMsg(''); // Clear messages when switching modes
            }}
            className="text-sm text-indigo-400 hover:text-indigo-300 transition bg-transparent border-none cursor-pointer font-medium"
          >
            {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}