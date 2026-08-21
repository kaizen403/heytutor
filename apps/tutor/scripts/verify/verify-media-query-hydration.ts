import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useIsCompactNav } from "../../lib/client/useMediaQuery";

function MediaQueryProbe() {
  return createElement("span", {
    "data-compact": String(useIsCompactNav()),
  });
}

const serverMarkup = renderToStaticMarkup(createElement(MediaQueryProbe));
if (!serverMarkup.includes('data-compact="false"')) {
  throw new Error(`server media-query snapshot was not deterministic: ${serverMarkup}`);
}

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    matchMedia: () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }),
  },
});

try {
  const hydrationMarkup = renderToStaticMarkup(createElement(MediaQueryProbe));
  if (hydrationMarkup !== serverMarkup) {
    throw new Error(
      `server and hydration snapshots differ: ${serverMarkup} !== ${hydrationMarkup}`,
    );
  }
} finally {
  Reflect.deleteProperty(globalThis, "window");
}

console.log("media-query hydration verification passed");
