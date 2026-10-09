# Chemistry planner examples

Files ending in `.json` are validated planner examples and are included in
`exemplars/_library.jsonl`.

Files ending in `.json.unconverted` remain as reference scenes for chemistry
figure kinds that do not yet have planner-callable engine kits. The exemplar
library intentionally ignores them: their atom-by-atom geometry is valid
engine output, but it is not a reliable pattern for the planner to author.
Those questions continue to use the existing chemistry-family fallback.
