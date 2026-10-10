# Topic-to-agent delegation matrix

Status, 9 October 2026: per-topic chapter diagram work is paused. This matrix is the topic checklist. Do not assign packets or claim rows.

Version: **2026 syllabi / 2 October 2026**. This is a documentation-only topic checklist. It starts no implementation work and certifies no new engine behaviour. `DIAGRAM_ENGINE_COVERAGE_PLAN.md` at the repository root keeps the historical 34-chapter priority queue and DCP-01 to DCP-12 backlog.

## Coordinator dispatch (historical, paused 9 October 2026)

The steps below describe how packets were dispatched from 2 to 9 October 2026. They are kept as a record; do not use them to assign new work. Ledger state lives in the [topic tracker](progress.md). The allocation tables below remain planning data; accepted counts are maintained separately.

The assignment CSVs' `current_evidence` fields record the initial planning snapshot. Live acceptance belongs to `topic-progress.csv`, the packet logs and the reconciled chapter counters; an old planning-snapshot warning must not overwrite later accepted evidence.

1. Select the next chapter from the root priority queue and the exam scope. Read the chapter allocation below, then only that subject's Markdown/CSV. The detailed topic rows control the scope of a packet; broad root descriptions are summaries.
2. Establish the accepted S0 evaluation/source-obligation contract and the packet's dependencies. Treat the curated Biology reference contract as a separate prerequisite owned by the Biology reviewer with the integration owner, not something inherited automatically from a chemistry graph.
3. Assign the packet's exact topic IDs and source/variant limits using the root plan's assignment template. A packet is an ownership boundary, not a promise that every compound row fits one session. Sub-assign specific named models, organisms or variants when needed; the original primary owner retains the remaining obligations, and partial completion never closes its whole topic row.
4. Audit candidate reuse before new implementation. The integration owner serializes shared compiler/IR/capability/planner changes; workers own disjoint modules and gates. Packet IDs are human planning identifiers, not runtime routers, chapter templates or question-ID dispatch keys.
5. Accept only row-level evidence for the selected variants plus negative/holdout, live reveal, persistence and replay gates in the root contract. Report full checklist allocation separately from evaluated/passing topics and passing diagram-required questions. DSA and Main Paper 2/AAT remain outside this plan.

## Catalogs and denominator boundaries

CSV is the authoritative row-level assignment data; Markdown is the human reading view. Every CSV row has exactly one primary packet, scope per exam, source references, proposed diagram need, current evidence, candidate reuse, required variants, independent checks and dependencies. Percentages are recomputable from integer assignments below; round-off may make displayed packet percentages sum to 99.9% or 100.1%.

| Catalog | Data | Assigned rows | Boundary |
| --- | --- | --- | --- |
| [Mathematics](maths.md) | [maths.csv](maths.csv) | 179/179 = 100% | Exact 179 primary taxonomy IDs / 14 units; NEET not applicable. |
| [Physics](physics.md) | [physics.csv](physics.csv) | 342/342 = 100% | Exact 342 primary taxonomy IDs / 20 units. |
| [Chemistry](chemistry.md) | [chemistry.csv](chemistry.csv) | 132/132 = 100% | Exact 132 primary taxonomy IDs / 20 units; Advanced scope stays in these rows where it overlaps. |
| [NEET Biology](biology.md) | [biology.csv](biology.csv) | 189/189 = 100% | Editorial checklist across all ten official units; not an admin taxonomy or an official NTA topic count. |
| [Advanced extra Chemistry](advanced-extra.md) | [advanced-extra.csv](advanced-extra.csv) | 41/41 = 100% | Editorial checklist across seven CA groups/nine extra headings; overlaps nine supplemental macro IDs. |
| [Supplemental taxonomy](supplemental.md) | [supplemental.csv](supplemental.csv) | 13/13 = 100% | Exact 13 supplemental topic IDs: 3 Mathematics, 1 Physics, 9 Chemistry; kept outside primary denominators. |

