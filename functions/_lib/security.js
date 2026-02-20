import { getConfig } from './config.js';
import { errorResponse } from './http.js';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const RATE_LIMIT_STORE = new Map();
let lastRateLimitSweepAt = 0;

function normalizeOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).origin;
  } catch (_error) {
    return '';
  }
}

function getClientIp(request) {
  const cfConnectingIp = request.headers.get('CF-Connecting-IP');
  if (cfConnectingIp) return cfConnectingIp.trim();

  const xForwardedFor = request.headers.get('X-Forwarded-For');
  if (xForwardedFor) {
    return xForwardedFor.split(',')[0].trim();
  }

  const xRealIp = request.headers.get('X-Real-IP');
  if (xRealIp) return xRealIp.trim();

  return 'unknown';
}

function sweepRateLimitStore(nowMs) {
  if (nowMs - lastRateLimitSweepAt < 60000) return;
  lastRateLimitSweepAt = nowMs;

  for (const [key, entry] of RATE_LIMIT_STORE.entries()) {
    if (!entry || entry.resetAt <= nowMs) {
      RATE_LIMIT_STORE.delete(key);
    }
  }
}

function consumeRateLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  sweepRateLimitStore(now);

  const existing = RATE_LIMIT_STORE.get(key);
  if (!existing || existing.resetAt <= now) {
    const nextEntry = {
      count: 1,
      resetAt: now + windowMs,
    };
    RATE_LIMIT_STORE.set(key, nextEntry);
    return {
      allowed: true,
      remaining: Math.max(maxRequests - 1, 0),
      resetAt: nextEntry.resetAt,
    };
  }

  existing.count += 1;
  RATE_LIMIT_STORE.set(key, existing);

  if (existing.count > maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
    };
  }

  return {
    allowed: true,
    remaining: Math.max(maxRequests - existing.count, 0),
    resetAt: existing.resetAt,
  };
}

async function verifyTurnstileToken(secretKey, token, remoteIp) {
  const body = new URLSearchParams();
  body.set('secret', secretKey);
  body.set('response', token);
  if (remoteIp && remoteIp !== 'unknown') {
    body.set('remoteip', remoteIp);
  }

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!response.ok) {
      return { success: false, errorCode: `turnstile-http-${response.status}` };
    }

    const data = await response.json().catch(() => null);
    if (!data || typeof data !== 'object') {
      return { success: false, errorCode: 'turnstile-invalid-response' };
    }

    if (data.success === true) {
      return {
        success: true,
        hostname: String(data.hostname || '').trim().toLowerCase(),
        action: String(data.action || '').trim(),
      };
    }

    const errorCodes = Array.isArray(data['error-codes']) ? data['error-codes'] : [];
    return { success: false, errorCode: errorCodes[0] || 'turnstile-verification-failed' };
  } catch (_error) {
    return { success: false, errorCode: 'turnstile-request-failed' };
  }
}

function getTurnstileToken(request) {
  const headers = request.headers;
  return (
    headers.get('x-turnstile-token') ||
    headers.get('cf-turnstile-response') ||
    headers.get('x-cf-turnstile-response') ||
    ''
  ).trim();
}

function isOriginAllowed(origin, allowedOrigins = []) {
  if (!origin) return false;
  return allowedOrigins.includes(origin);
}

