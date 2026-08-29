"""Recover the English half of bilingual exam pages and drop item-bank headers.

Official CBSE bilingual booklets print each question's Hindi rendering first
and its English rendering second. When the Hindi half was typeset in a legacy
Devanagari-mapped font (the Chanakya/DevLys families), text extraction renders
it as ASCII transliteration debris ("kmV H$s{OE") or Latin-1 symbol soup
("·¤ ×´") that per-character sanitizers cannot distinguish from math. NTA
item-bank exports additionally prefix each question with `Topic Name:` and
`ItemCode:` source-metadata headers that are metadata, not damage.

This module classifies whole lines and extracts the English half only when the
page splits cleanly: a transliterated block, then a contiguous English block,
then at most paper-code footers. It fails closed. Any mixed Hindi+English
line, any transliteration inside the English block, and any readable line
outside the English block whose tokens are not already present inside it leave
the text unchanged — a half-cut or interleaved stem is worse than a rejected
one.
"""

from __future__ import annotations

import re

# Item-bank source-metadata headers. Measured over the staged corpus these
# markers only ever occur at line start, in exactly these shapes; anything
# looser is left in place so question content can never be mistaken for
# metadata.
_METADATA_HEADER_RES = (
    re.compile(
        r"^\s*Topic\s*Name\s*:\s*(?:Physics|Chemistry|Mathematics)"
        r"\s*-?\s*Section\s*[-A-Za-z0-9]*\.?\s*$",
        re.IGNORECASE,
    ),
    re.compile(r"^\s*ItemCode\s*:\s*\d+\s*[.;:,-]?\s*$", re.IGNORECASE),
)

# Trailing paper-code footers such as "55/1/B    6" or "65(B)   12".
_FOOTER_LINE_RE = re.compile(r"^\s*\d{2,3}[A-Za-z0-9/().-]*\s+\d{1,3}\s*$")

# High-precision Chanakya-family transliteration fragments (H$ = क, {OE = िजए,
# Am¡a = और, AWdm = अथवा, ...). Each hit is one unit of evidence.
_TRANSLITERATION_LEXICAL_RE = re.compile(
    r"Ho\$|H\$[smr]|\{OE|\{bE|\{H\$|\{X|Am¡a|h[¡¢]|hþ|H\$mo|kmV|Xem©|It[{]M"
    r"|AmnH\$|à\{V|\{ÌÁ|g_rH|\{OU|H\$aHo|_\||AWdm|VWm\b|Ý`yZ|ê\$n|d¥Îm|joÌ"
    r"|ñn|H«\$|AmaoI"
)
# A dollar sign or brace glued into a letter run is a matra, never math.
_GLUED_DOLLAR_RE = re.compile(r"[A-Za-z]\$|\$[A-Za-z{]")
_GLUED_BRACE_RE = re.compile(r"[A-Za-z][{\[][A-Za-z]|[A-Za-z][>~]")
# Latin-1 letters inside a Latin word are Chanakya matras; standalone accented
# words (résumé) would need two adjacent hits to count.
_LATIN1_LETTER_IN_WORD_RE = re.compile(r"[A-Za-z][À-ÖØ-öø-ÿ]|[À-ÖØ-öø-ÿ][A-Za-z$>]")
# Latin-1 symbols glued to letters or to each other are the degraded "·¤"
# flavour. Digit-adjacent uses (1·5, 10–4, 5 × 10) never match.
_SYMBOL_CLASS = "¡¢£¤¥¦§¨©ª«¬®¯°±´µ¶·¸¹º»¼½¾¿×÷"
_GLUED_SYMBOL_RE = re.compile(
    rf"[{_SYMBOL_CLASS}][{_SYMBOL_CLASS}]|[A-Za-z][{_SYMBOL_CLASS}]"
    rf"|[{_SYMBOL_CLASS}][A-Za-z]"
)
_DEVANAGARI_RE = re.compile(r"[ऀ-ॿ]")
_PRIVATE_USE_RE = re.compile(r"[-]")

