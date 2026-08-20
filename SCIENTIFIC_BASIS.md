# Scientific Basis for Carbon Calculator Emission Factors

This document explains every emission factor used by the Carbon Calculator, in
enough detail to defend each number in a viva or cite it in the report's
methodology section. The source data lives in
`Backend/src/data/scientificEmissionFactors.js` — this document and that file
should be read together; if they ever disagree, the code is authoritative and
this file needs updating.

## 1. Standards used, and why

| Standard | Body | Used for |
|---|---|---|
| GHG Protocol Corporate Standard | WRI / WBCSD | Overall accounting framework — Scope 1/2/3 boundaries, the concept of an "emission factor" itself |
| IPCC 2006 Guidelines for National GHG Inventories, Vol. 2 (Energy) | IPCC | Default fuel combustion factors (petrol, CNG) used to derive two-wheeler and auto-rickshaw figures |
| 2024 Government GHG Conversion Factors for Company Reporting | UK DEFRA / DESNZ | Car, bus, and rail transport factors — the most widely used, publicly documented, annually-updated transport factor set in the world |
| CO2 Baseline Database, Version 21.0 | CEA (Central Electricity Authority, Government of India) | India's official electricity grid emission factor, also the basis for India's Scope 2 reporting and its carbon market (CCTS) |
| Poore & Nemecek (2018), *Science* 360(6392) | Peer-reviewed | Food emission factors — the largest meta-analysis of global food-system LCA data ever conducted (1,530 studies screened, 570 included, 38,000+ farms across 119 countries) |

We deliberately use an international-standard body (DEFRA) for transport
rather than an India-specific one, because **no official India passenger
transport emission factor database exists** covering the granularity this
app needs (per-mode, per-passenger-km). DEFRA's dataset is public, versioned,
and the closest thing to an international default; two categories where an
India-specific number matters more than an international default — grid
electricity, and India-only vehicle types (two-wheelers, auto-rickshaws) — use
Indian data or an India-calibrated derivation instead.

## 2. Transport

### Directly published (no derivation needed)
- **Petrol car**: 170 gCO2e/passenger-km — DEFRA 2024, average petrol car.
- **Diesel car**: 168 gCO2e/passenger-km — DEFRA 2024, average diesel car.
- **Rail/Metro**: 35.46 gCO2e/passenger-km — DEFRA 2024, National Rail.
- **Bus**: 96 gCO2e/passenger-km — DEFRA 2024, average local bus. **Caveat**:
  Indian buses typically run at higher occupancy than the UK fleet this figure
  is based on, which would lower the true India per-passenger figure. No
  official India bus passenger-km factor is published, so this is used as a
  documented, conservative proxy rather than an invented adjustment.

### Derived (calculation shown, not directly published)
Two-wheelers and CNG auto-rickshaws are not part of DEFRA's dataset (they're
not common in the UK), so their figures are derived from IPCC's default fuel
combustion factors combined with representative India fuel-economy figures:

- **IPCC default combustion factors** (2006 Guidelines, Vol. 2, Table 1.4):
  - Petrol (motor gasoline): 2.31 kg CO2 per litre burned
  - CNG: 2.68 kg CO2 per kg burned

- **Two-wheeler**: 2.31 kgCO2/L ÷ 45 km/L (typical India commuter scooter/
  motorcycle fuel economy) ≈ **51 gCO2e/km**
- **Auto-rickshaw**: 2.68 kgCO2/kg ÷ 28 km/kg CNG (typical fuel economy) ÷ 1.5
  (typical occupancy — rickshaws are usually shared or run with 1-2 riders)
  ≈ **64 gCO2e/passenger-km**
- **CNG car**: 2.68 kgCO2/kg ÷ 20 km/kg (typical India CNG hatchback/sedan
  fuel economy) ≈ **134 gCO2e/km**

These are labeled "derived" throughout the code and UI, distinct from the
directly-published DEFRA figures, so nobody mistakes a calculated estimate
for an official published statistic.

### Electric vehicles — never a fixed number
EV emissions are **not** a static factor. They're computed at request time as:

```
gCO2e/km = (energy consumption in kWh/km) × (grid emission factor for the user's region)
```

