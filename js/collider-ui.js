const _tooltip = d3.select('#tooltip');

function positionTooltip(event) {
  const node = _tooltip.node();
  if (!node) return;
  const pad = 12;
  const offset = 14;
  const rect = node.getBoundingClientRect();
  let left = event.clientX + offset;
  let top = event.clientY + offset;
  if (left + rect.width + pad > window.innerWidth) left = event.clientX - rect.width - offset;
  if (top + rect.height + pad > window.innerHeight) top = event.clientY - rect.height - offset;
  left = Math.max(pad, Math.min(left, window.innerWidth - rect.width - pad));
  top = Math.max(pad, Math.min(top, window.innerHeight - rect.height - pad));
  _tooltip.style('left', `${left}px`).style('top', `${top}px`);
}

function showTip(event, band, name, desc, color, meta = '') {
  _tooltip.select('.tooltip-band').text(band).style('color', color || 'var(--fg-muted)');
  _tooltip.select('.tooltip-name').text(name);
  _tooltip.select('.tooltip-meta').html(meta);
  _tooltip.select('.tooltip-desc').text(desc || '');
  _tooltip.classed('visible', true);
  positionTooltip(event);
}

function hideTip() {
  _tooltip.classed('visible', false);
}

document.addEventListener('mousemove', event => {
  if (_tooltip.classed('visible')) positionTooltip(event);
});

