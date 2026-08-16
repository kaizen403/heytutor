"""Deterministic full-syllabus classification sidecar and SQLite index.

The canonical question-v3 records are inputs only.  This module writes a
separate, auditable assignment for every question and can extend the normal
question-bank SQLite index with normalized syllabus tables.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import tempfile
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

from .models import (
    ValidationError,
    load_documents,
    load_json,
    load_jsonl,
    load_questions,
    validate_corpus,
    write_jsonl,
)
from .pipeline import PipelineError, build_sqlite_database


TAXONOMY_SCHEMA_VERSION = "question-bank-syllabus-taxonomy/v1"
RULES_SCHEMA_VERSION = "question-bank-syllabus-unit-rules/v1"
ASSIGNMENT_SCHEMA_VERSION = "question-bank-syllabus-assignment/v1"
REPORT_SCHEMA_VERSION = "question-bank-syllabus-report/v1"
DATABASE_SCHEMA_VERSION = "question-bank-full-sqlite/v1"
ASSIGNMENT_METHOD = "deterministic-lexical/v1"

SUPPORTED_SUBJECTS = ("Mathematics", "Physics")
ASSIGNMENT_SUBJECTS = (*SUPPORTED_SUBJECTS, "Chemistry")
SUBJECT_STATUSES = ("resolved", "missing_context", "conflict", "out_of_scope")
ASSIGNMENT_STATUSES = ("classified", "needs_review", "out_of_scope")
CONFIDENCES = ("high", "medium")
SYLLABUS_SCOPES = (
    "active",
    "outside_active_syllabus",
    "undetermined",
    "out_of_scope",
)
EVIDENCE_WEIGHTS = {
    "existing_topic_projection": 20,
    "strong_phrase": 8,
    "supporting_phrase": 3,
    "pattern": 5,
    "supplemental_alias": 8,
    "exclusion": -8,
}

_ASSIGNMENT_KEYS = {
    "schema_version",
    "question_id",
    "framework_id",
    "subject",
    "subject_status",
    "status",
    "primary_unit_id",
    "primary_topic_id",
    "confidence",
    "score",
    "margin",
    "syllabus_scope",
    "method",
    "candidate_units",
    "matched_topic_ids",
    "review_reasons",
}
_CANDIDATE_KEYS = {"unit_id", "score", "evidence"}
_EVIDENCE_KEYS = {"kind", "value", "weight"}
_QUESTION_ID_RE = re.compile(r"^q_[0-9a-f]{64}$")
_IDENTIFIER_RE = re.compile(r"^[a-z0-9][a-z0-9._|-]*$")
_DOCUMENT_SUBJECT_SPLIT_RE = re.compile(r"[,/;+&]")
_ALPHABETIC_WORD_RE = re.compile(r"[^\W\d_]+(?:['\u2019][^\W\d_]+)?", re.UNICODE)
_ANSWER_TAIL_RE = re.compile(r"\bANSWER\s*:\s*(.{101,})", re.IGNORECASE | re.DOTALL)
_ANSWER_SUMMARY_RE = re.compile(
    r"\b(?:"
    r"Answers?\s+for\s+the\s+above\s+questions?"
    r"|Question\s+Stem\s+for\s+Question\s+Nos?\.?\s*\d+\s+and\s+\d+"
    r"|Answer\s+Q\.?\s*\d+\s+and\s+Q\.?\s*\d+"
    r")\b",
    re.IGNORECASE,
)
_PAGE_MARKER_RE = re.compile(r"\bPage\s+\d+(?:\s+of\s+\d+)?\b", re.IGNORECASE)
_INLINE_OPTION_RE = re.compile(r"(?:^|\s)\(?[A-Da-d]\)?\s*[.):]", re.MULTILINE)
_OPTION_LINE_RE = re.compile(
    r"^\s*(?:\(?[A-Da-d]\)?\s*[.):]|[1-4]\s*[.)])\s*\S.*$"
)
_ASCII_WORD_RE = re.compile(r"[A-Za-z]+(?:['\u2019][A-Za-z]+)?")
_MATH_NOTATION_RE = re.compile(
    r"[=+*/^\u222b\u2211\u221a\u221e\u2264\u2265\u2260\u2248\u2202\u2206\u2192]"
    r"|\b(?:lim|sin|cos|tan|cot|sec|cosec|log|det|dx|dy)\b"
    r"|\b(?:find|solve|evaluate|calculate|prove|show)\b.{0,30}\b[a-z]\b",
    re.IGNORECASE,
)
_MOJIBAKE_MARKERS = frozenset("\u00c2\u00c3\u00e2\u00f0")
_QUESTION_TASK_CUE_RE = re.compile(
    r"\b(?:"
    r"what|why|how|which|find|calculate|explain|state|define|derive|show|prove|"
    r"write|draw|determine|evaluate"
    r")\b",
    re.IGNORECASE,
)
_BLOCKING_QUALITY_REASONS = frozenset(
    {
        "conflicting_subject_context",
        "missing_subject_context",
        "option_only_fragment",
        "possible_merged_questions",
        "very_short_non_mathematical_text",
    }
)
_REPORT_KEYS = {
    "schema_version",
    "generated_at",
    "framework_id",
    "taxonomy_schema_version",
    "assignment_schema_version",
    "method",
    "input_counts",
    "output_counts",
    "subject_counts",
    "subject_status_counts",
    "status_counts",
    "confidence_counts",
    "syllabus_scope_counts",
    "per_unit",
    "zero_coverage_unit_ids",
    "review_reason_counts",
    "review_samples",
    "source_release_status",
}


def _require(condition: bool, path: str, message: str) -> None:
    if not condition:
        raise ValidationError(f"{path}: {message}")


def _exact_keys(value: dict[str, Any], expected: set[str], path: str) -> None:
    missing = expected - value.keys()
    extra = value.keys() - expected
    _require(not missing, path, f"missing fields: {', '.join(sorted(missing))}")
    _require(not extra, path, f"unknown fields: {', '.join(sorted(extra))}")


def _nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _integer(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _string_array(value: Any, path: str, *, allow_empty: bool = True) -> None:
    _require(isinstance(value, list), path, "expected an array")
    if not allow_empty:
        _require(bool(value), path, "expected at least one item")
    _require(
        all(_nonempty_string(item) for item in value),
        path,
        "expected non-empty strings",
    )
    _require(len(value) == len(set(value)), path, "expected unique strings")


def validate_taxonomy(value: Any, path: str = "taxonomy") -> None:
    """Strictly validate the taxonomy contract and all internal references."""

    _require(isinstance(value, dict), path, "expected an object")
    _exact_keys(
        value,
        {"schema_version", "active_framework_id", "frameworks", "subjects"},
        path,
    )
    _require(
        value["schema_version"] == TAXONOMY_SCHEMA_VERSION,
        f"{path}.schema_version",
        f"expected {TAXONOMY_SCHEMA_VERSION}",
    )
    _require(
        _nonempty_string(value["active_framework_id"]),
        f"{path}.active_framework_id",
        "expected a non-empty string",
    )
    _require(
        isinstance(value["frameworks"], list) and bool(value["frameworks"]),
        f"{path}.frameworks",
        "expected at least one framework",
    )

    framework_ids: set[str] = set()
    active_ids: set[str] = set()
    for index, framework in enumerate(value["frameworks"]):
        framework_path = f"{path}.frameworks[{index}]"
        _require(isinstance(framework, dict), framework_path, "expected an object")
        _exact_keys(framework, {"framework_id", "label", "status", "source"}, framework_path)
        framework_id = framework["framework_id"]
        _require(
            _nonempty_string(framework_id) and bool(_IDENTIFIER_RE.fullmatch(framework_id)),
            f"{framework_path}.framework_id",
            "expected a unique lowercase identifier",
        )
        _require(framework_id not in framework_ids, f"{framework_path}.framework_id", "duplicate framework id")
        framework_ids.add(framework_id)
        _require(_nonempty_string(framework["label"]), f"{framework_path}.label", "expected a non-empty string")
        _require(framework["status"] in {"active", "historical"}, f"{framework_path}.status", "expected active or historical")
        if framework["status"] == "active":
            active_ids.add(framework_id)
        source = framework["source"]
        _require(isinstance(source, dict), f"{framework_path}.source", "expected an object")
        _exact_keys(source, {"publisher", "url", "local_path", "notes"}, f"{framework_path}.source")
        _require(_nonempty_string(source["publisher"]), f"{framework_path}.source.publisher", "expected a non-empty string")
        for field in ("url", "local_path", "notes"):
            _require(
                source[field] is None or _nonempty_string(source[field]),
                f"{framework_path}.source.{field}",
                "expected a non-empty string or null",
            )

    active_framework_id = value["active_framework_id"]
    _require(active_framework_id in framework_ids, f"{path}.active_framework_id", "does not reference a framework")
    _require(active_ids == {active_framework_id}, f"{path}.frameworks", "expected exactly the declared active framework")
    _require(
        isinstance(value["subjects"], list) and bool(value["subjects"]),
        f"{path}.subjects",
        "expected at least one subject",
    )

    subject_ids: set[str] = set()
    subject_names: set[str] = set()
    unit_ids: set[str] = set()
    topic_ids: set[str] = set()
    for subject_index, subject in enumerate(value["subjects"]):
        subject_path = f"{path}.subjects[{subject_index}]"
        _require(isinstance(subject, dict), subject_path, "expected an object")
        _exact_keys(subject, {"subject_id", "name", "units", "supplemental_units"}, subject_path)
        subject_id = subject["subject_id"]
        subject_name = subject["name"]
        _require(
            _nonempty_string(subject_id) and bool(_IDENTIFIER_RE.fullmatch(subject_id)),
            f"{subject_path}.subject_id",
            "expected a lowercase identifier",
        )
        _require(subject_id not in subject_ids, f"{subject_path}.subject_id", "duplicate subject id")
        subject_ids.add(subject_id)
        _require(_nonempty_string(subject_name), f"{subject_path}.name", "expected a non-empty string")
        _require(subject_name not in subject_names, f"{subject_path}.name", "duplicate subject name")
        subject_names.add(subject_name)
        for field in ("units", "supplemental_units"):
            _require(isinstance(subject[field], list), f"{subject_path}.{field}", "expected an array")
        _require(bool(subject["units"]), f"{subject_path}.units", "expected at least one regular unit")

        unit_numbers: set[int] = set()
        for supplemental, units_field in ((False, "units"), (True, "supplemental_units")):
            for unit_index, unit in enumerate(subject[units_field]):
                unit_path = f"{subject_path}.{units_field}[{unit_index}]"
                _require(isinstance(unit, dict), unit_path, "expected an object")
                _exact_keys(unit, {"unit_id", "unit_number", "name", "topics"}, unit_path)
                unit_id = unit["unit_id"]
                _require(
                    _nonempty_string(unit_id)
                    and bool(_IDENTIFIER_RE.fullmatch(unit_id))
                    and unit_id.startswith(f"{subject_id}|"),
                    f"{unit_path}.unit_id",
                    "expected a subject-prefixed lowercase identifier",
                )
                _require(unit_id not in unit_ids, f"{unit_path}.unit_id", "duplicate unit id")
                unit_ids.add(unit_id)
                if supplemental:
                    _require(unit["unit_number"] is None, f"{unit_path}.unit_number", "supplemental units require null")
                else:
                    _require(
                        _integer(unit["unit_number"]) and unit["unit_number"] >= 1,
                        f"{unit_path}.unit_number",
                        "expected a positive integer",
                    )
                    _require(unit["unit_number"] not in unit_numbers, f"{unit_path}.unit_number", "duplicate unit number")
                    unit_numbers.add(unit["unit_number"])
                _require(_nonempty_string(unit["name"]), f"{unit_path}.name", "expected a non-empty string")
                _require(
                    isinstance(unit["topics"], list) and bool(unit["topics"]),
                    f"{unit_path}.topics",
                    "expected at least one topic",
                )
                for topic_index, topic in enumerate(unit["topics"]):
                    topic_path = f"{unit_path}.topics[{topic_index}]"
                    _require(isinstance(topic, dict), topic_path, "expected an object")
                    _exact_keys(topic, {"topic_id", "label", "aliases", "framework_ids", "notes"}, topic_path)
                    topic_id = topic["topic_id"]
                    _require(
                        _nonempty_string(topic_id)
                        and bool(_IDENTIFIER_RE.fullmatch(topic_id))
                        and topic_id.startswith(f"{unit_id}|"),
                        f"{topic_path}.topic_id",
                        "expected a unit-prefixed lowercase identifier",
                    )
                    _require(topic_id not in topic_ids, f"{topic_path}.topic_id", "duplicate topic id")
                    topic_ids.add(topic_id)
                    _require(_nonempty_string(topic["label"]), f"{topic_path}.label", "expected a non-empty string")
                    _string_array(topic["aliases"], f"{topic_path}.aliases")
                    _string_array(topic["framework_ids"], f"{topic_path}.framework_ids")
                    for framework_id in topic["framework_ids"]:
                        _require(framework_id in framework_ids, f"{topic_path}.framework_ids", f"unknown framework {framework_id}")
                    _require(
                        topic["notes"] is None or _nonempty_string(topic["notes"]),
                        f"{topic_path}.notes",
                        "expected a non-empty string or null",
                    )


def load_taxonomy(path: Path) -> dict[str, Any]:
    value = load_json(path)
    validate_taxonomy(value, str(path))
    return value


def _taxonomy_maps(taxonomy: dict[str, Any]) -> dict[str, Any]:
    units: dict[str, dict[str, Any]] = {}
    topics: dict[str, dict[str, Any]] = {}
    unit_subject: dict[str, str] = {}
    supplemental: set[str] = set()
    regular_by_subject: dict[str, list[dict[str, Any]]] = defaultdict(list)
    supplemental_by_subject: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for subject in taxonomy["subjects"]:
        for field, is_supplemental in (("units", False), ("supplemental_units", True)):
            for unit in subject[field]:
                units[unit["unit_id"]] = unit
                unit_subject[unit["unit_id"]] = subject["name"]
                destination = supplemental_by_subject if is_supplemental else regular_by_subject
                destination[subject["name"]].append(unit)
                if is_supplemental:
                    supplemental.add(unit["unit_id"])
                for topic in unit["topics"]:
                    topics[topic["topic_id"]] = {**topic, "unit_id": unit["unit_id"]}
    return {
        "units": units,
        "topics": topics,
        "unit_subject": unit_subject,
        "supplemental": supplemental,
        "regular_by_subject": dict(regular_by_subject),
        "supplemental_by_subject": dict(supplemental_by_subject),
    }


def validate_unit_rules(
    value: Any,
    taxonomy: dict[str, Any] | None = None,
    path: str = "rules",
) -> None:
    """Strictly validate one subject's regular-unit lexical rules."""

    _require(isinstance(value, dict), path, "expected an object")
    _exact_keys(value, {"schema_version", "subject", "units"}, path)
    _require(
        value["schema_version"] == RULES_SCHEMA_VERSION,
        f"{path}.schema_version",
        f"expected {RULES_SCHEMA_VERSION}",
    )
    _require(value["subject"] in SUPPORTED_SUBJECTS, f"{path}.subject", f"expected one of {SUPPORTED_SUBJECTS}")
    _require(isinstance(value["units"], list) and bool(value["units"]), f"{path}.units", "expected at least one unit")
    seen_unit_ids: set[str] = set()
    for index, rule in enumerate(value["units"]):
        rule_path = f"{path}.units[{index}]"
        _require(isinstance(rule, dict), rule_path, "expected an object")
        _exact_keys(
            rule,
            {"unit_id", "strong_phrases", "supporting_phrases", "patterns", "exclusions"},
            rule_path,
        )
        _require(_nonempty_string(rule["unit_id"]), f"{rule_path}.unit_id", "expected a non-empty string")
        _require(rule["unit_id"] not in seen_unit_ids, f"{rule_path}.unit_id", "duplicate unit rule")
        seen_unit_ids.add(rule["unit_id"])
        for field in ("strong_phrases", "supporting_phrases", "patterns", "exclusions"):
            _string_array(rule[field], f"{rule_path}.{field}")
        _require(
            bool(rule["strong_phrases"] or rule["supporting_phrases"] or rule["patterns"]),
            rule_path,
            "at least one positive matcher is required",
        )
        for pattern_index, pattern in enumerate(rule["patterns"]):
            try:
                re.compile(pattern, re.IGNORECASE)
            except re.error as exc:
                raise ValidationError(f"{rule_path}.patterns[{pattern_index}]: invalid regular expression: {exc}") from exc

    if taxonomy is None:
        return
    validate_taxonomy(taxonomy)
    maps = _taxonomy_maps(taxonomy)
    expected = {
        unit["unit_id"]
        for unit in maps["regular_by_subject"].get(value["subject"], [])
    }
    _require(bool(expected), f"{path}.subject", "subject does not exist in the taxonomy")
    missing = expected - seen_unit_ids
    extra = seen_unit_ids - expected
    _require(not missing, f"{path}.units", f"missing unit rules: {', '.join(sorted(missing))}")
    _require(not extra, f"{path}.units", f"unknown or cross-subject units: {', '.join(sorted(extra))}")


