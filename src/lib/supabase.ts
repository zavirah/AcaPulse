import 'react-native-url-polyfill/auto';
import 'expo-sqlite/localStorage/install';

import { createClient } from '@supabase/supabase-js';

const projectUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

export const supabaseConfigured = Boolean(projectUrl && publishableKey);

export const supabase = supabaseConfigured
  ? createClient(projectUrl!, publishableKey!, {
      auth: {
        storage: localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error('AcaPulse backend is not configured yet. Add your Supabase URL and publishable key to the project .env file, then restart Expo.');
  }
  return supabase;
}