function initAboutModal(viewInfo) {
  const backdrop = document.getElementById('about-backdrop');
  const toggle = document.getElementById('about-toggle');
  if (!backdrop || !toggle) return;
  const modal = backdrop.querySelector('.about-modal');
  if (!modal) return;

  // Gather data from globals populated by loadFrameworkData()
  const allBands = typeof bands !== 'undefined' ? bands : [];
  const allRows = typeof rows !== 'undefined' ? rows : [];
  const allStances = typeof stances !== 'undefined' ? stances : [];
  const allPrinciples = typeof principlesById !== 'undefined' ? [...principlesById.values()] : [];

  // Pick 3 random stances to show as examples
  const exampleStances = [...allStances]
    .sort(() => Math.random() - 0.5)
    .slice(0, 3);

  // HTML helpers
  const makePill = (label, color, tip) => {
    const tipSpan = tip ? `<span class="about-pill-tip">${esc(tip)}</span>` : '';
    return `<span class="about-pill" style="--pill-color:${color}">${esc(label)}${tipSpan}</span>`;
  };
  const pColor = id => principlesById?.get(id)?.color || '#8b93a7';

  const bandPills = allBands.map(b => makePill(b.name, b.color, b.desc)).join('');
  const principlePills = allPrinciples.map(p => makePill(p.label, p.color, p.memo)).join('');
  const stancePills = exampleStances
    .map(s => makePill(s.name, '#8b93a7', s.desc)).join('');

  // Pick 3 random dimensions as examples
  const exampleDims = [...allRows].sort(() => Math.random() - 0.5).slice(0, 3);
  const dimPills = exampleDims.map(r => {
    const bandColor = allBands.find(b => b.name === r.band)?.color || '#8b93a7';
    return makePill(r.name, bandColor, r.desc);
  }).join('');

  // Helper: look up a dimension value and render as example row with tooltip
  const exampleRow = (dimName, valueName) => {
    const row = allRows.find(r => r.name === dimName);
    const entries = row ? rowValueEntries(row) : [];
    const entry = entries.find(e => e.value === valueName);
    const color = entry?.principle ? pColor(entry.principle) : '#8b93a7';
    const tip = entry?.memo || '';
    return `<div class="about-example-row"><span>${esc(dimName)}</span>${makePill(valueName, color, tip)}</div>`;
  };

  modal.innerHTML = `
    <button class="about-close" type="button" aria-label="Close">&times;</button>
    <h2>The AI Collider</h2>
    <div class="about-screens">
      <div class="about-screen active">
        <p class="about-lead">A mechanism to decompose ideas about AI into their constituent
          parts, scrutinise them in isolation, or collide them with other ideas to see where
          they align and what their crux is. It profiles AI stances — companies, regulators,
          deal structures, archetypes — across ${allRows.length} dimensions
          in ${allBands.length} bands.</p>
        <h3>${allBands.length} Bands</h3>
        <div class="about-pills">${bandPills}</div>
        <p class="about-caption">Each band groups related dimensions.</p>
        <h3>${allRows.length} Dimensions</h3>
        <p>Each band contains dimensions — specific aspects a stance can take a position on.
          A stance picks a value for each dimension it addresses, and stays silent on the
          rest. For example:</p>
        <div class="about-pills">${dimPills}</div>
        <h3>${allStances.length} Stances</h3>
        <p>A stance is a coherent position — what an entity claims, builds, or regulates.
          For example:</p>
        <div class="about-pills">${stancePills}</div>
        <h3>${allPrinciples.length} Principles</h3>
        <div class="about-pills">${principlePills}</div>
        <p class="about-caption">Each dimension value embodies a principle. Colour encodes
          the principle.</p>
        <h3>How to read it</h3>
        <p>Colour shows which principles a stance invokes. Where a stance uses
          consistent colours you see alignment; where colours contrast you see tension.
          Comparing stances reveals where they share or diverge on principles.
          Blank cells show where a stance is silent — silence is diagnostic.</p>
      </div>
      <div class="about-screen">
        <h3>What it can express</h3>
        <p>The same dimension can appear under different principles — and different stances
          can fill the same band with different colours. Cross-band interactions reveal
          structural logic:</p>
        <div class="about-examples-grid">
          <div class="about-example">
            <div class="about-example-title">One dimension, many principles</div>
            ${exampleRow('Autonomy', 'Stateless task')}
            ${exampleRow('Autonomy', 'Human-in-loop')}
            ${exampleRow('Autonomy', 'Self-directed')}
          </div>
          <div class="about-example">
            <div class="about-example-title">Land Grab — Rights band</div>
            ${exampleRow('Permission', 'Excluded')}
            ${exampleRow('Regulatory Posture', 'Permissive')}
            ${exampleRow('Model-Weight Rights', 'Hosted only')}
          </div>
        </div>
      </div>
      <div class="about-screen">
        <h3>Why this exists</h3>
        <p>Most analysis of AI arrangements stays in one lane — legal, technical, or
          financial. AI Collider shows how dimensions interact across lanes. A rights
          choice creates an infrastructure requirement that creates a capital commitment.
          The colour and space IS the analysis.</p>
        <h3>This view</h3>
        <p>${esc(viewInfo.viewDesc)}</p>
        <h3>Who made this?</h3>
        <p>AI Collider was built by <a href="https://fo.ls">Rich Folsom</a>,
          a technology lawyer at <a href="https://www.simmons-simmons.com/en/people/cluwhlpfr00nsuatc1vwv7d3k/rich-folsom">Simmons &amp; Simmons</a>.</p>
      </div>
    </div>
    <div class="about-nav">
      <button class="about-nav-arrow about-nav-prev" type="button" aria-label="Previous" disabled></button>
      <span class="about-nav-dot active"></span>
      <span class="about-nav-dot"></span>
      <span class="about-nav-dot"></span>
      <button class="about-nav-arrow about-nav-next" type="button" aria-label="Next"></button>
    </div>`;

  // Pill tooltips: reparent to backdrop so they escape modal overflow clipping
  const floatingTip = document.createElement('div');
  floatingTip.className = 'about-pill-tip';
  backdrop.appendChild(floatingTip);

  backdrop.addEventListener('mouseover', e => {
    const pill = e.target.closest('.about-pill');
    if (!pill) { floatingTip.style.display = 'none'; return; }
    const tipText = pill.querySelector('.about-pill-tip');
    if (!tipText) { floatingTip.style.display = 'none'; return; }
    floatingTip.textContent = tipText.textContent;
    const pr = pill.getBoundingClientRect();
    const br = backdrop.getBoundingClientRect();
    floatingTip.style.left = `${pr.left - br.left + pr.width / 2}px`;
    floatingTip.style.top = `${pr.top - br.top - 8}px`;
    floatingTip.style.display = 'block';
  });

  backdrop.addEventListener('mouseout', e => {
    if (!e.relatedTarget?.closest('.about-pill')) floatingTip.style.display = 'none';
  });

  // Wire up events after building DOM
  const closeBtn = modal.querySelector('.about-close');
  const aboutScreens = modal.querySelectorAll('.about-screen');
  const aboutDots = modal.querySelectorAll('.about-nav-dot');
  const prevBtn = modal.querySelector('.about-nav-prev');
  const nextBtn = modal.querySelector('.about-nav-next');
  let currentScreen = 0;

  function showScreen(i) {
    currentScreen = Math.max(0, Math.min(aboutScreens.length - 1, i));
    aboutScreens.forEach((s, j) => s.classList.toggle('active', j === currentScreen));
    aboutDots.forEach((d, j) => d.classList.toggle('active', j === currentScreen));
    if (prevBtn) prevBtn.disabled = currentScreen === 0;
    if (nextBtn) nextBtn.disabled = currentScreen === aboutScreens.length - 1;
  }

  const openModal = () => { backdrop.classList.add('visible'); showScreen(0); };
  const dismiss = () => {
    backdrop.classList.remove('visible');
    localStorage.setItem('colliderAboutDismissed', '1');
  };

  toggle.addEventListener('click', openModal);
  closeBtn?.addEventListener('click', dismiss);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) dismiss(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && backdrop.classList.contains('visible')) dismiss();
  });
  prevBtn?.addEventListener('click', () => showScreen(currentScreen - 1));
  nextBtn?.addEventListener('click', () => showScreen(currentScreen + 1));
  aboutDots.forEach((d, i) => d.addEventListener('click', () => showScreen(i)));

  if (!localStorage.getItem('colliderAboutDismissed')) openModal();
}

