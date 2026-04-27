---
name: shared-2
description: "Covers the **shared** subsystem of code-intel-platform. 12 symbols across 3 files. Key symbols: `Header`, `KeyboardShortcutsModal`, `StatusFooter`. Internal call density: 0 calls/symbol."
---

# shared

> **12 symbols** | **3 files** | path: `code-intel/web/src/components/shared/` | call density: 0/sym

## When to Use

Load this skill when:
- The task involves code in `code-intel/web/src/components/shared/`
- The user mentions `Header`, `KeyboardShortcutsModal`, `StatusFooter` or asks how they work
- Adding, modifying, or debugging shared-related functionality
- Tracing call chains that pass through the shared layer

## Key Files

| File | Symbols | Notes |
|------|---------|-------|
| `code-intel/web/src/components/shared/KeyboardShortcutsModal.tsx` | `KeyboardShortcutsModalProps`, `ShortcutEntry`, `ShortcutGroup`, `KeyboardShortcutsModal` +(2) | 1 exported |
| `code-intel/web/src/components/shared/Header.tsx` | `Props`, `Header`, `check`, `onKey` +(1) | 1 exported |
| `code-intel/web/src/components/shared/StatusFooter.tsx` | `StatusFooter` | 1 exported |

## Entry Points

Start exploration here — exported symbols with no external callers:

- **`Header`** `(function)` → `code-intel/web/src/components/shared/Header.tsx:12`
- **`KeyboardShortcutsModal`** `(function)` → `code-intel/web/src/components/shared/KeyboardShortcutsModal.tsx:43`
- **`StatusFooter`** `(function)` → `code-intel/web/src/components/shared/StatusFooter.tsx:8`

## Hot Symbols

Sorted by call graph degree (changing these has the highest blast radius):

| Symbol | Kind | In ← | → Out | File |
|--------|------|-----:|------:|------|
| `check` | function | 1 | 1 | `shared/Header.tsx` |
| `handleSearch` | function | 1 | 1 | `shared/Header.tsx` |
| `StatusFooter` | function | 0 | 2 | `shared/StatusFooter.tsx` |
| `Props` | interface | 0 | 0 | `shared/Header.tsx` |
| `Header` | function | 0 | 0 | `shared/Header.tsx` |
| `onKey` | function | 0 | 0 | `shared/Header.tsx` |
| `KeyboardShortcutsModalProps` | interface | 0 | 0 | `shared/KeyboardShortcutsModal.tsx` |
| `ShortcutEntry` | interface | 0 | 0 | `shared/KeyboardShortcutsModal.tsx` |
| `ShortcutGroup` | interface | 0 | 0 | `shared/KeyboardShortcutsModal.tsx` |
| `KeyboardShortcutsModal` | function | 0 | 0 | `shared/KeyboardShortcutsModal.tsx` |
| `handleKeyDown` | function | 0 | 0 | `shared/KeyboardShortcutsModal.tsx` |
| `handleOverlayClick` | function | 0 | 0 | `shared/KeyboardShortcutsModal.tsx` |

## Impact Guidance

Before modifying any symbol in this area:
1. **High-degree symbols** (In ← ≥ 3) — check all callers before changing signatures
2. **Entry points** — changes propagate to external consumers
3. Run `code-intel impact <symbol>` to get full blast radius

## Quick Commands

```bash
# Inspect most-connected symbol
code-intel inspect check
# Blast radius for entry point
code-intel impact Header
# Search this area
code-intel search "shared"
```
