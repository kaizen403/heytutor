export const DEMO_QUESTION =
  'Three 12 Ω resistors. Find the series and parallel resistance.'
export const DEMO_DOUBT = 'Why is it less than 12 Ω?'
export const DEMO_ANSWER =
  'The current has three paths instead of one. Each carries V/12, so together they carry V/4. The equivalent resistance is 4 Ω.'

export const DEMO_STEPS = {
  ask: [
    'Ask a question',
    'Read the problem',
    'Watch it unfold',
    'See the answer',
  ],
  annotate: [
    'Start with the figure',
    'Follow the method',
    'Work through it',
    'Understand the result',
  ],
  doubt: [
    'Click Ask Doubt',
    'Type your question',
    'Circle the step',
    'Get your answer',
  ],
  replay: [
    'Replay the lesson',
    'Choose a chapter',
    'Set your pace',
    'Watch it again',
  ],
  notes: [
    'Open Download',
    'Choose your format',
    'Prepare the file',
    'Keep the lesson',
  ],
} as const