function initLayoutResizer({ min, max, defaultPct, storageKey, onResize }) {
  const resizer = document.getElementById('layout-resizer');
  const layout = document.querySelector('main');
  if (!resizer || !layout) return;
  let resizeFrame = null;
  const scheduleResize = onResize ? () => {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => { resizeFrame = null; onResize(); });
  } : null;

  const setSplitFromClientX = clientX => {
    const rect = layout.getBoundingClientRect();
    if (!rect.width) return;
    const raw = ((clientX - rect.left) / rect.width) * 100;
    const next = Math.min(max, Math.max(min, raw));
    document.documentElement.style.setProperty('--left-pane', `${next}%`);
    localStorage.setItem(storageKey, next.toFixed(1));
    if (scheduleResize) scheduleResize();
  };

  const stopDrag = () => {
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', stopDrag);
    window.removeEventListener('pointercancel', stopDrag);
  };

  const onMove = event => {
    event.preventDefault();
    setSplitFromClientX(event.clientX);
  };

  resizer.addEventListener('pointerdown', event => {
    event.preventDefault();
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    resizer.setPointerCapture?.(event.pointerId);
    setSplitFromClientX(event.clientX);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
  });

  resizer.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--left-pane')) || defaultPct;
    const next = event.key === 'Home' ? min : event.key === 'End' ? max : current + (event.key === 'ArrowLeft' ? -2 : 2);
    const clamped = Math.min(max, Math.max(min, next));
    document.documentElement.style.setProperty('--left-pane', `${clamped}%`);
    localStorage.setItem(storageKey, clamped.toFixed(1));
    if (scheduleResize) scheduleResize();
  });
}
