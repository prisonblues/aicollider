let bands = [];
let rows = [];
let stances = [];
let comparisons = [];
let lineColors = [];
let bandColors = {};
let principleColors = {};
let principlesById = new Map();

let activeStances = new Set();
let activeComparison = null;
let compact = true;
let activeBandsOnly = false;
let annotatedOnly = false;
let diagnosticOrder = false;
let sortByStanceId = null;
let showLabels = false;
let lightMode = localStorage.getItem('colliderTheme')
  ? localStorage.getItem('colliderTheme') === 'light'
  : window.matchMedia('(prefers-color-scheme: light)').matches;
let chartTextScale = Number(localStorage.getItem('colliderTextScale') || 1);
if (!Number.isFinite(chartTextScale)) chartTextScale = 1;
chartTextScale = Math.max(0.75, Math.min(1.45, chartTextScale));
let applyingHash = false;
document.documentElement.dataset.theme = lightMode ? 'light' : 'dark';
const savedLeftPane = Number(localStorage.getItem('colliderMosaicLeftPane'));
if (Number.isFinite(savedLeftPane)) {
  document.documentElement.style.setProperty('--left-pane', `${Math.min(42, Math.max(18, savedLeftPane))}%`);
}

const diagnosticZones = [
  { name:'Capability Pressure', rows:['Capability Class','Domain Breadth','Capability Trajectory','Research Automation','Unhobbling','Replication Scale','Operating Speed','Physical World Extension'] },
  { name:'Agency Threshold', rows:['Role','Autonomy','Tool Access','Delegated Authority','Response / Intervention Capability','Actuation','Command Actor','Decision Tempo','Tradeoff Authority'] },
  { name:'Input Legitimacy', rows:['Permission','Regulatory Posture','Data Availability','Provenance','Territory','Data Subject Exposure','Data Sensitivity','Control Exposure'] },
  { name:'Capability Transformation', rows:['Processing Mode','Derivation','Retention / Persistence','Exit'] },
  { name:'Custody And Deployment', rows:['Model-Weight Rights','Execution / Residency Environment','Boundary','Deployment Surface'] },
  { name:'Control Surface', rows:['Observability','Evaluation','Alignment Method','Interpretability','Acceptance Basis','Access Control','Monitoring Scope'] },
  { name:'Containment And Proliferation', rows:['Security Posture','Adversary Model','Weight Security','Containment','Capability Limitation','Use Class','Harm Channel','Proliferation','Strategic Lead','Race Pressure','Nonproliferation Regime','Coalition Structure'] },
  { name:'Platform Capture', rows:['Model Sourcing','Compute Source','Cloud Dependency','Accelerator Stack','Supply Control','Silicon Bottleneck','Substitutability','Vertical Integration','Distribution Channel'] },
  { name:'Strategic Infrastructure', rows:['Physical Infrastructure','Silicon Bottleneck','Supply Jurisdiction','Coalition Structure'] },
  { name:'Value Capture And Unwind', rows:['Data Value Dynamics','Input Price','Output Allocation','Derived Value Capture','Risk Allocation / Backstop','Capital','Commitment Tenor','Revenue Dependency','Switching Cost','Exit'] },
];
const diagnosticMeta = new Map();
diagnosticZones.forEach((zone, zi) => zone.rows.forEach((name, ri) => diagnosticMeta.set(name, { zone: zone.name, zi, ri })));

