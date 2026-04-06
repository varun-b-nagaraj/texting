import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD';
const DEFAULT_ALLOWED_HEADERS =
  'authorization, x-client-info, apikey, content-type, prefer, range, accept-profile, content-profile';

const copyHeaders = (headers) => {
  const forwarded = new Headers();
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (
      lower === 'host' ||
      lower === 'content-length' ||
      lower === 'connection' ||
      lower === 'accept-encoding'
    ) {
      return;
    }
    forwarded.set(key, value);
  });
  // Avoid compressed payload/header mismatches through the proxy.
  forwarded.set('accept-encoding', 'identity');
  return forwarded;
};

const sanitizeResponseHeaders = (headers) => {
  const next = new Headers(headers);
  next.delete('content-encoding');
  next.delete('content-length');
  next.delete('transfer-encoding');
  next.delete('connection');
  next.delete('keep-alive');
  next.delete('proxy-authenticate');
  next.delete('proxy-authorization');
  next.delete('te');
  next.delete('trailer');
  next.delete('upgrade');
  return next;
};

const getCorsHeaders = (requestHeaders) => {
  const origin = requestHeaders.get('origin');
  const requestedHeaders = requestHeaders.get('access-control-request-headers');
  const corsHeaders = new Headers();

  corsHeaders.set('access-control-allow-origin', origin || '*');
  corsHeaders.set('access-control-allow-methods', ALLOWED_METHODS);
  corsHeaders.set(
    'access-control-allow-headers',
    requestedHeaders || DEFAULT_ALLOWED_HEADERS
  );
  corsHeaders.set('access-control-max-age', '86400');
  corsHeaders.set('vary', 'origin');

  return corsHeaders;
};

const applyCorsHeaders = (headers, corsHeaders) => {
  corsHeaders.forEach((value, key) => {
    headers.set(key, value);
  });
};

const proxy = async (request, { params }) => {
  const corsHeaders = getCorsHeaders(request.headers);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  if (!SUPABASE_URL) {
    const response = NextResponse.json(
      { error: 'Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL on server.' },
      { status: 500 }
    );
    applyCorsHeaders(response.headers, corsHeaders);
    return response;
  }

  const { path } = params;
  const incomingUrl = new URL(request.url);
  const suffix = Array.isArray(path) ? path.join('/') : '';
  const targetUrl = `${SUPABASE_URL.replace(/\/$/, '')}/${suffix}${incomingUrl.search}`;

  const method = request.method;
  const headers = copyHeaders(request.headers);

  let body;
  if (method !== 'GET' && method !== 'HEAD') {
    body = await request.arrayBuffer();
  }

  const upstream = await fetch(targetUrl, {
    method,
    headers,
    body,
    redirect: 'manual'
  });

  const responseHeaders = sanitizeResponseHeaders(upstream.headers);
  responseHeaders.set('cache-control', 'no-store');
  applyCorsHeaders(responseHeaders, corsHeaders);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  });
};

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
export const HEAD = proxy;
