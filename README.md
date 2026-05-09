# AI Collider

A visual diagnostic framework for understanding AI data arrangements. Each *stance* — a company, a regulator, a deal structure, an archetype — is profiled across 72 dimensions spanning capability, agency, rights, system architecture, supply chain, assurance, exposure, and value.

Live at **[aicollider.org](https://aicollider.org)**.

## Two views

**Mosaic** (`index.html`) — compare multiple stances side-by-side. Each column is a stance, each row is a dimension. The strip of colour IS the comparison: patterns that match share a shape; patterns that diverge show it instantly.

**Single Stance** (`stance.html`) — inspect one stance as a fingerprint chart across the full grammar. The pattern of filled and blank cells — and where colour clusters — reveals the stance's structural priorities.

## How the visual encoding works

**Colour** encodes the underlying principle: openness, control, extraction, sovereignty, containment, and so on. Fourteen principles cut across all eight bands. When a value has no principle, colour falls back to a positional gradient based on dimension type (spectrum, threshold, or topology).

**Blank cells** mean the stance is silent on that dimension. Silence is diagnostic — it shows where claims stop.

**Grid** is the comparison. The mosaic is a table — rows are dimensions, columns are stances. Each cell is a coloured block. Reading across a row compares how different stances treat the same dimension; reading down a column shows one stance's full profile. Matching colours on the same row mean shared principles; different colours show where the driving logic diverges.

**Fingerprint** is the single-stance view. A radial chart where each dimension is a wedge grouped by band. The filled arc shows where the stance sits in the value range; the colour shows the principle. Gaps are dimensions the stance is silent on.

## Dataset

The framework data lives in `data/`:

- **8 bands** — Capability, Agency, Rights, System, Supply, Assurance, Exposure, Value
- **72 dimensions** across 330 value positions
- **38 stances** — companies, regulators, deal structures, archetypes
- **21 comparisons** — curated pairings that make specific analytical points
- **14 principles** — cross-cutting categories that colour-code values across all bands

## Project structure

```
index.html               Mosaic (multi-stance comparison) view
stance.html              Single-stance fingerprint view
css/
  collider.css            Shared styles — theme variables, layout, panels, tooltip, modal
  mosaic.css              Mosaic-specific styles
  stance.css              Stance-specific styles
js/
  collider-data.js        Data loader — JSONC parser, normalisation, helpers
  collider-ui.js          Shared UI — tooltip positioning, layout resizer, about modal
  mosaic.js               Mosaic view logic
  stance.js               Stance view logic
data/
  framework.jsonc         Framework — bands, dimensions, values, principles
  comparisons.jsonc       Curated comparison entries
  stances/_index.json     Ordered list of stance IDs
  stances/*.jsonc         Individual stance files
```

## License

[CC-BY-SA 4.0](LICENSE)