function orderRows(sourceRows) {
  if (!diagnosticOrder && !sortByStanceId) return sourceRows;
  if (diagnosticOrder) {
    return [...sourceRows].sort((a, b) => {
      const am = diagnosticMeta.get(a.name);
      const bm = diagnosticMeta.get(b.name);
      if (am && bm) return am.zi - bm.zi || am.ri - bm.ri;
      if (am) return -1;
      if (bm) return 1;
      return rows.indexOf(a) - rows.indexOf(b);
    });
  }
  // Sort by principle in the selected stance column
  const arch = stances.find(a => a.id === sortByStanceId);
  if (!arch) return sourceRows;
  // Build a stable principle ordering from the rows that have picks
  const principleOrder = [];
  sourceRows.forEach(row => {
    const pick = arch.picks[row.name];
    if (!pick) return;
    const meta = valueMeta(row, pick);
    const p = meta.principle || '';
    if (p && !principleOrder.includes(p)) principleOrder.push(p);
  });
  return [...sourceRows].sort((a, b) => {
    const pickA = arch.picks[a.name];
    const pickB = arch.picks[b.name];
    // Rows without picks sort to the end
    if (!pickA && !pickB) return rows.indexOf(a) - rows.indexOf(b);
    if (!pickA) return 1;
    if (!pickB) return -1;
    const pA = valueMeta(a, pickA).principle || '';
    const pB = valueMeta(b, pickB).principle || '';
    const idxA = pA ? principleOrder.indexOf(pA) : principleOrder.length;
    const idxB = pB ? principleOrder.indexOf(pB) : principleOrder.length;
    if (idxA !== idxB) return idxA - idxB;
    return rows.indexOf(a) - rows.indexOf(b);
  });
}

function activeRows() {
  const names = new Set();
  activeStances.forEach(id => {
    const arch = stances.find(a => a.id === id);
    if (!arch) return;
    Object.keys(arch.picks).forEach(name => names.add(name));
  });
  return names;
}

