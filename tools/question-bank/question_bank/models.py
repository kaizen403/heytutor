"""Record validation, canonicalization, JSONL I/O, and exact deduplication."""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import unicodedata
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse

DOCUMENT_SCHEMA_VERSION = "question-bank-document/v2"
QUESTION_SCHEMA_VERSION = "question-bank-question/v3"

DOCUMENT_STATUSES = ("planned", "acquired", "extracted", "reviewed", "failed")
QUESTION_STATUSES = ("extracted", "classified", "reviewed")
DIFFICULTIES = ("easy", "medium", "hard")
SOURCE_TYPES = ("official", "institutional_archive", "public_archive", "third_party", "unknown")
PAPER_MODES = ("offline", "computer_based", "unknown")

_DOCUMENT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_QUESTION_ID_RE = re.compile(r"^q_[0-9a-f]{64}$")
_LEADING_QUESTION_NUMBER_RE = re.compile(
    r"^(?:(?:question|q)\s*)?\d{1,3}(?:\s*\([a-z]\))?\s*[.)-]\s*",
    re.IGNORECASE,
)


class ValidationError(ValueError):
    """Raised when a committed record violates a question-bank contract."""


def _require(condition: bool, path: str, message: str) -> None:
    if not condition:
        raise ValidationError(f"{path}: {message}")


def _is_nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _validated_timestamp(value: str, path: str) -> datetime:
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValidationError(f"{path}: expected an ISO-8601 timestamp") from exc
    _require(
        parsed.tzinfo is not None and parsed.utcoffset() is not None,
        path,
        "expected an offset-aware ISO-8601 timestamp",
    )
    _require(
        parsed.astimezone(timezone.utc) <= datetime.now(timezone.utc) + timedelta(minutes=5),
        path,
        "timestamp is in the future",
    )
    return parsed


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValidationError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_reject_duplicate_keys)
    except FileNotFoundError as exc:
        raise ValidationError(f"missing file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValidationError(f"{path}:{exc.lineno}:{exc.colno}: {exc.msg}") from exc


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError as exc:
        raise ValidationError(f"missing file: {path}") from exc

    records: list[dict[str, Any]] = []
    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line, object_pairs_hook=_reject_duplicate_keys)
        except json.JSONDecodeError as exc:
            raise ValidationError(f"{path}:{line_number}:{exc.colno}: {exc.msg}") from exc
        except ValidationError as exc:
            raise ValidationError(f"{path}:{line_number}: {exc}") from exc
        _require(isinstance(record, dict), f"{path}:{line_number}", "expected a JSON object")
        records.append(record)
    return records


