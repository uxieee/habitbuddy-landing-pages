export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

export function errorResponse(status, message, details) {
  return jsonResponse(
    {
      success: false,
      error: message,
      ...(details ? { details } : {}),
    },
    status,
  );
}

export async function readJson(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') {
      throw new Error('Request body must be a JSON object.');
    }
    return body;
  } catch (error) {
    const e = new Error('Invalid JSON body.');
    e.status = 400;
    throw e;
  }
}

export function methodNotAllowed(allowed = ['POST']) {
  return errorResponse(405, `Method not allowed. Use: ${allowed.join(', ')}`);
}

export function optionsResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: 'GET,POST,OPTIONS',
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