/* ── Colour logic ── */
function interpolateColor(c1, c2, t) {
  const parse = hex => {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const [r1, g1, b1] = parse(c1);
  const [r2, g2, b2] = parse(c2);
  return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)})`;
}

const defaultTypePalettes = {
  Spectrum: ['#16243a', '#2f8fb9', '#bcecff'],
  Threshold: ['#342313', '#d48632', '#ffd391'],
  Topology: ['#142d22', '#45a66a', '#c5f5cf'],
};
function clonePalettes(source) {
  return Object.fromEntries(Object.entries(source).map(([type, colors]) => [type, [...colors]]));
}
let typePalettes = clonePalettes(defaultTypePalettes);
const principleSeedColors = [
  '#4fb477', '#3aa1c9', '#d69c2f', '#c55b4a', '#8f6bd6', '#56b7aa',
  '#c77738', '#7f8fa6', '#d9608f', '#8dbf45', '#4d6fd6', '#b58a65',
];

function valueRatio(row, pick) {
  const values = rowValueEntries(row).map(entry => entry.value);
  const idx = values.indexOf(pick);
  if (idx < 0) return null;
  if (values.length <= 1) return 0.5;
  return idx / (values.length - 1);
}

function markColor(row, pick) {
  const ratio = valueRatio(row, pick);
  if (ratio === null) return null;
  const palette = typePalettes[row.type] || typePalettes.Spectrum;
  return ratio <= 0.5
    ? interpolateColor(palette[0], palette[1], ratio * 2)
    : interpolateColor(palette[1], palette[2], (ratio - 0.5) * 2);
}

function valueMeta(row, pick) {
  const entry = rowValueEntries(row).find(candidate => candidate.value === pick);
  return {
    value: pick,
    principle: entry?.principle || null,
    memo: entry?.memo || '',
    hasPrinciple: Boolean(entry?.principle),
    hasMemo: Boolean(entry?.memo),
  };
}

function pixelColor(row, pick) {
  const meta = valueMeta(row, pick);
  if (meta.principle) return ensurePrincipleColor(meta.principle);
  return markColor(row, pick);
}

function discoveredPrinciples() {
  const names = new Set(Object.keys(principleColors));
  rows.forEach(row => {
    rowValueEntries(row).forEach(entry => {
      if (entry.principle) names.add(entry.principle);
    });
  });
  return [...names].sort((a, b) => a.localeCompare(b));
}

function ensurePrincipleColor(principle) {
  if (!principleColors[principle]) {
    const index = discoveredPrinciples().indexOf(principle);
    principleColors[principle] = principleSeedColors[Math.max(0, index) % principleSeedColors.length];
  }
  return principleColors[principle];
}

function pixelTooltip(event, arch, row, pick, color) {
  const meta = valueMeta(row, pick);
  const principle = meta.principle ? principleLabel(meta.principle) : `Fallback: ${row.type}`;
  const archIdx = [...activeStances].indexOf(arch.id);
  const archColor = lineColors[Math.max(0, archIdx) % lineColors.length];
  const bandColor = bandColors[row.band] || 'var(--fg-muted)';
  const metaHtml =
    `<span class="tip-pill" style="--pill-color:${archColor}">${esc(arch.name)}</span>` +
    ` \u00d7 ` +
    `<span class="tip-pill" style="--pill-color:${bandColor}">${esc(row.name)}</span>` +
    `<br>${esc(row.band)}${row.group ? ` / ${esc(row.group)}` : ''}`;
  showTip(event, principle, meta.value, valueTooltipMemo(row, pick, arch), color, metaHtml);
}

function valueTooltipMemo(row, pick, arch = null) {
  const pickMemo = arch?.pickMemos?.[row.name];
  if (pickMemo) return pickMemo;
  const meta = valueMeta(row, pick);
  return meta.memo || row.desc || '';
}

function rowOptionsMeta(row) {
  return rowValueEntries(row)
    .map(entry => `${entry.value} [${entry.principle || `Fallback: ${row.type}`}]`)
    .join('  |  ');
}

function rowOptionsMemo(row) {
  const entries = rowValueEntries(row);
  const optionText = entries.map(entry => {
    const memo = entry.memo || 'No value memo yet.';
    return `${entry.value}: ${memo}`;
  }).join(' ');
  return `${row.desc || ''}${optionText ? `\n\nOptions: ${optionText}` : ''}`;
}

function comparisonAnnotationsForRows(visibleRows) {
  if (!activeComparison?.annotations?.length) return [];
  const rowIndex = new Map(visibleRows.map((row, index) => [row.name, { row, index }]));
  return activeComparison.annotations
    .map(annotation => ({ ...annotation, ...rowIndex.get(annotation.row) }))
    .filter(annotation => annotation.row && Number.isInteger(annotation.index));
}

function annotationColor(annotation) {
  if (annotation.type === 'match') return '#49b970';
  if (annotation.type === 'difference') return '#e9824a';
  if (annotation.type === 'tension') return '#d3a233';
  return bandColors[annotation.row.band] || 'var(--fg-muted)';
}

function comparisonSlug(comparison) {
  return slugify(comparison.slug || comparison.label);
}

/* ── Hash routing ── */
function parseHash() {
  const raw = decodeURIComponent(window.location.hash.replace(/^#/, '')).trim();
  if (!raw) return null;
  const [targetPart, queryPart = ''] = raw.split('?');
  const flags = new URLSearchParams(queryPart);
  return {
    targets: targetPart.split(',').map(slugify).filter(Boolean),
    flags,
  };
}

function applyHash() {
  const parsed = parseHash();
  if (!parsed || !parsed.targets.length) return false;
  const comparison = comparisons.find(candidate => parsed.targets.includes(comparisonSlug(candidate)));
  const stanceMatches = parsed.targets
    .map(target => stances.find(candidate => slugify(candidate.id) === target || slugify(candidate.name) === target))
    .filter(Boolean);

  applyingHash = true;
  if (comparison) {
    activeComparison = comparison;
    activeStances = new Set(comparison.ids);
  } else if (stanceMatches.length) {
    activeComparison = null;
    activeStances = new Set(stanceMatches.map(stance => stance.id));
  } else {
    applyingHash = false;
    return false;
  }

  if (parsed.flags.has('rows')) {
    const rowsMode = parsed.flags.get('rows');
    compact = rowsMode === 'marks';
    activeBandsOnly = rowsMode === 'bands';
    annotatedOnly = rowsMode === 'annotated';
  }
  if (parsed.flags.has('sort')) {
    const sortVal = parsed.flags.get('sort');
    diagnosticOrder = sortVal === 'diagnostic';
    if (!diagnosticOrder && sortVal) {
      const match = stances.find(s => slugify(s.id) === sortVal);
      sortByStanceId = match ? match.id : null;
    } else {
      sortByStanceId = null;
    }
  }
  if (parsed.flags.has('labels')) showLabels = parsed.flags.get('labels') === '1' || parsed.flags.get('labels') === 'true';
  update();
  applyingHash = false;
  return true;
}

function currentHash() {
  let target = '';
  if (activeComparison) target = comparisonSlug(activeComparison);
  else target = [...activeStances].map(id => slugify(id)).join(',');
  if (!target) return '';
  const flags = new URLSearchParams();
  if (annotatedOnly) flags.set('rows', 'annotated');
  else if (activeBandsOnly) flags.set('rows', 'bands');
  else if (compact) flags.set('rows', 'marks');
  if (diagnosticOrder) flags.set('sort', 'diagnostic');
  else if (sortByStanceId) flags.set('sort', slugify(sortByStanceId));
  if (showLabels) flags.set('labels', '1');
  const query = flags.toString();
  return `#${target}${query ? `?${query}` : ''}`;
}

