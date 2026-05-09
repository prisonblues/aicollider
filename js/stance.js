// deployed 2026-05-09
let bands = [];
let rows = [];
let stances = [];
let principlesById = new Map();
let principleColors = {};
let activeStance = null;
let displayMode = localStorage.getItem('singleStanceDisplayMode') || 'l3';
let activePrincipleFilter = new Set();
let hiddenDimensions = new Set();
let dimensionSort = { key: null, direction: 'asc' };
let dimensionsExpanded = localStorage.getItem('singleStanceDimensionsExpanded') === 'true';
let lightMode = localStorage.getItem('colliderTheme')
  ? localStorage.getItem('colliderTheme') === 'light'
  : window.matchMedia('(prefers-color-scheme: light)').matches;
let fingerprintSvg = null;
let fingerprintZoom = null;
let fingerprintAnimated = false;
document.documentElement.dataset.theme = lightMode ? 'light' : 'dark';
const savedLeftPane = Number(localStorage.getItem('singleStanceLeftPane'));
if (Number.isFinite(savedLeftPane)) {
  document.documentElement.style.setProperty('--left-pane', `${Math.min(68, Math.max(32, savedLeftPane))}%`);
}

const RADII = {
  center: 60,
  l1: { inner: 72, outer: 148 },
  l2: { inner: 156, outer: 280 },
  l3: { inner: 288, outer: 420 },
};
const GAP_PX = { l1: 4.5, l2: 4.5, l3: 4.5 };  // constant-width gaps in px
const VIEW_SIZE = 900;
const CENTER = VIEW_SIZE / 2;
const DISPLAY_MODES = [
  { id: 'all', label: 'All dimensions' },
  { id: 'l2', label: 'Relevant dimensions' },
  { id: 'l3', label: 'Selected values' },
];
const SHARE_IMAGE = {
  width: 1600,
  height: 900,
  padding: 48,
  chartSize: 690,
};
let embeddedInterCssPromise = null;

let imagequantModule = null;
let imagequantFailed = false;
async function loadImagequant() {
  if (imagequantModule) return imagequantModule;
  if (imagequantFailed) return null;
  try {
    const CDN = 'https://cdn.jsdelivr.net/npm/imagequant@0.1.2';
    const bg = await import(CDN + '/imagequant_bg.js');
    const wasmBytes = await fetch(CDN + '/imagequant_bg.wasm').then(r => r.arrayBuffer());
    const wasmImports = {
      './imagequant_bg.js': {
        __wbindgen_error_new: bg.__wbindgen_error_new,
        __wbindgen_throw: bg.__wbindgen_throw,
      }
    };
    const { instance } = await WebAssembly.instantiate(wasmBytes, wasmImports);
    bg.__wbg_set_wasm(instance.exports);
    imagequantModule = bg;
    return imagequantModule;
  } catch (e) {
    console.warn('imagequant WASM not available, falling back to basic quantization:', e);
    imagequantFailed = true;
    return null;
  }
}

function basicQuantize(ctx, canvas, step) {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  const mask = ~(step - 1);
  const half = step >> 1;
  for (let i = 0; i < d.length; i++) {
    d[i] = Math.min(255, (d[i] + half) & mask);
  }
  ctx.putImageData(imageData, 0, 0);
}

async function quantizePng(canvas) {
  const ctx = canvas.getContext('2d');
  const iq = await loadImagequant();
  if (iq) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const image = new iq.ImagequantImage(new Uint8Array(imageData.data.buffer), canvas.width, canvas.height, 0);
    const instance = new iq.Imagequant();
    instance.set_quality(75, 95);
    instance.set_speed(3);
    const output = instance.process(image);
    return new Blob([output.buffer], { type: 'image/png' });
  }
  basicQuantize(ctx, canvas, 4);
  return await new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not render PNG.')), 'image/png');
  });
}

function setActiveStance(stance) {
  activeStance = stance;
  activePrincipleFilter.clear();
  hiddenDimensions.clear();
  fingerprintAnimated = false;
  history.replaceState(null, '', `#${slugify(stance.id)}`);
  render();
}


function activeSlug() {
  return activeStance ? slugify(activeStance.id) : '';
}

function valueEntry(row, pick) {
  return rowValueEntries(row).find(value => value.value === pick) || null;
}

function principleMemo(id) {
  const principle = principlesById.get(id);
  if (!principle) return '';
  const examples = principle.examples?.length ? `\n\nExamples: ${principle.examples.join(', ')}` : '';
  return `${principle.memo || ''}${examples}`;
}

function pickMemo(row, arch) {
  const pick = arch.picks[row.name];
  if (!pick) return row.desc || '';
  return arch.pickMemos?.[row.name] || valueEntry(row, pick)?.memo || row.desc || '';
}

function pickColor(row, arch) {
  const pick = arch.picks[row.name];
  if (!hasPick(row, arch)) return null;
  const principle = valueEntry(row, pick)?.principle;
  return principleColors[principle] || '#8b93a7';
}

function isNonAssertivePick(value) {
  return String(value || '').trim().toLowerCase() === 'none';
}

function hasPick(row, arch = activeStance) {
  const pick = arch?.picks?.[row.name];
  return Boolean(pick) && !isNonAssertivePick(pick);
}

function rowMatchesActivePrinciples(row, arch = activeStance) {
  if (activePrincipleFilter.size === 0) return true;
  const pick = hasPick(row, arch) ? arch.picks[row.name] : null;
  return pick && activePrincipleFilter.has(valueEntry(row, pick)?.principle);
}

function syncHiddenFromPrinciples() {
  if (activePrincipleFilter.size === 0) {
    hiddenDimensions.clear();
    return;
  }
  const picked = rows.filter(row => hasPick(row, activeStance));
  picked.forEach(row => {
    if (rowMatchesActivePrinciples(row, activeStance)) {
      hiddenDimensions.delete(row.name);
    } else {
      hiddenDimensions.add(row.name);
    }
  });
}

function visibleRows(arch = activeStance) {
  if (!arch) return [];
  const base = displayMode === 'all' ? rows : rows.filter(row => hasPick(row, arch));
  return base.filter(row => !hiddenDimensions.has(row.name));
}

