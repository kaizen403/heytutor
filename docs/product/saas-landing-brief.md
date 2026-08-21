# Accelute — SaaS Landing Page Brief

> Collected from codebase, product plan, and live app metadata. Use this as source material for marketing copy, positioning, and landing page structure.
>
> **Last updated:** 2026-06-23  
> **Product version:** 0.1.0 (MVP / pre-SaaS)

---

## 1. Product Snapshot

| Field | Value |
|-------|-------|
| **Name** | Accelute |
| **Tagline** | AI whiteboard math tutor |
| **One-liner** | An AI math tutor that draws on a whiteboard like a teacher — stroke by stroke, with voice narration. |
| **Category** | EdTech · AI tutoring · Visual learning |
| **Delivery** | Web app (SaaS) |
| **Input method** | Text questions (no mic required for MVP) |
| **AI persona** | "Clicky" — friendly, casual math tutor (internal name from system prompt) |

### Elevator pitch (30 seconds)

Most AI tutors give you walls of text. **Accelute** teaches the way a real teacher would: it draws shapes on a whiteboard, writes formulas by hand, and explains everything out loud — all in sync. Ask a mensuration problem and watch a virtual cursor sketch a cuboid, draw a cube inside it, write the volume formulas, and walk you through the difference. No teacher required. Just a cursor, a board, and an explanation that actually makes sense.

---

## 2. The Problem We Solve

### Pain points (for landing page "Problem" section)

1. **Text-only AI is hard to follow for math** — equations and geometry don't land when they're just paragraphs.
2. **Video tutors don't scale** — human teachers on whiteboards are great, but expensive and not available 24/7.
3. **Static diagrams feel disconnected** — showing a finished picture skips the "how did we get here?" step.
4. **Students need to see the process** — drawing, labeling, and writing formulas in order mirrors how math is actually taught.

### Our answer

A **visual, spoken, step-by-step** tutoring experience where AI doesn't paste answers — it **performs** the explanation on a shared whiteboard, like sitting next to a patient teacher.

---

## 3. Core Value Propositions

Use these as hero bullets, feature cards, or ad copy hooks.

1. **Teaches like a teacher, not a chatbot** — stroke-by-stroke drawing and handwriting, not instant static images.
2. **Voice + visuals stay in sync** — narration plays while the cursor draws and writes at the right moment.
3. **Ask anything in plain English** — type a math question; AI plans the lesson and executes it on the board.
4. **Remembers the conversation** — multi-turn tutoring (last 10 exchanges) for follow-ups and deeper explanations.
5. **Works in the browser** — no install, no macOS-only app, accessible from any device.
6. **Instant visual clarity for geometry** — cuboids, cubes, triangles, circles, rectangles, lines, and labeled formulas.

---

## 4. How It Works (User Flow)

Good for a "How it works" section with 3–4 steps.

```
1. Ask          →  Type a math question in the input bar
2. Think        →  AI plans narration + drawing commands
3. Teach        →  Virtual cursor draws shapes and writes formulas stroke-by-stroke
4. Listen       →  Voice narration explains each step in sync with the board
```

### Tutor states (UI feedback)

| State | User sees |
|-------|-----------|
| **Ready** | Gray status dot — waiting for a question |
| **Thinking** | Amber pulse + overlay spinner — AI is planning the lesson |
| **Teaching** | Blue glow — cursor is drawing and/or voice is speaking |

### Example user question (from app placeholder)

> "find the volume difference between a cuboid and a cube inside it"

---

## 5. Feature Breakdown

### 5.1 Interactive whiteboard

- **1200×700 canvas** with warm off-white paper tone (`#F8F6F0`)
- **Three Konva layers:** drawing, animation, cursor
- **Animated virtual cursor** — blue triangle that flies along bezier arcs to each drawing target
- **Stroke-by-stroke reveal** — shapes and text appear progressively, not as finished assets
- **Handwriting-style text** — formulas written character-by-character via font glyph paths (opentype.js)

### 5.2 Drawing capabilities

The AI can embed drawing commands in its response. Supported primitives:

| Command | What it draws |
|---------|---------------|
| `DRAW_CUBOID` | 3D cuboid (isometric projection) |
| `DRAW_CUBE` | 3D cube |
| `DRAW_RECT` | 2D rectangle |
| `DRAW_CIRCLE` | Circle with radius |
| `DRAW_LINE` | Line segment |
| `WRITE` | Handwritten formula or text |
| `LABEL` | Short label near a shape |
| `PAUSE` | Timed pause between steps |
| `CLEAR` | Clear the board |

