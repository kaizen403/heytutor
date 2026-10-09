# Chemistry planner examples

Files ending in `.json` are validated planner examples and are included in
`exemplars/_library.jsonl`.

The ten active examples include four SMILES panels: two comparisons and two
reactions. The remaining six cover Lewis, VSEPR, energy and orbital kits.
Names are a convenience only: unresolved names require a SMILES repair.
Panels contain one to four molecules. Arrow endpoints are zero-based molecule
indices and their optional label is a reagent or condition, never geometry.
Disconnected SMILES, isotope marks and tetrahedral `@` stereo are unsupported
and fail atomically rather than losing their meaning. Alkene `/` and `\\`
stereo is preserved. A kit never infers a product from the question.

Files ending in `.json.unconverted` remain as reference scenes for chemistry
figure kinds that do not yet have planner-callable engine kits. The exemplar
library intentionally ignores them: their atom-by-atom geometry is valid
engine output, but it is not a reliable pattern for the planner to author.
Those questions continue to use the existing chemistry-family fallback.
