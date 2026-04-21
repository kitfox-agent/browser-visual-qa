/**
 * Mask credentials embedded in a URL string.
 *
 * @param {string} url
 * @returns {string}
 */
export function sanitizeUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') {
    return String(url ?? '');
  }

  try {
    const parsed = new URL(url);

    if (parsed.username || parsed.password) {
      parsed.username = '***';
      parsed.password = '***';
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

export default sanitizeUrl;
