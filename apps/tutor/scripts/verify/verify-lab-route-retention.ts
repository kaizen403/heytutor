import assert from "node:assert/strict";
import { labRouteRetention } from "../../lib/dev/labRouteRetention";

for (const mode of [undefined, "test", "production"]) {
  assert.equal(labRouteRetention({ NODE_ENV: mode, LECTURE_LAB_KEEP_ROUTES_HOT: "1" }), undefined);
}
for (const flag of [undefined, "", "0", "true", " 1 "]) {
  assert.equal(labRouteRetention({ NODE_ENV: "development", LECTURE_LAB_KEEP_ROUTES_HOT: flag }), undefined);
}
assert.deepEqual(labRouteRetention({ NODE_ENV: "development", LECTURE_LAB_KEEP_ROUTES_HOT: "1" }), {
  maxInactiveAge: 3_600_000, pagesBufferLength: 100,
});
console.log("lab route retention: explicit development-only control, default and production unchanged");
