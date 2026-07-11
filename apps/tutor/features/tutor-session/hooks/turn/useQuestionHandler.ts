import { useCallback } from "react";
import {
  IncrementalTagParser,
  lessonNarrationText,
  matchDiagramTemplate,
  buildTemplateIntroSegments,
  buildOpticsPrecisionIntro,
  opticsDecisionMetadata,
  isOpticsTemplateId,
  anchorToTextRect,
  prepareTemplateLessonSegments,
  type TutorSegment,
} from "@heytutor/drawing";
import {
  streamLLMResponse,
  TUTOR_SYSTEM_PROMPT,
  TUTOR_CONTINUATION_PROMPT,
  tutorDebug,
  resolveApiUrl,
  planDiagram,
  type DiagramPlan,
} from "@heytutor/tutor-core";
import { createTurnTelemetry } from "@/lib/turnTelemetry";
import { enrichStoredSegmentsWithReplayAudio } from "@/lib/replayTurns";
import { saveTurn, updateBoard, type StoredTurn } from "@/lib/boardsClient";
import { MAX_LLM_CONTINUATIONS, STREAM_SEGMENTS_LIVE } from "../../constants";
import { registerBoardAnchor } from "../../lib/boardLayout";
import { planToTemplate, buildPlannerIntroSegments } from "../../lib/planToTemplate";
import {
  createEmptySegmentPlanStats,
  isTeachingResponseIncomplete,
} from "../../lib/segmentPlanning";
import type { TurnControlApi, UseTurnLifecycleParams } from "./types";

