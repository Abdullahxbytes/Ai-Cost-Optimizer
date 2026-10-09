import { z } from 'zod';

export { z };

const SPREADSHEET_FORMULA_PREFIX = /^[\t\r ]*[=+\-@]/;

/**
 * Formats one CSV field and prevents spreadsheet applications from treating
 * user-controlled text as a formula when an exported file is opened.
 */
export function csvCell(value: unknown): string {
  const text = String(value ?? '');
  const safe = SPREADSHEET_FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