### 5.3 Voice narration (TTS)

- **Primary:** ElevenLabs (`eleven_flash_v2_5`) via server-side proxy
- **Fallback:** Browser Speech Synthesis when API keys are missing or TTS fails
- **Math-aware pronunciation** — converts `²`, `³`, `×`, `π`, etc. to spoken words ("a squared", "times", "pi")
- **Character-level timestamps** — ElevenLabs stream-with-timestamps for audio ↔ drawing sync

### 5.4 AI tutoring brain

- **LLM:** Kimi K2P6 via Fireworks AI (configurable via `FIREWORKS_MODEL`)
- **Streaming SSE** — responses stream in real time
- **Conversation memory** — last 10 Q&A exchanges
- **Teaching persona rules:**
  - Lowercase, casual, warm tone
  - Written for speech (no markdown, bullets, or symbols that sound awkward aloud)
  - Default: concise (1–2 sentences); expands when user asks for more detail
  - Never says "simply" or "just"
  - Ends with related ideas, not yes/no questions

### 5.5 Built-in demo mode

- Works **without API keys** using keyword-matched mock responses
- Demo topics: cuboid/cube volume, rectangle area, Pythagorean theorem, circle radius/circumference
- Lets prospects try the product on a landing page embed or free tier

---

## 6. Use Cases & Example Lessons

### Primary subject focus (today)

**Math — especially visual / geometry / mensuration**

| Topic | What the tutor does on the board |
|-------|----------------------------------|
| Volume (cuboid + cube) | Draws cuboid → writes `V = l × w × h` → draws cube inside → writes `V = s³` → computes difference |
| Rectangle area | Draws rectangle → labels length/width → writes area formula → plugs in numbers |
| Pythagorean theorem | Draws right triangle → labels sides a, b, c → writes `a² + b² = c²` → walks through 3-4-5 example |
| Circle properties | Draws circle + radius line → writes area and circumference formulas |

### Target users (SaaS segments)

| Segment | Why Accelute fits |
|---------|-------------------|
| **Students (middle school – college)** | Homework help for geometry, algebra, mensuration |
| **Parents** | Affordable at-home math support that feels human |
| **Tutoring centers / schools** | Scalable visual explainer for common problem types |
| **Homeschool families** | Step-by-step visual lessons without scheduling a human |
| **EdTech platforms** | Embeddable whiteboard tutor API (future) |

---

## 7. Differentiators vs. Alternatives

| Alternative | Limitation | Accelute advantage |
|-------------|------------|---------------------|
| ChatGPT / generic AI chat | Text-only; math is hard to parse | Draws and narrates visually |
| Khan Academy / video | Fixed content, not interactive | Answers *your* question on the spot |
| Photomath / calculators | Shows answer steps as text | Shows steps *being drawn* like a teacher |
| Clicky (macOS app) | Points at screen; no whiteboard drawing | Full whiteboard teaching in the browser |
| Human tutors | Expensive, scheduling friction | On-demand, 24/7, fraction of the cost |

### Unique mechanism

> **"Performative tutoring"** — the AI doesn't describe what to draw; it draws it live while speaking, with a cursor that follows every stroke.

---

## 8. Brand & Visual Identity

### Personality

- Warm, approachable, patient teacher energy
- Not corporate or sterile — feels like a cozy study session
- Confident but not condescending (no "simply" or "just")

### Color palette

| Token | Hex | Usage |
|-------|-----|-------|
| Darkest | `#003C43` | App background, sidebar, darkest surfaces |
| Dark | `#135D66` | Elevated surfaces, input bar, whiteboard frame |
| Sage | `#77B0AA` | Interactive accents, cursor, secondary text, borders |
| Mint | `#E3FEF7` | Text primary, whiteboard surface, bright accents |
| Board surface | `#C4E8DE` | Whiteboard (slightly muted mint for less glare) |

### Typography

- **Plus Jakarta Sans** (weights 200–800) — UI, headings, body
- Handwriting on board uses a script font loaded via opentype.js (Caveat-style)

### Visual motifs for landing page