Primary taxonomy completeness is **653/653 = 100% assigned**. Including the separate supplemental catalog, all **666/666 existing taxonomy IDs** are preserved exactly once. This proves assignment completeness at the repository's declared grain, not an official atomic-topic count or measured diagram accuracy. Biology and Advanced editorial totals use different grains and are not added to that taxonomy percentage.

A broad source/taxonomy row may contain many named compounds, cases or organisms. Its required variants and acceptance tests remain obligations even though it counts as one row. The subject reviewer must approve the editorial grain and any mixed `review` scope before freezing an exam evaluation. Official headings, teaching applications and optional legacy subjects are deliberately distinguishable; this matrix does not convert broad syllabus wording into a falsely precise official topic count.

The nine supplemental Chemistry macro rows and the Advanced-extra children represent the same extra chapter scope at different grains. Dispatch detailed CA children for named Advanced work; keep the exact macro IDs for taxonomy traceability, and close a macro only after its selected listed children are evidenced or its unlisted aliases explicitly resolved. Catalysis/practical sols and primary-unit polymerization overlaps are owned by primary C packets, not counted again as new exam coverage.

## Scope and evidence conventions

| Value | Meaning and counting rule |
| --- | --- |
| `listed` | The concept is explicitly named by the cited 2026 source. Variants still require the stated depth/model limits. |
| `application` | A supported application of a listed concept, not a separately quoted official heading. Freeze whether and how the exam denominator includes it. |
| `supplemental` | An unlisted standalone or optional historical extension. Visible and assigned, but outside the selected official baseline unless separately approved. |
| `review` | A mixed/ambiguous source row whose exact exam boundary needs editorial resolution before denominator freeze. It is not an implementation pass. |
| `not_applicable` | The subject is absent from this exam, such as Maths in NEET or Biology in JEE. |
| `required` / `conditional` / `text_only` | Planning hypotheses for diagram need, not syllabus rules or a way to exclude failed visuals. Confirm independently against source questions before evaluation. |
| `topic audit pending` | The planning-snapshot evidence status in the subject CSVs. Historical operator fractions do not identify topic-level passes; implemented topic coverage is unknown, not zero and not the allocation percentage. Live state is in `topic-progress.csv`, where 13 rows are `accepted` (Chemistry Atomic Structure 6/6 and Chemical Bonding 7/7). |

### Separate allocation from future acceptance

- **Packet allocation share** = unique assigned checklist rows in the packet / all checklist rows in that chapter. It is an intended ownership share, not expected incremental diagram gain; topics can share operators and one topic can need multiple independent variants.
- **Combined chapter allocation** = union of packet-assigned topic IDs / chapter checklist denominator. It is 100% here because every row has an owner, including pending and supplemental rows.
- **Accepted topic completion** later counts a row only when all frozen obligations for that topic have evidence. A single draw, a successful family smoke test or a candidate module name cannot close a compound row. Preserve the full chapter denominator and report exam-specific scope exclusions separately.
- **Question-level visual coverage** later uses the independently frozen diagram-required source cohort: verified exact/qualitative results and independently compiled honest representations are reported by tier; relevance, proofs, numeric authority, labels, live reveal and saved replay remain separate gates. Text-only/source-quality cases stay separately visible, not counted as diagram successes.

For a chapter with N checklist rows, **at least 90%** needs `ceil(0.9 × N)` fully accepted rows; **above 90%** needs `floor(0.9 × N) + 1`. Tables expose both to avoid rounding 8/9 or 9/10 into a false threshold claim. These are future row-level targets after audit, not predictions from inherited fractions. The only accepted rows are the 13 Chemistry rows above, so no credible delta from today's engine coverage is calculated for the other chapters.

## Primary sources

Page numbers mean physical PDF pages, not footer labels. Recheck the official portals when implementation begins; 2026 is the reviewed baseline, not a claim of 2027 publication or later syllabus stability.

