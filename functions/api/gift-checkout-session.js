import { errorResponse, optionsResponse } from '../_lib/http.js';

const RETIRED_MESSAGE = 'Endpoint retired. Use /api/gift-payment-element-init and /api/gift-payment-complete.';

export async function onRequestPost() {
  return errorResponse(410, RETIRED_MESSAGE);
}

export async function onRequestGet() {
  return errorResponse(410, RETIRED_MESSAGE);
}

export async function onRequestOptions() {
  return optionsResponse(['POST', 'OPTIONS']);
}