function normalizeTurnstileMode(value, fallback = 'off') {
  const normalized = String(value || '').trim().toLowerCase();
  if (['off', 'optional', 'required'].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizeTurnstileAction(value) {
  return String(value || '').trim();
}

function getAllowedTurnstileHostnames(config, requestUrl) {
  const hostnames = new Set();
  if (requestUrl?.hostname) {
    hostnames.add(String(requestUrl.hostname).toLowerCase());
  }

  const allowedOrigins = Array.isArray(config?.allowedOrigins) ? config.allowedOrigins : [];
  allowedOrigins.forEach((origin) => {
    const normalized = normalizeOrigin(origin);
    if (!normalized) return;
    try {
      hostnames.add(new URL(normalized).hostname.toLowerCase());
    } catch (_error) {
      // Ignore malformed origins from configuration.
    }
  });

  return [...hostnames];
}

export async function applyApiSecurity(context, options = {}) {
  const config = getConfig(context.env, context.request);
  const request = context.request;
  const requestUrl = new URL(request.url);

  const requireOriginHeader =
    options.requireOriginHeader !== undefined ? Boolean(options.requireOriginHeader) : config.requireOriginHeader;

  const allowedOrigins = Array.isArray(config.allowedOrigins) ? config.allowedOrigins : [];
  const originHeader = request.headers.get('origin');

  if (originHeader) {
    const normalizedOrigin = normalizeOrigin(originHeader);
    if (!normalizedOrigin || !isOriginAllowed(normalizedOrigin, allowedOrigins)) {
      return errorResponse(403, 'Origin is not allowed.');
    }
  } else if (requireOriginHeader) {
    return errorResponse(403, 'Origin header is required.');
  }

  const routeKey = String(options.routeKey || requestUrl.pathname || '/api/unknown');
  const maxRequests =
    Number.isFinite(options.rateLimitMaxRequests) && options.rateLimitMaxRequests > 0
      ? Math.floor(options.rateLimitMaxRequests)
      : config.rateLimitMaxRequests;
  const windowSeconds =
    Number.isFinite(options.rateLimitWindowSeconds) && options.rateLimitWindowSeconds > 0
      ? Math.floor(options.rateLimitWindowSeconds)
      : config.rateLimitWindowSeconds;

  if (Number.isFinite(maxRequests) && maxRequests > 0 && Number.isFinite(windowSeconds) && windowSeconds > 0) {
    const ip = getClientIp(request);
    const rateKey = `${routeKey}:${ip}`;
    const result = consumeRateLimit(rateKey, maxRequests, windowSeconds * 1000);
    if (!result.allowed) {
      const retryAfterSeconds = Math.max(Math.ceil((result.resetAt - Date.now()) / 1000), 1);
      return errorResponse(429, 'Too many requests. Please try again shortly.', undefined, {
        headers: {
          'Retry-After': String(retryAfterSeconds),
          'X-RateLimit-Limit': String(maxRequests),
          'X-RateLimit-Remaining': '0',
        },
      });
    }
  }

  const turnstileMode = normalizeTurnstileMode(
    options.turnstileMode !== undefined ? options.turnstileMode : config.turnstileEnforcement,
    'off',
  );
  const expectedTurnstileAction = normalizeTurnstileAction(options.turnstileAction);

  if (turnstileMode !== 'off') {
    const token = getTurnstileToken(request);

    if (!token) {
      if (turnstileMode === 'required') {
        return errorResponse(400, 'Human verification failed. Please try again.');
      }
      return null;
    }

    if (!config.turnstileSecretKey) {
      return errorResponse(500, 'Human verification is not configured.');
    }

    const clientIp = getClientIp(request);
    const verification = await verifyTurnstileToken(config.turnstileSecretKey, token, clientIp);
    if (!verification.success) {
      return errorResponse(400, 'Human verification failed. Please try again.');
    }

    const expectedHostnames = getAllowedTurnstileHostnames(config, requestUrl);
    const verifiedHostname = String(verification.hostname || '').trim().toLowerCase();
    if (
      expectedHostnames.length > 0 &&
      (!verifiedHostname || !expectedHostnames.includes(verifiedHostname))
    ) {
      return errorResponse(400, 'Human verification failed. Please try again.');
    }

    if (expectedTurnstileAction) {
      const verifiedAction = normalizeTurnstileAction(verification.action);
      if (!verifiedAction || verifiedAction !== expectedTurnstileAction) {
        return errorResponse(400, 'Human verification failed. Please try again.');
      }
    }
  }

  return null;
}
