# Dose gate audit, phase 2-3 (2026-10-12)

Plan: `docs/plans/active/Audit_actions.md` (main checkout, untracked). Branch `feat/sentrapedia-dify-theoracle`, gate at `0a708b4e`.
Status: **REQUIRES FURTHER CORRECTION.** Classification done offline; no gate or retrieval code changed; live baseline and the 10-disease benchmark not done.

## 1. Data and method

- **Live baseline failed twice** (paid, about $0.29 in total). Run 1: 18/61 cases ok; run 2: 12/61 (`live-attempt-2-targeted.*`). In both, the MIRA API-error breaker opened after consecutive provider errors and paused model calls for 60 s; the rest of the run failed in 1-3 ms (`API_ERRORS` 503, then `SERVICE` 502). The breaker also counts failed parallel copies of a request that succeeded. The provider error type is not logged (`engine.py` keeps only the exception class name in a swallowed `StepFailed`). The same eval ran 61/61 on 2026-10-11. Gaffer chose to continue offline.
- **Offline replay** (`.runtime/audit/`, git-ignored): `extract.py` takes the 122 eval replies from `audit-2026-10-11.jsonl` with the bundle sent to each call; `replay.test.ts` runs the HEAD `gateTherapy` on them. It reproduces the PIPELINE-REPORT counts exactly: **42 verified on both paths** (legacy 42 / 14 dose removed / 9 removed; targeted 42 / 27 / 2).
- Per drug the replay also runs the gate (a) with every passage forced "about" the diagnosis and (b) with the diagnosis bundle added to the therapy bundle. `corpus_scan.py` then searches all 20,465 TheOracle chunks for passages naming the drug and the diagnosis. Each row was read by hand: `classification-targeted.json`.
- The plan's baseline (39 verified / 30 without dose) predates later gate commits. On the same replies the targeted path now has 42 verified, 27 drugs with the dose removed, and 2 drugs removed (29 non-verified).

## 2. The 29 non-verified targeted drugs

| Cat. | Meaning | n | Gate right? | Rows |
|---|---|---:|---|---|
| A | Source genuinely has no dose | 5 | yes | H1 antihistamine class (urticaria), parasetamol (varicella), losion kalamin, ceramide, ambroxol (COPD) |
| B | Dose exists, retrieval did not bring it | 3 | **no** | metformin 500 mg (PAPDI 2024 chunk not retrieved); tenofovir 300 mg and amoxicillin-clavulanate (verify with the diagnosis bundle, which the targeted gate does not read) |
| C | Retrieved, parsing failed | 0 | - | - |
| D | Parsed, validation rejected a correct dose | 6 | **no** | betahistin 6 mg x2, sertralin 25 mg, diazepam 2 mg (single value inside a source range "6-12 mg", "25-50 mg", "2-5 mg"); efavirenz 600 mg (passage says ODHA/antiretroviral, not HIV); chlorpheniramine (spelling, below) |
| E | Needs patient context | 2 | yes | deferasiroks 250 mg, deferipron 500 mg: tablet strengths for weight-based chelation, no weight in the case |
| F | Indication unsupported | 1 | yes | flukonazol 50 mg for pityriasis versicolor, from an azole list for other mycoses |
| G | Specialist or individualized | 1 | yes | albumin in sepsis; duration and note copied from a FORNAS burns restriction |
| H1 | Model wrote a regimen the source does not state | 6 | yes | diosmin/hesperidin x4 (one tablet's content written as the dose; source: 3 x 2 tablet), amoksisilin 2 x 250 mg for OMA (source: 3 x 500 mg adult or 80-90 mg/kgBB/day child), prednisone 30 mg up to 2 weeks for COPD (sources: 40 mg/day for 5 days) |
| H2 | Model wrote no amount ("1x", "2-3x") although the source states one | 5 | yes (nothing to verify) | salbutamol, aminofilin (COPD), adrenalin 1:10.000, lidokain 2% (in the note), mupirosin (2% omitted) |

**20 of 29 are correct blocks; 9 (B 3, D 6) are correct doses the pipeline failed to show.**

Confirmed defect, not in the plan: `spell()` in `theoracle-evidence-gate.ts` turns "ch" into "kh", so English names never match Indonesian ones: chlorpheniramine -> `khlorfeniramin` vs `klorfeniramin` (also chloramphenicol, chlorhexidine, hydrochlorothiazide). The drug is removed as "no passage names it".

Secondary finding: haemorrhoids are coded I84.9 with the English label, while the catalog lists hemoroid under K64, so no hemoroid passage counts as "about" the diagnosis. It made no difference here (the tablet-content rule already blocks the four rows), but it would block a correct dose.

## 3. Phase 3: the 42 verified targeted doses

Every verified number occurs in a passage that names the drug and the diagnosis; no fabricated or unsupported number was found. The weaknesses are of the design, not of the regex:

1. **A concentration counts as a dose.** budesonid "0.25 mg/mL" for asthma (FORNAS nebule strength), with no amount per administration.
2. **A formulation strength counts as a regimen.** FORNAS lists verify olanzapin 5 mg, fosfomisin 3 g, timolol 0.25%; the numbers fit usual doses here, but the cited text is a strength list.
3. **Frequency and duration in `dose` are not checked.** kloramfenikol "1x1 tetes" verifies against "1 tetes setiap 2-4 jam".
4. **Population and context are not checked.** Isoniazid 300 mg and pirazinamid 1.5 g cite renal-impairment and MDR weight-band tables; asiklovir 4 x 20 mg/kgBB is the child form for a case without an age.

## 4. Proposed corrections (none applied; each needs Gaffer's go)

| # | Change | Target | Expected effect on the replay | Risk |
|---|---|---|---|---|
| 1 | `spell`: "ch" -> "k" before the "c" rules | gate | chlorpheniramine removed -> dose removed (its 3 x 4 mg chunk was not retrieved) | Low |
| 2 | Targeted gate reads therapy bundle + diagnosis bundle | gateway, gate call only | +2 verified (tenofovir, amoxicillin-clavulanate) | Low: same passage rules |
| 3 | A single model strength inside a source range of the same unit and per-kg status verifies | gate | +4 verified (betahistin x2, sertralin, diazepam) | Medium: needs tests that a range in another clause or for another drug does not count |
| 4 | Diagnosis synonyms (ODHA = HIV; hemoroid = haemorrhoids, I84 = K64) | gate | +1 (efavirenz) | Medium: a word list to maintain |
| 5 | Therapy prompt: `dose` must hold the amount or concentration | MIRA prompt (pinned in `SOURCE.json`) | Fewer H2 rows on new replies; no replay effect | Medium: engine change, live eval needed |
| 6 | Breaker counts one failure per request, not per parallel copy; log the provider error type | MIRA engine | Unblocks the live eval | Low-medium: engine change |

Changes 1-3 together would take the replay from 42 to an expected 48 verified on the targeted path, with no relaxed rule for a passage about another disease. Retrieval for metformin (B) and the design limits in section 3 need a separate decision.

## 5. Not done

- Phase 2 live reproduction (blocked by the breaker; see change 6).
- Phase 4, the 10-disease external benchmark (needs web research).
- Phase 6: no new measurement. The 2026-10-11 report already attributes the latency rise to the second MIRA call (`mira_tx` p50 about 2.0 s); today's partial runs agree (p50 4.7 s).
