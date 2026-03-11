import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';

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

const proxy = async (request, { params }) => {
  if (!SUPABASE_URL) {
    return NextResponse.json(
      { error: 'Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL on server.' },
      { status: 500 }
    );
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
