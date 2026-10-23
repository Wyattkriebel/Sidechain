#!/usr/bin/env python3
"""
build_artifact.py — inline the Sidechain repo files into one self-contained
page, so the published artifact and the repo never drift apart.

Emits two flavours:
  dist/sidechain-artifact.html  — body-only (the Artifact host supplies the
                                  doctype/head/body skeleton)
  dist/sidechain-standalone.html — a complete document that opens from file://

Usage:  python3 pipeline/build_artifact.py
"""
import json, os, re, sys

ROOT = os.path.join(os.path.dirname(__file__), "..")
P = lambda *a: os.path.join(ROOT, *a)

FONTS = ('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
         'family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&'
         'family=IBM+Plex+Sans:wght@400;500;600&'
         'family=JetBrains+Mono:wght@500;600;700&display=swap">')


def read(*parts):
    with open(P(*parts), encoding="utf-8") as fh:
        return fh.read()


def main():
    if not os.path.exists(P("data", "puzzles.json")):
        sys.exit("run pipeline/build_sidechain.py first")

    tokens = read("shared", "tokens.css")
    style = read("sidechain", "style.css")
    game = read("sidechain", "game.js")
    data = json.load(open(P("data", "puzzles.json"), encoding="utf-8"))
    html = read("sidechain", "index.html")

    # lift the markup out of <body>, dropping the external <script> tags
    body = re.search(r"<body>(.*?)</body>", html, re.S).group(1)
    body = re.sub(r"<script[^>]*src=[^>]*></script>\s*", "", body)
    body = body.strip()

    data_js = "window.SIDECHAIN_DATA=" + json.dumps(
        data, separators=(",", ":"), ensure_ascii=False) + ";"
    # never let a literal </script> inside the data close the tag early
    data_js = data_js.replace("</", "<\\/")

    head = (
        "<title>Sidechain</title>\n" + FONTS +
        "\n<style>\n" + tokens + "\n" + style + "\n</style>\n"
    )
    scripts = ("<script>" + data_js + "</script>\n"
               "<script>\n" + game + "\n</script>\n")

    os.makedirs(P("dist"), exist_ok=True)

    with open(P("dist", "sidechain-artifact.html"), "w", encoding="utf-8") as fh:
        fh.write(head + body + "\n" + scripts)

    standalone = (
        "<!doctype html>\n<html lang=\"en\">\n<head>\n"
        "<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
        + head +
        "<style>:root{padding-top:env(safe-area-inset-top,0px);"
        "padding-bottom:env(safe-area-inset-bottom,0px)}"
        "body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n"
        "</head>\n<body>\n" + body + "\n" + scripts + "</body>\n</html>\n"
    )
    with open(P("dist", "sidechain-standalone.html"), "w", encoding="utf-8") as fh:
        fh.write(standalone)

    for name in ("sidechain-artifact.html", "sidechain-standalone.html"):
        kb = os.path.getsize(P("dist", name)) / 1024
        print(f"  {name:32s} {kb:7.1f} KB")


if __name__ == "__main__":
    main()
