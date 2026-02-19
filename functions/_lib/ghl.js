import { getConfig, assertConfig } from './config.js';

const GHL_VERSION_HEADER = '2021-07-28';

function withQuery(url, query) {
  if (!query) return url;
  const u = new URL(url);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      u.searchParams.set(key, String(value));
    }
  });
  return u.toString();
}

async function parseResponse(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { raw: text };
  }
}

function makeError(status, message, data) {
  const error = new Error(message || 'GHL request failed.');
  error.status = status;
  error.data = data;
  return error;
}

function normalizeCustomFields(customFields = []) {
  return customFields
    .filter((item) => item && item.id && item.value !== undefined && item.value !== null && item.value !== '')
    .map((item) => ({ id: item.id, value: String(item.value) }));
}

export async function ghlRequest(env, path, options = {}) {
  const config = getConfig(env, { url: 'https://example.com' });
  assertConfig(config, ['ghlPrivateToken', 'locationId']);

  const method = options.method || 'GET';
  const url = withQuery(`${config.ghlApiBase}${path}`, options.query);
  const body = options.body;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${config.ghlPrivateToken}`,
      Version: GHL_VERSION_HEADER,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'HabitBuddyBridge/1.0',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await parseResponse(res);
  if (!res.ok) {
    const message =
      data?.message ||
      data?.error ||
      data?.errors?.[0]?.message ||
      `GHL ${method} ${path} failed with status ${res.status}`;
    throw makeError(res.status, message, data);
  }

  return data;
}

export async function upsertContact(env, payload) {
  const config = getConfig(env, { url: 'https://example.com' });
  const body = {
    locationId: config.locationId,
    ...payload,
  };
  if (Array.isArray(body.customFields)) {
    body.customFields = normalizeCustomFields(body.customFields);
  }

  const data = await ghlRequest(env, '/contacts/upsert', { method: 'POST', body });
  return data?.contact || data?.data?.contact || data;
}

export async function updateContact(env, contactId, payload) {
  const body = { ...payload };
  if (Array.isArray(body.customFields)) {
    body.customFields = normalizeCustomFields(body.customFields);
  }

  const data = await ghlRequest(env, `/contacts/${contactId}`, { method: 'PUT', body });
  return data?.contact || data;
}

export async function getContact(env, contactId) {
  const data = await ghlRequest(env, `/contacts/${contactId}`);
  return data?.contact || data;
}

export async function addContactTags(env, contactId, tags) {
  const cleanTags = (tags || []).filter(Boolean);
  if (cleanTags.length === 0) return;
  await ghlRequest(env, `/contacts/${contactId}/tags`, {
    method: 'POST',
    body: { tags: cleanTags },
  });
}

export async function removeContactTags(env, contactId, tags) {
  const cleanTags = (tags || []).filter(Boolean);
  if (cleanTags.length === 0) return;
  await ghlRequest(env, `/contacts/${contactId}/tags`, {
    method: 'DELETE',
    body: { tags: cleanTags },
  });
}

export async function searchOpportunities(env, params = {}) {
  const config = getConfig(env, { url: 'https://example.com' });
  const query = {
    location_id: config.locationId,
    page: params.page ?? 1,
    limit: params.limit ?? 20,
    pipeline_id: params.pipelineId,
    contact_id: params.contactId,
    status: params.status,
    id: params.id,
    pipeline_stage_id: params.pipelineStageId,
  };

  const data = await ghlRequest(env, '/opportunities/search', { query });
  return data?.opportunities || [];
}

export async function getOpportunity(env, opportunityId) {
  const data = await ghlRequest(env, `/opportunities/${opportunityId}`);
  return data?.opportunity || data;
}

export async function createOpportunity(env, payload) {
  const config = getConfig(env, { url: 'https://example.com' });
  const body = {
    locationId: config.locationId,
    ...payload,
  };
  if (Array.isArray(body.customFields)) {
    body.customFields = normalizeCustomFields(body.customFields);
  }

  const data = await ghlRequest(env, '/opportunities/', { method: 'POST', body });
  return data?.opportunity || data;
}

export async function updateOpportunity(env, opportunityId, payload) {
  const body = { ...payload };
  if (Array.isArray(body.customFields)) {
    body.customFields = normalizeCustomFields(body.customFields);
  }

  const data = await ghlRequest(env, `/opportunities/${opportunityId}`, {
    method: 'PUT',
    body,
  });
  return data?.opportunity || data;
}

export async function listAssociations(env) {
  const config = getConfig(env, { url: 'https://example.com' });
  const data = await ghlRequest(env, '/associations/', {
    query: { locationId: config.locationId },
  });
  return data?.associations || [];
}

export async function getRelationsForRecord(env, recordId) {
  const config = getConfig(env, { url: 'https://example.com' });
  const data = await ghlRequest(env, `/associations/relations/${recordId}`, {
    query: { locationId: config.locationId },
  });
  return data?.relations || [];
}

export async function createAssociationDefinition(env, payload) {
  const config = getConfig(env, { url: 'https://example.com' });
  const body = {
    locationId: config.locationId,
    ...payload,
  };
  return ghlRequest(env, '/associations/', {
    method: 'POST',
    body,
  });
}

export async function createAssociationRelation(env, payload) {
  const config = getConfig(env, { url: 'https://example.com' });
  const body = {
    locationId: config.locationId,
    ...payload,
  };
  return ghlRequest(env, '/associations/relations', {
    method: 'POST',
    body,
  });
}

export async function deleteAssociationRelation(env, payload) {
  const config = getConfig(env, { url: 'https://example.com' });
  const body = {
    locationId: config.locationId,
    ...payload,
  };
  return ghlRequest(env, '/associations/relations', {
    method: 'DELETE',
    body,
  });
}

export function isDuplicateRelationError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('duplicate relation');
}

export function isRelationNotFoundError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('not found') || message.includes('already deleted');
}

export async function ensureGiftContactAssociation(env) {
  const config = getConfig(env, { url: 'https://example.com' });
  const key = config.giftContactAssociationKey;
  if (!key) return null;

  const associations = await listAssociations(env);
  const exists = associations.find((item) => item?.id === key);
  if (exists) return exists;

  try {
    await createAssociationDefinition(env, {
      key,
      firstObjectKey: 'contact',
      secondObjectKey: 'contact',
      firstObjectLabel: 'GIFTER',
      secondObjectLabel: 'GIFT_RECIPIENT',
    });
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    if (!message.includes('already exists') && error.status !== 409) {
      throw error;
    }
  }

  const updated = await listAssociations(env);
  return updated.find((item) => item?.id === key) || null;
}