Energy consumption is assumed at 150 Wh/km (representative of the compact EV
segment popular in India, ~15 kWh/100km). The grid factor is the CEA figure
below. This is why EVs are never treated as zero-emission in this app — their
true footprint depends entirely on how the electricity was generated.

## 3. Electricity — the India grid factor

**710 gCO2e/kWh** — CEA CO2 Baseline Database, Version 21.0, Weighted Average
Emission Factor (WAEF) for FY 2024-25. This is the official consumption-side
(Scope 2) grid factor published by India's Central Electricity Authority, and
the same figure used in India's national carbon market (CCTS) for Scope 2
accounting.

CEA publishes three variants — WAEF, Operating Margin (OM), and Build Margin
(CM/BM, used for offset-project baselines). **WAEF is the correct choice**
for an individual calculating their own consumption footprint; OM/BM exist
for a different purpose (crediting new generation capacity against a
counterfactual).

**On state-level factors**: India's grid has been a largely unified,
interconnected national system since the "one nation, one grid" reform, and
CEA does not publish separate state-level consumption factors. Every Indian
region in this app (Punjab, Delhi, Maharashtra, Karnataka, Tamil Nadu) is
therefore mapped to the same national WAEF. This is stated explicitly in the
data file rather than presenting an invented state-specific number as if it
were official.

## 4. Food

Base figures are global-average kg CO2e per kg of product from Poore &
Nemecek (2018), as reported in the original paper and its very widely-used
secondary presentation by Our World in Data (the standard reference point
most food-carbon tools, including several GHG Protocol-aligned calculators,
draw on).

| Category | Reference food | kg CO2e / kg | Assumed serving |
|---|---|---|---|
| Red meat | Beef, global average | 60 | 200 g |
| Dairy-heavy | Cheese, global average | 21 | 100 g |
| Poultry | Chicken, global average | 6 | 200 g |
| Fish | Farmed fish, global average | 5 | 200 g |
| Vegetarian meal | Mixed vegetables, global average | 2 | 350 g |
| Vegan meal | Legumes/pulses, global average | 1 | 350 g |

The per-kg figures are the directly published Poore & Nemecek numbers. The
**serving masses are a documented assumption**, not published data — chosen
to represent a realistic single meal/portion for each category, so the
per-serving number the app shows is a transparent calculation
(`kg/kg figure × serving mass`), not an unsourced "per serving" statistic.

**Known limitation, stated plainly**: Poore & Nemecek's figures are *global
averages* across production systems and geographies. India-specific
agricultural footprints (irrigation-heavy rice paddies, dairy-heavy diets,
different livestock feed systems) will differ from the global average in both
directions. A global average was used because no equivalently comprehensive
India-specific food-LCA meta-analysis exists at the time of writing. This is
exactly the kind of caveat worth stating directly in a viva if asked.

## 5. Consumption / goods

No standard body publishes per-item factors the way DEFRA does for
transport — a "clothing item" or "phone" varies too much by type and
manufacturing origin for a single official number to exist. These figures are
labeled **indicative** throughout the code and UI, and are the midpoint of
published LCA-aggregate ranges:

| Category | Estimate | Basis |
|---|---|---|
| Clothing item | 10 kg CO2e | Midpoint of WRAP / Ellen MacArthur Foundation cotton-garment LCA aggregates (~8-12 kg) |
| Small electronics | 55 kg CO2e | Midpoint of manufacturer environmental-report ranges for smartphones (~50-60 kg) |
| Large electronics | 200 kg CO2e | Midpoint of manufacturer LCA reports for laptops (~180-220 kg) |
| Household goods | 15 kg CO2e | General durable-goods LCA aggregate midpoint |
| Packaging waste | 0.5 kg CO2e / kg | Generic mixed packaging waste-stream estimate |

## 6. What to say if asked "why isn't X more precise"

The honest answer, consistent across every category above: **precision costs
data availability**. DEFRA's transport figures are precise because DEFRA
publishes fleet-composition-weighted averages annually from real UK transport
statistics. CEA's grid figure is precise because it's computed from every
grid-connected power station's actual generation and fuel mix. Food and
consumption figures are less precise because the underlying activity (what
specific beef, whose phone, made how) varies enormously and no equivalent
national/official dataset exists at that granularity — so the most defensible
approach is to use the best available published meta-analysis (food) or a
transparent midpoint-of-range estimate (consumption), and say so, rather than
presenting invented false precision.
