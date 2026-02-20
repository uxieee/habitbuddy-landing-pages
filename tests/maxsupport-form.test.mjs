import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const maxSupportPath = path.resolve(__dirname, '../maxsupport.html');

async function readMaxSupportHtml() {
  return fs.readFile(maxSupportPath, 'utf8');
}

test('maxsupport form requires first name, last name, email, and phone', async () => {
  const html = await readMaxSupportHtml();

  assert.match(
    html,
    /<input[^>]*id="firstName"[^>]*name="first_name"[^>]*required/i,
    'first_name should be present and required',
  );
  assert.match(
    html,
    /<input[^>]*id="lastName"[^>]*name="last_name"[^>]*required/i,
    'last_name should be present and required',
  );
  assert.match(
    html,
    /<input[^>]*id="email"[^>]*name="email"[^>]*required/i,
    'email should be present and required',
  );
  assert.match(
    html,
    /<input[^>]*id="phoneLocal"[^>]*name="phone_local"[^>]*required/i,
    'phone_local should be present and required',
  );
  assert.doesNotMatch(html, /Email \(Optional\)/, 'email should no longer be marked optional');
});

test('maxsupport uses responsive container-query layout for two-name row', async () => {
  const html = await readMaxSupportHtml();

  assert.match(html, /container-type:\s*inline-size;/, 'signup form should define a container context');
  assert.match(html, /@container\s+signup-form\s*\(min-width:\s*520px\)/, 'container query should be present');
  assert.match(html, /\.form-grid--two\s*\{[\s\S]*grid-template-columns:\s*1fr;/, 'mobile first single column');
  assert.match(
    html,
    /@container\s+signup-form\s*\(min-width:\s*520px\)\s*\{[\s\S]*\.form-grid--two[\s\S]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    'desktop should switch to two columns',
  );
  assert.match(
    html,
    /onclick="document\.getElementById\('firstName'\)\.focus\(\)"/,
    'bottom CTA should focus firstName field',
  );
});
