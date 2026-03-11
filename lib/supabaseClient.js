import { createClient } from '@supabase/supabase-js';

const proxyBase = 'https://texting-tau.vercel.app';
const supabaseUrl = `${proxyBase}/api/supabase-proxy`;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
