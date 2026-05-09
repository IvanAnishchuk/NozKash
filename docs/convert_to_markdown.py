#!/usr/bin/env python3
"""Convert reference documents (RFC .txt/.xml, BIP .mediawiki, HTML papers) to markdown.

Idempotent: re-run safely after refreshing source files.
Outputs .md files alongside originals (e.g. rfc5869.txt → rfc5869.md).
Skips files that already have a hand-written .md companion unless --force is given.

Requires: pandoc (for mediawiki/HTML), xml2rfc (for RFC XML; install via uv).

Usage:
    uv run convert_to_markdown.py           # convert all, skip existing
    uv run convert_to_markdown.py --force   # overwrite existing .md files
    uv run convert_to_markdown.py --dry-run # show what would be converted
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

DOCS_SRC = Path(__file__).parent / "src"
RFCS_DIR = DOCS_SRC / "standards" / "rfcs"
BIPS_DIR = DOCS_SRC / "standards" / "bips"
PAPERS_DIR = DOCS_SRC / "papers"

# Draft RFCs that have hand-written .md sources — never overwrite these
HANDWRITTEN_MD = {
    "draft-irtf-cfrg-bls-signature.md",
    "draft-irtf-cfrg-bls-signature-plans.md",
    "draft-irtf-cfrg-bls-signature-resources.md",
    "draft-irtf-cfrg-hash-to-curve.md",
    "draft-irtf-cfrg-pairing-friendly-curves.md",
    # Paper with manually maintained .md
    "buterin-2023-privacy-pools.md",
}


# ---------------------------------------------------------------------------
# RFC XML → .md  (xml2rfc → HTML → pandoc → cleanup)
# ---------------------------------------------------------------------------

def convert_rfc_xml(src: Path) -> str:
    """Convert RFC XML v3 to markdown via xml2rfc HTML output + pandoc."""
    with tempfile.NamedTemporaryFile(suffix=".html", delete=False) as tmp:
        tmp_html = Path(tmp.name)

    try:
        subprocess.run(
            ["xml2rfc", "--html", "--out", str(tmp_html), str(src)],
            capture_output=True,
            text=True,
            check=True,
        )
        result = subprocess.run(
            ["pandoc", "-f", "html", "-t", "gfm", "--wrap=auto",
             "--columns=100", str(tmp_html)],
            capture_output=True,
            text=True,
            check=True,
        )
    finally:
        tmp_html.unlink(missing_ok=True)

    text = result.stdout

    # Strip all remaining HTML tags
    text = re.sub(r"<[^>]+>", "", text)

    # Remove the header table
    text = re.sub(
        r"^\|[^|]*\|[^|]*\|[^|]*\|\s*\n\|[-|]*\|\s*\n\|[^|]*\|[^|]*\|[^|]*\|\s*\n",
        "",
        text,
        flags=re.MULTILINE,
    )

    # Remove xml2rfc metadata block (Stream:, RFC:, Category:, etc.)
    text = re.sub(
        r"^(?:Stream|RFC|Category|Published|ISSN|Authors?):\s*\n.*?(?=\n#|\n## )",
        "",
        text,
        flags=re.MULTILINE | re.DOTALL,
    )

    # Strip xml2rfc paragraph markers
    text = text.replace("¶", "")

    # Collapse blank lines
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    text = text.strip()

    # Extract RFC number and find the real title (second # heading, after "RFC NNNN")
    rfc_match = re.search(r"rfc(\d+)", src.stem)
    rfc_num = rfc_match.group(1) if rfc_match else src.stem
    headings = re.findall(r"^#\s+(.+)$", text, re.MULTILINE)
    title = next(
        (h.strip() for h in headings if not re.match(r"^RFC\s+\d+$", h.strip())),
        src.stem,
    )

    frontmatter = (
        f"---\n"
        f'title: "RFC {rfc_num}: {title}"\n'
        f'source: "{src.name}"\n'
        f"generated: true\n"
        f"---\n\n"
    )
    return frontmatter + text


# ---------------------------------------------------------------------------
# RFC .txt → .md  (custom parser)
# ---------------------------------------------------------------------------

def convert_rfc_txt(src: Path) -> str:
    """Convert IETF RFC plain-text format to markdown."""
    text = src.read_text(encoding="utf-8", errors="replace")

    # Strip form-feed characters
    text = text.replace("\f", "")

    # Remove page header/footer lines
    text = re.sub(
        r"^.{40,76}\[Page \d+\]\s*$",
        "",
        text,
        flags=re.MULTILINE,
    )
    text = re.sub(
        r"^(?:RFC|STD) \d{3,5}\s+.{15,65}\s+\w+ \d{4}\s*$",
        "",
        text,
        flags=re.MULTILINE,
    )

    # Collapse runs of 3+ blank lines
    text = re.sub(r"\n{4,}", "\n\n\n", text)

    # Extract RFC number and title from header
    rfc_match = re.search(r"Request for Comments:\s*(\d+)", text)
    rfc_num = rfc_match.group(1) if rfc_match else ""

    title_match = re.search(
        r"^\s{6,}(\S.{10,})\s*$",
        text[:2000],
        re.MULTILINE,
    )
    title = title_match.group(1).strip() if title_match else f"RFC {rfc_num}"

    # Strip the RFC header block (everything before Abstract)
    abstract_pos = text.find("\nAbstract\n")
    if abstract_pos == -1:
        abstract_pos = text.find("\nAbstract\r\n")
    if abstract_pos > 0:
        text = text[abstract_pos:]

    lines = text.split("\n")
    out: list[str] = []
    in_code_block = False

    out.append("---")
    out.append(f'title: "RFC {rfc_num}: {title}"')
    out.append(f'source: "{src.name}"')
    out.append("generated: true")
    out.append("---")
    out.append("")
    out.append(f"# RFC {rfc_num}: {title}")
    out.append("")

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.rstrip()

        # Detect section headers: "N.  Title" or "N.N.  Title"
        section_match = re.match(
            r"^(\s{0,3})(\d+(?:\.\d+)*\.?)\s{2,}(\S.*)$", stripped
        )
        if section_match:
            _indent, num, heading = section_match.groups()
            depth = num.count(".")
            if num.endswith("."):
                depth = max(1, depth)
            level = min(depth + 1, 5)
            prefix = "#" * level
            if in_code_block:
                out.append("```")
                in_code_block = False
            out.append("")
            out.append(f"{prefix} {num} {heading}")
            out.append("")
            i += 1
            continue

        # Detect standalone headers
        standalone_match = re.match(
            r"^(\s{0,3})(Abstract|Status of This Memo|Copyright Notice|"
            r"Table of Contents|Introduction|Security Considerations|"
            r"IANA Considerations|References|Normative References|"
            r"Informative References|Acknowledgements?|"
            r"Authors?['\u2019]?\s+Address(?:es)?|Full Copyright Statement|"
            r"Intellectual Property|Appendix [A-Z]\.?\s*.*)$",
            stripped,
        )
        if standalone_match and not in_code_block:
            _, heading = standalone_match.groups()
            out.append("")
            out.append(f"## {heading}")
            out.append("")
            i += 1
            continue

        # Code blocks: lines indented 6+ spaces with code-like content
        if stripped and line.startswith("      ") and not section_match:
            if not in_code_block:
                content = stripped
                if re.search(r"[|+\-=>{}\[\]();/\\]", content) or re.match(
                    r"^(Step |PRK |OKM |IKM |Hash |if |for |0x|HMAC|SHA|"
                    r"Input:|Output:|Procedure|struct |def |let |Type:)",
                    content,
                ):
                    out.append("")
                    out.append("```")
                    in_code_block = True
            out.append(stripped)
            i += 1
            continue
        elif in_code_block and (not stripped or not line.startswith("      ")):
            out.append("```")
            out.append("")
            in_code_block = False

        if not stripped:
            out.append("")
            i += 1
            continue

        # Remove leading 3-space RFC body indent
        cleaned = re.sub(r"^   ", "", line.rstrip())
        out.append(cleaned)
        i += 1

    if in_code_block:
        out.append("```")

    return "\n".join(out)


# ---------------------------------------------------------------------------
# BIP .mediawiki → .md  (via pandoc)
# ---------------------------------------------------------------------------

def convert_mediawiki(src: Path) -> str:
    """Convert MediaWiki format to markdown using pandoc."""
    result = subprocess.run(
        ["pandoc", "-f", "mediawiki", "-t", "gfm", "--wrap=auto",
         "--columns=100", str(src)],
        capture_output=True,
        text=True,
        check=True,
    )
    text = result.stdout

    meta_match = re.search(r"Title:\s*(.+?)$", text, re.MULTILINE)
    title = meta_match.group(1).strip() if meta_match else src.stem

    bip_match = re.search(r"BIP:\s*(\d+)", text)
    bip_num = bip_match.group(1) if bip_match else ""

    frontmatter = (
        f"---\n"
        f'title: "BIP-{bip_num}: {title}"\n'
        f'source: "{src.name}"\n'
        f"generated: true\n"
        f"---\n\n"
    )
    return frontmatter + text


# ---------------------------------------------------------------------------
# HTML papers → .md  (via pandoc + cleanup)
# ---------------------------------------------------------------------------

def convert_html_paper(src: Path) -> str:
    """Convert HTML paper/blog post to markdown, stripping boilerplate."""
    result = subprocess.run(
        ["pandoc", "-f", "html", "-t", "gfm", "--wrap=auto",
         "--columns=100", str(src)],
        capture_output=True,
        text=True,
        check=True,
    )
    text = result.stdout

    # Strip pandoc div/span wrappers from saved web pages
    text = re.sub(r"::+\s*\{[^}]*\}\s*", "", text)
    text = re.sub(r"\[\s*\]\([^)]*\)\{[^}]*\}", "", text)
    text = re.sub(r":::+\s*", "", text)

    # Remove navigation, sharing, footer boilerplate
    text = re.sub(
        r"^.*(?:aria-label|Skip to|Sign [iu]n|Sign up|"
        r"Previous post|Next post|Share post|Back to top|"
        r"©|All rights reserved|cookie|"
        r"target=\"_blank\" rel=\"noopener\").*$",
        "",
        text,
        flags=re.MULTILINE | re.IGNORECASE,
    )

    # Remove empty links/images
    text = re.sub(r"\[.*?\]\(\s*\)\s*", "", text)
    text = re.sub(r"!\[.*?\]\(\s*\)\s*", "", text)

    # Remove CSS code blocks
    text = re.sub(r"```\s*css\s*\n.*?```", "", text, flags=re.DOTALL)

    # Strip HTML remnants
    text = re.sub(r"<div[^>]*>\s*", "", text)
    text = re.sub(r"</div>\s*", "", text)
    text = re.sub(r"<span[^>]*>", "", text)
    text = re.sub(r"</span>", "", text)

    # Collapse blank lines
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    text = text.strip()

    # Extract title
    title_match = re.search(r"^#{1,2}\s+(.+)$", text, re.MULTILINE)
    title = title_match.group(1).strip() if title_match else src.stem

    # Escape quotes in title for YAML
    title = title.replace('"', '\\"')

    frontmatter = (
        f"---\n"
        f'title: "{title}"\n'
        f'source: "{src.name}"\n'
        f"generated: true\n"
        f"---\n\n"
    )
    return frontmatter + text


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def find_convertible_files() -> list[tuple[Path, str]]:
    """Return list of (source_path, format) tuples for convertible files."""
    files: list[tuple[Path, str]] = []

    # RFC files: prefer .xml (xml2rfc pipeline) over .txt (custom parser)
    seen_rfcs: set[str] = set()
    for xml in sorted(RFCS_DIR.glob("rfc*.xml")):
        stem = xml.stem
        if f"{stem}.md" not in HANDWRITTEN_MD:
            files.append((xml, "rfc-xml"))
            seen_rfcs.add(stem)

    for txt in sorted(RFCS_DIR.glob("rfc*.txt")):
        stem = txt.stem
        if stem not in seen_rfcs and f"{stem}.md" not in HANDWRITTEN_MD:
            files.append((txt, "rfc-txt"))

    # BIP .mediawiki files
    for mw in sorted(BIPS_DIR.glob("*.mediawiki")):
        files.append((mw, "mediawiki"))

    # HTML papers
    for html in sorted(PAPERS_DIR.glob("*.html")):
        stem = html.stem
        if f"{stem}.md" not in HANDWRITTEN_MD:
            files.append((html, "html"))

    return files


def has_xml2rfc() -> bool:
    """Check if xml2rfc is available."""
    return shutil.which("xml2rfc") is not None


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert reference documents to markdown."
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Overwrite existing generated .md files (never overwrites handwritten)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Show what would be converted without writing",
    )
    args = parser.parse_args()

    xml2rfc_ok = has_xml2rfc()
    if not xml2rfc_ok:
        print("Warning: xml2rfc not found; RFC XML files will use txt fallback.")
        print("  Install: uv run --with xml2rfc convert_to_markdown.py")

    files = find_convertible_files()
    converted = 0
    skipped = 0
    errors = 0

    for src, fmt in files:
        dest = src.with_suffix(".md")

        # Never overwrite handwritten .md files
        if dest.name in HANDWRITTEN_MD:
            skipped += 1
            continue

        if dest.exists() and not args.force:
            print(f"  skip  {src.relative_to(DOCS_SRC)}  (.md exists)")
            skipped += 1
            continue

        if args.dry_run:
            print(f"  would convert  {src.relative_to(DOCS_SRC)}  ({fmt})")
            converted += 1
            continue

        try:
            if fmt == "rfc-xml":
                if xml2rfc_ok:
                    md = convert_rfc_xml(src)
                else:
                    # Fall back to .txt if available
                    txt_path = src.with_suffix(".txt")
                    if txt_path.exists():
                        md = convert_rfc_txt(txt_path)
                    else:
                        print(f"  skip  {src.relative_to(DOCS_SRC)}  (no xml2rfc, no .txt)")
                        skipped += 1
                        continue
            elif fmt == "rfc-txt":
                md = convert_rfc_txt(src)
            elif fmt == "mediawiki":
                md = convert_mediawiki(src)
            elif fmt == "html":
                md = convert_html_paper(src)
            else:
                continue

            dest.write_text(md, encoding="utf-8")
            print(f"  done  {src.relative_to(DOCS_SRC)} → {dest.name}")
            converted += 1

        except Exception as e:
            print(f"  ERROR {src.relative_to(DOCS_SRC)}: {e}", file=sys.stderr)
            errors += 1

    print(f"\nConverted: {converted}  Skipped: {skipped}  Errors: {errors}")


if __name__ == "__main__":
    main()
