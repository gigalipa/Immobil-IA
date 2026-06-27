# Immobil-IA ONNX model contract

These ONNX files are deterministic baseline models for local inference. They
encode the current Rust scoring formulas as small linear graphs so the runtime
contract can be integrated before a real HITL training set exists.

All input values are expected as `float32` in the range `0..1`. Scores are
returned as `float32` in the range `0..100`.

## Common runtime contract

- Input name: `input`
- Output name: `scores`
- Batch shape: fixed batch size `1`
- Output order:
  0. `gps`
  1. `visual`
  2. `features`
  3. `confidence`

The graphs use only common ONNX operators: `MatMul`, `Add`, `Clip`, and
`Concat`.

## `models/post_comparer.onnx`

Objective: decide if two posts represent the same property.

Input shape: `float32[1, 12]`

Feature order:

| Index | Name | Expected normalization |
| --- | --- | --- |
| 0 | `distanceKmNormalized` | `0` means same point, `1` means far enough to be treated as unrelated. A good first mapping is `min(distance_km * 0.35, 1.0)`, matching the Rust `100 - distance_km * 35` rule. |
| 1 | `sameZone` | `1` same/contained normalized zone, `0` different zone. |
| 2 | `priceSimilarity` | `1` same price, `0` outside accepted tolerance. |
| 3 | `areaSimilarity` | `1` same area, `0` outside accepted tolerance. |
| 4 | `roomSimilarity` | `1` same room count, `0.65` one room apart, `0.2` otherwise, `0.5` unknown. |
| 5 | `titleTextSimilarity` | Jaccard/embedding similarity normalized to `0..1`. |
| 6 | `locationTextSimilarity` | Location text similarity normalized to `0..1`. |
| 7 | `ownerPhoneMatch` | `1` same normalized phone, `0` otherwise. |
| 8 | `ownerNameSimilarity` | Owner/name similarity normalized to `0..1`. |
| 9 | `imageAvailableBoth` | `1` both posts have an image, `0` otherwise. |
| 10 | `sourceReliabilityA` | Source reliability normalized to `0..1`. |
| 11 | `sourceReliabilityB` | Source reliability normalized to `0..1`. |

Baseline formula:

```text
gps = clip(100 - 100 * distanceKmNormalized, 0, 100)
visual = clip(
  45
  + 43 * ownerPhoneMatch
  + 12 * ownerNameSimilarity
  + 17 * imageAvailableBoth
  + 4 * sourceReliabilityA
  + 4 * sourceReliabilityB,
  0,
  100
)
features = clip(
  20 * sameZone
  + 20 * priceSimilarity
  + 18 * areaSimilarity
  + 16 * roomSimilarity
  + 18 * titleTextSimilarity
  + 8 * locationTextSimilarity,
  0,
  100
)
confidence = clip(0.30 * gps + 0.40 * visual + 0.30 * features, 0, 100)
```

This is intentionally aggressive for duplicate detection: strong owner or image
signals can push a pair into human review even when text is imperfect.

## `models/matchmaker.onnx`

Objective: estimate if a lead should receive a consolidated property suggestion.

Input shape: `float32[1, 14]`

Feature order:

| Index | Name | Expected normalization |
| --- | --- | --- |
| 0 | `locationSimilarity` | Location affinity normalized to `0..1`. |
| 1 | `budgetFit` | `1` budget covers price, lower values represent shortfall. |
| 2 | `transactionIntentMatch` | `1` rent-vs-sale intent matches, `0` conflict, middle values unknown. |
| 3 | `leadPropertyTextSimilarity` | Lead/property text similarity normalized to `0..1`. |
| 4 | `roomFit` | Requested rooms vs property rooms normalized to `0..1`. |
| 5 | `areaFit` | Requested area vs property area normalized to `0..1`. |
| 6 | `leadHasPhone` | `1` phone present, `0` missing. |
| 7 | `leadHasEmail` | `1` email present, `0` missing. |
| 8 | `propertyHasOwnerPhone` | `1` owner phone present, `0` missing. |
| 9 | `propertyHasOwnerEmail` | `1` owner email present, `0` missing. |
| 10 | `propertyPublicationCountNormalized` | Publication count confidence, for example `min(count / 4, 1)`. |
| 11 | `propertyCertaintyNormalized` | Consolidation certainty normalized to `0..1`. |
| 12 | `priceNormalized` | Market-relative price, `0` low to `1` high. |
| 13 | `budgetNormalized` | Market-relative budget, `0` low to `1` high. |

Baseline formula:

```text
gps = clip(100 * locationSimilarity, 0, 100)
visual = clip(
  100 * (
    0.30 * transactionIntentMatch
    + 0.15 * leadHasPhone
    + 0.10 * leadHasEmail
    + 0.15 * propertyHasOwnerPhone
    + 0.10 * propertyHasOwnerEmail
    + 0.10 * propertyPublicationCountNormalized
    + 0.10 * propertyCertaintyNormalized
  ),
  0,
  100
)
features = clip(
  2.5
  + 30 * budgetFit
  + 25 * leadPropertyTextSimilarity
  + 20 * roomFit
  + 15 * areaFit
  + 5 * propertyCertaintyNormalized
  + 5 * propertyPublicationCountNormalized
  - 2.5 * priceNormalized
  + 2.5 * budgetNormalized,
  0,
  100
)
confidence = clip(0.30 * gps + 0.25 * visual + 0.45 * features, 0, 100)
```

This is intentionally more conservative than `PostComparer`: preference fit and
contact/data quality matter more because false-positive lead suggestions are
costlier for the agent.

## Replacing with trained models later

Keep the same input/output names, shapes, and score order when replacing these
baselines. A trained model can add hidden layers or tree-derived logic as long
as the runtime contract stays stable.
