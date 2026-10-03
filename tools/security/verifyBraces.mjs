import { createRequire } from "node:module";
import { resolve } from "node:path";
import { verifyBracesApi } from "./bracesDepth.mjs";

const landingRequire = createRequire(resolve("apps/landing/package.json"));
const tailwindRequire = createRequire(landingRequire.resolve("tailwindcss/package.json"));
const chokidarRequire = createRequire(tailwindRequire.resolve("chokidar/package.json"));
const bracesPath = chokidarRequire.resolve("braces");
verifyBracesApi(chokidarRequire("braces"));
console.log(`Verified brace-depth bounds and compatibility: ${bracesPath}`);