function syncHash() {
  if (applyingHash) return;
  const next = currentHash();
  if (next && window.location.hash !== next) history.replaceState(null, '', next);
  if (!next && window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
}

/* ── Controls ── */
function renderControls() {
  const archEl = document.getElementById('stance-buttons');
  stances.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'pill';
    btn.textContent = displayName(a);
    btn.dataset.id = a.id;
    btn.addEventListener('click', () => {
      activeComparison = null;
      if (activeStances.has(a.id)) activeStances.delete(a.id);
      else activeStances.add(a.id);
      update();
    });
    archEl.appendChild(btn);
  });

  const compEl = document.getElementById('comparison-buttons');
  comparisons.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'pill';
    btn.textContent = c.label;
    btn.dataset.comp = c.label;
    btn.addEventListener('click', () => {
      activeComparison = c;
      activeStances = new Set(c.ids);
      update();
    });
    compEl.appendChild(btn);
  });

  renderGrammarEditor();
}

function renderGrammarEditor() {
  const editor = document.getElementById('grammar-editor');
  editor.innerHTML = '';
  const principles = discoveredPrinciples();
  const principleNote = document.createElement('div');
  principleNote.className = 'grammar-note';
  principleNote.textContent = principles.length
    ? 'Colours encode cross-cutting principles, not categories or dimension types.'
    : 'No principle metadata found yet. Add principles to values to enable principle colours.';
  editor.appendChild(principleNote);
  principles.forEach(principle => {
    const meta = principlesById.get(principle) || {};
    const row = document.createElement('div');
    row.className = 'grammar-row';
    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'grammar-swatch';
    input.title = `Change ${meta.label || principle} colour`;
    input.value = ensurePrincipleColor(principle);
    input.addEventListener('input', () => {
      principleColors[principle] = input.value;
      renderMosaic();
    });
    row.appendChild(input);
    const body = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'grammar-name';
    title.textContent = meta.label || principle;
    const desc = document.createElement('div');
    desc.className = 'grammar-desc';
    desc.textContent = meta.memo || 'No principle description yet.';
    const examples = document.createElement('div');
    examples.className = 'grammar-examples';
    examples.textContent = meta.examples?.length ? `Examples: ${meta.examples.join(', ')}` : 'Examples pending.';
    body.append(title, desc, examples);
    row.appendChild(body);
    editor.appendChild(row);
  });
}

