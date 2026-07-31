# v1.0.9: Decouple vector updates from graph rebuild mode

## Problem

v1.0.8 correctly uses a clean full graph rebuild when source files change, but incorrectly uses graph execution mode to decide vector scope. A one-file source change therefore rebuilds embeddings for the entire repository.

## Required behavior

- First embeddings-enabled analysis builds the full vector index.
- Known changed/deleted source sets update vectors only for those paths, even when graph analysis performs a correctness-first full rebuild.
- Known zero-change runs perform no vector writes.
- Missing, incompatible, or stale vector state and explicit `--force` perform a full vector rebuild.
- Unknown change scope fails safe with a full vector rebuild.

## Non-goal

This does not restore partial graph rebuilding. Graph correctness and vector efficiency remain independent decisions.