def load_unit_rules(path: Path, taxonomy: dict[str, Any] | None = None) -> dict[str, Any]:
    value = load_json(path)
    validate_unit_rules(value, taxonomy, str(path))
    return value


def load_syllabus_inputs(
    taxonomy_path: Path, rule_paths: Iterable[Path]
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    taxonomy = load_taxonomy(taxonomy_path)
    rules_by_subject: dict[str, dict[str, Any]] = {}
    for rule_path in rule_paths:
        rules = load_unit_rules(rule_path, taxonomy)
        subject = rules["subject"]
        _require(subject not in rules_by_subject, str(rule_path), f"duplicate rules for {subject}")
        rules_by_subject[subject] = rules
    taxonomy_subjects = {subject["name"] for subject in taxonomy["subjects"]}
    _require(
        set(rules_by_subject) == taxonomy_subjects,
        "rules",
        "expected exactly one rules document for each taxonomy subject",
    )
    return taxonomy, rules_by_subject


def _normalize_subject(value: str) -> str | None:
    normalized = " ".join(value.split()).casefold()
    aliases = {
        "math": "Mathematics",
        "maths": "Mathematics",
        "mathematics": "Mathematics",
        "physics": "Physics",
        "chemistry": "Chemistry",
    }
    return aliases.get(normalized)


def resolve_question_subject(
    question: dict[str, Any], documents_by_id: dict[str, dict[str, Any]]
) -> tuple[str | None, str, list[str]]:
    """Resolve provenance subjects without borrowing text from combined papers."""

    resolved: set[str] = set()
    missing_combined_context = False
    unsupported_context = False
    for source_ref in question["source_refs"]:
        context = source_ref["subject_context"]
        if context is not None:
            normalized = _normalize_subject(context)
            if normalized is None:
                unsupported_context = True
            else:
                resolved.add(normalized)
            continue
        document = documents_by_id[source_ref["document_id"]]
        parts = [
            part.strip()
            for part in _DOCUMENT_SUBJECT_SPLIT_RE.split(document["subject"])
            if part.strip()
        ]
        if len(parts) != 1:
            missing_combined_context = True
            continue
        normalized = _normalize_subject(parts[0])
        if normalized is None:
            unsupported_context = True
        else:
            resolved.add(normalized)

    if len(resolved) > 1:
        return None, "conflict", ["conflicting_subject_context"]
    if resolved:
        subject = next(iter(resolved))
        if subject == "Chemistry":
            return subject, "out_of_scope", []
        return subject, "resolved", []
    if missing_combined_context:
        return None, "missing_context", ["missing_subject_context"]
    if unsupported_context:
        return None, "out_of_scope", ["unsupported_subject"]
    # Valid question-v3 rows always have a source, so this is defensive only.
    return None, "missing_context", ["missing_subject_context"]


def _normalized_match_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value)
    normalized = normalized.translate(
        str.maketrans(
            {
                "\u2018": "'",
                "\u2019": "'",
                "\u201b": "'",
                "\u2010": "-",
                "\u2011": "-",
                "\u2012": "-",
                "\u2013": "-",
                "\u2014": "-",
                "\u2212": "-",
            }
        )
    )
    return " ".join(normalized.split())