/* ── Table renderer ── */
function renderMosaic() {
  const selected = [...activeStances].map(id => stances.find(a => a.id === id)).filter(Boolean);
  const active = activeRows();
  const annotatedRowNames = new Set(activeComparison?.annotations?.map(a => a.row) || []);
  const activeBands = new Set(rows.filter(r => active.has(r.name)).map(r => r.band));

  let visibleRows = annotatedOnly && annotatedRowNames.size
    ? rows.filter(r => annotatedRowNames.has(r.name))
    : rows;
  if (!annotatedOnly && activeBandsOnly && selected.length)
    visibleRows = rows.filter(r => activeBands.has(r.band));
  if (!annotatedOnly && compact && selected.length)
    visibleRows = visibleRows.filter(r => active.has(r.name) || annotatedRowNames.has(r.name));
  visibleRows = orderRows(visibleRows);

  const annotations = comparisonAnnotationsForRows(visibleRows);
  const annotationsByRow = new Map();
  annotations.forEach(a => {
    const list = annotationsByRow.get(a.row.name) || [];
    list.push(a);
    annotationsByRow.set(a.row.name, list);
  });
  const hasAnnotations = annotations.length > 0;

  const chart = document.getElementById('mosaic-chart');
  chart.innerHTML = '';

  const colW = showLabels ? 48 : 26;
  const rowH = Math.round((showLabels ? 28 : 17) * chartTextScale);

  const table = document.createElement('table');
  table.className = 'mosaic-table' + (showLabels ? ' show-labels' : '');
  table.style.setProperty('--col-w', `${colW}px`);
  table.style.setProperty('--row-h', `${rowH}px`);
  table.style.setProperty('--text-scale', chartTextScale);

  // ── Header ──
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  const bandHeader = document.createElement('th');
  bandHeader.className = 'band-header';
  headerRow.appendChild(bandHeader);

  const cornerCell = document.createElement('th');
  cornerCell.className = 'corner-cell';
  if (!sortByStanceId && !diagnosticOrder) cornerCell.classList.add('sort-active');
  cornerCell.style.cursor = 'pointer';
  const cornerSpan = document.createElement('span');
  cornerSpan.textContent = 'Spectrum';
  cornerCell.appendChild(cornerSpan);
  cornerCell.addEventListener('click', () => {
    sortByStanceId = null;
    diagnosticOrder = false;
    update();
  });
  headerRow.appendChild(cornerCell);

  selected.forEach((arch, i) => {
    const th = document.createElement('th');
    th.className = 'arch-header';
    if (sortByStanceId === arch.id) th.classList.add('sort-active');
    th.style.cursor = 'pointer';
    const span = document.createElement('span');
    span.textContent = displayName(arch);
    span.style.color = lineColors[i % lineColors.length];
    th.appendChild(span);
    th.addEventListener('click', () => {
      diagnosticOrder = false;
      sortByStanceId = sortByStanceId === arch.id ? null : arch.id;
      update();
    });
    headerRow.appendChild(th);
  });

  if (hasAnnotations) {
    const th = document.createElement('th');
    th.className = 'anno-header';
    th.textContent = 'WHY THESE DIMENSIONS MATTER';
    headerRow.appendChild(th);
  }

  thead.appendChild(headerRow);
  table.appendChild(thead);

  // ── Body ──
  const tbody = document.createElement('tbody');

  // Build band group blocks
  const sortArch = sortByStanceId ? stances.find(a => a.id === sortByStanceId) : null;
  const groupBlocks = [];
  let currentBlock = null;
  visibleRows.forEach((row, i) => {
    let key;
    if (diagnosticOrder) {
      key = diagnosticMeta.get(row.name)?.zone || 'Other';
    } else if (sortArch) {
      const pick = sortArch.picks[row.name];
      if (!pick) {
        key = 'Unpicked';
      } else {
        const p = valueMeta(row, pick).principle || '';
        key = p ? principleLabel(p) : 'Fallback';
      }
    } else {
      key = row.band;
    }
    if (!currentBlock || currentBlock.key !== key) {
      currentBlock = { key, row, start: i };
      groupBlocks.push(currentBlock);
    }
  });
  const blockStarts = new Map(groupBlocks.map(b => [b.start, b]));

  visibleRows.forEach((row, ri) => {
    const tr = document.createElement('tr');

    // Band label cell (content only on first row of each group)
    const bandCell = document.createElement('td');
    bandCell.className = 'band-cell';
    if (blockStarts.has(ri)) {
      const block = blockStarts.get(ri);
      let color;
      if (diagnosticOrder) color = '#6f7894';
      else if (sortArch) {
        const pick = sortArch.picks[block.row.name];
        color = pick ? pixelColor(block.row, pick) : 'var(--fg-muted)';
      } else {
        color = bandColors[block.row.band];
      }
      bandCell.textContent = block.key.toUpperCase();
      bandCell.style.color = color;
    }
    tr.appendChild(bandCell);

    // Dimension name
    const nameCell = document.createElement('td');
    nameCell.className = 'dim-name';
    nameCell.textContent = row.name;
    nameCell.addEventListener('mouseenter', e => showTip(
      e, row.band,
      `${row.group ? row.group + ' / ' : ''}${row.name} \u00b7 ${row.type}`,
      rowOptionsMemo(row),
      bandColors[row.band],
      rowOptionsMeta(row)
    ));
    nameCell.addEventListener('mouseleave', hideTip);
    tr.appendChild(nameCell);

    // Value cells per stance
    selected.forEach((arch, ai) => {
      const cell = document.createElement('td');
      cell.className = 'val-cell';
      const mark = document.createElement('div');
      mark.className = 'mark';

      const pick = arch.picks[row.name];
      if (pick) {
        const color = pixelColor(row, pick);
        if (color) mark.style.backgroundColor = color;
        if (showLabels) {
          const label = document.createElement('span');
          label.className = 'val-label';
          label.textContent = pick;
          cell.appendChild(label);
        }
        cell.addEventListener('mouseenter', e => pixelTooltip(e, arch, row, pick, color));
        cell.addEventListener('mouseleave', hideTip);
      }

      cell.appendChild(mark);
      tr.appendChild(cell);
    });

    // Annotation cell
    if (hasAnnotations) {
      const annoCell = document.createElement('td');
      annoCell.className = 'anno-cell';
      const rowAnnotations = annotationsByRow.get(row.name) || [];
      rowAnnotations.forEach(annotation => {
        const color = annotationColor(annotation);
        const wrap = document.createElement('div');
        wrap.className = 'anno-wrap';
        const dot = document.createElement('span');
        dot.className = 'anno-dot';
        dot.style.backgroundColor = color;
        const body = document.createElement('div');
        body.className = 'anno-body';
        const title = document.createElement('div');
        title.className = 'anno-title';
        title.textContent = annotation.title || annotation.row.name;
        const text = document.createElement('div');
        text.className = 'anno-text';
        text.textContent = annotation.commentary || '';
        body.append(title, text);
        wrap.append(dot, body);
        annoCell.appendChild(wrap);
      });
      tr.appendChild(annoCell);
    }

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  chart.appendChild(table);
}

/* ── Stance modal ── */
const extLinkSvg = '<svg viewBox="0 0 512 512"><path fill="currentColor" d="M320 0c-17.7 0-32 14.3-32 32s14.3 32 32 32h82.7L201.4 265.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L448 109.3V192c0 17.7 14.3 32 32 32s32-14.3 32-32V32c0-17.7-14.3-32-32-32H320zM80 32C35.8 32 0 67.8 0 112v320c0 44.2 35.8 80 80 80h320c44.2 0 80-35.8 80-80V320c0-17.7-14.3-32-32-32s-32 14.3-32 32v112c0 8.8-7.2 16-16 16H80c-8.8 0-16-7.2-16-16V112c0-8.8 7.2-16 16-16h112c17.7 0 32-14.3 32-32s-14.3-32-32-32H80z"/></svg>';

function openStanceModal(stanceId) {
  const frame = document.getElementById('stance-modal-frame');
  frame.src = `stance.html#${slugify(stanceId)}`;
  document.getElementById('stance-modal-backdrop').classList.add('visible');
}

function closeStanceModal() {
  document.getElementById('stance-modal-backdrop').classList.remove('visible');
  document.getElementById('stance-modal-frame').src = '';
}

document.getElementById('stance-modal-backdrop').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeStanceModal();
});
document.querySelector('.stance-modal-close').addEventListener('click', closeStanceModal);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeStanceModal();
});

