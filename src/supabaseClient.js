// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

// 1. Pull the environment variables securely from your .env file
// Vite requires the 'import.meta.env' syntax for custom variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 2. Initialize the Supabase client
// This 'supabase' object is what we will import into App.jsx to talk to the database
export const supabase = createClient(supabaseUrl, supabaseAnonKey);