function visibleBandsForRows(scopedRows) {
  const visibleBandNames = new Set(scopedRows.map(row => row.band));
  return bands.filter(band => visibleBandNames.has(band.name));
}

function visibleValues(row, pick) {
  const values = rowValueEntries(row);
  if (displayMode === 'l3') return values.filter(value => value.value === pick);
  return values;
}

function showPrincipleTooltip(event, principle, selectedRows) {
  const color = principleColors[principle] || 'var(--fg-muted)';
  const tooltip = d3.select('#tooltip');
  tooltip.select('.tooltip-band').text('Principle signal').style('color', color);
  tooltip.select('.tooltip-name').text(principleLabel(principle));
  tooltip.select('.tooltip-meta').text(`${selectedRows.length} selected ${selectedRows.length === 1 ? 'dimension' : 'dimensions'} in ${activeStance.name}`);
  tooltip.select('.tooltip-desc').html(`
    <div class="tooltip-table">
      ${selectedRows.map(({ row, pick }) => `
        <div class="tooltip-row-name">${esc(row.name)}</div>
        <div class="tooltip-value-pill" style="--pill-color:${esc(pickColor(row, activeStance) || color)}">${esc(pick)}</div>
      `).join('')}
    </div>
  `);
  tooltip.classed('visible', true);
  positionTooltip(event);
}

function computeFingerprintArcs(arch) {
  const arcs = [];
  const scopedRows = visibleRows(arch);
  const scopedBands = visibleBandsForRows(scopedRows);
  const rowsByBand = new Map(scopedBands.map(band => [band.name, scopedRows.filter(row => row.band === band.name)]));

  // padAngle + padRadius → constant-width gaps with parallel (non-radial) sides
  const l1PadRadius = Math.sqrt(RADII.l1.inner * RADII.l1.outer);
  const l2PadRadius = Math.sqrt(RADII.l2.inner * RADII.l2.outer);
  const l3PadRadius = Math.sqrt(RADII.l3.inner * RADII.l3.outer);
  const l1PadAngle = GAP_PX.l1 / l1PadRadius;
  const l2PadAngle = GAP_PX.l2 / l2PadRadius;
  const l3PadAngle = GAP_PX.l3 / l3PadRadius;

  const l1Angle = 2 * Math.PI / Math.max(1, scopedBands.length);
  let l1Start = 0;

  scopedBands.forEach((band) => {
    const bandRows = rowsByBand.get(band.name) || [];
    const l1End = l1Start + l1Angle;
    arcs.push({
      level: 1,
      startAngle: l1Start,
      endAngle: l1End,
      innerRadius: RADII.l1.inner,
      outerRadius: RADII.l1.outer,
      padAngle: l1PadAngle,
      padRadius: l1PadRadius,
      name: band.name,
      band: band.name,
      color: band.color,
      desc: band.desc || `${band.name} rows`,
    });

    const l2Angle = l1Angle / Math.max(1, bandRows.length);
    let l2Start = l1Start;
    bandRows.forEach(row => {
      const l2End = l2Start + l2Angle;
      const pick = hasPick(row, arch) ? arch.picks[row.name] : null;
      arcs.push({
        level: 2,
        startAngle: l2Start,
        endAngle: l2End,
        innerRadius: RADII.l2.inner,
        outerRadius: RADII.l2.outer,
        padAngle: l2PadAngle,
        padRadius: l2PadRadius,
        name: row.name,
        band: band.name,
        row,
        color: band.color,
        skeleton: !pick,
        desc: row.desc,
      });

      const possibleValues = visibleValues(row, pick);
      const l3Angle = l2Angle / Math.max(1, possibleValues.length);
      let l3Start = l2Start;
      possibleValues.forEach(value => {
        const l3End = l3Start + Math.max(0.0001, l3Angle);
        const selected = pick === value.value;
        arcs.push({
          level: 3,
          startAngle: l3Start,
          endAngle: l3End,
          innerRadius: RADII.l3.inner,
          outerRadius: RADII.l3.outer,
          padAngle: l3PadAngle,
          padRadius: l3PadRadius,
          name: value.value,
          band: band.name,
          row,
          principle: value.principle,
          color: principleColors[value.principle] || band.color,
          desc: selected ? pickMemo(row, arch) : value.memo || row.desc,
          selected,
          silent: !pick,
        });
        l3Start = l3End;
      });
      l2Start = l2End;
    });
    l1Start = l1End;
  });
  return arcs;
}

function tangentialPos(arc) {
  const midAngle = (arc.startAngle + arc.endAngle) / 2;
  const midRadius = (arc.innerRadius + arc.outerRadius) / 2;
  const x = midRadius * Math.sin(midAngle);
  const y = -midRadius * Math.cos(midAngle);
  const deg = midAngle * 180 / Math.PI;
  let rotation = deg;
  if (deg > 90 && deg <= 270) rotation -= 180;
  return { x, y, rotation };
}

function radialPos(arc) {
  const midAngle = (arc.startAngle + arc.endAngle) / 2;
  const midRadius = (arc.innerRadius + arc.outerRadius) / 2;
  const x = midRadius * Math.sin(midAngle);
  const y = -midRadius * Math.cos(midAngle);
  const deg = midAngle * 180 / Math.PI;
  const rotation = deg < 180 ? deg - 90 : deg + 90;
  return { x, y, rotation };
}

function arcSpan(arc) {
  const pad = arc.padAngle || 0;
  return (arc.endAngle - arc.startAngle - pad) * ((arc.innerRadius + arc.outerRadius) / 2);
}