function stanceCardHtml(a, i) {
  const color = lineColors[i % lineColors.length];
  const slug = slugify(a.id);
  const caveatHtml = a.caveat
    ? `<div class="stance-caveat">* ${a.caveat}</div>`
    : '';
  return `<div class="stance-card" style="--item-color:${color}">
    <div class="stance-card-head">
      <strong class="stance-card-title" data-stance-id="${a.id}">${displayName(a)}</strong>
      <a class="stance-card-link" href="/${slug}" target="_blank" aria-label="Open ${a.name} in new tab">${extLinkSvg}</a>
    </div>
    <div>${a.desc}</div>
    ${caveatHtml}
  </div>`;
}

function wireCardTitles(container) {
  container.querySelectorAll('.stance-card-title').forEach(el => {
    el.addEventListener('click', () => openStanceModal(el.dataset.stanceId));
  });
}

/* ── Info panel ── */
function updateInfo() {
  const info = document.getElementById('infobox');
  const selected = [...activeStances].map(id => stances.find(a => a.id === id)).filter(Boolean);
  if (activeComparison) {
    const analysis = activeComparison.analysis;
    const analysisHtml = analysis ? `
      <div class="info-item" style="--item-color:#49b970"><strong>Same</strong> ${analysis.same}</div>
      <div class="info-item" style="--item-color:#e9824a"><strong>Different</strong> ${analysis.different}</div>
      <div class="info-item" style="--item-color:#d3a233"><strong>Impact</strong> ${analysis.impact}</div>
    ` : '';
    const stancesHtml = selected.map((a, i) => stanceCardHtml(a, i)).join('');
    info.innerHTML = `
      <div class="info-section">
        <div class="info-kicker">Comparison</div>
        <div class="info-title">${activeComparison.label}</div>
        <div class="comparison-desc">${activeComparison.desc}</div>
        ${analysisHtml}
      </div>
      <div class="info-section">
        <div class="info-kicker">Stances in this comparison</div>
        <div class="stance-list">${stancesHtml}</div>
      </div>
    `;
    wireCardTitles(info);
    return;
  }
  if (!selected.length) {
    info.innerHTML = '<span style="color:var(--fg-muted)">Select stances or a comparison. Blank dimensions are intentionally silent; there is no interpolated path.</span>';
    return;
  }
  info.innerHTML = `<div class="info-section"><div class="info-kicker">Selected stances</div><div class="stance-list">` +
    selected.map((a, i) => stanceCardHtml(a, i)).join('') +
    '</div></div>';
  wireCardTitles(info);
}