@lru_cache(maxsize=4096)
def _phrase_pattern(phrase: str) -> re.Pattern[str]:
    normalized = _normalized_match_text(phrase)
    pieces = [re.escape(piece) for piece in normalized.split(" ")]
    expression = r"\s+".join(pieces)
    if normalized and (normalized[0].isalnum() or normalized[0] == "_"):
        expression = r"(?<!\w)" + expression
    if normalized and (normalized[-1].isalnum() or normalized[-1] == "_"):
        expression += r"(?!\w)"
    return re.compile(expression, re.IGNORECASE)


@lru_cache(maxsize=4096)
def _phrase_needle(phrase: str) -> str:
    return _normalized_match_text(phrase).casefold()


@lru_cache(maxsize=1024)
def _rule_pattern(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.IGNORECASE)


def _phrase_match(phrase: str, haystack: str) -> re.Match[str] | None:
    # Nearly all unit phrases are absent.  The literal prefilter avoids a
    # costly boundary-regex search while preserving the regex as authority for
    # the comparatively small set of literal hits.
    if _phrase_needle(phrase) not in haystack:
        return None
    return _phrase_pattern(phrase).search(haystack)


def _phrase_matches(phrase: str, haystack: str) -> bool:
    return _phrase_match(phrase, haystack) is not None


def _select_nonoverlapping_positive_evidence(
    matches: list[tuple[dict[str, Any], tuple[int, int]]],
) -> list[dict[str, Any]]:
    """Keep independent signals while collapsing phrase/regex double counts."""

    selected: list[tuple[dict[str, Any], tuple[int, int]]] = []
    selected_keys: set[tuple[str, str, int]] = set()
    for evidence, span in sorted(
        matches,
        key=lambda item: (
            -item[0]["weight"],
            -(item[1][1] - item[1][0]),
            item[1][0],
            _evidence_sort_key(item[0]),
        ),
    ):
        key = (evidence["kind"], evidence["value"], evidence["weight"])
        if key in selected_keys:
            continue
        if any(
            span[0] < selected_span[1] and selected_span[0] < span[1]
            for _, selected_span in selected
        ):
            continue
        selected.append((evidence, span))
        selected_keys.add(key)
    return [evidence for evidence, _ in selected]


def _evidence_sort_key(evidence: dict[str, Any]) -> tuple[str, str, str, int]:
    return (
        evidence["kind"],
        evidence["value"].casefold(),
        evidence["value"],
        evidence["weight"],
    )


def _candidate_sort_key(candidate: dict[str, Any]) -> tuple[int, str]:
    return (-candidate["score"], candidate["unit_id"])