| Key | Source and scope |
| --- | --- |
| J-PDF | [Official NTA JEE Main 2026 PDF](https://cdnbbsr.s3waas.gov.in/s3f8e59f4b2fe7c5705bf878bbd494ccdf/uploads/2025/10/202510311323551056.pdf), linked by the [NTA syllabus page](https://jeemain.nta.nic.in/document/syllabus-2026/). Paper 1 only: Maths pp.1–2, Physics pp.3–6, Chemistry pp.7–11. |
| A-PDF | [Official JEE Advanced 2026 syllabus](https://jeeadv.ac.in/documents/jee-advanced-2026-syllabus.pdf). Chemistry pp.1–8, Maths pp.9–12, Physics pp.13–16. |
| N-PDF | [NTA-hosted NMC NEET-UG 2026 syllabus](https://www.nta.ac.in/Download/Notice/Notice_20260108180635.pdf), notice dated 22 December 2025, linked through the [NEET syllabus publication](https://neet.nta.nic.in/document/syllabus-for-neet-ug-2026-examination/). Physics pp.4–8, Chemistry pp.9–14, Biology pp.15–18. |
| N-FAQ | [NTA NEET-UG 2026 Information Bulletin](https://cdnbbsr.s3waas.gov.in/s37bc1ec1d9c3426357e69acd5bf320061/uploads/2026/02/202602231394640855.pdf), physical PDF p.81 / printed p.76, syllabus FAQ Q4: “insect (Frog)” means **an insect and a frog**. Both brief morphology/system accounts remain assigned. |

Source keywords or scope tags are not question-derived proof. Chemistry's Henry's law is listed in Main/NEET Equilibrium U6 and Advanced Solutions even though the repository places its topic in Solutions U5. The source controls exam scope; the unchanged taxonomy ID controls assignment traceability. Subject files retain additional limits on planes, triple products, organic configurations, experimental methods and legacy topics.

## The 34 inherited core chapters: allocation and targets

The queue order, chapter labels, priorities and historical fractions below are preserved. Each denominator is the existing primary-taxonomy row count, not a derived official atom count. Packet details and exact IDs are in maths.md/physics.md. Historical fractions describe reported aggregate operator matches; they are not accepted-topic numerators for this new matrix.

| Order | Priority | Chapter | Historical aggregate | Packet allocation shares | Combined allocation | Rows for ≥90% / >90% |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | P0 | Kinematics | 6/14 | CH-01a: 4/14 (28.6%); CH-01b: 3/14 (21.4%); CH-01c: 7/14 (50.0%) | 14/14 (100%) | 13 / 13 |
| 2 | P0 | Current Electricity | 0/17 | CH-02a: 5/17 (29.4%); CH-02b: 8/17 (47.1%); CH-02c: 4/17 (23.5%) | 17/17 (100%) | 16 / 16 |
| 3 | P0 | Laws of Motion | 0/17 | CH-03a: 6/17 (35.3%); CH-03b: 4/17 (23.5%); CH-03c: 7/17 (41.2%) | 17/17 (100%) | 16 / 16 |
| 4 | P0 | Work, Energy and Power | 0/16 | CH-04a: 1/16 (6.2%); CH-04b: 10/16 (62.5%); CH-04c: 5/16 (31.2%) | 16/16 (100%) | 15 / 15 |
| 5 | P0 | Magnetic Effects of Current and Magnetism | 1/23 | CH-05a: 5/23 (21.7%); CH-05b: 10/23 (43.5%); CH-05c: 8/23 (34.8%) | 23/23 (100%) | 21 / 21 |
| 6 | P0 | Coordinate Geometry | 15/29 | CH-06a: 9/29 (31.0%); CH-06b: 10/29 (34.5%); CH-06c: 10/29 (34.5%) | 29/29 (100%) | 27 / 27 |
| 7 | P1 | Rotational Motion | 3/17 | CH-07a: 5/17 (29.4%); CH-07b: 8/17 (47.1%); CH-07c: 4/17 (23.5%) | 17/17 (100%) | 16 / 16 |
| 8 | P1 | Electrostatics | 2/24 | CH-08a: 7/24 (29.2%); CH-08b: 6/24 (25.0%); CH-08c: 11/24 (45.8%) | 24/24 (100%) | 22 / 22 |
| 9 | P1 | Electromagnetic Induction and Alternating Currents | 6/14 | CH-09a: 4/14 (28.6%); CH-09b: 3/14 (21.4%); CH-09c: 7/14 (50.0%) | 14/14 (100%) | 13 / 13 |
| 10 | P1 | Optics | 2/27 | CH-10a: 7/27 (25.9%); CH-10b: 7/27 (25.9%); CH-10c: 13/27 (48.1%) | 27/27 (100%) | 25 / 25 |
| 11 | P1 | Limit, Continuity and Differentiability | 6/18 | CH-11a: 5/18 (27.8%); CH-11b: 9/18 (50.0%); CH-11c: 4/18 (22.2%) | 18/18 (100%) | 17 / 17 |
| 12 | P1 | Integral Calculus | 0/13 | CH-12a: 7/13 (53.8%); CH-12b: 6/13 (46.2%) | 13/13 (100%) | 12 / 12 |
| 13 | P1 | Differential Equations | 0/8 | CH-13a: 4/8 (50.0%); CH-13b: 3/8 (37.5%); CH-13c: 1/8 (12.5%) | 8/8 (100%) | 8 / 8 |
| 14 | P1 | Matrices and Determinants | 0/14 | CH-14a: 3/14 (21.4%); CH-14b: 7/14 (50.0%); CH-14c: 4/14 (28.6%) | 14/14 (100%) | 13 / 13 |
| 15 | P1 | Sequence and Series | 0/10 | CH-15a: 5/10 (50.0%); CH-15b: 4/10 (40.0%); CH-15c: 1/10 (10.0%) | 10/10 (100%) | 9 / 10 |
| 16 | P1 | Binomial Theorem and its Simple Applications | 0/8 | CH-16a: 3/8 (37.5%); CH-16b: 5/8 (62.5%) | 8/8 (100%) | 8 / 8 |
| 17 | P1 | Permutations and Combinations | 2/9 | CH-17a: 5/9 (55.6%); CH-17b: 4/9 (44.4%) | 9/9 (100%) | 9 / 9 |
| 18 | P1 | Three-Dimensional Geometry | 6/14 | CH-18a: 4/14 (28.6%); CH-18b: 2/14 (14.3%); CH-18c: 8/14 (57.1%) | 14/14 (100%) | 13 / 13 |
| 19 | P1 | Properties of Solids and Liquids | 5/27 | CH-19a: 5/27 (18.5%); CH-19b: 10/27 (37.0%); CH-19c: 4/27 (14.8%); CH-19d: 8/27 (29.6%) | 27/27 (100%) | 25 / 25 |
| 20 | P2 | Thermodynamics | 5/12 | CH-20a: 4/12 (33.3%); CH-20b: 5/12 (41.7%); CH-20c: 3/12 (25.0%) | 12/12 (100%) | 11 / 11 |
| 21 | P2 | Kinetic Theory of Gases | 0/11 | CH-21a: 5/11 (45.5%); CH-21b: 2/11 (18.2%); CH-21c: 4/11 (36.4%) | 11/11 (100%) | 10 / 10 |
| 22 | P2 | Dual Nature of Matter and Radiation | 0/8 | CH-22a: 2/8 (25.0%); CH-22b: 3/8 (37.5%); CH-22c: 3/8 (37.5%) | 8/8 (100%) | 8 / 8 |
| 23 | P2 | Atoms and Nuclei | 0/12 | CH-23a: 4/12 (33.3%); CH-23b: 6/12 (50.0%); CH-23c: 2/12 (16.7%) | 12/12 (100%) | 11 / 11 |
| 24 | P2 | Electronic Devices | 0/14 | CH-24a: 9/14 (64.3%); CH-24b: 3/14 (21.4%); CH-24c: 2/14 (14.3%) | 14/14 (100%) | 13 / 13 |
| 25 | P2 | Experimental Skills | 0/33 | CH-25a: 6/33 (18.2%); CH-25b: 9/33 (27.3%); CH-25c: 18/33 (54.5%) | 33/33 (100%) | 30 / 30 |
| 26 | P2 | Electromagnetic Waves | 0/8 | CH-26a: 4/8 (50.0%); CH-26b: 3/8 (37.5%); CH-26c: 1/8 (12.5%) | 8/8 (100%) | 8 / 8 |
| 27 | After the gap report | Oscillations and Waves | 6/21 | CH-27a: 11/21 (52.4%); CH-27b: 9/21 (42.9%); CH-27c: 1/21 (4.8%) | 21/21 (100%) | 19 / 19 |
| 28 | After the gap report | Gravitation | 2/14 | CH-28a: 6/14 (42.9%); CH-28b: 7/14 (50.0%); CH-28c: 1/14 (7.1%) | 14/14 (100%) | 13 / 13 |
| 29 | After the gap report | Sets, Relations and Functions | 4/10 | CH-29a: 7/10 (70.0%); CH-29b: 3/10 (30.0%) | 10/10 (100%) | 9 / 10 |
| 30 | After the gap report | Complex Numbers and Quadratic Equations | 7/14 | CH-30a: 3/14 (21.4%); CH-30b: 9/14 (64.3%); CH-30c: 2/14 (14.3%) | 14/14 (100%) | 13 / 13 |
| 31 | After the gap report | Vector Algebra | 3/10 | CH-31a: 5/10 (50.0%); CH-31b: 1/10 (10.0%); CH-31c: 4/10 (40.0%) | 10/10 (100%) | 9 / 10 |
| 32 | After the gap report | Statistics and Probability | 2/12 | CH-32a: 3/12 (25.0%); CH-32b: 5/12 (41.7%); CH-32c: 4/12 (33.3%) | 12/12 (100%) | 11 / 11 |
| 33 | After the gap report | Trigonometry | 1/10 | CH-33a: 2/10 (20.0%); CH-33b: 5/10 (50.0%); CH-33c: 3/10 (30.0%) | 10/10 (100%) | 9 / 10 |
| 34 | After the gap report | Units and Measurements | 0/13 | CH-34a: 8/13 (61.5%); CH-34b: 4/13 (30.8%); CH-34c: 1/13 (7.7%) | 13/13 (100%) | 12 / 12 |

## Separate Chemistry, Biology and Advanced chapter allocations

These are additional subject/planning lanes, not additions to the inherited 34-core-chapter denominator or reorderings of its priority queue. Biology/Advanced counts are editorial checklist rows; Chemistry U1–U20 counts are exact primary taxonomy rows.

### Chemistry U1–U20

| Chapter / group | Rows | Packet allocation shares | Combined allocation | Rows for ≥90% / >90% | Current verified topics |
| --- | --- | --- | --- | --- | --- |
| Some Basic Concepts in Chemistry | 7 | C-01a: 4/7 (57.1%); C-01b: 3/7 (42.9%) | 7/7 (100%) | 7 / 7 | Unknown; audit pending |
| Atomic Structure | 6 | C-02a: 3/6 (50.0%); C-02b: 2/6 (33.3%); C-02c: 1/6 (16.7%) | 6/6 (100%) | 6 / 6 | 6/6 |
| Chemical Bonding and Molecular Structure | 7 | C-03a: 1/7 (14.3%); C-03b: 4/7 (57.1%); C-03c: 1/7 (14.3%); C-03d: 1/7 (14.3%) | 7/7 (100%) | 7 / 7 | 7/7 |
| Chemical Thermodynamics | 6 | C-04a: 4/6 (66.7%); C-04b: 2/6 (33.3%) | 6/6 (100%) | 6 / 6 | 0/6 accepted |
| Solutions | 6 | C-05a: 3/6 (50.0%); C-05b: 2/6 (33.3%); C-05c: 1/6 (16.7%) | 6/6 (100%) | 6 / 6 | 0/6 accepted |
| Equilibrium | 8 | C-06a: 4/8 (50.0%); C-06b: 3/8 (37.5%); C-06c: 1/8 (12.5%) | 8/8 (100%) | 8 / 8 | Unknown; audit pending |
| Redox Reactions and Electrochemistry | 8 | C-07a: 2/8 (25.0%); C-07b: 3/8 (37.5%); C-07c: 2/8 (25.0%); C-07d: 1/8 (12.5%) | 8/8 (100%) | 8 / 8 | Unknown; audit pending |
| Chemical Kinetics | 6 | C-08a: 4/6 (66.7%); C-08b: 2/6 (33.3%) | 6/6 (100%) | 6 / 6 | Unknown; audit pending |
| Classification of Elements and Periodicity in Properties | 6 | C-09a: 2/6 (33.3%); C-09b: 4/6 (66.7%) | 6/6 (100%) | 6 / 6 | Unknown; audit pending |
| p-Block Elements | 7 | C-10a: 1/7 (14.3%); C-10b1: 1/7 (14.3%); C-10b2: 1/7 (14.3%); C-10b3: 1/7 (14.3%); C-10b4: 1/7 (14.3%); C-10b5: 1/7 (14.3%); C-10b6: 1/7 (14.3%) | 7/7 (100%) | 7 / 7 | Unknown; audit pending |
| d- and f-Block Elements | 7 | C-11a: 4/7 (57.1%); C-11b: 2/7 (28.6%); C-11c: 1/7 (14.3%) | 7/7 (100%) | 7 / 7 | Unknown; audit pending |
| Coordination Compounds | 6 | C-12a: 3/6 (50.0%); C-12b: 1/6 (16.7%); C-12c: 2/6 (33.3%) | 6/6 (100%) | 6 / 6 | Unknown; audit pending |
| Purification and Characterisation of Organic Compounds | 5 | C-13a: 2/5 (40.0%); C-13b: 3/5 (60.0%) | 5/5 (100%) | 5 / 5 | Unknown; audit pending |
| Some Basic Principles of Organic Chemistry | 8 | C-14a: 3/8 (37.5%); C-14b: 2/8 (25.0%); C-14c: 3/8 (37.5%) | 8/8 (100%) | 8 / 8 | Unknown; audit pending |
| Hydrocarbons | 7 | C-15a: 1/7 (14.3%); C-15b: 4/7 (57.1%); C-15c: 2/7 (28.6%) | 7/7 (100%) | 7 / 7 | Unknown; audit pending |
| Organic Compounds Containing Halogens | 5 | C-16a: 3/5 (60.0%); C-16b: 2/5 (40.0%) | 5/5 (100%) | 5 / 5 | Unknown; audit pending |
| Organic Compounds Containing Oxygen | 8 | C-17a: 3/8 (37.5%); C-17b: 4/8 (50.0%); C-17c: 1/8 (12.5%) | 8/8 (100%) | 8 / 8 | Unknown; audit pending |
| Organic Compounds Containing Nitrogen | 6 | C-18a: 5/6 (83.3%); C-18b: 1/6 (16.7%) | 6/6 (100%) | 6 / 6 | Unknown; audit pending |
| Biomolecules | 7 | C-19a: 2/7 (28.6%); C-19b: 2/7 (28.6%); C-19c: 1/7 (14.3%); C-19d: 2/7 (28.6%) | 7/7 (100%) | 7 / 7 | Unknown; audit pending |
| Principles Related to Practical Chemistry | 6 | C-20a: 1/6 (16.7%); C-20b: 1/6 (16.7%); C-20c: 1/6 (16.7%); C-20d: 2/6 (33.3%); C-20e: 1/6 (16.7%) | 6/6 (100%) | 6 / 6 | Unknown; audit pending |

### NEET Biology U1–U10

| Chapter / group | Rows | Packet allocation shares | Combined allocation | Rows for ≥90% / >90% | Current verified topics |
| --- | --- | --- | --- | --- | --- |
| Diversity in Living World | 9 | B-01a: 4/9 (44.4%); B-01b: 2/9 (22.2%); B-01c: 1/9 (11.1%); B-01d: 2/9 (22.2%) | 9/9 (100%) | 9 / 9 | Unknown; audit pending |
| Structural Organisation in Animals and Plants | 29 | B-02a: 7/29 (24.1%); B-02b: 9/29 (31.0%); B-02c: 1/29 (3.4%); B-02d-frog: 6/29 (20.7%); B-02d-insect: 6/29 (20.7%) | 29/29 (100%) | 27 / 27 | Unknown; audit pending |
| Cell Structure and Function | 20 | B-03a: 12/20 (60.0%); B-03b: 5/20 (25.0%); B-03c: 3/20 (15.0%) | 20/20 (100%) | 18 / 19 | Unknown; audit pending |
| Plant Physiology | 19 | B-04a: 4/19 (21.1%); B-04b: 4/19 (21.1%); B-04c: 6/19 (31.6%); B-04d: 5/19 (26.3%) | 19/19 (100%) | 18 / 18 | Unknown; audit pending |
| Human Physiology | 35 | B-05a: 6/35 (17.1%); B-05b: 6/35 (17.1%); B-05c: 6/35 (17.1%); B-05d: 5/35 (14.3%); B-05e: 3/35 (8.6%); B-05f: 9/35 (25.7%) | 35/35 (100%) | 32 / 32 | Unknown; audit pending |
| Reproduction | 19 | B-06a: 8/19 (42.1%); B-06b: 4/19 (21.1%); B-06c: 3/19 (15.8%); B-06d: 4/19 (21.1%) | 19/19 (100%) | 18 / 18 | Unknown; audit pending |
| Genetics and Evolution | 27 | B-07a: 10/27 (37.0%); B-07b: 9/27 (33.3%); B-07c: 8/27 (29.6%) | 27/27 (100%) | 25 / 25 | Unknown; audit pending |
| Biology and Human Welfare | 10 | B-08a: 3/10 (30.0%); B-08b: 4/10 (40.0%); B-08c: 3/10 (30.0%) | 10/10 (100%) | 9 / 10 | Unknown; audit pending |
| Biotechnology and Its Applications | 8 | B-09a: 3/8 (37.5%); B-09b: 5/8 (62.5%) | 8/8 (100%) | 8 / 8 | Unknown; audit pending |
| Ecology and Environment | 13 | B-10a: 4/13 (30.8%); B-10b: 5/13 (38.5%); B-10c: 4/13 (30.8%) | 13/13 (100%) | 12 / 12 | Unknown; audit pending |

### Advanced extra Chemistry CA-01–CA-07

| Chapter / group | Rows | Packet allocation shares | Combined allocation | Rows for ≥90% / >90% | Current verified topics |
| --- | --- | --- | --- | --- | --- |
| States Of Matter | 7 | CA-01a: 2/7 (28.6%); CA-01b: 3/7 (42.9%); CA-01c: 2/7 (28.6%) | 7/7 (100%) | 7 / 7 | Unknown; audit pending |
| Solid State | 5 | CA-02a: 2/5 (40.0%); CA-02b: 2/5 (40.0%); CA-02c: 1/5 (20.0%) | 5/5 (100%) | 5 / 5 | Unknown; audit pending |
| Surface Chemistry | 4 | CA-03a: 2/4 (50.0%); CA-03b: 1/4 (25.0%); CA-03c: 1/4 (25.0%) | 4/4 (100%) | 4 / 4 | Unknown; audit pending |
| Hydrogen S Block | 9 | CA-04a: 3/9 (33.3%); CA-04b: 2/9 (22.2%); CA-04c: 4/9 (44.4%) | 9/9 (100%) | 9 / 9 | Unknown; audit pending |
| Metallurgy | 5 | CA-05a: 2/5 (40.0%); CA-05b: 1/5 (20.0%); CA-05c: 2/5 (40.0%) | 5/5 (100%) | 5 / 5 | Unknown; audit pending |
| Environmental Chemistry | 3 | CA-06a: 2/3 (66.7%); CA-06b: 1/3 (33.3%) | 3/3 (100%) | 3 / 3 | Unknown; audit pending |
| Polymers Everyday | 8 | CA-07a: 4/8 (50.0%); CA-07b: 3/8 (37.5%); CA-07c: 1/8 (12.5%) | 8/8 (100%) | 8 / 8 | Unknown; audit pending |

## Supplemental traceability and primary owners

These are thirteen exact coarse taxonomy records. A one-row macro allocation of 100% means its ownership is assigned, not that its constituent cases are solved. Four SX packets cover optional historical-scope Maths/Physics work; Chemistry macros use the same CA owner as their listed detailed children.

| Exact topic ID | Primary owner | Scope J / A / N | Allocation |
| --- | --- | --- | --- |
| maths\|supplemental\|linear-programming\|core | SX-M01 | supplemental / supplemental / not_applicable | 1/1 macro assigned; audit pending |
| maths\|supplemental\|mathematical-induction\|core | SX-M02 | supplemental / supplemental / not_applicable | 1/1 macro assigned; audit pending |
| maths\|supplemental\|mathematical-reasoning\|core | SX-M03 | supplemental / supplemental / not_applicable | 1/1 macro assigned; audit pending |
| physics\|supplemental\|communication-systems\|core | SX-P01 | supplemental / supplemental / supplemental | 1/1 macro assigned; audit pending |
| chemistry\|supplemental\|states-of-matter\|core | CA-01a | supplemental / listed / supplemental | 1/1 macro assigned; audit pending |
| chemistry\|supplemental\|solid-state\|core | CA-02a | supplemental / listed / supplemental | 1/1 macro assigned; audit pending |
| chemistry\|supplemental\|surface-chemistry\|core | CA-03a | supplemental / review / supplemental | 1/1 macro assigned; audit pending |
| chemistry\|supplemental\|hydrogen\|core | CA-04a | supplemental / review / supplemental | 1/1 macro assigned; audit pending |
| chemistry\|supplemental\|s-block-elements\|core | CA-04c | supplemental / listed / supplemental | 1/1 macro assigned; audit pending |
| chemistry\|supplemental\|metallurgy\|core | CA-05a | supplemental / listed / supplemental | 1/1 macro assigned; audit pending |
| chemistry\|supplemental\|environmental-chemistry\|core | CA-06a | supplemental / listed / supplemental | 1/1 macro assigned; audit pending |
| chemistry\|supplemental\|polymers\|core | CA-07a | supplemental / listed / supplemental | 1/1 macro assigned; audit pending |
| chemistry\|supplemental\|chemistry-in-everyday-life\|core | CA-07b | supplemental / review / supplemental | 1/1 macro assigned; audit pending |

## Evidence required when closing a packet

Return the exact topic IDs and accepted source/model variants; the unchanged denominator and scoped exclusions; independent expected equations/topology/reference relations; positive, mutation, invalid/singular and holdout outcomes; named commands and artifacts; and live/persistence/replay results. List every remaining variant or blocked dependency with an owner. Reusable implementation follows the root authority contract: scene-engine owns all diagram marks, deterministic values remain source-grounded, and partial/invalid candidates never reach the canvas.

A packet cannot report “100% coverage” from the assignment count. Its completion report distinguishes fully accepted rows, partial rows, legitimate text-only decisions and failed required diagrams. The chapter report takes the union of accepted topic IDs and never adds overlapping family counts or supplemental macro/child totals.

## Snapshot provenance

Taxonomy source: [syllabus-taxonomy.json](../../../data/question-bank/syllabus-taxonomy.json), schema `question-bank-syllabus-taxonomy/v1`, active framework `jee-main-2026`. SHA-256: `2d2a65ff89f4ce6aae9016c3a607dfb3d1f06a259a2313d1cf47db07a51a7510`. This checksum identifies the denominator snapshot; this work does not modify that file.

Regenerate/review assignments if the taxonomy or published syllabus changes. Exact labels and IDs are preserved even where an editorial correction is needed; e.g. the Physics pendulum-dissipation label is reviewed against the official amplitude-squared/time activity rather than silently rewritten. New accepted evidence must replace pending statuses only after the topic audit, not as a side effect of this planning document.