function updateButtons() {
  document.getElementById('all-stances').classList.toggle('active', stances.length > 0 && activeStances.size === stances.length);
  document.getElementById('all-stances').style.setProperty('--active-color', '#2f8fb9');
  document.getElementById('clear-stances').classList.toggle('active', activeStances.size === 0);
  document.getElementById('clear-stances').style.setProperty('--active-color', '#6f7894');
  document.querySelectorAll('#stance-buttons .pill').forEach(btn => {
    const idx = [...activeStances].indexOf(btn.dataset.id);
    btn.classList.toggle('active', idx >= 0);
    btn.style.setProperty('--active-color', idx >= 0 ? lineColors[idx % lineColors.length] : '#2f8fb9');
  });
  document.querySelectorAll('#comparison-buttons .pill').forEach(btn => btn.classList.toggle('active', activeComparison && btn.dataset.comp === activeComparison.label));
  document.getElementById('compact-toggle').classList.toggle('active', compact);
  document.getElementById('compact-toggle').style.setProperty('--active-color', '#2f8fb9');
  document.getElementById('active-bands-toggle').classList.toggle('active', activeBandsOnly);
  document.getElementById('active-bands-toggle').style.setProperty('--active-color', '#45a66a');
  document.getElementById('annotated-toggle').classList.toggle('active', annotatedOnly);
  document.getElementById('annotated-toggle').style.setProperty('--active-color', '#d3a233');
  document.getElementById('diagnostic-toggle').classList.toggle('active', diagnosticOrder);
  document.getElementById('diagnostic-toggle').style.setProperty('--active-color', '#d48632');
  document.getElementById('labels-toggle').classList.toggle('active', showLabels);
  document.getElementById('labels-toggle').style.setProperty('--active-color', '#9f5b9c');
}

