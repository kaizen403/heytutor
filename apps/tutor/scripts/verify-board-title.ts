import {
  deriveBoardTitleFromQuestion,
  finalizeBoardTitle,
  isMetaOrInvalidBoardTitle,
} from "../lib/boardTitle";

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

console.log("verify-board-title: all checks passed");
