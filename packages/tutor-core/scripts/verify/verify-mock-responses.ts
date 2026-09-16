import { getMockResponse } from "../../src/llm/mockResponses";

const doubtAboutMirror = getMockResponse(
  'i have a doubt about the question "Concave mirror, f = 15 cm". my doubt: what is pole P.',
);
if (!doubtAboutMirror.includes("you marked this part of the board")) {
  throw new Error("a doubt prompt must not fall through to a full lesson mock");
}
if (doubtAboutMirror.includes("equation of a circle") || /\[DRAW_/.test(doubtAboutMirror)) {
  throw new Error("a doubt mock must not restart a canned lecture or draw a new figure");
}

const continueLesson = getMockResponse("continue");
if (!continueLesson.includes("next unwritten step")) {
  throw new Error("a resume prompt must have its own mock, not the default empty reply");
}

const linearEquation = getMockResponse("Solve the equation 2x + 3 = 7");
if (!linearEquation.includes("linear equation demo")) {
  throw new Error("linear equation prompt did not select the linear-equation mock response");
}
if (linearEquation.includes("equation of a circle")) {
  throw new Error("linear equation prompt incorrectly selected the circle mock response");
}

const circleEquation = getMockResponse("Derive the standard form equation of a circle.");
if (!circleEquation.includes("equation of a circle")) {
  throw new Error("circle prompt did not preserve the circle mock response");
}

for (const nonCirclePrompt of [
  "Derive the equation of motion for constant acceleration.",
  "Write the standard form of a linear equation.",
]) {
  if (getMockResponse(nonCirclePrompt).includes("equation of a circle")) {
    throw new Error(`generic topic terms selected the circle fixture: ${nonCirclePrompt}`);
  }
}

console.log("verify-mock-responses: ok");