def write_jsonl(path: Path, records: Iterable[dict[str, Any]]) -> None:
    """Atomically write deterministic UTF-8 JSONL."""

    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            for record in records:
                output.write(json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
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


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
    except FileNotFoundError as exc:
        raise ValidationError(f"missing file: {path}") from exc
    return digest.hexdigest()


def canonical_question_text(text: str) -> str:
    """Normalize presentation-only variation without erasing mathematical punctuation."""

    normalized = unicodedata.normalize("NFKC", text).replace("\u00ad", "")
    normalized = _LEADING_QUESTION_NUMBER_RE.sub("", normalized.strip(), count=1)
    return " ".join(normalized.split()).casefold()


def question_content_sha256(text: str) -> str:
    return hashlib.sha256(canonical_question_text(text).encode("utf-8")).hexdigest()


def question_id_for_text(text: str) -> str:
    return f"q_{question_content_sha256(text)}"


def _validate_exact_keys(record: dict[str, Any], expected: set[str], path: str) -> None:
    missing = expected - record.keys()
    extra = record.keys() - expected
    _require(not missing, path, f"missing fields: {', '.join(sorted(missing))}")
    _require(not extra, path, f"unknown fields: {', '.join(sorted(extra))}")


def validate_document(record: dict[str, Any], path: str = "document") -> None:
    expected = {
        "schema_version",
        "document_id",
        "provenance",
        "year",
        "exam",
        "session",
        "set",
        "subject",
        "source_url",
        "paper",
        "artifact",
        "sha256",
        "status",
    }
    _validate_exact_keys(record, expected, path)
    _require(record["schema_version"] == DOCUMENT_SCHEMA_VERSION, f"{path}.schema_version", f"expected {DOCUMENT_SCHEMA_VERSION}")
    _require(isinstance(record["document_id"], str) and bool(_DOCUMENT_ID_RE.fullmatch(record["document_id"])), f"{path}.document_id", "use 1-128 lowercase URL-safe characters")

    provenance = record["provenance"]
    _require(isinstance(provenance, dict), f"{path}.provenance", "expected an object")
    _validate_exact_keys(provenance, {"publisher", "source_type", "retrieved_at", "notes"}, f"{path}.provenance")
    _require(_is_nonempty_string(provenance["publisher"]), f"{path}.provenance.publisher", "expected a non-empty string")
    _require(provenance["source_type"] in SOURCE_TYPES, f"{path}.provenance.source_type", f"expected one of {SOURCE_TYPES}")
    _require(provenance["retrieved_at"] is None or _is_nonempty_string(provenance["retrieved_at"]), f"{path}.provenance.retrieved_at", "expected a timestamp string or null")
    if provenance["retrieved_at"] is not None:
        _validated_timestamp(provenance["retrieved_at"], f"{path}.provenance.retrieved_at")
    _require(provenance["notes"] is None or _is_nonempty_string(provenance["notes"]), f"{path}.provenance.notes", "expected a non-empty string or null")

    _require(isinstance(record["year"], int) and not isinstance(record["year"], bool) and 1900 <= record["year"] <= 2100, f"{path}.year", "expected an integer from 1900 through 2100")
    for field in ("exam", "session", "set", "subject"):
        _require(_is_nonempty_string(record[field]), f"{path}.{field}", "expected a non-empty string; use 'not_applicable' when needed")

    parsed_url = urlparse(record["source_url"]) if isinstance(record["source_url"], str) else None
    _require(parsed_url is not None and parsed_url.scheme == "https" and bool(parsed_url.netloc), f"{path}.source_url", "expected an HTTPS URL")

    paper = record["paper"]
    _require(isinstance(paper, dict), f"{path}.paper", "expected an object")
    _validate_exact_keys(
        paper,
        {
            "stage",
            "paper_number",
            "exam_date",
            "shift",
            "mode",
            "language",
            "accessibility_variant",
        },
        f"{path}.paper",
    )
    for field in ("stage", "language", "accessibility_variant"):
        _require(_is_nonempty_string(paper[field]), f"{path}.paper.{field}", "expected a non-empty string")
    for field in ("paper_number", "shift"):
        _require(paper[field] is None or _is_nonempty_string(paper[field]), f"{path}.paper.{field}", "expected a non-empty string or null")
    _require(
        paper["exam_date"] is None
        or (
            isinstance(paper["exam_date"], str)
            and bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", paper["exam_date"]))
        ),
        f"{path}.paper.exam_date",
        "expected YYYY-MM-DD or null",
    )
    _require(paper["mode"] in PAPER_MODES, f"{path}.paper.mode", f"expected one of {PAPER_MODES}")

    artifact = record["artifact"]
    _require(isinstance(artifact, dict), f"{path}.artifact", "expected an object")
    _validate_exact_keys(
        artifact,
        {"media_type", "page_count", "container_url", "container_sha256", "member_path"},
        f"{path}.artifact",
    )
    _require(_is_nonempty_string(artifact["media_type"]), f"{path}.artifact.media_type", "expected a non-empty string")
    _require(
        artifact["page_count"] is None
        or (
            isinstance(artifact["page_count"], int)
            and not isinstance(artifact["page_count"], bool)
            and artifact["page_count"] >= 1
        ),
        f"{path}.artifact.page_count",
        "expected a positive integer or null",
    )
    container_url = artifact["container_url"]
    parsed_container = urlparse(container_url) if isinstance(container_url, str) else None
    _require(
        container_url is None
        or (parsed_container is not None and parsed_container.scheme == "https" and bool(parsed_container.netloc)),
        f"{path}.artifact.container_url",
        "expected an HTTPS URL or null",
    )
    _require(
        artifact["container_sha256"] is None
        or (
            isinstance(artifact["container_sha256"], str)
            and bool(_SHA256_RE.fullmatch(artifact["container_sha256"]))
        ),
        f"{path}.artifact.container_sha256",
        "expected 64 lowercase hex characters or null",
    )
    _require(
        artifact["member_path"] is None or _is_nonempty_string(artifact["member_path"]),
        f"{path}.artifact.member_path",
        "expected a non-empty string or null",
    )
    if artifact["member_path"] is not None:
        _require(container_url is not None, f"{path}.artifact.container_url", "archive members require a container URL")
        _require(artifact["container_sha256"] is not None, f"{path}.artifact.container_sha256", "archive members require a container hash")
    _require(record["sha256"] is None or (isinstance(record["sha256"], str) and bool(_SHA256_RE.fullmatch(record["sha256"]))), f"{path}.sha256", "expected 64 lowercase hex characters or null")
    _require(record["status"] in DOCUMENT_STATUSES, f"{path}.status", f"expected one of {DOCUMENT_STATUSES}")
    if record["status"] in {"acquired", "extracted", "reviewed"}:
        _require(record["sha256"] is not None, f"{path}.sha256", f"status {record['status']} requires a content hash")
        _require(
            provenance["retrieved_at"] is not None,
            f"{path}.provenance.retrieved_at",
            f"status {record['status']} requires a retrieval timestamp",
        )


def validate_source_ref(source_ref: dict[str, Any], path: str) -> None:
    expected = {
        "document_id",
        "document_sha256",
        "page_number",
        "page_end",
        "question_number",
        "subject_context",
        "extraction_method",
        "extracted_text_sha256",
        "extraction_artifact_sha256s",
    }
    _validate_exact_keys(source_ref, expected, path)
    _require(isinstance(source_ref["document_id"], str) and bool(_DOCUMENT_ID_RE.fullmatch(source_ref["document_id"])), f"{path}.document_id", "invalid document id")
    _require(isinstance(source_ref["document_sha256"], str) and bool(_SHA256_RE.fullmatch(source_ref["document_sha256"])), f"{path}.document_sha256", "expected 64 lowercase hex characters")
    _require(isinstance(source_ref["page_number"], int) and not isinstance(source_ref["page_number"], bool) and source_ref["page_number"] >= 1, f"{path}.page_number", "expected an integer of at least 1")
    _require(isinstance(source_ref["page_end"], int) and not isinstance(source_ref["page_end"], bool) and source_ref["page_end"] >= source_ref["page_number"], f"{path}.page_end", "expected an integer at or after page_number")
    _require(_is_nonempty_string(source_ref["question_number"]), f"{path}.question_number", "expected a non-empty string")
    _require(
        source_ref["subject_context"] is None
        or _is_nonempty_string(source_ref["subject_context"]),
        f"{path}.subject_context",
        "expected a non-empty string or null",
    )
    _require(_is_nonempty_string(source_ref["extraction_method"]), f"{path}.extraction_method", "expected a non-empty string")
    _require(isinstance(source_ref["extracted_text_sha256"], str) and bool(_SHA256_RE.fullmatch(source_ref["extracted_text_sha256"])), f"{path}.extracted_text_sha256", "expected 64 lowercase hex characters")
    artifact_hashes = source_ref["extraction_artifact_sha256s"]
    _require(
        isinstance(artifact_hashes, list)
        and bool(artifact_hashes)
        and all(isinstance(value, str) and bool(_SHA256_RE.fullmatch(value)) for value in artifact_hashes),
        f"{path}.extraction_artifact_sha256s",
        "expected at least one SHA-256 digest",
    )
    _require(
        artifact_hashes == sorted(set(artifact_hashes)),
        f"{path}.extraction_artifact_sha256s",
        "expected unique sorted digests",
    )


def validate_question(record: dict[str, Any], path: str = "question") -> None:
    expected = {
        "schema_version",
        "question_id",
        "text",
        "content_sha256",
        "topic",
        "subtopic",
        "difficulty",
        "answer",
        "status",
        "source_refs",
    }
    _validate_exact_keys(record, expected, path)
    _require(record["schema_version"] == QUESTION_SCHEMA_VERSION, f"{path}.schema_version", f"expected {QUESTION_SCHEMA_VERSION}")
    _require(_is_nonempty_string(record["text"]), f"{path}.text", "expected a non-empty string")
    expected_hash = question_content_sha256(record["text"])
    _require(record["content_sha256"] == expected_hash, f"{path}.content_sha256", "does not match normalized question text")
    _require(isinstance(record["question_id"], str) and bool(_QUESTION_ID_RE.fullmatch(record["question_id"])), f"{path}.question_id", "expected q_ followed by a SHA-256 digest")
    _require(record["question_id"] == f"q_{expected_hash}", f"{path}.question_id", "does not match normalized question text")
    for field in ("topic", "subtopic", "answer"):
        _require(record[field] is None or _is_nonempty_string(record[field]), f"{path}.{field}", "expected a non-empty string or null")
    _require(record["difficulty"] is None or record["difficulty"] in DIFFICULTIES, f"{path}.difficulty", f"expected one of {DIFFICULTIES} or null")
    _require(record["status"] in QUESTION_STATUSES, f"{path}.status", f"expected one of {QUESTION_STATUSES}")
    _require(isinstance(record["source_refs"], list) and bool(record["source_refs"]), f"{path}.source_refs", "expected at least one source reference")
    seen_source_refs: set[tuple[Any, ...]] = set()
    for index, source_ref in enumerate(record["source_refs"]):
        _require(isinstance(source_ref, dict), f"{path}.source_refs[{index}]", "expected an object")
        validate_source_ref(source_ref, f"{path}.source_refs[{index}]")
        source_key = _source_ref_key(source_ref)
        _require(source_key not in seen_source_refs, f"{path}.source_refs[{index}]", "duplicate source reference")
        seen_source_refs.add(source_key)
    if record["status"] == "reviewed":
        for field in ("topic", "subtopic", "difficulty", "answer"):
            _require(record[field] is not None, f"{path}.{field}", "reviewed questions must be complete")


def load_documents(path: Path) -> list[dict[str, Any]]:
    documents = load_jsonl(path)
    for index, document in enumerate(documents):
        validate_document(document, f"{path}:{index + 1}")
    return documents


def load_questions(path: Path) -> list[dict[str, Any]]:
    questions = load_jsonl(path)
    for index, question in enumerate(questions):
        validate_question(question, f"{path}:{index + 1}")
    return questions


def migrate_questions_v2_to_v3(
    path: Path, *, dry_run: bool = False
) -> dict[str, Any]:
    """Atomically add nullable subject context to canonical v2 question rows."""

    records = load_jsonl(path)
    migrated = 0
    unchanged = 0
    for index, record in enumerate(records):
        record_path = f"{path}:{index + 1}"
        if not isinstance(record, dict):
            raise ValidationError(f"{record_path}: expected an object")
        version = record.get("schema_version")
        if version == QUESTION_SCHEMA_VERSION:
            unchanged += 1
            validate_question(record, record_path)
            continue
        if version != "question-bank-question/v2":
            raise ValidationError(
                f"{record_path}.schema_version: expected question-bank-question/v2 or "
                f"{QUESTION_SCHEMA_VERSION}"
            )
        source_refs = record.get("source_refs")
        if not isinstance(source_refs, list):
            raise ValidationError(f"{record_path}.source_refs: expected an array")
        for source_index, source_ref in enumerate(source_refs):
            if not isinstance(source_ref, dict) or "subject_context" in source_ref:
                raise ValidationError(
                    f"{record_path}.source_refs[{source_index}]: invalid v2 source reference"
                )
            source_ref["subject_context"] = None
        record["schema_version"] = QUESTION_SCHEMA_VERSION
        validate_question(record, record_path)
        migrated += 1
    if not dry_run:
        write_jsonl(path, records)
    return {
        "operation": "migrate-questions-v2-to-v3",
        "questions_file": str(path),
        "dry_run": dry_run,
        "migrated": migrated,
        "unchanged": unchanged,
        "questions": len(records),
    }


def _source_ref_key(source_ref: dict[str, Any]) -> tuple[Any, ...]:
    return (
        source_ref["document_id"],
        source_ref["page_number"],
        source_ref["page_end"],
        source_ref["question_number"],
        source_ref["extraction_method"],
        source_ref["extracted_text_sha256"],
    )


def _merge_question(target: dict[str, Any], incoming: dict[str, Any]) -> None:
    if target["content_sha256"] != incoming["content_sha256"]:
        raise ValidationError("cannot merge questions with different content hashes")
    for field in ("topic", "subtopic", "difficulty", "answer"):
        old_value = target[field]
        new_value = incoming[field]
        if old_value is None:
            target[field] = new_value
        elif new_value is not None and new_value != old_value:
            raise ValidationError(
                f"duplicate {target['question_id']} has conflicting {field}: {old_value!r} vs {new_value!r}"
            )

    status_rank = {status: index for index, status in enumerate(QUESTION_STATUSES)}
    if status_rank[incoming["status"]] > status_rank[target["status"]]:
        target["status"] = incoming["status"]

    sources = {_source_ref_key(source_ref): source_ref for source_ref in target["source_refs"]}
    for source_ref in incoming["source_refs"]:
        key = _source_ref_key(source_ref)
        existing = sources.get(key)
        if existing is None:
            sources[key] = source_ref
            continue
        existing_context = existing["subject_context"]
        incoming_context = source_ref["subject_context"]
        if (
            existing_context is not None
            and incoming_context is not None
            and existing_context != incoming_context
        ):
            raise ValidationError(
                f"duplicate {target['question_id']} has conflicting subject context "
                f"for source reference {key}: {existing_context!r} vs {incoming_context!r}"
            )
        if existing_context is None:
            existing["subject_context"] = incoming_context
        comparable_existing = {
            **existing,
            "subject_context": None,
            "extraction_artifact_sha256s": [],
        }
        comparable_incoming = {
            **source_ref,
            "subject_context": None,
            "extraction_artifact_sha256s": [],
        }
        if comparable_existing != comparable_incoming:
            raise ValidationError(f"duplicate {target['question_id']} has conflicting source reference {key}")
        existing["extraction_artifact_sha256s"] = sorted(
            set(existing["extraction_artifact_sha256s"])
            | set(source_ref["extraction_artifact_sha256s"])
        )
    target["source_refs"] = [sources[key] for key in sorted(sources)]


def deduplicate_questions(records: Iterable[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    """Merge exact normalized-text duplicates and preserve all source appearances."""

    by_hash: dict[str, dict[str, Any]] = {}
    duplicates = 0
    for record in records:
        validate_question(record)
        copied = json.loads(json.dumps(record, ensure_ascii=False))
        existing = by_hash.get(copied["content_sha256"])
        if existing is None:
            copied["source_refs"] = sorted(copied["source_refs"], key=_source_ref_key)
            by_hash[copied["content_sha256"]] = copied
        else:
            _merge_question(existing, copied)
            duplicates += 1
    return sorted(by_hash.values(), key=lambda item: item["question_id"]), duplicates


def _near_duplicate_tokens(text: str) -> tuple[str, ...]:
    """Tokenize prose and mathematical punctuation without erasing either."""

    return tuple(re.findall(r"[^\W_]+|[^\w\s]", canonical_question_text(text)))


def _token_shingles(tokens: tuple[str, ...]) -> frozenset[tuple[str, ...]]:
    width = 3 if len(tokens) >= 8 else 2 if len(tokens) >= 4 else 1
    return frozenset(
        tuple(tokens[index : index + width])
        for index in range(max(1, len(tokens) - width + 1))
    )


def find_near_duplicate_questions(
    records: Iterable[dict[str, Any]],
    *,
    minimum_similarity: float = 0.9,
    maximum_pairs: int = 1000,
) -> tuple[list[dict[str, Any]], bool]:
    """Find likely OCR/set variants without mutating or merging the corpus.

    Candidate generation uses each question's rarest token trigrams, avoiding an
    all-pairs scan for large corpora. The final score combines shingle Jaccard
    similarity with a character-sequence ratio. Results are evidence for review,
    never an automatic deduplication decision.
    """

    if not 0.0 <= minimum_similarity <= 1.0:
        raise ValidationError("minimum_similarity: expected a value from 0 through 1")
    if maximum_pairs < 1:
        raise ValidationError("maximum_pairs: expected a positive integer")

    questions = list(records)
    features: list[dict[str, Any]] = []
    shingle_documents: dict[tuple[str, ...], list[int]] = defaultdict(list)
    for index, question in enumerate(questions):
        validate_question(question, f"questions[{index}]")
        canonical = canonical_question_text(question["text"])
        tokens = _near_duplicate_tokens(question["text"])
        shingles = _token_shingles(tokens)
        features.append(
            {
                "canonical": canonical,
                "shingles": shingles,
                "topic": question["topic"],
            }
        )
        for shingle in shingles:
            shingle_documents[shingle].append(index)

    results: list[dict[str, Any]] = []
    for right_index, right in enumerate(questions):
        right_feature = features[right_index]
        # Rare shingles are the strongest and cheapest blocking keys. Using up
        # to 32 keeps OCR variants discoverable without exploding on boilerplate.
        blocking_shingles = sorted(
            right_feature["shingles"],
            key=lambda shingle: (len(shingle_documents[shingle]), shingle),
        )[:32]
        candidate_indexes = {
            left_index
            for shingle in blocking_shingles
            for left_index in shingle_documents[shingle]
            if left_index < right_index
        }
        for left_index in candidate_indexes:
            left = questions[left_index]
            left_feature = features[left_index]
            if (
                left_feature["topic"] is not None
                and right_feature["topic"] is not None
                and left_feature["topic"] != right_feature["topic"]
            ):
                continue
            left_length = len(left_feature["canonical"])
            right_length = len(right_feature["canonical"])
            if min(left_length, right_length) / max(left_length, right_length, 1) < 0.65:
                continue
            intersection = len(left_feature["shingles"] & right_feature["shingles"])
            union = len(left_feature["shingles"] | right_feature["shingles"])
            jaccard = intersection / union if union else 1.0
            # Avoid the more expensive sequence comparison for weak candidates.
            if jaccard < max(0.35, minimum_similarity - 0.25):
                continue
            sequence_ratio = SequenceMatcher(
                None,
                left_feature["canonical"],
                right_feature["canonical"],
                autojunk=False,
            ).ratio()
            similarity = max(jaccard, sequence_ratio)
            if similarity < minimum_similarity:
                continue
            results.append(
                {
                    "left_question_id": left["question_id"],
                    "right_question_id": right["question_id"],
                    "similarity": round(similarity, 6),
                    "shingle_jaccard": round(jaccard, 6),
                    "sequence_ratio": round(sequence_ratio, 6),
                    "left_document_ids": sorted(
                        {ref["document_id"] for ref in left["source_refs"]}
                    ),
                    "right_document_ids": sorted(
                        {ref["document_id"] for ref in right["source_refs"]}
                    ),
                }
            )

    results.sort(
        key=lambda item: (
            -item["similarity"],
            item["left_question_id"],
            item["right_question_id"],
        )
    )
    truncated = len(results) > maximum_pairs
    return results[:maximum_pairs], truncated


def validate_corpus(documents: list[dict[str, Any]], questions: list[dict[str, Any]]) -> None:
    document_by_id: dict[str, dict[str, Any]] = {}
    for index, document in enumerate(documents):
        validate_document(document, f"documents[{index}]")
        document_id = document["document_id"]
        _require(document_id not in document_by_id, f"documents[{index}].document_id", f"duplicate id {document_id}")
        document_by_id[document_id] = document

    seen_question_ids: set[str] = set()
    seen_content_hashes: set[str] = set()
    for index, question in enumerate(questions):
        validate_question(question, f"questions[{index}]")
        question_id = question["question_id"]
        content_hash = question["content_sha256"]
        _require(question_id not in seen_question_ids, f"questions[{index}].question_id", f"duplicate id {question_id}")
        _require(content_hash not in seen_content_hashes, f"questions[{index}].content_sha256", "duplicate content; run the dedupe command")
        seen_question_ids.add(question_id)
        seen_content_hashes.add(content_hash)
        for source_index, source_ref in enumerate(question["source_refs"]):
            source_path = f"questions[{index}].source_refs[{source_index}]"
            document = document_by_id.get(source_ref["document_id"])
            _require(document is not None, f"{source_path}.document_id", "does not exist in the manifest")
            _require(document["sha256"] == source_ref["document_sha256"], f"{source_path}.document_sha256", "does not match the manifest")
            page_count = document["artifact"]["page_count"]
            if page_count is not None:
                _require(
                    source_ref["page_end"] <= page_count,
                    f"{source_path}.page_end",
                    f"exceeds document page count {page_count}",
                )