function update() {
  if (sortByStanceId && !activeStances.has(sortByStanceId)) sortByStanceId = null;
  updateButtons();
  updateInfo();
  renderMosaic();
  syncHash();
}

/* ── Event handlers ── */
document.getElementById('all-stances').addEventListener('click', () => {
  activeComparison = null;
  activeStances = new Set(stances.map(a => a.id));
  update();
});
document.getElementById('clear-stances').addEventListener('click', () => {
  activeComparison = null;
  activeStances.clear();
  update();
});
document.getElementById('compact-toggle').addEventListener('click', () => {
  compact = !compact;
  if (compact) {
    activeBandsOnly = false;
    annotatedOnly = false;
  }
  update();
});
document.getElementById('active-bands-toggle').addEventListener('click', () => {
  activeBandsOnly = !activeBandsOnly;
  if (activeBandsOnly) {
    compact = false;
    annotatedOnly = false;
  }
  update();
});
document.getElementById('annotated-toggle').addEventListener('click', () => {
  annotatedOnly = !annotatedOnly;
  if (annotatedOnly) {
    compact = false;
    activeBandsOnly = false;
  }
  update();
});
document.getElementById('diagnostic-toggle').addEventListener('click', () => {
  diagnosticOrder = !diagnosticOrder;
  if (diagnosticOrder) sortByStanceId = null;
  update();
});
document.getElementById('labels-toggle').addEventListener('click', () => { showLabels = !showLabels; update(); });
document.getElementById('theme-toggle').addEventListener('click', () => {
  lightMode = !lightMode;
  document.documentElement.dataset.theme = lightMode ? 'light' : 'dark';
  localStorage.setItem('colliderTheme', lightMode ? 'light' : 'dark');
});
document.getElementById('chart-text-smaller').addEventListener('click', () => {
  chartTextScale = Math.max(0.75, Number((chartTextScale - 0.1).toFixed(2)));
  localStorage.setItem('colliderTextScale', chartTextScale);
  renderMosaic();
});
document.getElementById('chart-text-reset').addEventListener('click', () => {
  chartTextScale = 1;
  localStorage.setItem('colliderTextScale', chartTextScale);
  renderMosaic();
});
document.getElementById('chart-text-larger').addEventListener('click', () => {
  chartTextScale = Math.min(1.45, Number((chartTextScale + 0.1).toFixed(2)));
  localStorage.setItem('colliderTextScale', chartTextScale);
  renderMosaic();
});
document.getElementById('grammar-reset').addEventListener('click', () => {
  principleColors = normalisePrincipleColors([...principlesById.values()]);
  renderGrammarEditor();
  renderMosaic();
});

loadFrameworkData().then(data => {
  bands = data.bands;
  rows = data.rows;
  stances = data.stances;
  comparisons = data.comparisons;
  lineColors = Array.from({length: 6}, (_, i) =>
    getComputedStyle(document.documentElement).getPropertyValue(`--line-${i}`).trim()
  );
  bandColors = Object.fromEntries(bands.map(b => [b.name, b.color]));
  principleColors = normalisePrincipleColors(data.principleColors || data.principles || {});
  principlesById = new Map((data.principles || []).map(principle => [principle.id, principle]));

  initLayoutResizer({
    min: 18, max: 42, defaultPct: 27,
    storageKey: 'colliderMosaicLeftPane',
    onResize: renderMosaic,
  });
  renderControls();
  initAboutModal({
    viewDesc: "In the mosaic, each column is a stance and each row is a dimension. Selecting stances adds columns; the pattern of colour and space IS the comparison \u2014 shapes that match share a logic, shapes that diverge show it instantly."
  });
  if (!applyHash()) {
    activeComparison = comparisons.find(c => c.label === 'Same contract, opposite outcome') || null;
    if (activeComparison) activeStances = new Set(activeComparison.ids);
    update();
  }
}).catch(err => {
  document.getElementById('infobox').innerHTML = `<div class="info-title">Could not load data</div><div>${esc(err.message)}</div>`;
});

window.addEventListener('hashchange', applyHash);