export function useQuestionHandler(
  params: UseTurnLifecycleParams,
  turnControl: Pick<
    TurnControlApi,
    "finishLectureUi" | "applyTurnPhase" | "enqueueSegment" | "processResponseText"
  >,
) {
  const {
    sessionId,
    boards,
    narrationText,
    phase,
    boardLoaded,
    whiteboardRef,
    pendingQuestionRef,
    cancelRef,
    isPausedRef,
    conversationHistoryRef,
    turnActiveRef,
    turnAbortRef,
    collectedSegmentsRef,
    recordedSegmentsRef,
    rawResponseRef,
    currentTraceIdRef,
    segmentChainRef,
    drawChainRef,
    turnStatsRef,
    segmentPlanStatsRef,
    fbdPhaseMarkedRef,
    fbdPhaseStartedRef,
    activeDiagramTemplateRef,
    boardLayoutRef,
    turnTelemetryRef,
    speedRef,
    storedTurnsRef,
    setInputInteracted,
    setIsPaused,
    setIsReplaying,
    setTranscriptOpen,
    setLastError,
    setStoredTurnsCount,
    setBoards,
    setPhase,
    setNarrationText,
    setCurrentSegmentText,
    ensureTTSClient,
    resetBoardLayout,
    persistTurnForReplay,
    registerReplayBlobUrl,
    revokeReplayBlobUrls,
  } = params;

  const { finishLectureUi, applyTurnPhase, enqueueSegment, processResponseText } = turnControl;

  const handleQuestion = useCallback(
    async (question: string) => {
      const wb = whiteboardRef.current;
      if (!boardLoaded || !wb) {
        pendingQuestionRef.current = question;
        setInputInteracted(true);
        return;
      }
      if (phase !== "idle") {
        pendingQuestionRef.current = null;
        return;
      }

      pendingQuestionRef.current = null;

      tutorDebug("turn", "question submitted", {
        question_preview: question.slice(0, 120),
        board_id: sessionId,
      });

      cancelRef.current = false;
      isPausedRef.current = false;
      setIsPaused(false);
      setIsReplaying(false);
      setTranscriptOpen(false);
      setLastError(null);
      turnActiveRef.current = true;
      const abortController = new AbortController();

      const boardIdForName = sessionId;
      if (boardIdForName) {
        const needsName = boards.find(
          (b) => b.id === boardIdForName,
        )?.title === "new board";
        if (needsName) {
          void fetch(resolveApiUrl("/api/board-name"), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ question }),
          })
            .then((r) => r.json())
            .then((data) => {
              const title: string | undefined = data?.title;
              if (!title) return;
              void updateBoard(boardIdForName, { title }).then((board) => {
                if (!board) return;
                setBoards((prev) =>
                  prev.map((b) => (b.id === boardIdForName ? { ...b, title: board.title } : b)),
                );
              });
            })
            .catch(() => {
              // ignore — keep "new board" as fallback
            });
        }
      }
      turnAbortRef.current = abortController;
      let turnCancelled = false;
      setPhase("thinking");
      setNarrationText("");
      setCurrentSegmentText("");
      collectedSegmentsRef.current = [];
      recordedSegmentsRef.current = [];
      rawResponseRef.current = "";
      currentTraceIdRef.current = null;
      segmentChainRef.current = Promise.resolve();
      drawChainRef.current = Promise.resolve();
      turnStatsRef.current = { drawMs: 0, ttsChars: 0 };
      segmentPlanStatsRef.current = createEmptySegmentPlanStats();
      revokeReplayBlobUrls();
      fbdPhaseMarkedRef.current = false;
      fbdPhaseStartedRef.current = false;
      // Synchronous fallback so resetBoardLayout has a layout hint immediately.
      // The planner may override this once it returns.
      const fallbackTemplate = matchDiagramTemplate(question);
      activeDiagramTemplateRef.current = fallbackTemplate;
      resetBoardLayout(false, fallbackTemplate !== null);

      const tel = createTurnTelemetry();
      turnTelemetryRef.current = tel;
      const thinkingSpan = tel.span("thinking");
      let thinkingEnded = false;

      const endThinking = (metadata?: Record<string, unknown>) => {
        if (thinkingEnded) {
          return;
        }

        thinkingEnded = true;
        thinkingSpan.end(metadata);
      };

      const wsSpan = tel.span("websocket-connect");
      let wsEnded = false;

      const endWsConnect = (metadata: Record<string, unknown>) => {
        if (wsEnded) {
          return;
        }

        wsEnded = true;
        wsSpan.end(metadata);
      };

      // The planner runs concurrently with TTS prewarming. It understands the
      // question and emits precise drawing commands; templates are the fallback.
      setPhase("planning");
      const plannerSpan = tel.span("planner");
      const plannerStartedAt = Date.now();

      void ensureTTSClient().prewarm({
        onConnect: ({ ms, ok }) => {
          endWsConnect({
            latency_ms: Math.round(ms),
            ok,
          });
        },
      });

      const plannerUrl = resolveApiUrl("/api/chat");
      let plan: DiagramPlan | null = null;
      try {
        plan = await planDiagram(question, {
          proxyUrl: plannerUrl,
          sessionId: sessionId ?? undefined,
          signal: abortController.signal,
          timeoutMs: 8000,
        });
      } catch {
        plan = null;
      }
      const plannerLatencyMs = Date.now() - plannerStartedAt;

      // Resolve the active diagram source. Hand-crafted regex templates often
      // have domain-specific details (resistor rectangles, terminal marks,
      // detailed promptAddons with solution guidance) that the LLM planner
      // can't replicate. So we prefer the template when it exists and is at
      // least as detailed as the planner output. The planner is used for
      // novel questions that don't match any template.
      const plannerCommandCount = plan?.commands.length ?? 0;
      const templateCommandCount = fallbackTemplate?.commands.length ?? 0;

      let activeTemplate: import("@heytutor/drawing").DiagramTemplate | null;
      let diagramSource: "planner" | "template" | "none";
      let plannerOverridden = false;

      // Prefer hand-crafted optics family templates over the planner so lens/prism/TIR
      // never get a wrong generic diagram from a novel planner sketch.
      const opticsFamilyMatch =
        fallbackTemplate !== null && isOpticsTemplateId(fallbackTemplate.id);

      if (opticsFamilyMatch) {
        activeTemplate = fallbackTemplate;
        diagramSource = "template";
        plannerOverridden = plan !== null;
        activeDiagramTemplateRef.current = activeTemplate;
      } else if (fallbackTemplate && templateCommandCount >= plannerCommandCount) {
        // Template is at least as detailed as the planner — prefer it.
        activeTemplate = fallbackTemplate;
        diagramSource = "template";
      } else if (plan) {
        // Planner is more detailed, or no template matched — use planner.
        activeTemplate = planToTemplate(plan);
        diagramSource = "planner";
        activeDiagramTemplateRef.current = activeTemplate;
      } else {
        activeTemplate = fallbackTemplate;
        diagramSource = activeTemplate ? "template" : "none";
      }

      plannerSpan.end({
        source: diagramSource,
        latency_ms: plannerLatencyMs,
        diagram_type: plan?.diagramType ?? fallbackTemplate?.id ?? null,
        command_count: plan?.commands.length ?? null,
        template_command_count: templateCommandCount || null,
        planner_command_count: plannerCommandCount || null,
        template_preferred: diagramSource === "template" && plan !== null,
      });

      const runtimePromptAddon = activeTemplate?.promptAddon ?? "";
      const turnSystemPrompt = runtimePromptAddon
        ? `${TUTOR_SYSTEM_PROMPT}\n\n--- current lesson (runtime) ---\n${runtimePromptAddon}`
        : TUTOR_SYSTEM_PROMPT;
      const turnContinuationPrompt = runtimePromptAddon
        ? `${TUTOR_CONTINUATION_PROMPT}\n\n--- diagram reminder ---\n${runtimePromptAddon}`
        : TUTOR_CONTINUATION_PROMPT;

      // Transition from planning back to thinking before the LLM stream starts.
      setPhase("thinking");

      const introSegments = activeTemplate
        ? activeTemplate.plannerGenerated
          ? buildPlannerIntroSegments(activeTemplate)
          : buildTemplateIntroSegments(activeTemplate, question)
        : [];
      if (activeTemplate) {
        fbdPhaseStartedRef.current = true;
        for (const anchor of activeTemplate.anchors) {
          registerBoardAnchor(boardLayoutRef.current, anchorToTextRect(anchor));
        }

        const opticsIntro =
          isOpticsTemplateId(activeTemplate.id) || activeTemplate.id === "optics_ray"
            ? buildOpticsPrecisionIntro(activeTemplate, question)
            : null;

        if (opticsIntro) {
          const matchPayload = {
            template_id: activeTemplate.id,
            regex_id: activeTemplate.id,
            question_preview: question.slice(0, 120),
          };
          tel.mark("optics-match", matchPayload);
          tutorDebug("optics", "optics-match", matchPayload);

          const classifyPayload = {
            optics_kind: opticsIntro.classify.optics_kind,
            parsed_numbers: opticsIntro.classify.parsed_numbers,
            confidence: opticsIntro.classify.confidence,
            reason: opticsIntro.classify.reason,
          };
          tel.mark("optics-classify", classifyPayload);
          tutorDebug("optics", "optics-classify", classifyPayload);

          const introBuiltPayload = {
            segment_count: opticsIntro.intro_segment_count,
            command_summary: opticsIntro.command_summary,
            optics_kind: opticsIntro.optics_kind,
          };
          tel.mark("optics-intro-built", introBuiltPayload);
          tutorDebug("optics", "optics-intro-built", introBuiltPayload);

          tel.meta(
            opticsDecisionMetadata(opticsIntro, {
              diagram_source: diagramSource,
              allow_llm_draw: activeTemplate.allowLlmDrawInDiagramZone === true,
              planner_overridden: plannerOverridden,
            }),
          );
        }

        turnTelemetryRef.current?.mark("template-intro-queued", {
          template_id: activeTemplate.id,
          template_name: activeTemplate.name,
          diagram_source: diagramSource,
          planner_latency_ms: plannerLatencyMs,
          intro_segment_count: introSegments.length,
          command_count: activeTemplate.commands.length,
          ...(opticsIntro
            ? {
                optics_kind: opticsIntro.optics_kind,
                optics_intro_segment_count: opticsIntro.intro_segment_count,
              }
            : {}),
          commands: activeTemplate.commands.map((command) => ({
            type: command.type,
            params: command.params,
            ...(command.text ? { text: command.text } : {}),
          })),
        });

        if (opticsIntro) {
          const queuedPayload = {
            segment_count: opticsIntro.intro_segment_count,
            command_summary: opticsIntro.command_summary,
            diagram_source: diagramSource,
            optics_kind: opticsIntro.optics_kind,
          };
          tel.mark("optics-intro-queued", queuedPayload);
          tutorDebug("optics", "optics-intro-queued", queuedPayload);
        }

        // Diagram-guard telemetry: the count of draw/label commands reflects how
        // many components the deterministic builder placed. A mismatch against
        // what the lesson later solves (e.g. a phantom extra resistor) shows up
        // here as an extra draw+label pair for the same template.
        const introCommands = introSegments.flatMap((segment) => segment.commands ?? []);
        const diagramDrawCount = introCommands.filter((command) =>
          command.type.startsWith("DRAW_"),
        ).length;
        const diagramLabelCount = introCommands.filter(
          (command) => command.type === "LABEL",
        ).length;
        tutorDebug("draw", "queued diagram intro segments", {
          template: activeTemplate.id,
          source: diagramSource,
          segment_count: introSegments.length,
          diagram_draw_commands: diagramDrawCount,
          diagram_labels: diagramLabelCount,
          planner_latency_ms: plannerLatencyMs,
        });
      }

      if (STREAM_SEGMENTS_LIVE) {
        for (const segment of introSegments) {
          enqueueSegment(segment);
        }
      }

      try {
        // Mini-buffer for live-mode blocking: instead of enqueuing each segment
        // immediately, buffer it until the next segment arrives (or the stream
        // ends), then run prepareTemplateLessonSegments on the buffered segment
        // and enqueue the filtered result. This ensures the template guard
        // actually filters conflicting draw commands during the stream instead
        // of only running as a post-hoc audit.
        let bufferedSegment: TutorSegment | null = null;

        const flushBufferedSegment = () => {
          if (!bufferedSegment) return;
          const prepared = prepareTemplateLessonSegments([bufferedSegment], activeTemplate);
          for (const seg of prepared.segments) {
            enqueueSegment(seg);
          }
          if (prepared.blockedCommandCount > 0 || prepared.droppedSegmentCount > 0) {
            tutorDebug("draw", "live segment filtered by mini-buffer", {
              blocked_commands: prepared.blockedCommandCount,
              dropped_segments: prepared.droppedSegmentCount,
            });
          }
          bufferedSegment = null;
        };

        const parser = new IncrementalTagParser({
          onSegmentReady: (segment) => {
            if (STREAM_SEGMENTS_LIVE) {
              // Flush the previously buffered segment, then buffer this one.
              flushBufferedSegment();
              bufferedSegment = segment;
            } else {
              tutorDebug("parser", "segment ready from stream", {
                narration_preview: segment.narration.slice(0, 80),
                command_type: segment.command?.type ?? null,
                deferred: true,
              });
            }
          },
        });

        tutorDebug("turn", "LLM stream starting");

        let fullResponse = "";
        let lastStreamStats: Awaited<ReturnType<typeof streamLLMResponse>>["streamStats"];
        let traceId: string | null = null;
        let continueCount = 0;
        let previousChunk = "";
        let reasoningOnlyRetry = false;

        while (continueCount <= MAX_LLM_CONTINUATIONS) {
          const isContinuation = continueCount > 0 && !reasoningOnlyRetry;
          const streamResult = await streamLLMResponse(
            {
              systemPrompt: isContinuation
                ? turnContinuationPrompt
                : turnSystemPrompt,
              userPrompt: isContinuation ? "continue" : question,
              conversationHistory: isContinuation
                ? [
                    ...conversationHistoryRef.current,
                    {
                      user: question,
                      assistant: lessonNarrationText(fullResponse),
                    },
                  ]
                : conversationHistoryRef.current,
              proxyUrl: resolveApiUrl("/api/chat"),
              sessionId: sessionId ?? undefined,
              signal: abortController.signal,
              onTraceId: (id) => {
                currentTraceIdRef.current = id;
                tel.setTrace(id, sessionId ?? undefined);
              },
            },
            (delta) => {
              endThinking({ phase: "first_token", delta_chars: delta.length });
              if (delta.includes("[")) {
                tutorDebug("parser", "draw tag delta", {
                  delta_chars: delta.length,
                  preview: delta.slice(0, 80),
                });
              }
              parser.push(delta);
            },
          );

          fullResponse += streamResult.text;
          traceId = streamResult.traceId;
          lastStreamStats = streamResult.streamStats;

          if (cancelRef.current) {
            break;
          }

          // Reasoning-only starvation: the model spent its budget thinking and
          // emitted no spoken content. Retry the original question once instead
          // of failing the turn (upstream already raised the token ceiling).
          const reasoningOnlyChunk =
            streamResult.text.trim().length === 0 &&
            (streamResult.streamStats?.reasoningChars ?? 0) > 0;
          if (
            reasoningOnlyChunk &&
            !reasoningOnlyRetry &&
            continueCount < MAX_LLM_CONTINUATIONS
          ) {
            reasoningOnlyRetry = true;
            continueCount += 1;
            tutorDebug("turn", "reasoning-only response, retrying question", {
              reasoning_chars: streamResult.streamStats?.reasoningChars ?? 0,
            });
            continue;
          }
          reasoningOnlyRetry = false;

          if (
            !isTeachingResponseIncomplete(
              streamResult.text,
              fullResponse,
              previousChunk,
            )
          ) {
            break;
          }

          previousChunk = streamResult.text;
          continueCount += 1;
          if (continueCount > MAX_LLM_CONTINUATIONS) {
            break;
          }

          tutorDebug("turn", "continuing truncated LLM response", {
            continuation: continueCount,
            response_chars: fullResponse.length,
          });
        }

        const rawResponse = fullResponse;
        const streamStats = lastStreamStats;

        tutorDebug("turn", "LLM stream finished", {
          response_chars: rawResponse.length,
          trace_id: traceId,
          stream_stats: streamStats,
          segments_so_far: collectedSegmentsRef.current.length,
          continuations: continueCount,
        });

        if (cancelRef.current) {
          turnCancelled = true;
          return;
        }

        if (traceId) {
          currentTraceIdRef.current = traceId;
          tel.setTrace(traceId, sessionId ?? undefined);
        }

        if (!thinkingEnded) {
          endThinking({ phase: "no_first_token" });
        }

        parser.flush();
        // Flush the last buffered segment through the template guard.
        flushBufferedSegment();

        const responseText = rawResponse.trim();
        rawResponseRef.current = responseText;

        if (responseText.length === 0) {
          const reasoningOnly = (streamStats?.reasoningChars ?? 0) > 0;
          const message = reasoningOnly
            ? "the ai couldn't generate a response — try rephrasing"
            : "the ai returned an empty response. try asking again.";
          tutorDebug("turn", "empty response", {
            reasoning_chars: streamStats?.reasoningChars ?? 0,
            stream_stats: streamStats,
          });
          setNarrationText(message);
          setCurrentSegmentText(message);
          setLastError({ message, question });
          return;
        }

        tutorDebug("turn", "planning lesson from full response");
        applyTurnPhase("speaking");

        await processResponseText(responseText, introSegments, STREAM_SEGMENTS_LIVE);

        const finalNarration =
          responseText.length > 0 ? lessonNarrationText(responseText) : narrationText;

        if (finalNarration.trim() && !turnCancelled && !cancelRef.current) {
          conversationHistoryRef.current.push({
            user: question,
            assistant: finalNarration,
          });

          if (conversationHistoryRef.current.length > 10) {
            conversationHistoryRef.current.shift();
          }

          const currentId = sessionId;
          if (currentId && rawResponseRef.current) {
            const savedTurn = await saveTurn(currentId, {
              question,
              rawResponse: rawResponseRef.current,
              speedMultiplier: speedRef.current,
              traceId: currentTraceIdRef.current,
              segments: recordedSegmentsRef.current,
            });

            let turnForReplay: StoredTurn | null = null;
            if (savedTurn) {
              turnForReplay = {
                ...savedTurn,
                segments: enrichStoredSegmentsWithReplayAudio(
                  savedTurn.segments,
                  recordedSegmentsRef.current,
                  registerReplayBlobUrl,
                ),
              };
            } else if (recordedSegmentsRef.current.length > 0) {
              turnForReplay = persistTurnForReplay(
                question,
                rawResponseRef.current,
                recordedSegmentsRef.current,
              );
            }

            if (turnForReplay) {
              storedTurnsRef.current = [...storedTurnsRef.current, turnForReplay];
              setStoredTurnsCount(storedTurnsRef.current.length);
            }

            setBoards((prev) =>
              prev.map((b) =>
                b.id === currentId ? { ...b, preview: question.slice(0, 60) } : b,
              ),
            );
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          turnCancelled = true;
          endThinking({ phase: "cancelled" });
          return;
        }

        if (cancelRef.current) {
          turnCancelled = true;
          return;
        }

        console.error("Tutor error:", error);
        let message = "something went wrong. try asking again.";
        if (error instanceof TypeError && /fetch|network|failed to fetch/i.test(error.message)) {
          message = "network error — check your connection";
        } else if (error instanceof Error && /tts|audio|elevenlabs|speech/i.test(error.message)) {
          message = "audio generation failed — the lesson continues without voice";
        } else if (error instanceof Error && /timeout|aborted|abort/i.test(error.message)) {
          message = "the request took too long. try asking again.";
        }
        setNarrationText(message);
        setCurrentSegmentText(message);
        setLastError({ message, question });
        endThinking({ phase: "error" });
      } finally {
        turnAbortRef.current = null;
        endWsConnect({ ok: false, reason: "turn_complete_without_connect_event" });
        if (!thinkingEnded) {
          endThinking({ phase: turnCancelled ? "cancelled" : "turn_complete" });
        }

        tel.meta({
          total_duration_ms: tel.durationMs(),
          segment_count: collectedSegmentsRef.current.length,
          total_draw_ms: turnStatsRef.current.drawMs,
          total_tts_chars: turnStatsRef.current.ttsChars,
          diagram_template_id: segmentPlanStatsRef.current.activeTemplateId,
          diagram_template_name: segmentPlanStatsRef.current.activeTemplateName,
          diagram_planned_segment_count: segmentPlanStatsRef.current.plannedSegmentCount,
          diagram_intro_segment_count: segmentPlanStatsRef.current.introSegmentCount,
          diagram_llm_segment_count: segmentPlanStatsRef.current.llmSegmentCount,
          diagram_blocked_template_draw_commands:
            segmentPlanStatsRef.current.blockedTemplateDrawCommands,
          diagram_dropped_template_redraw_segments:
            segmentPlanStatsRef.current.droppedTemplateRedrawSegments,
          question_preview: question.slice(0, 120),
          cancelled: turnCancelled,
        });

        tutorDebug("turn", "turn complete", {
          cancelled: turnCancelled,
          segment_count: collectedSegmentsRef.current.length,
          total_draw_ms: turnStatsRef.current.drawMs,
          total_tts_chars: turnStatsRef.current.ttsChars,
        });

        finishLectureUi();

        const telToFlush = turnTelemetryRef.current;
        turnTelemetryRef.current = null;
        void telToFlush?.flush();
      }
    },
    [
      sessionId,
      boards,
      narrationText,
      phase,
      processResponseText,
      enqueueSegment,
      resetBoardLayout,
      boardLoaded,
      persistTurnForReplay,
      registerReplayBlobUrl,
      revokeReplayBlobUrls,
      finishLectureUi,
      ensureTTSClient,
      applyTurnPhase,
      whiteboardRef,
      pendingQuestionRef,
      setInputInteracted,
      cancelRef,
      isPausedRef,
      setIsPaused,
      setIsReplaying,
      setTranscriptOpen,
      setLastError,
      turnActiveRef,
      turnAbortRef,
      collectedSegmentsRef,
      recordedSegmentsRef,
      rawResponseRef,
      currentTraceIdRef,
      segmentChainRef,
      drawChainRef,
      turnStatsRef,
      segmentPlanStatsRef,
      fbdPhaseMarkedRef,
      fbdPhaseStartedRef,
      activeDiagramTemplateRef,
      boardLayoutRef,
      turnTelemetryRef,
      conversationHistoryRef,
      speedRef,
      storedTurnsRef,
      setStoredTurnsCount,
      setBoards,
      setPhase,
      setNarrationText,
      setCurrentSegmentText,
    ],
  );

  return { handleQuestion };
}