# Very frequent transliterated function words; two or more on one line are
# decisive because English lines never accumulate them.
_TRANSLITERATED_FUNCTION_WORDS = frozenset(
    {
        "go", "na", "hmo", "OmVm", "Zht", "AWdm", "Xmo", "VWm", "Bg", "`m",
        "Xr", "H$m", "Ho", "_o", "ahm", "aho", "dmbo", "dmbr", "JE", "JB",
    }
)
# A line that is only a connective (AWdm = OR) or a section stamp (IÊS> =
# खण्ड) belongs to the Hindi half even though it carries little evidence.
_TRANSLITERATED_CONNECTIVE_LINE_RE = re.compile(r"^\s*(?:AWdm|IÊS>?.{0,4})\s*$")
_STANDALONE_DANDA_RE = re.compile(r"(?:^|\s)&(?:\s|$)")

_ENGLISH_STOP_WORDS = frozenset(
    {
        "the", "of", "is", "and", "in", "to", "for", "with", "on", "at", "by",
        "from", "find", "if", "then", "when", "what", "which", "that", "this",
        "are", "be", "it", "its", "value", "given", "two", "between", "using",
        "write", "state", "show", "draw", "as", "was", "were", "has", "have",
        "will", "can", "each", "per", "how", "an", "or", "prove", "solve",
        "let", "hence", "obtain", "calculate", "determine", "explain", "name",
        "following", "respectively", "equation", "function", "number",
        "point", "line", "plane",
    }
)
_ENGLISH_CONTENT_CUE_RE = re.compile(
    r"\b(?:calculate|derive|determine|differentiate|equation|evaluate|find|"
    r"integrate|prove|show|solve|state|value|what|which)\b",
    re.IGNORECASE,
)
# A word glued to transliteration punctuation is itself transliteration.
_TAINT_CHARACTERS = frozenset("${}|" + _SYMBOL_CLASS)

_WORD_RE = re.compile(r"[A-Za-z]+")
_VOWEL_RE = re.compile(r"[aeiouyAEIOUY]")
_READABLE_TOKEN_RE = re.compile(r"[A-Za-z]+|\d+(?:\.\d+)?|[=+*/|^<>]")


def strip_source_metadata_headers(text: str) -> str:
    """Drop `Topic Name:`/`ItemCode:` item-bank header lines, nothing else."""

    kept = [
        line
        for line in text.splitlines()
        if not any(pattern.match(line) for pattern in _METADATA_HEADER_RES)
    ]
    if len(kept) == len(text.splitlines()):
        return text
    return "\n".join(kept).strip()


def _transliteration_evidence(line: str) -> int:
    evidence = 0
    evidence += len(_TRANSLITERATION_LEXICAL_RE.findall(line))
    evidence += len(_GLUED_DOLLAR_RE.findall(line))
    evidence += len(_GLUED_BRACE_RE.findall(line))
    evidence += len(_LATIN1_LETTER_IN_WORD_RE.findall(line))
    evidence += len(_GLUED_SYMBOL_RE.findall(line))
    evidence += 2 * len(_DEVANAGARI_RE.findall(line))
    evidence += 2 * len(_PRIVATE_USE_RE.findall(line))
    words = re.findall(r"[A-Za-z$¡]+", line)
    function_words = sum(
        1 for word in words if word in _TRANSLITERATED_FUNCTION_WORDS
    )
    if function_words >= 2:
        evidence += function_words
    if evidence >= 1 and _STANDALONE_DANDA_RE.search(line):
        evidence += 1
    return evidence


def _clean_words(line: str) -> list[str]:
    """Latin words not glued to transliteration punctuation."""

    words: list[str] = []
    for match in _WORD_RE.finditer(line):
        before = line[match.start() - 1] if match.start() > 0 else " "
        after = line[match.end()] if match.end() < len(line) else " "
        if before in _TAINT_CHARACTERS or after in _TAINT_CHARACTERS:
            continue
        words.append(match.group(0))
    return words


def _english_signal(line: str) -> tuple[int, int]:
    words = _clean_words(line)
    stop_words = sum(
        1 for word in words if len(word) >= 2 and word.lower() in _ENGLISH_STOP_WORDS
    )
    plausible = sum(
        1
        for word in words
        if len(word) >= 2
        and not any(character.isupper() for character in word[1:])
        and _VOWEL_RE.search(word)
    )
    return plausible, stop_words


