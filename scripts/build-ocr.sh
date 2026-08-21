#!/bin/bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="${CUE_OCR_OUTPUT:-$root/.cache/ocr}"
export CLANG_MODULE_CACHE_PATH="${CUE_SWIFT_MODULE_CACHE:-$root/.cache/swift-module-cache}"
mkdir -p "$out" "$CLANG_MODULE_CACHE_PATH"
xcrun swiftc -O -o "$out/cue-ocr" "$root/native/ocr/main.swift"