- Warm radial gradients (amber glow behind whiteboard)
- Floating whiteboard frame with deep shadow
- Blue triangle cursor as brand icon / favicon candidate
- Paper-textured input bar with pencil icon
- Status dot animations (amber thinking, blue teaching)

---

## 9. Technical Architecture (for "Built with" / trust section)

```
User question (text)
       ↓
Next.js frontend (React 19)
       ↓
POST /api/chat  →  Fireworks AI (Kimi K2P6)  [or mock responses]
       ↓
Parse drawing commands from AI response
       ↓
Build audio ↔ drawing sync plan
       ↓
POST /api/tts   →  ElevenLabs  [or browser Speech Synthesis]
       ↓
Parallel: voice plays + cursor draws on Konva canvas
```

### Tech stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15, React 19, TypeScript |
| Styling | Tailwind CSS 4 |
| Canvas | Konva.js + react-konva |
| Hand-drawn feel | Rough.js |
| Handwriting paths | opentype.js |
| Animation | GSAP, custom bezier cursor animation |
| LLM | Fireworks AI (Kimi K2P6) |
| TTS | ElevenLabs (`eleven_flash_v2_5`) |
| Deployment target | Vercel-compatible Next.js app |

### Environment variables

```env
FIREWORKS_API_KEY=...      # LLM (optional — mock mode without)
FIREWORKS_MODEL=...        # default: accounts/fireworks/models/kimi-k2p6
ELEVENLABS_API_KEY=...     # TTS (optional — browser voice fallback)
ELEVENLABS_VOICE_ID=...    # ElevenLabs voice selection
```

---

## 10. Current Product Status

### ✅ Built (v0.1.0)

- Full tutor UI (header, whiteboard, input bar, status indicator)
- Whiteboard with stroke-by-stroke shape + handwriting animation
- Virtual cursor with bezier flight paths
- Drawing command protocol + parser
- LLM integration with streaming (Fireworks)
- TTS integration with ElevenLabs + browser fallback
- Audio ↔ drawing synchronization
- Conversation history (10 turns)
- Mock/demo mode without API keys
- Response bubble showing current narration segment
- Warm design system with entrance animations

### 🚧 Not yet built (SaaS gaps)

- User accounts / authentication
- Billing / subscriptions (Stripe, etc.)
- Usage limits / quotas per plan
- Landing page (separate from app)
- Pricing page
- Onboarding flow
- Analytics / conversion tracking
- Team / classroom features
- Subject expansion beyond math MVP
- Voice input (mic / push-to-talk)
- Export / share lesson replays
- Mobile-optimized layout
- Custom branding for B2B

---

## 11. SaaS Positioning Recommendations

> These are **suggested** angles — not implemented in the product yet.

### Positioning statement

**Accelute** is the AI whiteboard tutor for students who learn better when they *see* math being worked out — not just read about it.

### Pricing tier ideas

| Tier | Audience | Suggested limits | Features |
|------|----------|------------------|----------|
| **Free** | Try-before-buy | 5 questions/day, mock or limited AI | Full whiteboard demo, browser TTS |
| **Student** | Individual learners | 100 questions/month | Premium voice, full AI, conversation history |
| **Family** | Up to 5 profiles | 500 questions/month | Multiple learners, progress (future) |
| **School / Tutor** | Institutions | Unlimited / seat-based | Admin dashboard, usage reports (future) |

### Key SaaS metrics to track later

- Questions asked per user
- Session length (time on whiteboard)
- Conversion: demo → signup → paid
- Topic distribution (which math areas are most asked)
- TTS vs. text-only engagement

### Suggested CTAs for landing page

| CTA | Placement |
|-----|-----------|
| **Try it free** | Hero — links to live demo / app |
| **See it teach a problem** | Hero secondary — auto-plays example lesson |
| **Start learning** | Pricing cards |
| **Book a demo** | B2B / school section |

---

## 12. Landing Page Section Outline

Suggested page structure using collected info:

1. **Hero**
   - Headline: *"Learn math the way teachers actually teach it."*
   - Subhead: AI whiteboard tutor that draws, writes, and explains out loud — stroke by stroke.
   - CTA: Try free + See it teach a problem
   - Search bar placeholder: "e.g. find the volume of a cuboid"
   - Social proof placeholder (student count, schools, etc.)

2. **Problem → Solution**
   - "Math isn't meant to be read in paragraphs."
    - Side-by-side: chatbot text wall vs. Accelute whiteboard