def score_question_units(
    question: dict[str, Any],
    subject: str,
    taxonomy: dict[str, Any],
    rules_by_subject: dict[str, dict[str, Any]],
    *,
    _maps: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Return at most three deterministically ranked, subject-gated candidates."""

    _require(subject in SUPPORTED_SUBJECTS, "subject", f"expected one of {SUPPORTED_SUBJECTS}")
    _require(subject in rules_by_subject, "rules", f"missing rules for {subject}")
    maps = _maps or _taxonomy_maps(taxonomy)
    match_text = _normalized_match_text(question["text"])
    haystack = match_text.casefold()
    existing_topic = question.get("topic")
    candidates: list[dict[str, Any]] = []
    rules = {
        rule["unit_id"]: rule for rule in rules_by_subject[subject]["units"]
    }

    for unit in maps["regular_by_subject"].get(subject, []):
        rule = rules[unit["unit_id"]]
        evidence: list[dict[str, Any]] = []
        positive_matches: list[tuple[dict[str, Any], tuple[int, int]]] = []
        positive_match = False
        if (
            isinstance(existing_topic, str)
            and _normalized_match_text(existing_topic).casefold()
            == _normalized_match_text(unit["name"]).casefold()
        ):
            evidence.append(
                {
                    "kind": "existing_topic_projection",
                    "value": existing_topic,
                    "weight": EVIDENCE_WEIGHTS["existing_topic_projection"],
                }
            )
            positive_match = True
        for field, kind in (
            ("strong_phrases", "strong_phrase"),
            ("supporting_phrases", "supporting_phrase"),
        ):
            for phrase in rule[field]:
                match = _phrase_match(phrase, haystack)
                if match is not None:
                    positive_matches.append(
                        (
                            {
                                "kind": kind,
                                "value": phrase,
                                "weight": EVIDENCE_WEIGHTS[kind],
                            },
                            match.span(),
                        )
                    )
                    positive_match = True
        for pattern in rule["patterns"]:
            for match in _rule_pattern(pattern).finditer(match_text):
                positive_matches.append(
                    (
                        {
                            "kind": "pattern",
                            "value": pattern,
                            "weight": EVIDENCE_WEIGHTS["pattern"],
                        },
                        match.span(),
                    )
                )
                positive_match = True
        evidence.extend(_select_nonoverlapping_positive_evidence(positive_matches))
        for phrase in rule["exclusions"]:
            if _phrase_matches(phrase, haystack):
                evidence.append(
                    {
                        "kind": "exclusion",
                        "value": phrase,
                        "weight": EVIDENCE_WEIGHTS["exclusion"],
                    }
                )
        if not positive_match:
            continue
        evidence = sorted(
            {(
                item["kind"],
                item["value"],
                item["weight"],
            ): item for item in evidence}.values(),
            key=_evidence_sort_key,
        )
        candidates.append(
            {
                "unit_id": unit["unit_id"],
                "score": sum(item["weight"] for item in evidence),
                "evidence": evidence,
            }
        )

    for unit in maps["supplemental_by_subject"].get(subject, []):
        positive_matches = []
        for topic in unit["topics"]:
            for phrase in [topic["label"], *topic["aliases"]]:
                match = _phrase_match(phrase, haystack)
                if match is not None:
                    positive_matches.append(
                        (
                            {
                                "kind": "supplemental_alias",
                                "value": phrase,
                                "weight": EVIDENCE_WEIGHTS["supplemental_alias"],
                            },
                            match.span(),
                        )
                    )
        evidence = _select_nonoverlapping_positive_evidence(positive_matches)
        if not evidence:
            continue
        evidence = sorted(
            {(
                item["kind"],
                item["value"],
                item["weight"],
            ): item for item in evidence}.values(),
            key=_evidence_sort_key,
        )
        candidates.append(
            {
                "unit_id": unit["unit_id"],
                "score": sum(item["weight"] for item in evidence),
                "evidence": evidence,
            }
        )

    return sorted(candidates, key=_candidate_sort_key)[:3]


@lru_cache(maxsize=4096)
def _topic_phrase_normalized(value: str) -> str:
    normalized = _normalized_match_text(value).casefold()
    normalized = re.sub(r"[^\w]+", " ", normalized, flags=re.UNICODE)
    return " ".join(normalized.split())


def _topic_value_normalized(value: str) -> str:
    normalized = _normalized_match_text(value).casefold()
    normalized = re.sub(r"[^\w]+", " ", normalized, flags=re.UNICODE)
    return " ".join(normalized.split())


def _topic_phrase_match(phrase: str, normalized_value: str) -> bool:
    needle = _topic_phrase_normalized(phrase)
    if not needle:
        return False
    return needle == normalized_value or f" {needle} " in f" {normalized_value} "


def match_unit_topics(
    question: dict[str, Any], unit: dict[str, Any]
) -> tuple[list[str], str | None]:
    """Match only complete topic labels/aliases within the selected unit."""

    text = _topic_value_normalized(question["text"])
    subtopic = question.get("subtopic")
    normalized_subtopic = (
        _topic_value_normalized(subtopic) if isinstance(subtopic, str) else None
    )
    matches: list[tuple[str, tuple[int, int, int]]] = []
    for topic in unit["topics"]:
        best_specificity: tuple[int, int, int] | None = None
        for phrase in [topic["label"], *topic["aliases"]]:
            normalized_phrase = _topic_phrase_normalized(phrase)
            word_count = len(normalized_phrase.split())
            character_count = len(normalized_phrase)
            if normalized_subtopic is not None and _topic_phrase_match(phrase, normalized_subtopic):
                exact = int(normalized_subtopic == normalized_phrase)
                specificity = (2 + exact, word_count, character_count)
                if best_specificity is None or specificity > best_specificity:
                    best_specificity = specificity
            if _topic_phrase_match(phrase, text):
                specificity = (1, word_count, character_count)
                if best_specificity is None or specificity > best_specificity:
                    best_specificity = specificity
        if best_specificity is not None:
            matches.append((topic["topic_id"], best_specificity))
    matched_topic_ids = sorted(topic_id for topic_id, _ in matches)
    if not matches:
        return matched_topic_ids, None
    most_specific = max(specificity for _, specificity in matches)
    winners = sorted(topic_id for topic_id, specificity in matches if specificity == most_specific)
    return matched_topic_ids, winners[0] if len(winners) == 1 else None


def _scope_for_match(
    unit: dict[str, Any],
    matched_topic_ids: list[str],
    active_framework_id: str,
    *,
    supplemental: bool,
) -> str:
    if supplemental:
        return "outside_active_syllabus"
    topics = {topic["topic_id"]: topic for topic in unit["topics"]}
    if matched_topic_ids:
        lifecycle = {
            active_framework_id in topics[topic_id]["framework_ids"]
            for topic_id in matched_topic_ids
        }
        if lifecycle == {True}:
            return "active"
        if lifecycle == {False}:
            return "outside_active_syllabus"
        return "undetermined"
    has_legacy_only_topic = any(
        active_framework_id not in topic["framework_ids"] for topic in unit["topics"]
    )
    return "undetermined" if has_legacy_only_topic else "active"


def _is_option_only_fragment(text: str) -> bool:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if lines and re.fullmatch(r"options?\s*:", lines[0], re.IGNORECASE):
        lines = lines[1:]
    if not lines:
        return False
    return all(_OPTION_LINE_RE.match(line) is not None for line in lines)


def _has_math_notation(text: str) -> bool:
    if _MATH_NOTATION_RE.search(text) is not None:
        return True
    return re.search(r"\d\s*[-:]\s*\d|\b[a-z]\s*\([^)]*\)", text, re.IGNORECASE) is not None


def _is_exemptible_mojibake_or_c1(character: str) -> bool:
    return character in _MOJIBAKE_MARKERS or 0x80 <= ord(character) <= 0x9F


def _is_non_exempt_corruption_character(character: str) -> bool:
    return character == "\ufffd" or unicodedata.category(character) in {"Co", "Cs"}


def _is_clean_ascii_prompt_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if any(
        _is_exemptible_mojibake_or_c1(character)
        or _is_non_exempt_corruption_character(character)
        for character in stripped
    ):
        return False
    visible = [character for character in stripped if not character.isspace()]
    if not visible:
        return False
    ascii_visible = sum(0x20 <= ord(character) <= 0x7E for character in visible)
    if ascii_visible / len(visible) < 0.7:
        return False
    alphabetic_words = _ASCII_WORD_RE.findall(stripped)
    if len(alphabetic_words) < 7:
        return False
    alphabetic_characters = sum(
        character.isascii() and character.isalpha() for character in stripped
    )
    return (
        alphabetic_characters >= 30
        and _QUESTION_TASK_CUE_RE.search(stripped) is not None
    )


def _has_high_corruption_ratio(text: str) -> bool:
    visible = [character for character in text if not character.isspace()]
    if not visible:
        return False
    if any(_is_non_exempt_corruption_character(character) for character in visible):
        return True
    suspicious = sum(
        _is_exemptible_mojibake_or_c1(character) for character in visible
    )
    if suspicious < 3 or suspicious / len(visible) < 0.05:
        return False
    return not any(_is_clean_ascii_prompt_line(line) for line in text.splitlines())


def quality_review_reasons(text: str) -> list[str]:
    reasons: list[str] = []
    if _is_option_only_fragment(text):
        reasons.append("option_only_fragment")
    alphabetic_words = _ALPHABETIC_WORD_RE.findall(text)
    if (
        len(alphabetic_words) <= 2
        and len("".join(text.split())) <= 40
        and not _has_math_notation(text)
    ):
        reasons.append("very_short_non_mathematical_text")
    page_markers = len(_PAGE_MARKER_RE.findall(text))
    option_markers = len(_INLINE_OPTION_RE.findall(text))
    looks_like_merged_pages = page_markers >= 2 or (
        page_markers >= 1 and option_markers >= 8
    )
    if (
        _ANSWER_TAIL_RE.search(text) is not None
        or _ANSWER_SUMMARY_RE.search(text) is not None
        or looks_like_merged_pages
    ):
        reasons.append("possible_merged_questions")
    if _has_high_corruption_ratio(text):
        reasons.append("high_character_corruption_ratio")
    return sorted(set(reasons))


def _confidence_for(score: int, margin: int) -> str | None:
    if score >= 8 and margin >= 5:
        return "high"
    if score >= 5 and margin >= 3:
        return "medium"
    return None


def assign_question(
    question: dict[str, Any],
    documents_by_id: dict[str, dict[str, Any]],
    taxonomy: dict[str, Any],
    rules_by_subject: dict[str, dict[str, Any]],
    *,
    _maps: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create one complete sidecar assignment without changing the question."""

    subject, subject_status, subject_reasons = resolve_question_subject(question, documents_by_id)
    assignment: dict[str, Any] = {
        "schema_version": ASSIGNMENT_SCHEMA_VERSION,
        "question_id": question["question_id"],
        "framework_id": taxonomy["active_framework_id"],
        "subject": subject,
        "subject_status": subject_status,
        "status": "needs_review",
        "primary_unit_id": None,
        "primary_topic_id": None,
        "confidence": None,
        "score": None,
        "margin": None,
        "syllabus_scope": "undetermined",
        "method": ASSIGNMENT_METHOD,
        "candidate_units": [],
        "matched_topic_ids": [],
        "review_reasons": sorted(set(subject_reasons)),
    }
    if subject_status == "out_of_scope":
        assignment["status"] = "out_of_scope"
        assignment["syllabus_scope"] = "out_of_scope"
        return assignment
    if subject_status in {"missing_context", "conflict"}:
        return assignment
    assert subject is not None

    maps = _maps or _taxonomy_maps(taxonomy)
    candidates = score_question_units(
        question, subject, taxonomy, rules_by_subject, _maps=maps
    )
    assignment["candidate_units"] = candidates
    if candidates:
        score = candidates[0]["score"]
        margin = score - candidates[1]["score"] if len(candidates) > 1 else score
        assignment["score"] = score
        assignment["margin"] = margin
        confidence = _confidence_for(score, margin)
    else:
        confidence = None
        assignment["review_reasons"].append("no_unit_evidence")

    if candidates and confidence is None:
        score = candidates[0]["score"]
        margin = assignment["margin"]
        assert isinstance(margin, int)
        if score < 5:
            assignment["review_reasons"].append("unit_score_below_threshold")
        elif margin == 0:
            assignment["review_reasons"].append("unit_score_tie")
        else:
            assignment["review_reasons"].append("unit_margin_below_threshold")

    if len(candidates) > 1 and candidates[1]["score"] >= 8:
        assignment["review_reasons"].append("multi_unit_evidence")

    quality_reasons = quality_review_reasons(question["text"])
    assignment["review_reasons"].extend(quality_reasons)
    blocking = bool(set(assignment["review_reasons"]) & _BLOCKING_QUALITY_REASONS)
    if confidence is None or blocking:
        assignment["review_reasons"] = sorted(set(assignment["review_reasons"]))
        return assignment

    primary_unit_id = candidates[0]["unit_id"]
    unit = maps["units"][primary_unit_id]
    matched_topic_ids, primary_topic_id = match_unit_topics(question, unit)
    assignment["primary_unit_id"] = primary_unit_id
    assignment["primary_topic_id"] = primary_topic_id
    assignment["confidence"] = confidence
    assignment["matched_topic_ids"] = matched_topic_ids
    assignment["syllabus_scope"] = _scope_for_match(
        unit,
        matched_topic_ids,
        taxonomy["active_framework_id"],
        supplemental=primary_unit_id in maps["supplemental"],
    )
    top_evidence = candidates[0]["evidence"]
    if any(item["kind"] == "existing_topic_projection" for item in top_evidence) and not any(
        item["weight"] > 0 and item["kind"] != "existing_topic_projection"
        for item in top_evidence
    ):
        assignment["review_reasons"].append(
            "uncorroborated_existing_topic_projection"
        )
    assignment["review_reasons"] = sorted(set(assignment["review_reasons"]))
    assignment["status"] = (
        "needs_review" if assignment["review_reasons"] else "classified"
    )
    return assignment


def validate_assignment(
    assignment: Any,
    taxonomy: dict[str, Any],
    path: str = "assignment",
    *,
    _maps: dict[str, Any] | None = None,
) -> None:
    """Validate exact keys, value invariants, and taxonomy references."""

    _require(isinstance(assignment, dict), path, "expected an object")
    _exact_keys(assignment, _ASSIGNMENT_KEYS, path)
    _require(assignment["schema_version"] == ASSIGNMENT_SCHEMA_VERSION, f"{path}.schema_version", f"expected {ASSIGNMENT_SCHEMA_VERSION}")
    _require(isinstance(assignment["question_id"], str) and bool(_QUESTION_ID_RE.fullmatch(assignment["question_id"])), f"{path}.question_id", "expected q_ followed by a SHA-256 digest")
    _require(assignment["framework_id"] == taxonomy["active_framework_id"], f"{path}.framework_id", "expected the active taxonomy framework")
    _require(assignment["subject"] is None or assignment["subject"] in ASSIGNMENT_SUBJECTS, f"{path}.subject", "invalid subject")
    _require(assignment["subject_status"] in SUBJECT_STATUSES, f"{path}.subject_status", "invalid subject status")
    _require(assignment["status"] in ASSIGNMENT_STATUSES, f"{path}.status", "invalid assignment status")
    _require(assignment["confidence"] is None or assignment["confidence"] in CONFIDENCES, f"{path}.confidence", "invalid confidence")
    _require(assignment["score"] is None or _integer(assignment["score"]), f"{path}.score", "expected an integer or null")
    _require(assignment["margin"] is None or _integer(assignment["margin"]), f"{path}.margin", "expected an integer or null")
    _require(assignment["syllabus_scope"] in SYLLABUS_SCOPES, f"{path}.syllabus_scope", "invalid syllabus scope")
    _require(assignment["method"] == ASSIGNMENT_METHOD, f"{path}.method", f"expected {ASSIGNMENT_METHOD}")

    maps = _maps or _taxonomy_maps(taxonomy)
    candidates = assignment["candidate_units"]
    _require(isinstance(candidates, list), f"{path}.candidate_units", "expected an array")
    _require(len(candidates) <= 3, f"{path}.candidate_units", "expected at most three candidates")
    candidate_ids: set[str] = set()
    for index, candidate in enumerate(candidates):
        candidate_path = f"{path}.candidate_units[{index}]"
        _require(isinstance(candidate, dict), candidate_path, "expected an object")
        _exact_keys(candidate, _CANDIDATE_KEYS, candidate_path)
        unit_id = candidate["unit_id"]
        _require(unit_id in maps["units"], f"{candidate_path}.unit_id", "unknown taxonomy unit")
        _require(unit_id not in candidate_ids, f"{candidate_path}.unit_id", "duplicate candidate unit")
        candidate_ids.add(unit_id)
        _require(maps["unit_subject"][unit_id] == assignment["subject"], f"{candidate_path}.unit_id", "candidate crosses subject boundary")
        _require(_integer(candidate["score"]), f"{candidate_path}.score", "expected an integer")
        evidence = candidate["evidence"]
        _require(isinstance(evidence, list) and bool(evidence), f"{candidate_path}.evidence", "expected at least one evidence item")
        evidence_keys: set[tuple[str, str, int]] = set()
        for evidence_index, item in enumerate(evidence):
            evidence_path = f"{candidate_path}.evidence[{evidence_index}]"
            _require(isinstance(item, dict), evidence_path, "expected an object")
            _exact_keys(item, _EVIDENCE_KEYS, evidence_path)
            _require(item["kind"] in EVIDENCE_WEIGHTS, f"{evidence_path}.kind", "invalid evidence kind")
            _require(_nonempty_string(item["value"]), f"{evidence_path}.value", "expected a non-empty string")
            _require(_integer(item["weight"]), f"{evidence_path}.weight", "expected an integer")
            _require(item["weight"] == EVIDENCE_WEIGHTS[item["kind"]], f"{evidence_path}.weight", "does not match the evidence kind")
            evidence_key = (item["kind"], item["value"], item["weight"])
            _require(evidence_key not in evidence_keys, evidence_path, "duplicate evidence")
            evidence_keys.add(evidence_key)
            if unit_id in maps["supplemental"]:
                _require(item["kind"] == "supplemental_alias", evidence_path, "supplemental units accept only label/alias evidence")
            else:
                _require(item["kind"] != "supplemental_alias", evidence_path, "regular units cannot use supplemental evidence")
        _require(evidence == sorted(evidence, key=_evidence_sort_key), f"{candidate_path}.evidence", "expected deterministically sorted evidence")
        _require(any(item["weight"] > 0 for item in evidence), f"{candidate_path}.evidence", "candidate requires positive evidence")
        _require(candidate["score"] == sum(item["weight"] for item in evidence), f"{candidate_path}.score", "does not equal the evidence weights")
    _require(candidates == sorted(candidates, key=_candidate_sort_key), f"{path}.candidate_units", "expected score-ranked candidates")

    if candidates:
        expected_score = candidates[0]["score"]
        expected_margin = expected_score - candidates[1]["score"] if len(candidates) > 1 else expected_score
        _require(assignment["score"] == expected_score, f"{path}.score", "does not match the top candidate")
        _require(assignment["margin"] == expected_margin, f"{path}.margin", "does not match the candidate margin")
    else:
        _require(assignment["score"] is None, f"{path}.score", "requires candidate evidence")
        _require(assignment["margin"] is None, f"{path}.margin", "requires candidate evidence")

    primary_unit_id = assignment["primary_unit_id"]
    _require(primary_unit_id is None or primary_unit_id in maps["units"], f"{path}.primary_unit_id", "unknown taxonomy unit")
    if primary_unit_id is None:
        _require(assignment["primary_topic_id"] is None, f"{path}.primary_topic_id", "requires a primary unit")
        _require(assignment["confidence"] is None, f"{path}.confidence", "requires a primary unit")
    else:
        _require(bool(candidates) and primary_unit_id == candidates[0]["unit_id"], f"{path}.primary_unit_id", "must be the top candidate")
        expected_confidence = _confidence_for(assignment["score"], assignment["margin"])
        _require(assignment["confidence"] == expected_confidence and expected_confidence is not None, f"{path}.confidence", "does not match score thresholds")

    matched_topic_ids = assignment["matched_topic_ids"]
    _string_array(matched_topic_ids, f"{path}.matched_topic_ids")
    _require(matched_topic_ids == sorted(matched_topic_ids), f"{path}.matched_topic_ids", "expected sorted topic ids")
    for topic_id in matched_topic_ids:
        _require(topic_id in maps["topics"], f"{path}.matched_topic_ids", f"unknown topic {topic_id}")
        _require(primary_unit_id is not None and maps["topics"][topic_id]["unit_id"] == primary_unit_id, f"{path}.matched_topic_ids", "topic is outside the primary unit")
    primary_topic_id = assignment["primary_topic_id"]
    _require(primary_topic_id is None or primary_topic_id in matched_topic_ids, f"{path}.primary_topic_id", "must be one of the matched topics")
    if primary_unit_id is not None:
        expected_scope = _scope_for_match(
            maps["units"][primary_unit_id],
            matched_topic_ids,
            taxonomy["active_framework_id"],
            supplemental=primary_unit_id in maps["supplemental"],
        )
        _require(
            assignment["syllabus_scope"] == expected_scope,
            f"{path}.syllabus_scope",
            "does not match the selected topic lifecycle",
        )

    review_reasons = assignment["review_reasons"]
    _string_array(review_reasons, f"{path}.review_reasons")
    _require(review_reasons == sorted(review_reasons), f"{path}.review_reasons", "expected sorted review reasons")

    subject_status = assignment["subject_status"]
    if subject_status == "resolved":
        _require(assignment["subject"] in SUPPORTED_SUBJECTS, f"{path}.subject", "resolved assignments require a supported subject")
    elif subject_status in {"missing_context", "conflict"}:
        _require(assignment["subject"] is None, f"{path}.subject", "unresolved assignments require null")
        _require(primary_unit_id is None, f"{path}.primary_unit_id", "unresolved subjects must abstain")
        expected_reason = (
            "missing_subject_context"
            if subject_status == "missing_context"
            else "conflicting_subject_context"
        )
        _require(expected_reason in review_reasons, f"{path}.review_reasons", f"requires {expected_reason}")
    else:
        _require(assignment["subject"] in {None, "Chemistry"}, f"{path}.subject", "out-of-scope assignments cannot use a supported subject")
        _require(assignment["status"] == "out_of_scope", f"{path}.status", "out-of-scope subject requires out_of_scope status")
        _require(assignment["syllabus_scope"] == "out_of_scope", f"{path}.syllabus_scope", "out-of-scope subject requires out_of_scope scope")

    if assignment["status"] == "classified":
        _require(primary_unit_id is not None, f"{path}.primary_unit_id", "classified assignments require a primary unit")
        _require(not review_reasons, f"{path}.review_reasons", "classified assignments cannot have review reasons")
    elif assignment["status"] == "needs_review":
        _require(bool(review_reasons), f"{path}.review_reasons", "needs_review assignments require a reason")
        _require(assignment["syllabus_scope"] != "out_of_scope", f"{path}.syllabus_scope", "needs_review cannot be out_of_scope")
    else:
        _require(subject_status == "out_of_scope", f"{path}.subject_status", "out_of_scope status requires an out-of-scope subject")
    if primary_unit_id is None and assignment["status"] != "out_of_scope":
        _require(assignment["syllabus_scope"] == "undetermined", f"{path}.syllabus_scope", "abstentions require undetermined scope")


def validate_assignments(
    assignments: list[dict[str, Any]],
    questions: list[dict[str, Any]],
    taxonomy: dict[str, Any],
) -> None:
    _require(isinstance(assignments, list), "assignments", "expected an array")
    _require(isinstance(questions, list), "questions", "expected an array")
    maps = _taxonomy_maps(taxonomy)
    question_ids = [question["question_id"] for question in questions]
    assignment_ids: list[str] = []
    for index, assignment in enumerate(assignments):
        validate_assignment(
            assignment, taxonomy, f"assignments[{index}]", _maps=maps
        )
        assignment_ids.append(assignment["question_id"])
    _require(len(assignment_ids) == len(set(assignment_ids)), "assignments", "duplicate question assignments")
    _require(set(assignment_ids) == set(question_ids), "assignments", "expected exactly one assignment for every question")
    _require(assignment_ids == sorted(assignment_ids), "assignments", "expected question-id order")


def load_assignments(
    path: Path,
    questions: list[dict[str, Any]],
    taxonomy: dict[str, Any],
) -> list[dict[str, Any]]:
    assignments = load_jsonl(path)
    validate_assignments(assignments, questions, taxonomy)
    return assignments


def build_assignments(
    documents: list[dict[str, Any]],
    questions: list[dict[str, Any]],
    taxonomy: dict[str, Any],
    rules_by_subject: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    validate_corpus(documents, questions)
    validate_taxonomy(taxonomy)
    taxonomy_subjects = {subject["name"] for subject in taxonomy["subjects"]}
    _require(
        set(rules_by_subject) == taxonomy_subjects,
        "rules",
        "expected exactly one rules document for each taxonomy subject",
    )
    for subject, rules in rules_by_subject.items():
        _require(
            rules.get("subject") == subject,
            f"rules.{subject}",
            "mapping key does not match the rules subject",
        )
        validate_unit_rules(rules, taxonomy)
    documents_by_id = {document["document_id"]: document for document in documents}
    maps = _taxonomy_maps(taxonomy)
    assignments = [
        assign_question(
            question,
            documents_by_id,
            taxonomy,
            rules_by_subject,
            _maps=maps,
        )
        for question in sorted(questions, key=lambda item: item["question_id"])
    ]
    validate_assignments(assignments, questions, taxonomy)
    return assignments


def _release_status(questions: list[dict[str, Any]]) -> str:
    return (
        "reviewed"
        if questions and all(question["status"] == "reviewed" for question in questions)
        else "candidate_only"
    )


def _fixed_counter(
    values: Iterable[str | None], keys: Iterable[str]
) -> dict[str, int]:
    counts = Counter("null" if value is None else value for value in values)
    return {key: counts[key] for key in sorted(keys)}


def make_report(
    documents: list[dict[str, Any]],
    questions: list[dict[str, Any]],
    taxonomy: dict[str, Any],
    rules_by_subject: dict[str, dict[str, Any]],
    assignments: list[dict[str, Any]],
    *,
    generated_at: str | None = None,
    review_sample_limit: int = 20,
) -> dict[str, Any]:
    """Build a text-free aggregate report with bounded question-id samples."""

    _require(
        1 <= review_sample_limit <= 20,
        "review_sample_limit",
        "expected an integer from 1 through 20",
    )
    validate_assignments(assignments, questions, taxonomy)
    maps = _taxonomy_maps(taxonomy)
    classified_by_unit = Counter(
        assignment["primary_unit_id"]
        for assignment in assignments
        if assignment["status"] == "classified" and assignment["primary_unit_id"] is not None
    )
    review_by_unit = Counter(
        assignment["primary_unit_id"]
        for assignment in assignments
        if assignment["status"] == "needs_review" and assignment["primary_unit_id"] is not None
    )
    per_unit = []
    for unit_id in sorted(maps["units"]):
        unit = maps["units"][unit_id]
        per_unit.append(
            {
                "unit_id": unit_id,
                "subject": maps["unit_subject"][unit_id],
                "name": unit["name"],
                "supplemental": unit_id in maps["supplemental"],
                "classified": classified_by_unit[unit_id],
                "needs_review": review_by_unit[unit_id],
            }
        )
    reasons_to_ids: dict[str, list[str]] = defaultdict(list)
    for assignment in assignments:
        for reason in assignment["review_reasons"]:
            reasons_to_ids[reason].append(assignment["question_id"])
    topic_count = sum(len(unit["topics"]) for unit in maps["units"].values())
    report = {
        "schema_version": REPORT_SCHEMA_VERSION,
        "generated_at": generated_at
        or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "framework_id": taxonomy["active_framework_id"],
        "taxonomy_schema_version": taxonomy["schema_version"],
        "assignment_schema_version": ASSIGNMENT_SCHEMA_VERSION,
        "method": ASSIGNMENT_METHOD,
        "input_counts": {
            "documents": len(documents),
            "questions": len(questions),
            "source_references": sum(len(question["source_refs"]) for question in questions),
            "frameworks": len(taxonomy["frameworks"]),
            "subjects": len(taxonomy["subjects"]),
            "units": len(maps["units"]),
            "topics": topic_count,
            "rule_units": sum(len(rules["units"]) for rules in rules_by_subject.values()),
        },
        "output_counts": {
            "assignments": len(assignments),
            "candidate_units": sum(len(item["candidate_units"]) for item in assignments),
            "evidence": sum(
                len(candidate["evidence"])
                for item in assignments
                for candidate in item["candidate_units"]
            ),
            "matched_topics": sum(len(item["matched_topic_ids"]) for item in assignments),
            "review_reasons": sum(len(item["review_reasons"]) for item in assignments),
        },
        "subject_counts": _fixed_counter(
            (item["subject"] for item in assignments),
            [*ASSIGNMENT_SUBJECTS, "null"],
        ),
        "subject_status_counts": _fixed_counter(
            (item["subject_status"] for item in assignments), SUBJECT_STATUSES
        ),
        "status_counts": _fixed_counter(
            (item["status"] for item in assignments), ASSIGNMENT_STATUSES
        ),
        "confidence_counts": _fixed_counter(
            (item["confidence"] for item in assignments), [*CONFIDENCES, "null"]
        ),
        "syllabus_scope_counts": _fixed_counter(
            (item["syllabus_scope"] for item in assignments), SYLLABUS_SCOPES
        ),
        "per_unit": per_unit,
        "zero_coverage_unit_ids": sorted(
            unit_id
            for unit_id in maps["units"]
            if classified_by_unit[unit_id] + review_by_unit[unit_id] == 0
        ),
        "review_reason_counts": dict(
            sorted((reason, len(question_ids)) for reason, question_ids in reasons_to_ids.items())
        ),
        "review_samples": {
            reason: sorted(set(question_ids))[:review_sample_limit]
            for reason, question_ids in sorted(reasons_to_ids.items())
        },
        "source_release_status": _release_status(questions),
    }
    validate_report(report)
    return report


def validate_report(report: Any, path: str = "report") -> None:
    _require(isinstance(report, dict), path, "expected an object")
    _exact_keys(report, _REPORT_KEYS, path)
    _require(report["schema_version"] == REPORT_SCHEMA_VERSION, f"{path}.schema_version", f"expected {REPORT_SCHEMA_VERSION}")
    _require(_nonempty_string(report["generated_at"]), f"{path}.generated_at", "expected a timestamp string")
    _require(_nonempty_string(report["framework_id"]), f"{path}.framework_id", "expected a non-empty string")
    _require(report["taxonomy_schema_version"] == TAXONOMY_SCHEMA_VERSION, f"{path}.taxonomy_schema_version", f"expected {TAXONOMY_SCHEMA_VERSION}")
    _require(report["assignment_schema_version"] == ASSIGNMENT_SCHEMA_VERSION, f"{path}.assignment_schema_version", f"expected {ASSIGNMENT_SCHEMA_VERSION}")
    _require(report["method"] == ASSIGNMENT_METHOD, f"{path}.method", f"expected {ASSIGNMENT_METHOD}")
    for field in (
        "input_counts",
        "output_counts",
        "subject_counts",
        "subject_status_counts",
        "status_counts",
        "confidence_counts",
        "syllabus_scope_counts",
        "review_reason_counts",
    ):
        _require(isinstance(report[field], dict), f"{path}.{field}", "expected an object")
    _exact_keys(
        report["input_counts"],
        {
            "documents",
            "questions",
            "source_references",
            "frameworks",
            "subjects",
            "units",
            "topics",
            "rule_units",
        },
        f"{path}.input_counts",
    )
    _exact_keys(
        report["output_counts"],
        {
            "assignments",
            "candidate_units",
            "evidence",
            "matched_topics",
            "review_reasons",
        },
        f"{path}.output_counts",
    )
    _exact_keys(
        report["subject_counts"],
        {*ASSIGNMENT_SUBJECTS, "null"},
        f"{path}.subject_counts",
    )
    _exact_keys(
        report["subject_status_counts"],
        set(SUBJECT_STATUSES),
        f"{path}.subject_status_counts",
    )
    _exact_keys(
        report["status_counts"],
        set(ASSIGNMENT_STATUSES),
        f"{path}.status_counts",
    )
    _exact_keys(
        report["confidence_counts"],
        {*CONFIDENCES, "null"},
        f"{path}.confidence_counts",
    )
    _exact_keys(
        report["syllabus_scope_counts"],
        set(SYLLABUS_SCOPES),
        f"{path}.syllabus_scope_counts",
    )
    for field in (
        "input_counts",
        "output_counts",
        "subject_counts",
        "subject_status_counts",
        "status_counts",
        "confidence_counts",
        "syllabus_scope_counts",
        "review_reason_counts",
    ):
        value = report[field]
        _require(
            all(_nonempty_string(key) and _integer(count) and count >= 0 for key, count in value.items()),
            f"{path}.{field}",
            "expected non-negative integer counts",
        )
    _require(isinstance(report["per_unit"], list), f"{path}.per_unit", "expected an array")
    unit_ids: list[str] = []
    for index, unit in enumerate(report["per_unit"]):
        unit_path = f"{path}.per_unit[{index}]"
        _require(isinstance(unit, dict), unit_path, "expected an object")
        _exact_keys(
            unit,
            {"unit_id", "subject", "name", "supplemental", "classified", "needs_review"},
            unit_path,
        )
        for field in ("unit_id", "subject", "name"):
            _require(_nonempty_string(unit[field]), f"{unit_path}.{field}", "expected a non-empty string")
        _require(isinstance(unit["supplemental"], bool), f"{unit_path}.supplemental", "expected a boolean")
        for field in ("classified", "needs_review"):
            _require(_integer(unit[field]) and unit[field] >= 0, f"{unit_path}.{field}", "expected a non-negative integer")
        unit_ids.append(unit["unit_id"])
    _require(unit_ids == sorted(set(unit_ids)), f"{path}.per_unit", "expected unique unit-id order")
    _string_array(report["zero_coverage_unit_ids"], f"{path}.zero_coverage_unit_ids")
    _require(report["zero_coverage_unit_ids"] == sorted(report["zero_coverage_unit_ids"]), f"{path}.zero_coverage_unit_ids", "expected sorted ids")
    _require(isinstance(report["review_samples"], dict), f"{path}.review_samples", "expected an object")
    _require(set(report["review_samples"]) == set(report["review_reason_counts"]), f"{path}.review_samples", "expected the same reasons as review_reason_counts")
    for reason, question_ids in report["review_samples"].items():
        _require(_nonempty_string(reason), f"{path}.review_samples", "expected reason keys")
        _string_array(question_ids, f"{path}.review_samples.{reason}")
        _require(question_ids == sorted(question_ids), f"{path}.review_samples.{reason}", "expected sorted ids")
        _require(len(question_ids) <= 20, f"{path}.review_samples.{reason}", "too many sample ids")
        _require(all(_QUESTION_ID_RE.fullmatch(question_id) for question_id in question_ids), f"{path}.review_samples.{reason}", "expected question ids only")
    _require(report["source_release_status"] in {"reviewed", "candidate_only"}, f"{path}.source_release_status", "invalid release status")


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            json.dump(value, output, ensure_ascii=False, indent=2, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_name, path)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


_SYLLABUS_SQLITE_SCHEMA = """
CREATE TABLE syllabus_frameworks (
    framework_id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'historical')),
    source_publisher TEXT NOT NULL,
    source_url TEXT,
    source_local_path TEXT,
    source_notes TEXT
);

CREATE TABLE syllabus_units (
    unit_id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    unit_number INTEGER,
    name TEXT NOT NULL,
    is_supplemental INTEGER NOT NULL CHECK (is_supplemental IN (0, 1)),
    CHECK ((is_supplemental = 1 AND unit_number IS NULL) OR
           (is_supplemental = 0 AND unit_number IS NOT NULL))
);

CREATE TABLE syllabus_topics (
    topic_id TEXT PRIMARY KEY,
    unit_id TEXT NOT NULL REFERENCES syllabus_units(unit_id),
    label TEXT NOT NULL,
    notes TEXT,
    UNIQUE (topic_id, unit_id)
);

CREATE TABLE syllabus_topic_aliases (
    topic_id TEXT NOT NULL REFERENCES syllabus_topics(topic_id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    PRIMARY KEY (topic_id, alias)
);

CREATE TABLE syllabus_topic_frameworks (
    topic_id TEXT NOT NULL REFERENCES syllabus_topics(topic_id) ON DELETE CASCADE,
    framework_id TEXT NOT NULL REFERENCES syllabus_frameworks(framework_id),
    PRIMARY KEY (topic_id, framework_id)
);

CREATE TABLE syllabus_assignments (
    question_id TEXT PRIMARY KEY REFERENCES questions(question_id) ON DELETE CASCADE,
    schema_version TEXT NOT NULL,
    framework_id TEXT NOT NULL REFERENCES syllabus_frameworks(framework_id),
    subject TEXT,
    subject_status TEXT NOT NULL,
    status TEXT NOT NULL,
    primary_unit_id TEXT REFERENCES syllabus_units(unit_id),
    primary_topic_id TEXT,
    confidence TEXT,
    score INTEGER,
    margin INTEGER,
    syllabus_scope TEXT NOT NULL,
    method TEXT NOT NULL,
    FOREIGN KEY (primary_topic_id, primary_unit_id)
        REFERENCES syllabus_topics(topic_id, unit_id)
);

CREATE TABLE syllabus_assignment_candidates (
    question_id TEXT NOT NULL REFERENCES syllabus_assignments(question_id) ON DELETE CASCADE,
    rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 3),
    unit_id TEXT NOT NULL REFERENCES syllabus_units(unit_id),
    score INTEGER NOT NULL,
    PRIMARY KEY (question_id, unit_id),
    UNIQUE (question_id, rank)
);

CREATE TABLE syllabus_assignment_evidence (
    question_id TEXT NOT NULL,
    unit_id TEXT NOT NULL,
    evidence_order INTEGER NOT NULL,
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    weight INTEGER NOT NULL,
    PRIMARY KEY (question_id, unit_id, evidence_order),
    UNIQUE (question_id, unit_id, kind, value, weight),
    FOREIGN KEY (question_id, unit_id)
        REFERENCES syllabus_assignment_candidates(question_id, unit_id) ON DELETE CASCADE
);

CREATE TABLE syllabus_assignment_matched_topics (
    question_id TEXT NOT NULL REFERENCES syllabus_assignments(question_id) ON DELETE CASCADE,
    topic_id TEXT NOT NULL REFERENCES syllabus_topics(topic_id),
    PRIMARY KEY (question_id, topic_id)
);

CREATE TABLE syllabus_assignment_review_reasons (
    question_id TEXT NOT NULL REFERENCES syllabus_assignments(question_id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    PRIMARY KEY (question_id, reason)
);

CREATE INDEX syllabus_units_subject_idx
    ON syllabus_units(subject, is_supplemental, unit_number);
CREATE INDEX syllabus_topics_unit_idx ON syllabus_topics(unit_id);
CREATE INDEX syllabus_topic_frameworks_framework_idx
    ON syllabus_topic_frameworks(framework_id, topic_id);
CREATE INDEX syllabus_assignments_status_idx
    ON syllabus_assignments(subject, subject_status, status, confidence, syllabus_scope);
CREATE INDEX syllabus_assignments_primary_unit_idx
    ON syllabus_assignments(primary_unit_id, primary_topic_id);
CREATE INDEX syllabus_candidates_unit_idx
    ON syllabus_assignment_candidates(unit_id, score);
CREATE INDEX syllabus_evidence_kind_value_idx
    ON syllabus_assignment_evidence(kind, value, unit_id);
CREATE INDEX syllabus_matched_topics_topic_idx
    ON syllabus_assignment_matched_topics(topic_id, question_id);
CREATE INDEX syllabus_review_reasons_reason_idx
    ON syllabus_assignment_review_reasons(reason, question_id);
"""


def build_full_sqlite_database(
    manifest_path: Path,
    questions_path: Path,
    database_path: Path,
    taxonomy: dict[str, Any],
    assignments: list[dict[str, Any]],
) -> dict[str, Any]:
    """Atomically build the normal index plus normalized syllabus tables."""

    documents = load_documents(manifest_path)
    questions = load_questions(questions_path)
    validate_corpus(documents, questions)
    validate_assignments(assignments, questions, taxonomy)
    maps = _taxonomy_maps(taxonomy)

    database_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{database_path.name}.", suffix=".tmp", dir=database_path.parent
    )
    os.close(descriptor)
    temporary_path = Path(temporary_name)
    connection: sqlite3.Connection | None = None
    try:
        base_result = build_sqlite_database(manifest_path, questions_path, temporary_path)
        connection = sqlite3.connect(temporary_path)
        connection.execute("PRAGMA foreign_keys = ON")
        with connection:
            connection.executescript(_SYLLABUS_SQLITE_SCHEMA)
            connection.executemany(
                """
                INSERT INTO syllabus_frameworks (
                    framework_id, label, status, source_publisher, source_url,
                    source_local_path, source_notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        framework["framework_id"],
                        framework["label"],
                        framework["status"],
                        framework["source"]["publisher"],
                        framework["source"]["url"],
                        framework["source"]["local_path"],
                        framework["source"]["notes"],
                    )
                    for framework in sorted(taxonomy["frameworks"], key=lambda item: item["framework_id"])
                ],
            )
            unit_rows = []
            topic_rows = []
            alias_rows = []
            topic_framework_rows = []
            for unit_id in sorted(maps["units"]):
                unit = maps["units"][unit_id]
                unit_rows.append(
                    (
                        unit_id,
                        maps["unit_subject"][unit_id],
                        unit["unit_number"],
                        unit["name"],
                        int(unit_id in maps["supplemental"]),
                    )
                )
                for topic in sorted(unit["topics"], key=lambda item: item["topic_id"]):
                    topic_rows.append((topic["topic_id"], unit_id, topic["label"], topic["notes"]))
                    alias_rows.extend((topic["topic_id"], alias) for alias in sorted(topic["aliases"]))
                    topic_framework_rows.extend(
                        (topic["topic_id"], framework_id)
                        for framework_id in sorted(topic["framework_ids"])
                    )
            connection.executemany(
                "INSERT INTO syllabus_units (unit_id, subject, unit_number, name, is_supplemental) VALUES (?, ?, ?, ?, ?)",
                unit_rows,
            )
            connection.executemany(
                "INSERT INTO syllabus_topics (topic_id, unit_id, label, notes) VALUES (?, ?, ?, ?)",
                topic_rows,
            )
            connection.executemany(
                "INSERT INTO syllabus_topic_aliases (topic_id, alias) VALUES (?, ?)",
                alias_rows,
            )
            connection.executemany(
                "INSERT INTO syllabus_topic_frameworks (topic_id, framework_id) VALUES (?, ?)",
                topic_framework_rows,
            )
            connection.executemany(
                """
                INSERT INTO syllabus_assignments (
                    question_id, schema_version, framework_id, subject, subject_status,
                    status, primary_unit_id, primary_topic_id, confidence, score,
                    margin, syllabus_scope, method
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        item["question_id"],
                        item["schema_version"],
                        item["framework_id"],
                        item["subject"],
                        item["subject_status"],
                        item["status"],
                        item["primary_unit_id"],
                        item["primary_topic_id"],
                        item["confidence"],
                        item["score"],
                        item["margin"],
                        item["syllabus_scope"],
                        item["method"],
                    )
                    for item in assignments
                ],
            )
            candidate_rows = []
            evidence_rows = []
            matched_topic_rows = []
            review_reason_rows = []
            for assignment in assignments:
                question_id = assignment["question_id"]
                for rank, candidate in enumerate(assignment["candidate_units"], start=1):
                    candidate_rows.append((question_id, rank, candidate["unit_id"], candidate["score"]))
                    for evidence_order, evidence in enumerate(candidate["evidence"], start=1):
                        evidence_rows.append(
                            (
                                question_id,
                                candidate["unit_id"],
                                evidence_order,
                                evidence["kind"],
                                evidence["value"],
                                evidence["weight"],
                            )
                        )
                matched_topic_rows.extend(
                    (question_id, topic_id) for topic_id in assignment["matched_topic_ids"]
                )
                review_reason_rows.extend(
                    (question_id, reason) for reason in assignment["review_reasons"]
                )
            connection.executemany(
                "INSERT INTO syllabus_assignment_candidates (question_id, rank, unit_id, score) VALUES (?, ?, ?, ?)",
                candidate_rows,
            )
            connection.executemany(
                """
                INSERT INTO syllabus_assignment_evidence (
                    question_id, unit_id, evidence_order, kind, value, weight
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                evidence_rows,
            )
            connection.executemany(
                "INSERT INTO syllabus_assignment_matched_topics (question_id, topic_id) VALUES (?, ?)",
                matched_topic_rows,
            )
            connection.executemany(
                "INSERT INTO syllabus_assignment_review_reasons (question_id, reason) VALUES (?, ?)",
                review_reason_rows,
            )
            connection.executemany(
                "INSERT INTO metadata (key, value) VALUES (?, ?)",
                [
                    ("syllabus_database_schema_version", DATABASE_SCHEMA_VERSION),
                    ("syllabus_taxonomy_schema_version", taxonomy["schema_version"]),
                    ("syllabus_assignment_schema_version", ASSIGNMENT_SCHEMA_VERSION),
                    ("syllabus_rules_schema_version", RULES_SCHEMA_VERSION),
                    ("syllabus_active_framework_id", taxonomy["active_framework_id"]),
                    ("syllabus_assignment_method", ASSIGNMENT_METHOD),
                ],
            )

        assignment_count = connection.execute("SELECT COUNT(*) FROM syllabus_assignments").fetchone()[0]
        if assignment_count != len(questions):
            raise PipelineError(
                f"SQLite syllabus assignment count mismatch: {assignment_count} != {len(questions)}"
            )
        missing_assignments = connection.execute(
            """
            SELECT COUNT(*)
            FROM questions AS q
            LEFT JOIN syllabus_assignments AS a ON a.question_id = q.question_id
            WHERE a.question_id IS NULL
            """
        ).fetchone()[0]
        if missing_assignments:
            raise PipelineError(f"SQLite has {missing_assignments} questions without syllabus assignments")
        foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
        if foreign_keys:
            raise PipelineError(f"SQLite foreign-key check failed: {foreign_keys[:5]}")
        integrity = connection.execute("PRAGMA integrity_check").fetchone()
        if integrity != ("ok",):
            raise PipelineError(f"SQLite integrity check failed: {integrity}")
        connection.close()
        connection = None
        os.replace(temporary_path, database_path)
    finally:
        if connection is not None:
            connection.close()
        try:
            temporary_path.unlink()
        except FileNotFoundError:
            pass

    return {
        **base_result,
        "database": str(database_path),
        "syllabus_frameworks": len(taxonomy["frameworks"]),
        "syllabus_units": len(maps["units"]),
        "syllabus_topics": len(maps["topics"]),
        "syllabus_assignments": len(assignments),
        "syllabus_candidates": sum(len(item["candidate_units"]) for item in assignments),
        "syllabus_evidence": sum(
            len(candidate["evidence"])
            for item in assignments
            for candidate in item["candidate_units"]
        ),
        "syllabus_review_reasons": sum(len(item["review_reasons"]) for item in assignments),
        "question_release_status": _release_status(questions),
    }


def build_syllabus_index(
    manifest_path: Path,
    questions_path: Path,
    taxonomy_path: Path,
    rule_paths: Iterable[Path],
    assignments_path: Path,
    database_path: Path,
    *,
    report_path: Path | None = None,
    build_database: bool = True,
) -> dict[str, Any]:
    """Load, classify, validate, and atomically write all requested outputs."""

    rule_paths = list(rule_paths)
    input_paths = {
        path.resolve()
        for path in [manifest_path, questions_path, taxonomy_path, *rule_paths]
    }
    output_paths = [assignments_path]
    if build_database:
        output_paths.append(database_path)
    if report_path is not None:
        output_paths.append(report_path)
    resolved_outputs = [path.resolve() for path in output_paths]
    _require(
        len(resolved_outputs) == len(set(resolved_outputs)),
        "outputs",
        "output paths must be distinct",
    )
    _require(
        not input_paths.intersection(resolved_outputs),
        "outputs",
        "an output path cannot replace a canonical input",
    )

    documents = load_documents(manifest_path)
    questions = load_questions(questions_path)
    validate_corpus(documents, questions)
    taxonomy, rules_by_subject = load_syllabus_inputs(taxonomy_path, rule_paths)
    assignments = build_assignments(documents, questions, taxonomy, rules_by_subject)
    write_jsonl(assignments_path, assignments)
    database_result = None
    if build_database:
        database_result = build_full_sqlite_database(
            manifest_path,
            questions_path,
            database_path,
            taxonomy,
            assignments,
        )
    report = make_report(documents, questions, taxonomy, rules_by_subject, assignments)
    if report_path is not None:
        _atomic_json(report_path, report)
    return {
        "operation": "build-syllabus-index",
        "assignments": str(assignments_path),
        "database": str(database_path) if build_database else None,
        "report": str(report_path) if report_path is not None else None,
        "database_result": database_result,
        "summary": report,
    }
