import {
  boardNeedsGeneratedTitle,
  deriveBoardTitleFromQuestion,
  finalizeBoardTitle,
  isMetaOrInvalidBoardTitle,
} from "../../lib/boards/boardTitle";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const fbdQuestion =
  "Solve: a 5 kg box is pushed with 20 N on a surface with μ = 0.3. Find acceleration and draw the free-body diagram.";

assert(
  deriveBoardTitleFromQuestion(fbdQuestion) === "5 kg box free-body diagram",
  "FBD question should derive a concrete diagram title",
);

assert(
  isMetaOrInvalidBoardTitle("Wants A Topic Name For The Math Concept Covered By The Quest"),
  "meta LLM title should be rejected",
);

assert(
  finalizeBoardTitle(
    fbdQuestion,
    "Wants A Topic Name For The Math Concept Covered By The Quest",
  ) === "5 kg box free-body diagram",
  "bad LLM title should fall back to derived title",
);

assert(
  finalizeBoardTitle(fbdQuestion, "5 kg box free-body diagram") === "5 kg box free-body diagram",
  "good LLM title should be kept",
);

assert(
  !isMetaOrInvalidBoardTitle("Free-body diagram with friction"),
  "valid descriptive title should pass validation",
);

const refractionQuestion =
  "Light enters glass at 45 degrees with n = 1.5. Find the angle of refraction and draw both rays.";
const refractionTitle = deriveBoardTitleFromQuestion(refractionQuestion);
assert(
  refractionTitle !== "Fractions" && /light enters glass/i.test(refractionTitle),
  `refraction must not match the fractions title rule: ${refractionTitle}`,
);

assert(
  boardNeedsGeneratedTitle({ isDraft: true, title: "new board", persistedTurnCount: 0 }),
  "a draft board must be named from the first question",
);
assert(
  boardNeedsGeneratedTitle({
    isDraft: false,
    title: "Voltage divider midpoint voltage",
    persistedTurnCount: 0,
  }),
  "an empty board still carrying an abandoned title must be renamed from the question that actually runs",
);
assert(
  !boardNeedsGeneratedTitle({
    isDraft: false,
    title: "Voltage divider midpoint voltage",
    persistedTurnCount: 1,
  }),
  "a later doubt on a saved lesson must not rename the board",
);
assert(
  boardNeedsGeneratedTitle({ isDraft: false, title: "new board", persistedTurnCount: 1 }),
  "a saved lesson still titled new board must be named",
);

const ionicRadius =
  "Arrange the isoelectronic ions Na+, Mg2+ and Al3+ in order of ionic radius. State the radius convention and the nuclear-charge order.";
assert(
  deriveBoardTitleFromQuestion(ionicRadius) !== "Circle geometry",
  "an ionic radius is not circle geometry",
);
assert(
  deriveBoardTitleFromQuestion("Find the area of a circle with radius 4 cm.") === "Circle geometry",
  "a circle radius stays circle geometry",
);

const ionisation =
  "Explain the exceptions in the first ionisation enthalpy: beryllium versus boron, and nitrogen versus oxygen. The trend is not monotonic.";
assert(
  deriveBoardTitleFromQuestion(ionisation) !== "Photosynthesis",
  "oxygen the element is not photosynthesis",
);
assert(
  deriveBoardTitleFromQuestion("Explain photosynthesis in a green plant.") === "Photosynthesis",
  "a plant photosynthesis question stays photosynthesis",
);

const zeroOrder =
  "A zero-order reaction has [A]0 = 0.50 mol/L and k = 0.10 mol/L/s. Find [A] at t = 2.0 s.";
const zeroTitle = deriveBoardTitleFromQuestion(zeroOrder);
assert(
  zeroTitle.includes("0.50"),
  `a decimal in the stem must survive the title: ${zeroTitle}`,
);

console.log("verify-board-title: all checks passed");
