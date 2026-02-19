export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      ...headers,
    },
  });
}

export function errorResponse(status, message, details, options = {}) {
  const includeDetails = options.includeDetails === true;
  return jsonResponse(
    {
      success: false,
      error: message,
      ...(includeDetails && details ? { details } : {}),
    },
    status,
    options.headers || {},
  );
}

function makeHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function hasJsonContentType(request) {
  const contentType = String(request.headers.get('content-type') || '').toLowerCase();
  return contentType.includes('application/json');
}

function parseContentLength(request) {
  const raw = request.headers.get('content-length');
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

export async function readJson(request, options = {}) {
  const requireJsonContentType = options.requireJsonContentType !== false;
  const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0 ? Math.floor(options.maxBytes) : 32768;

  if (requireJsonContentType && !hasJsonContentType(request)) {
    throw makeHttpError(415, 'Content-Type must be application/json.');
  }

  const contentLength = parseContentLength(request);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw makeHttpError(413, 'Request body is too large.');
  }

  let rawBody = '';
  try {
    rawBody = await request.text();
  } catch (_error) {
    throw makeHttpError(400, 'Invalid request body.');
  }

  if (!rawBody) {
    throw makeHttpError(400, 'Request body is required.');
  }

  const bodySize = new TextEncoder().encode(rawBody).length;
  if (bodySize > maxBytes) {
    throw makeHttpError(413, 'Request body is too large.');
  }

  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw makeHttpError(400, 'Request body must be a JSON object.');
    }
    return parsed;
  } catch (error) {
    if (Number.isFinite(error?.status)) throw error;
    throw makeHttpError(400, 'Invalid JSON body.');
  }
}

export function methodNotAllowed(allowed = ['POST']) {
  return errorResponse(405, `Method not allowed. Use: ${allowed.join(', ')}`);
}

export function optionsResponse(allowed = ['GET', 'POST', 'OPTIONS']) {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: allowed.join(','),
    },
  });
}

export function unwrapError(error) {
  if (!error) {
    return { status: 500, message: 'Unknown error.' };
  }

  const status = Number(error.status || error.statusCode || 500);
  const message = error.message || 'Unexpected error.';
  const details = error.details || error.data || undefined;

  return { status, message, details };
}