def _classify_line(line: str) -> str:
    stripped = line.strip()
    if not stripped:
        return "blank"
    if any(pattern.match(stripped) for pattern in _METADATA_HEADER_RES):
        return "meta"
    if _TRANSLITERATED_CONNECTIVE_LINE_RE.match(stripped):
        return "hindi"
    evidence = _transliteration_evidence(stripped)
    plausible, stop_words = _english_signal(stripped)
    english = stop_words >= 2 or (plausible >= 4 and stop_words >= 1) or plausible >= 6
    hindi = evidence >= 3
    if hindi and english:
        return "mixed"
    if hindi:
        return "hindi"
    if english:
        return "english"
    if evidence == 2 and plausible < 2:
        return "hindi_weak"
    return "neutral"


def _readable_tokens(text: str) -> set[str]:
    return {token.casefold() for token in _READABLE_TOKEN_RE.findall(text)}


def _has_usable_english(text: str) -> bool:
    if _ENGLISH_CONTENT_CUE_RE.search(text) is not None:
        return True
    return len(re.findall(r"[A-Za-z]{2,}", text)) >= 5


def _reads_as_english(text: str) -> bool:
    """The result must clear the readability bar, not merely improve on it."""

    if len(text) < 30:
        return False
    non_ascii = sum(1 for character in text if ord(character) > 127)
    if non_ascii / len(text) >= 0.25:
        return False
    if text.count("$") >= 6:
        return False
    return all(
        _classify_line(line) in ("english", "neutral", "blank")
        for line in text.splitlines()
    )


def extract_english_half(text: str) -> str | None:
    """Return the English half of a bilingual page, or None when unsure.

    None means the page did not split cleanly and the caller must keep the
    original text.
    """

    lines = text.splitlines()
    classes = [_classify_line(line) for line in lines]
    if not any(cls in ("hindi", "hindi_weak", "mixed") for cls in classes):
        return None
    if "mixed" in classes:
        # Hindi and English merged onto one line: any cut would interleave.
        return None
    if "english" not in classes:
        return None
    lines = [line for line, cls in zip(lines, classes) if cls != "meta"]
    classes = [cls for cls in classes if cls != "meta"]

    first_english = classes.index("english")
    last_english = len(classes) - 1 - classes[::-1].index("english")
    # The English block extends over contiguous trailing formula lines but
    # stops at footers and at anything transliterated.
    end = last_english
    probe = last_english + 1
    while (
        probe < len(lines)
        and classes[probe] in ("neutral", "blank")
        and not _FOOTER_LINE_RE.match(lines[probe])
    ):
        end = probe
        probe += 1
    region = lines[first_english : end + 1]
    region_classes = classes[first_english : end + 1]
    if any(cls in ("hindi", "hindi_weak") for cls in region_classes):
        return None
    region_tokens = _readable_tokens("\n".join(region))

    for index, cls in enumerate(classes):
        if first_english <= index <= end:
            continue
        if cls in ("hindi", "hindi_weak", "blank"):
            continue
        if _FOOTER_LINE_RE.match(lines[index]):
            continue
        tokens = _readable_tokens(lines[index])
        if tokens and not tokens.issubset(region_tokens):
            # A readable line outside the English block holds content the
            # block does not: cutting would lose or interleave it.
            return None

    while region and not region[-1].strip():
        region.pop()
    result = "\n".join(region).strip()
    if not result:
        return None
    if not _has_usable_english(result) or not _reads_as_english(result):
        return None
    return result


def normalize_bilingual_text(text: str) -> str:
    """Strip item-bank headers, then extract the English half when confident.

    Returns the input unchanged whenever neither step applies. Never returns
    a half-cut or interleaved stem: extraction that cannot prove a clean
    Hindi-then-English split leaves the text as it was.
    """

    stripped = strip_source_metadata_headers(text)
    extracted = extract_english_half(stripped)
    if extracted is not None:
        return extracted
    return stripped if stripped != text else text