function abbreviate(text, max = 20) {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 2))}\u2026`;
}

function tangentialFits(arc, text, pxPerChar = 6.3) {
  return arcSpan(arc) >= text.length * pxPerChar;
}

function radialFits(arc, text, pxPerChar = 6.1) {
  return (arc.outerRadius - arc.innerRadius) >= text.length * pxPerChar;
}

function labelForArc(arc) {
  const name = abbreviate(arc.name, arc.level === 1 ? 28 : 18);
  if (arc.level === 1) return { text: name, ...tangentialPos(arc) };
  if (arc.level === 3) {
    if (!arc.selected) return null;
    const text = radialFits(arc, name, 7.5) ? name : abbreviate(arc.name, 12);
    return { text, ...radialPos(arc) };
  }
  if (arc.level === 2 && arc.skeleton) return null;
  if (arc.level === 2) {
    const text = radialFits(arc, name, 7.2) ? name : abbreviate(arc.name, 12);
    return { text, ...radialPos(arc) };
  }
  if (!tangentialFits(arc, name, 9)) return null;
  return { text: name, ...tangentialPos(arc) };
}

function renderFingerprint() {
  const chart = d3.select('#fingerprint-chart');
  chart.selectAll('*').remove();
  if (!activeStance) return;
  const arcs = computeFingerprintArcs(activeStance);
  const svg = chart.append('svg').attr('viewBox', `0 0 ${VIEW_SIZE} ${VIEW_SIZE}`).attr('preserveAspectRatio', 'xMidYMid meet');
  const viewport = svg.append('g').attr('class', 'fingerprint-viewport');
  const g = viewport.append('g').attr('transform', `translate(${CENTER},${CENTER})`);
  const arcGen = d3.arc();
  fingerprintSvg = svg;
  fingerprintZoom = d3.zoom()
    .scaleExtent([0.55, 5])
    .extent([[0, 0], [VIEW_SIZE, VIEW_SIZE]])
    .translateExtent([[0, 0], [VIEW_SIZE, VIEW_SIZE]])
    .filter(event => !event.ctrlKey || event.type === 'wheel')
    .on('zoom', event => {
      viewport.attr('transform', event.transform);
    });
  svg.call(fingerprintZoom);
  svg.on('dblclick.zoom', null);

  [RADII.l1.inner, RADII.l2.inner, RADII.l3.inner, RADII.l3.outer].forEach(radius => {
    g.append('circle').attr('r', radius).attr('fill', 'none').attr('stroke', 'var(--axis)').attr('stroke-width', 0.5);
  });

  g.append('circle')
    .attr('r', RADII.center)
    .attr('fill', 'var(--surface-2)')
    .attr('stroke', 'var(--border)');

  [1, 2, 3].forEach(level => {
    arcs.filter(arc => arc.level === level).forEach(arc => {
      const fill = arc.level === 1
        ? colorMix(arc.color, 0.42)
        : arc.level === 2
          ? (arc.skeleton ? 'var(--skeleton)' : colorMix(arc.color, 0.23))
          : (arc.selected ? arc.color : colorMix(arc.color, arc.silent ? 0.1 : 0.18));
      const finalOpacity = arc.level === 3
        ? (arc.selected ? 1 : arc.silent ? 0.34 : 0.52)
        : arc.skeleton ? 0.68 : 1;
      const targetD = arcGen(arc);
      const animate = !fingerprintAnimated;
      const path = g.append('path')
        .attr('class', `arc-path level-${level}`)
        .attr('fill', fill)
        .attr('stroke', 'var(--border)')
        .attr('stroke-width', 0.45)
        .attr('opacity', finalOpacity)
        .on('mouseenter', event => showArcTooltip(event, arc))
        .on('mouseleave', hideTip);
      if (animate) {
        const startD = arcGen({
          innerRadius: arc.innerRadius,
          outerRadius: arc.innerRadius,
          startAngle: (arc.startAngle + arc.endAngle) / 2,
          endAngle: (arc.startAngle + arc.endAngle) / 2,
        });
        const delay = level === 1 ? 80 : level === 2 ? 250 : 430;
        const jitter = Math.round((arc.startAngle / (2 * Math.PI)) * 260);
        path.attr('d', startD)
          .transition()
          .delay(delay + jitter)
          .duration(650)
          .ease(d3.easeCubicOut)
          .attr('d', targetD);
      } else {
        path.attr('d', targetD);
      }
      path.append('title').text(arc.name);

      const label = labelForArc(arc);
      if (label) {
        const labelEl = g.append('text')
          .attr('class', `arc-label level-${level}`)
          .attr('x', label.x)
          .attr('y', label.y)
          .attr('transform', `rotate(${label.rotation},${label.x},${label.y})`)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .text(label.text);
        if (animate) {
          labelEl.style('opacity', 0)
            .transition()
            .delay(level === 1 ? 470 : level === 2 ? 650 : 820)
            .duration(360)
            .style('opacity', 1);
        }
      }
    });
  });
  fingerprintAnimated = true;
}

function colorMix(color, opacity, fallback = color) {
  const parsed = d3.color(color);
  if (!parsed) return fallback;
  parsed.opacity = opacity;
  return parsed.formatRgb();
}

function resetFingerprintZoom() {
  if (!fingerprintSvg || !fingerprintZoom) return;
  fingerprintSvg.transition().duration(240).call(fingerprintZoom.transform, d3.zoomIdentity);
}

function inlineSvgStyles(svg) {
  const properties = [
    'fill',
    'stroke',
    'stroke-width',
    'stroke-linejoin',
    'opacity',
    'font-family',
    'font-size',
    'font-weight',
    'letter-spacing',
    'text-transform',
  ];
  svg.querySelectorAll('*').forEach(node => {
    const styles = window.getComputedStyle(node);
    properties.forEach(property => {
      const value = styles.getPropertyValue(property);
      if (value) node.style.setProperty(property, value);
    });
  });
}

async function embeddedInterCss() {
  if (!embeddedInterCssPromise) {
    embeddedInterCssPromise = (async () => {
      const response = await fetch('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
      if (!response.ok) throw new Error('Could not load Inter font CSS.');
      let css = await response.text();
      const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map(match => match[1].replace(/^["']|["']$/g, ''));
      for (const url of [...new Set(urls)]) {
        const fontResponse = await fetch(url);
        if (!fontResponse.ok) continue;
        const blob = await fontResponse.blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        css = css.replaceAll(url, dataUrl);
      }
      return css;
    })().catch(error => {
      console.warn(error);
      return '';
    });
  }
  return embeddedInterCssPromise;
}

function fingerprintFileName() {
  return `${slugify(activeStance?.name || 'fingerprint')}-fingerprint.png`;
}

async function fingerprintSvgBlob() {
  const source = document.querySelector('#fingerprint-chart svg');
  if (!source) throw new Error('Fingerprint chart is not available.');
  await document.fonts?.ready;
  const clone = source.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', VIEW_SIZE);
  clone.setAttribute('height', VIEW_SIZE);
  clone.querySelector('.fingerprint-viewport')?.removeAttribute('transform');
  clone.style.background = 'transparent';
  inlineSvgStyles(clone);
  const fontCss = await embeddedInterCss();
  if (fontCss) {
    const defs = clone.querySelector('defs') || clone.insertBefore(document.createElementNS('http://www.w3.org/2000/svg', 'defs'), clone.firstChild);
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = fontCss;
    defs.appendChild(style);
  }
  const serialized = new XMLSerializer().serializeToString(clone);
  return new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines = Infinity) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  words.forEach(word => {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth || !line) {
      line = test;
    } else {
      lines.push(line);
      line = word;
    }
  });
  if (line) lines.push(line);
  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines && visible.length) {
    let last = visible[visible.length - 1];
    while (last.length > 1 && ctx.measureText(`${last}...`).width > maxWidth) {
      last = last.slice(0, -1).trim();
    }
    visible[visible.length - 1] = `${last}...`;
  }
  visible.forEach((lineText, index) => ctx.fillText(lineText, x, y + index * lineHeight));
  return visible.length * lineHeight;
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function sharePalette() {
  return lightMode ? {
    bg0: '#f7f0e4',
    bg1: '#fffaf0',
    bg2: '#dcebf0',
    fg: '#172033',
    muted: 'rgba(23,32,51,0.64)',
    soft: 'rgba(23,32,51,0.42)',
    panel: 'rgba(255,255,255,0.58)',
    panelStroke: 'rgba(23,32,51,0.1)',
    axis: 'rgba(23,32,51,0.15)',
    border: 'rgba(23,32,51,0.13)',
    skeleton: 'rgba(23,32,51,0.07)',
    centerFill: 'rgba(245,236,220,0.92)',
    shadow: 'rgba(23,32,51,0.16)',
    blueGlow: 'rgba(47,143,185,0.22)',
    goldGlow: 'rgba(211,162,51,0.2)',
  } : {
    bg0: '#070912',
    bg1: '#101725',
    bg2: '#1c1a18',
    fg: '#f7f1e8',
    muted: 'rgba(247,241,232,0.72)',
    soft: 'rgba(247,241,232,0.46)',
    panel: 'rgba(8,12,24,0.42)',
    panelStroke: 'rgba(255,255,255,0.1)',
    axis: 'rgba(255,255,255,0.1)',
    border: 'rgba(255,255,255,0.09)',
    skeleton: 'rgba(255,255,255,0.075)',
    centerFill: 'rgba(20,26,44,0.9)',
    shadow: 'rgba(0,0,0,0.34)',
    blueGlow: 'rgba(47,143,185,0.38)',
    goldGlow: 'rgba(211,162,51,0.26)',
  };
}

async function ensureExportFonts() {
  if (!document.fonts) return;
  await Promise.all([
    document.fonts.load('500 30px Inter'),
    document.fonts.load('500 14px Inter'),
    document.fonts.load('600 13px Inter'),
    document.fonts.load('700 28px Inter'),
    document.fonts.load('800 78px Inter'),
  ]);
  await document.fonts.ready;
}

function drawFingerprintCanvas(ctx, arch, x, y, size, palette) {
  const arcs = computeFingerprintArcs(arch);
  const arcGen = d3.arc().context(ctx);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / VIEW_SIZE, size / VIEW_SIZE);
  ctx.translate(CENTER, CENTER);

  ctx.strokeStyle = palette.axis;
  ctx.lineWidth = 0.5;
  [RADII.l1.inner, RADII.l2.inner, RADII.l3.inner, RADII.l3.outer].forEach(radius => {
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
  });

  ctx.beginPath();
  ctx.arc(0, 0, RADII.center, 0, Math.PI * 2);
  ctx.fillStyle = palette.centerFill;
  ctx.fill();
  ctx.strokeStyle = palette.border;
  ctx.stroke();

  [1, 2, 3].forEach(level => {
    arcs.filter(arc => arc.level === level).forEach(arc => {
      const fill = arc.level === 1
        ? colorMix(arc.color, 0.42, palette.skeleton)
        : arc.level === 2
          ? (arc.skeleton ? palette.skeleton : colorMix(arc.color, 0.23, palette.skeleton))
          : (arc.selected ? arc.color : colorMix(arc.color, arc.silent ? 0.1 : 0.18, palette.skeleton));
      const opacity = arc.level === 3
        ? (arc.selected ? 1 : arc.silent ? 0.34 : 0.52)
        : arc.skeleton ? 0.68 : 1;

      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.beginPath();
      arcGen(arc);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = palette.border;
      ctx.lineWidth = 0.45;
      ctx.stroke();
      ctx.restore();
    });
  });

  arcs.forEach(arc => {
    const label = labelForArc(arc);
    if (!label) return;
    ctx.save();
    ctx.translate(label.x, label.y);
    ctx.rotate(label.rotation * Math.PI / 180);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = arc.level === 2 ? palette.muted : palette.fg;
    ctx.font = arc.level === 1
      ? '500 14px Inter, system-ui, sans-serif'
      : arc.level === 2
        ? '500 14px Inter, system-ui, sans-serif'
        : '600 12.5px Inter, system-ui, sans-serif';
    ctx.fillText(label.text, 0, 0);
    ctx.restore();
  });

  ctx.restore();
}

async function fingerprintPngBlob(scale = 1.5) {
  await ensureExportFonts();
  const width = SHARE_IMAGE.width * scale;
  const height = SHARE_IMAGE.height * scale;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.textBaseline = 'alphabetic';
  const palette = sharePalette();

  const bg = ctx.createLinearGradient(0, 0, SHARE_IMAGE.width, SHARE_IMAGE.height);
  bg.addColorStop(0, palette.bg0);
  bg.addColorStop(0.58, palette.bg1);
  bg.addColorStop(1, palette.bg2);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SHARE_IMAGE.width, SHARE_IMAGE.height);

  const blueGlow = ctx.createRadialGradient(180, 90, 10, 180, 90, 760);
  blueGlow.addColorStop(0, palette.blueGlow);
  blueGlow.addColorStop(1, 'rgba(47,143,185,0)');
  ctx.fillStyle = blueGlow;
  ctx.fillRect(0, 0, SHARE_IMAGE.width, SHARE_IMAGE.height);

  const goldGlow = ctx.createRadialGradient(1390, 120, 10, 1390, 120, 760);
  goldGlow.addColorStop(0, palette.goldGlow);
  goldGlow.addColorStop(1, 'rgba(211,162,51,0)');
  ctx.fillStyle = goldGlow;
  ctx.fillRect(0, 0, SHARE_IMAGE.width, SHARE_IMAGE.height);

  const pad = SHARE_IMAGE.padding;
  const chartX = SHARE_IMAGE.width - SHARE_IMAGE.chartSize - 70;
  const cardTop = 56;
  const chartY = cardTop + 24;

  // ── Title: top-align with the card ──
  const titleBaseline = cardTop + 62; // optically align with card top
  ctx.fillStyle = palette.fg;
  ctx.font = '800 74px Inter, system-ui, sans-serif';
  const titleH = wrapCanvasText(ctx, activeStance ? displayName(activeStance) : 'Fingerprint', pad, titleBaseline, chartX - pad - 40, 82, 2);

  // ── Principle filter pills (if active) ──
  let descY = titleBaseline + titleH + 20;
  if (activePrincipleFilter.size > 0) {
    let pillX = pad;
    ctx.font = '600 22px Inter, system-ui, sans-serif';
    const pillPadX = 16, pillPadY = 8, pillH = 34, pillRadius = 17;
    for (const principle of activePrincipleFilter) {
      const label = principleLabel(principle);
      const pillColor = principleColors[principle] || '#8b93a7';
      const pillTextW = ctx.measureText(label).width;
      const pillW = pillTextW + pillPadX * 2;
      roundRect(ctx, pillX, descY - pillH + pillPadY, pillW, pillH, pillRadius);
      ctx.fillStyle = pillColor;
      ctx.globalAlpha = 0.15;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = pillColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = pillColor;
      ctx.fillText(label, pillX + pillPadX, descY);
      pillX += pillW + 8;
    }
    descY += pillH + 12;
  }

  // ── Description ──
  ctx.fillStyle = palette.muted;
  ctx.font = '500 30px Inter, system-ui, sans-serif';
  wrapCanvasText(ctx, activeStance?.desc || '', pad, descY, chartX - pad - 40, 42, 5);

  // ── Wheel card + chart ──
  ctx.save();
  ctx.shadowColor = palette.shadow;
  ctx.shadowBlur = 42;
  ctx.shadowOffsetY = 20;
  roundRect(ctx, chartX - 24, cardTop, SHARE_IMAGE.chartSize + 48, SHARE_IMAGE.chartSize + 48, 18);
  ctx.fillStyle = palette.panel;
  ctx.fill();
  ctx.strokeStyle = palette.panelStroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  drawFingerprintCanvas(ctx, activeStance, chartX, chartY, SHARE_IMAGE.chartSize, palette);

  // ── Attribution: bottom-right, well clear of the card ──
  ctx.textAlign = 'right';
  ctx.fillStyle = palette.muted;
  ctx.font = '600 22px Inter, system-ui, sans-serif';
  ctx.fillText('AI Collider', SHARE_IMAGE.width - pad, SHARE_IMAGE.height - 52);
  ctx.fillStyle = palette.fg;
  ctx.font = '600 22px Inter, system-ui, sans-serif';
  ctx.fillText('Rich Folsom \u00b7 aicollider.org', SHARE_IMAGE.width - pad, SHARE_IMAGE.height - 24);
  ctx.textAlign = 'left';

  return await quantizePng(canvas);
}

async function saveFingerprintPng() {
  const blob = await fingerprintPngBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fingerprintFileName();
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function copyFingerprintPng() {
  if (!navigator.clipboard || !window.ClipboardItem) {
    throw new Error('PNG clipboard copy is not available in this browser.');
  }
  const blob = await fingerprintPngBlob();
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

function setButtonBusy(button, label) {
  if (!button) return () => {};
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  return (nextLabel = original) => {
    button.disabled = false;
    button.textContent = nextLabel;
    if (nextLabel !== original) setTimeout(() => { button.textContent = original; }, 1200);
  };
}

function showArcTooltip(event, arc) {
  if (arc.level === 1) {
    showTip(event, 'L1 BAND', arc.name, arc.desc, arc.color, 'Framework band');
    return;
  }
  if (arc.level === 2) {
    const pick = hasPick(arc.row, activeStance) ? activeStance.picks[arc.row.name] : null;
    showTip(
      event,
      arc.band,
      arc.row.name,
      pick ? `Selected value: ${pick}\n\n${pickMemo(arc.row, activeStance)}` : `Silent for ${activeStance.name}.\n\n${arc.row.desc}`,
      pick ? pickColor(arc.row, activeStance) : arc.color,
      pick ? 'L2 row with selected L3 value' : 'L2 row retained as framework skeleton'
    );
    return;
  }
  const status = arc.selected
    ? 'Selected value'
    : arc.silent
      ? 'Possible value on silent row'
      : 'Possible value, not selected';
  const body = arc.selected
    ? arc.desc
    : arc.silent
      ? `Available option for ${arc.row.name}, but ${activeStance.name} is silent on this row.\n\n${arc.desc}`
      : `Available option for ${arc.row.name}; ${activeStance.name} selects "${activeStance.picks[arc.row.name]}".\n\n${arc.desc}`;
  showTip(
    event,
    principleLabel(arc.principle),
    arc.name,
    body,
    arc.color,
    `${status} \u00b7 ${activeStance.name} \u00d7 ${arc.row.name} \u00b7 ${arc.band}`
  );
}

function renderMosaic() {
  const chart = d3.select('#mosaic-chart');
  chart.selectAll('*').remove();
  if (!activeStance) return;
  const scopedRows = visibleRows(activeStance);
  const margin = { top: 42, right: 28, bottom: 24, left: 240 };
  const rowH = 13;
  const markW = 16;
  const width = margin.left + markW + margin.right;
  const height = margin.top + scopedRows.length * rowH + margin.bottom;
  const svg = chart.append('svg').attr('width', width).attr('height', height);
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  let currentBand = null;
  scopedRows.forEach((row, index) => {
    const y = index * rowH + rowH / 2;
    if (row.band !== currentBand) {
      currentBand = row.band;
      g.append('text')
        .attr('x', -margin.left + 8)
        .attr('y', index * rowH + 9)
        .attr('fill', bands.find(band => band.name === row.band)?.color || 'var(--fg-muted)')
        .attr('font-size', 8)
        .attr('font-weight', 800)
        .attr('letter-spacing', '0.1em')
        .text(row.band.toUpperCase());
    }
    g.append('text')
      .attr('x', -12)
      .attr('y', y + 3.5)
      .attr('text-anchor', 'end')
      .attr('fill', 'var(--fg-dim)')
      .attr('font-size', 9)
      .attr('font-weight', 600)
      .text(abbreviate(row.name, 32))
      .on('mouseenter', event => showTip(event, row.band, row.name, row.desc, bands.find(band => band.name === row.band)?.color))
      .on('mouseleave', hideTip);

    g.append('rect')
      .attr('x', 0)
      .attr('y', index * rowH)
      .attr('width', markW)
      .attr('height', rowH - 1)
      .attr('fill', 'var(--empty)');

    const pick = hasPick(row, activeStance) ? activeStance.picks[row.name] : null;
    if (!pick) return;
    const color = pickColor(row, activeStance);
    g.append('rect')
      .attr('x', 0)
      .attr('y', index * rowH)
      .attr('width', markW)
      .attr('height', rowH - 1)
      .attr('fill', color)
      .on('mouseenter', event => showTip(
        event,
        principleLabel(valueEntry(row, pick)?.principle),
        pick,
        pickMemo(row, activeStance),
        color,
        `Selected value \u00b7 ${activeStance.name} \u00d7 ${row.name} \u00b7 ${row.band}`
      ))
      .on('mouseleave', hideTip);
  });
}

function sortDimensionRows(sourceRows) {
  if (!dimensionSort.key && activePrincipleFilter.size === 0) return sourceRows;
  const direction = dimensionSort.direction === 'desc' ? -1 : 1;
  return [...sourceRows].sort((a, b) => {
    // When principles are selected, matching rows float to the top
    if (activePrincipleFilter.size > 0) {
      const aMatch = rowMatchesActivePrinciples(a, activeStance) ? 0 : 1;
      const bMatch = rowMatchesActivePrinciples(b, activeStance) ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
    }
    if (!dimensionSort.key) return rows.indexOf(a) - rows.indexOf(b);
    let comparison = 0;
    if (dimensionSort.key === 'category') {
      comparison = a.band.localeCompare(b.band)
        || (a.group || '').localeCompare(b.group || '')
        || a.name.localeCompare(b.name);
    }
    if (dimensionSort.key === 'principle') {
      const aPick = hasPick(a, activeStance) ? activeStance.picks[a.name] : null;
      const bPick = hasPick(b, activeStance) ? activeStance.picks[b.name] : null;
      const aPrinciple = aPick ? valueEntry(a, aPick)?.principle || 'silent' : 'silent';
      const bPrinciple = bPick ? valueEntry(b, bPick)?.principle || 'silent' : 'silent';
      comparison = principleLabel(aPrinciple).localeCompare(principleLabel(bPrinciple))
        || a.band.localeCompare(b.band)
        || a.name.localeCompare(b.name);
    }
    return comparison * direction || rows.indexOf(a) - rows.indexOf(b);
  });
}

function renderDimensionTable() {
  const holder = document.getElementById('dimension-table');
  if (!holder || !activeStance) return;
  // Table shows all rows for the display mode (including hidden ones, so users can toggle eye icons)
  const base = displayMode === 'all' ? rows : rows.filter(row => hasPick(row, activeStance));
  const scopedRows = sortDimensionRows(base);
  const sortClass = dimensionSort.direction === 'asc' ? 'asc' : 'desc';
  const hasHidden = hiddenDimensions.size > 0;
  holder.innerHTML = `
    <div class="dimension-table-header">
      <div class="dimension-cell dim-vis-cell">${hasHidden ? `<button class="dim-vis-reset" type="button" title="Show all dimensions" aria-label="Show all dimensions"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/><line x1="2" y1="2" x2="22" y2="22"/></svg></button>` : ''}</div>
      <div class="dimension-cell sortable ${dimensionSort.key === 'category' ? `active ${sortClass}` : ''}" data-sort-key="category" role="button" tabindex="0" aria-label="Sort by category">Category<span class="sort-icons" aria-hidden="true"><span class="sort-up">\u25b2</span><span class="sort-down">\u25bc</span></span></div>
      <div class="dimension-cell">Dimension</div>
      <div class="dimension-cell">Value</div>
      <div class="dimension-cell sortable ${dimensionSort.key === 'principle' ? `active ${sortClass}` : ''}" data-sort-key="principle" role="button" tabindex="0" aria-label="Sort by principle">Principle<span class="sort-icons" aria-hidden="true"><span class="sort-up">\u25b2</span><span class="sort-down">\u25bc</span></span></div>
    </div>
    <div class="dimension-table-body" role="table" aria-label="Dimensions">
      ${scopedRows.map(row => {
        const pick = hasPick(row, activeStance) ? activeStance.picks[row.name] : null;
        const value = pick ? valueEntry(row, pick) : null;
        const principle = value?.principle || '';
        const bandColor = bands.find(band => band.name === row.band)?.color || 'var(--fg-muted)';
        const color = pick ? pickColor(row, activeStance) : 'var(--fg-muted)';
        const principleColor = principle ? principleColors[principle] || color : 'var(--fg-muted)';
        const hidden = hiddenDimensions.has(row.name);
          return `
            <div class="dimension-row ${hidden ? 'dim-hidden' : ''}" data-row="${esc(row.name)}" role="row">
            <div class="dimension-cell dim-vis-cell"><button class="dim-vis-toggle" type="button" data-dim="${esc(row.name)}" title="${hidden ? 'Show' : 'Hide'} on chart" aria-label="${hidden ? 'Show' : 'Hide'} ${esc(row.name)} on chart"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${hidden ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>' : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'}</svg></button></div>
            <div class="dimension-cell"><span class="band-chip" style="--band-color:${esc(bandColor)}"></span>${esc(row.band)}</div>
            <div class="dimension-cell dimension-name">${esc(row.name)}</div>
            <div class="dimension-cell">${pick ? `<span class="value-pill" style="--pill-color:${esc(color)}">${esc(pick)}</span>` : '<span class="muted-cell">Open</span>'}</div>
            <div class="dimension-cell">${principle ? `<span class="principle-pill" data-principle="${esc(principle)}" style="--principle-color:${esc(principleColor)}">${esc(principleLabel(principle))}</span>` : '<span class="muted-cell">Silent</span>'}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
  holder.querySelectorAll('.dimension-table-header .sortable').forEach(cell => {
    const applySort = () => {
      const key = cell.dataset.sortKey;
      if (dimensionSort.key === key) {
        dimensionSort.direction = dimensionSort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        dimensionSort = { key, direction: 'asc' };
      }
      renderDimensionTable();
    };
    cell.addEventListener('click', applySort);
    cell.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      applySort();
    });
  });
  holder.querySelectorAll('.dim-vis-toggle').forEach(btn => {
    btn.addEventListener('click', event => {
      event.stopPropagation();
      const dim = btn.dataset.dim;
      if (hiddenDimensions.has(dim)) hiddenDimensions.delete(dim);
      else hiddenDimensions.add(dim);
      renderDimensionTable();
      renderFingerprint();
    });
  });
  const resetBtn = holder.querySelector('.dim-vis-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      hiddenDimensions.clear();
      renderDimensionTable();
      renderFingerprint();
    });
  }
  holder.querySelectorAll('.dimension-row').forEach(rowEl => {
    const row = rows.find(item => item.name === rowEl.dataset.row);
    if (!row) return;
    rowEl.addEventListener('mouseenter', event => {
      const pick = hasPick(row, activeStance) ? activeStance.picks[row.name] : null;
      const color = pick ? pickColor(row, activeStance) : bands.find(band => band.name === row.band)?.color;
      showTip(
        event,
        row.band,
        row.name,
        row.desc,
        color,
        pick ? `Selected value: ${pick}` : `Open dimension for ${activeStance.name}`
      );
    });
    rowEl.addEventListener('mouseleave', hideTip);
  });
  holder.querySelectorAll('.principle-pill').forEach(pill => {
    const principle = pill.dataset.principle;
    pill.addEventListener('mouseenter', event => {
      event.stopPropagation();
      showTip(
        event,
        'Principle',
        principleLabel(principle),
        principleMemo(principle),
        principleColors[principle] || 'var(--fg-muted)',
        'Strategic principle attached to this selected value'
      );
    });
  });
}

function principleRowsForActiveStance() {
  const rowsByPrinciple = new Map();
  rows.forEach(row => {
    const pick = hasPick(row, activeStance) ? activeStance.picks[row.name] : null;
    if (!pick) return;
    const principle = valueEntry(row, pick)?.principle || 'uncertainty';
    if (!rowsByPrinciple.has(principle)) rowsByPrinciple.set(principle, []);
    rowsByPrinciple.get(principle).push({ row, pick });
  });
  return rowsByPrinciple;
}

function renderPrincipleFilters() {
  const holder = document.getElementById('principle-filter-cards');
  if (!holder || !activeStance) return;
  const rowsByPrinciple = principleRowsForActiveStance();
  const subtitle = document.getElementById('dimension-subtitle');
  if (subtitle) {
    const dimensionCount = rows.filter(row => hasPick(row, activeStance)).length;
    const principleCount = rowsByPrinciple.size;
    subtitle.textContent = `${dimensionCount} dimensions encapsulating ${principleCount} ${principleCount === 1 ? 'principle' : 'principles'}.`;
  }
  const topPrinciples = [...rowsByPrinciple.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 4);
  // Prune stale selections
  for (const p of activePrincipleFilter) {
    if (!rowsByPrinciple.has(p)) activePrincipleFilter.delete(p);
  }
  holder.innerHTML = `
    ${topPrinciples.map(([principle, selectedRows]) => `
      <div class="stat-card principle-filter-card ${activePrincipleFilter.has(principle) ? 'active' : ''}" data-principle="${esc(principle)}" style="--active-color:${esc(principleColors[principle] || 'var(--fg-muted)')}">
        <strong style="color:${principleColors[principle] || 'var(--fg)'}">${selectedRows.length}</strong><span>${principleLabel(principle)}</span>
      </div>
    `).join('')}
  `;
  holder.querySelectorAll('.stat-card').forEach(card => {
    const principle = card.dataset.principle || null;
    const selectedRows = principle ? rowsByPrinciple.get(principle) || [] : [];
    card.addEventListener('click', () => {
      if (activePrincipleFilter.has(principle)) {
        activePrincipleFilter.delete(principle);
      } else {
        activePrincipleFilter.add(principle);
      }
      syncHiddenFromPrinciples();
      renderPrincipleFilters();
      renderDimensionTable();
      renderFingerprint();
    });
    if (principle) {
      card.addEventListener('mouseenter', event => showPrincipleTooltip(event, principle, selectedRows));
      card.addEventListener('mouseleave', hideTip);
    }
  });
}

function renderSummary() {
  const summary = document.getElementById('summary');
  if (!activeStance) {
    summary.innerHTML = '<div class="info-title">No stance selected</div><div>Use a hash such as <code>#rag</code> or choose a stance.</div>';
    return;
  }
  const extLink = document.body.classList.contains('embedded')
    ? `<a class="stance-ext-link" href="/${slugify(activeStance.id)}" target="_blank" aria-label="Open in new tab"><svg viewBox="0 0 512 512"><path fill="currentColor" d="M320 0c-17.7 0-32 14.3-32 32s14.3 32 32 32h82.7L201.4 265.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L448 109.3V192c0 17.7 14.3 32 32 32s32-14.3 32-32V32c0-17.7-14.3-32-32-32H320zM80 32C35.8 32 0 67.8 0 112v320c0 44.2 35.8 80 80 80h320c44.2 0 80-35.8 80-80V320c0-17.7-14.3-32-32-32s-32 14.3-32 32v112c0 8.8-7.2 16-16 16H80c-8.8 0-16-7.2-16-16V112c0-8.8 7.2-16 16-16h112c17.7 0 32-14.3 32-32s-14.3-32-32-32H80z"/></svg></a>`
    : '';
  const caveatHtml = activeStance.caveat
    ? `<div class="stance-caveat">* ${activeStance.caveat}</div>`
    : '';
  summary.innerHTML = `
    <div class="summary-head">
      ${extLink}
      <div class="stance-select-wrap">
        <label for="stance-select">Stance</label>
        <select id="stance-select" aria-label="Choose stance"></select>
      </div>
    </div>
    <div>${activeStance.desc}</div>
    ${caveatHtml}
  `;
}

function renderControls() {
  const modeHolder = document.getElementById('display-mode-buttons');
  modeHolder.innerHTML = '';
  DISPLAY_MODES.forEach(mode => {
    const button = document.createElement('button');
    button.className = 'pill';
    button.textContent = mode.label;
    button.classList.toggle('active', displayMode === mode.id);
    button.addEventListener('click', () => {
      displayMode = mode.id;
      localStorage.setItem('singleStanceDisplayMode', displayMode);
      render();
    });
    modeHolder.appendChild(button);
  });

  const holder = document.getElementById('stance-select');
  if (holder) {
    holder.innerHTML = '';
    stances.forEach(stance => {
      const option = document.createElement('option');
      option.value = stance.id;
      option.textContent = displayName(stance);
      option.selected = activeStance?.id === stance.id;
      holder.appendChild(option);
    });
    holder.onchange = () => {
      setActiveStance(stances.find(stance => stance.id === holder.value) || stances[0]);
    };
  }

  const buttonHolder = document.getElementById('stance-buttons');
  buttonHolder.innerHTML = '';
  stances.forEach(stance => {
    const button = document.createElement('button');
    button.className = 'pill';
    button.textContent = displayName(stance);
    button.classList.toggle('active', activeStance?.id === stance.id);
    button.addEventListener('click', () => setActiveStance(stance));
    buttonHolder.appendChild(button);
  });
}

function resolveHash() {
  const path = window.location.pathname.replace(/^\/|\/$/g, '');
  if (path && !path.includes('.') && !path.includes('/')) {
    const slugged = slugify(path);
    const match = stances.find(s => slugify(s.id) === slugged || slugify(s.name) === slugged);
    if (match) return match;
  }
  const target = slugify(decodeURIComponent(window.location.hash.replace(/^#/, ''))) || 'rag';
  return stances.find(stance => slugify(stance.id) === target || slugify(stance.name) === target) || stances[0];
}

function render() {
  renderSummary();
  renderControls();
  renderDimensionPanelState();
  renderPrincipleFilters();
  renderDimensionTable();
  renderFingerprint();
}

function renderDimensionPanelState() {
  const panel = document.querySelector('.dimension-panel');
  const toggle = document.getElementById('dimension-expand-toggle');
  if (!panel || !toggle) return;
  panel.classList.toggle('expanded', dimensionsExpanded);
  toggle.textContent = dimensionsExpanded ? 'Collapse' : 'Expand';
  toggle.classList.toggle('active', dimensionsExpanded);
  toggle.setAttribute('aria-expanded', String(dimensionsExpanded));
  if (document.body.classList.contains('embedded')) {
    document.body.classList.toggle('expanded', dimensionsExpanded);
  }
}


document.getElementById('theme-toggle').addEventListener('click', () => {
  lightMode = !lightMode;
  document.documentElement.dataset.theme = lightMode ? 'light' : 'dark';
  localStorage.setItem('colliderTheme', lightMode ? 'light' : 'dark');
});

document.getElementById('fingerprint-reset').addEventListener('click', resetFingerprintZoom);

document.getElementById('dimension-expand-toggle').addEventListener('click', () => {
  dimensionsExpanded = !dimensionsExpanded;
  localStorage.setItem('singleStanceDimensionsExpanded', String(dimensionsExpanded));
  renderDimensionPanelState();
});

document.getElementById('fingerprint-save').addEventListener('click', async event => {
  const done = setButtonBusy(event.currentTarget, 'Saving');
  try {
    await saveFingerprintPng();
    done('Saved');
  } catch (error) {
    console.error(error);
    done('Failed');
  }
});

document.getElementById('fingerprint-copy').addEventListener('click', async event => {
  const done = setButtonBusy(event.currentTarget, 'Copying');
  try {
    await copyFingerprintPng();
    done('Copied');
  } catch (error) {
    console.error(error);
    done('Failed');
  }
});

window.addEventListener('hashchange', () => {
  activeStance = resolveHash();
  activePrincipleFilter.clear();
  hiddenDimensions.clear();
  fingerprintAnimated = false;
  render();
});

loadFrameworkData().then(data => {
  bands = data.bands;
  rows = data.rows;
  stances = data.stances;
  principlesById = new Map((data.principles || []).map(principle => [principle.id, principle]));
  principleColors = normalisePrincipleColors(data.principleColors || data.principles || {});

  initLayoutResizer({
    min: 32, max: 68, defaultPct: 52,
    storageKey: 'singleStanceLeftPane',
  });
  if (window.self !== window.top) document.body.classList.add('embedded');
  activeStance = resolveHash();
  const cleanPath = window.location.pathname.replace(/^\/|\/$/g, '');
  if (!window.location.hash && !cleanPath && activeStance) {
    history.replaceState(null, '', `#${slugify(activeStance.id)}`);
  }
  render();
  initAboutModal({
    viewDesc: "The fingerprint shows one stance\u2019s full shape. The pattern of filled and blank cells \u2014 and where colour clusters \u2014 reveals structural priorities. Selecting a comparison overlays a second stance so you can see where two positions align or diverge."
  });
}).catch(error => {
  document.getElementById('summary').innerHTML = `<div class="info-title">Could not load data</div><div>${esc(error.message)}</div>`;
});
