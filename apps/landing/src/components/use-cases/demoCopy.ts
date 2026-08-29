import { RESISTORS_QUESTION, RESISTORS_SEGMENTS } from '../hero-lesson/resistorsProgram'
import type { DemoCopy } from './useUseCaseDemo'

/**
 * The lesson the use cases demonstrate. The question and the narration come
 * straight from the board program that draws it, so the copy on the rail can
 * never drift from what the whiteboard is actually doing.
 */
export const RESISTORS_DEMO: DemoCopy = {
  question: RESISTORS_QUESTION,
  doubt: 'wait — why does parallel come out smaller than one resistor?',
  bubbles: RESISTORS_SEGMENTS.map((segment) => segment.bubble),
}