3. **How it works** (3 steps)
   - Ask → AI plans → Cursor teaches with voice

4. **Feature grid**
   - Stroke-by-stroke drawing
   - Synced voice narration
   - Remembers your questions
   - Works in any browser
   - Geometry, formulas, labels
   - Instant demo mode

5. **Live example / interactive demo**
   - Pre-filled question buttons:
     - "volume difference between cuboid and cube"
     - "pythagorean theorem with a 3-4-5 triangle"
     - "area of a rectangle"

6. **Who it's for**
   - Students, parents, tutors, schools

7. **Comparison table**
   - vs. chatbots, vs. videos, vs. human tutors

8. **Pricing**
   - Free / Student / Family / School tiers

9. **FAQ**
   - What subjects? (Math today, more coming)
   - Do I need a mic? (No — type your question)
   - Does it work on mobile? (Browser-based, best on desktop/tablet)
   - Is it a replacement for a teacher? (Supplement, not substitute)

10. **Footer CTA**
    - "Ask your first question — free."

---

## 13. Copy Bank (ready-to-use phrases)

### Headlines

- "AI that teaches on a whiteboard, not in a chat box."
- "Watch math come to life — stroke by stroke."
- "The tutor who draws while they explain."
- "Your math problem, taught live on a board."
- "Like a teacher at the whiteboard. Available anytime."

### Subheadlines

- "Type a question. Watch a virtual tutor sketch shapes, write formulas, and talk you through every step."
- "Geometry, mensuration, algebra — explained the way you'd learn in a classroom."
- "No installs. No scheduling. Just ask."

### Feature one-liners

- **Live drawing** — Shapes and formulas appear stroke by stroke, not all at once.
- **Synced narration** — The tutor speaks while the cursor draws — never out of sync.
- **Follow-up friendly** — Ask "explain more" and the tutor goes deeper, remembering context.
- **Always ready** — Stuck on homework at 11pm? The board is open.

### Trust / credibility lines

- "Built with the same architecture patterns as production AI companions."
- "Powered by frontier LLMs and natural voice synthesis."
- "Runs entirely in your browser — no downloads."

---

## 14. SEO & Metadata

### Current meta (from app)

- **Title:** Accelute — ai whiteboard tutor
- **Description:** an ai math tutor that draws on a whiteboard like a teacher

### Suggested landing page SEO

- **Title:** Accelute — AI Whiteboard Math Tutor | Learn by Watching It Drawn
- **Description:** Ask any math question and watch an AI tutor draw shapes, write formulas, and explain out loud on an interactive whiteboard. Free to try.
- **Keywords:** ai math tutor, whiteboard tutor, geometry help, visual math learning, ai homework help, mensuration tutor, interactive math tutor

---

## 15. Reference & Lineage

- **Architecture inspired by:** [Clicky](https://github.com/farzaa/clicky) — AI companion with cursor, TTS, and LLM proxy patterns (ported from macOS Swift to web TypeScript)
- **Whiteboard patterns referenced:** Sparks AI Math Tutor, Professor KIA, MathBoard, BoardyBoo
- **Internal build plan:** `.omo/plans/ai-tutor-whiteboard.md`

---

## 16. Open Questions for Marketing

Fill these in before final landing page copy:

- [ ] Public URL / domain (accelute.ai?)
- [ ] Founder story / why this exists
- [ ] Pricing numbers
- [ ] Launch date / waitlist vs. live signup
- [ ] Legal: COPPA/FERPA considerations for school segment?
- [ ] Logo beyond wordmark "Accelute"
- [ ] Demo video or GIF asset
- [ ] Testimonials / beta user quotes
- [ ] Social links, support email

---

## 17. Quick Reference — File Map

| What | Where |
|------|-------|
| Main app page | `app/page.tsx` |
| Metadata | `app/layout.tsx` |
| System prompt / persona | `lib/systemPrompt.ts` |
| Drawing protocol | `lib/drawingProtocol.ts` |
| Mock demo responses | `lib/mockResponses.ts` |
| Design tokens | `lib/designTokens.ts` |
| Whiteboard component | `components/Whiteboard.tsx` |
| Chat API proxy | `app/api/chat/route.ts` |
| TTS API proxy | `app/api/tts/route.ts` |
| Product build plan | `.omo/plans/ai-tutor-whiteboard.md` |
