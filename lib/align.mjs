/**
 * Pair two landmark lists by normalized text, then fuzzy similarity, then ordinal fallback.
 *
 * @param {Array<object>} landmarksA
 * @param {Array<object>} landmarksB
 * @returns {{ pairs: Array<[object, object]>, unpaired: { a: object[], b: object[] }, warnings: string[] }}
 */
export function alignLandmarks(landmarksA = [], landmarksB = []) {
  const warnings = [];
  const pairs = [];

  const entriesA = toEntries(landmarksA);
  const entriesB = toEntries(landmarksB);

  if (entriesA.length !== entriesB.length) {
    warnings.push(`Landmark count mismatch: A=${entriesA.length}, B=${entriesB.length}`);
  }

  matchExact(entriesA, entriesB, pairs);
  matchFuzzy(entriesA, entriesB, pairs);
  matchByPosition(entriesA, entriesB, pairs);

  const unpaired = {
    a: entriesA.filter((entry) => !entry.matched).map((entry) => entry.landmark),
    b: entriesB.filter((entry) => !entry.matched).map((entry) => entry.landmark),
  };

  if (unpaired.a.length || unpaired.b.length) {
    warnings.push(`Unpaired landmarks remain: A=${unpaired.a.length}, B=${unpaired.b.length}`);
  }

  return { pairs, unpaired, warnings };
}

function toEntries(landmarks) {
  return landmarks.map((landmark, index) => ({
    landmark,
    index,
    normalizedText: normalizeText(extractText(landmark)),
    matched: false,
  }));
}

function matchExact(entriesA, entriesB, pairs) {
  const buckets = new Map();

  for (const entry of entriesB) {
    if (entry.matched || !entry.normalizedText) continue;

    const bucket = buckets.get(entry.normalizedText) ?? [];
    bucket.push(entry);
    buckets.set(entry.normalizedText, bucket);
  }

  for (const entryA of entriesA) {
    if (entryA.matched || !entryA.normalizedText) continue;

    const bucket = buckets.get(entryA.normalizedText);
    if (!bucket?.length) continue;

    const entryB = bucket.shift();
    pairEntries(entryA, entryB, pairs);
  }
}

function matchFuzzy(entriesA, entriesB, pairs) {
  for (const entryA of entriesA) {
    if (entryA.matched || !entryA.normalizedText) continue;

    let bestCandidate = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestCount = 0;

    for (const entryB of entriesB) {
      if (entryB.matched || !entryB.normalizedText) continue;

      const distance = levenshtein(entryA.normalizedText, entryB.normalizedText);
      if (!isAllowedFuzzyMatch(entryA.normalizedText, entryB.normalizedText, distance)) {
        continue;
      }

      if (distance < bestDistance) {
        bestDistance = distance;
        bestCandidate = entryB;
        bestCount = 1;
      } else if (distance === bestDistance) {
        bestCount += 1;
      }
    }

    if (bestCandidate && bestCount === 1) {
      pairEntries(entryA, bestCandidate, pairs);
    }
  }
}

function matchByPosition(entriesA, entriesB, pairs) {
  const remainingA = entriesA.filter((entry) => !entry.matched);
  const remainingB = entriesB.filter((entry) => !entry.matched);
  const limit = Math.min(remainingA.length, remainingB.length);

  for (let index = 0; index < limit; index += 1) {
    const entryA = remainingA[index];
    const entryB = remainingB[index];

    if (!isAllowedPositionalMatch(entryA, entryB)) {
      continue;
    }

    pairEntries(entryA, entryB, pairs);
  }
}

function pairEntries(entryA, entryB, pairs) {
  entryA.matched = true;
  entryB.matched = true;
  pairs.push([entryA.landmark, entryB.landmark]);
}

function extractText(landmark) {
  if (typeof landmark === 'string') return landmark;
  if (!landmark || typeof landmark !== 'object') return '';

  const candidates = [
    landmark.text,
    landmark.label,
    landmark.name,
    landmark.value,
    landmark.content,
    landmark.title,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      return candidate;
    }
  }

  return '';
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, '')
    .replace(/[\s\p{Z}]+/gu, '');
}

function isAllowedFuzzyMatch(textA, textB, distance) {
  const longestLength = Math.max(textA.length, textB.length);
  if (longestLength === 0) return false;
  if (distance > maximumSafeDistance(longestLength)) return false;

  return distance <= fuzzyThreshold(longestLength);
}

function isAllowedPositionalMatch(entryA, entryB) {
  return Math.abs(entryA.index - entryB.index) <= 2;
}

function fuzzyThreshold(longestLength) {
  if (longestLength <= 10) {
    return 2;
  }

  return Math.max(2, Math.floor(longestLength * 0.2));
}

function maximumSafeDistance(longestLength) {
  return Math.max(0, Math.floor(longestLength * 0.5));
}

function levenshtein(left, right) {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array(right.length + 1);

  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row;

    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + cost,
      );
    }

    for (let column = 0; column <= right.length; column += 1) {
      previous[column] = current[column];
    }
  }

  return previous[right.length];
}

export default alignLandmarks;
