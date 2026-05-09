function stripJsonComments(input) {
  let output = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === '/' && next === '/') {
      while (i < input.length && input[i] !== '\n') i++;
      output += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) {
        if (input[i] === '\n') output += '\n';
        i++;
      }
      i++;
      continue;
    }
    output += char;
  }
  return output;
}

async function parseFrameworkResponse(response) {
  const text = await response.text();
  const url = response.url || '';
  return JSON.parse(url.endsWith('.jsonc') ? stripJsonComments(text) : text);
}

function resolveDataPath(relativePath) {
  return [new URL(`data/${relativePath}`, window.location.href).href];
}

async function fetchDataFile(relativePath) {
  const candidates = resolveDataPath(relativePath);
  const tried = [];
  for (const url of candidates) {
    tried.push(url);
    const response = await fetch(url);
    if (response.ok) return parseFrameworkResponse(response);
  }
  throw new Error(`Failed to load data/${relativePath}. Tried: ${tried.join(', ')}`);
}

async function loadFrameworkData() {
  // Fetch framework, index, and comparisons in parallel
  const [framework, stanceIds, comparisons] = await Promise.all([
    fetchDataFile('framework.jsonc'),
    fetchDataFile('stances/_index.json'),
    fetchDataFile('comparisons.jsonc'),
  ]);

  // Fetch all stances in parallel once we have the ID list
  const stances = await Promise.all(
    stanceIds.map(id => fetchDataFile(`stances/${id}.jsonc`))
  );

  return normaliseFrameworkData({ ...framework, stances, comparisons });
}

function normaliseFrameworkData(data) {
  const categories = data.categories || data.bands || [];
  return {
    ...data,
    bands: categories.map(({ groups, ...category }) => category),
    rows: normaliseFrameworkRows(data),
    stances: (data.stances || data.archetypes || []).map(normaliseStance),
  };
}

function normaliseFrameworkRows(data) {
  if (Array.isArray(data.rows)) {
    return data.rows.map(row => ({
      ...row,
      band: row.band || row.category || row.subCategory,
    }));
  }
  return (data.categories || data.bands || []).flatMap(category =>
    (category.groups || []).flatMap(group =>
      (group.rows || []).map(row => ({
        ...row,
        band: category.name,
        group: group.name,
      }))
    )
  );
}

function normaliseStance(stance) {
  const picks = {};
  const pickMemos = {};
  Object.entries(stance.picks || {}).forEach(([rowName, pick]) => {
    if (pick && typeof pick === 'object' && !Array.isArray(pick)) {
      picks[rowName] = pick.value ?? pick.name ?? pick.label;
      pickMemos[rowName] = pick.memo ?? pick.desc ?? pick.description ?? '';
    } else {
      picks[rowName] = pick;
      pickMemos[rowName] = stance.pickMemos?.[rowName] || '';
    }
  });
  return { ...stance, picks, pickMemos };
}

function normalisePrincipleColors(source) {
  if (Array.isArray(source)) {
    return Object.fromEntries(source.map(item => [
      item.id || item.name || item.principle,
      item.color,
    ]).filter(([name, color]) => name && color));
  }
  return { ...source };
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function principleLabel(id) {
  return (typeof principlesById !== 'undefined' && principlesById.get(id)?.label) || id || '';
}

function slugify(value) {
  return String(value).trim().toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function displayName(stance) {
  return stance.caveat ? stance.name + '*' : stance.name;
}

function normaliseValueEntry(entry) {
  if (typeof entry === 'string') return { value: entry, principle: null, memo: '' };
  return {
    value: entry.value ?? entry.name ?? entry.label,
    principle: entry.principle ?? entry.category ?? null,
    memo: entry.memo ?? entry.desc ?? entry.description ?? '',
  };
}

function rowValueEntries(row) {
  const source = row.values || row.ticks || [];
  return source.map(normaliseValueEntry).filter(entry => entry.value);
}
