# Capability: Runtime trust and offline installation

## ADDED Requirements

### Requirement: Official runtime archives have verifiable authenticity
Official v1.0.12+ runtime archives SHALL be verifiable against an approved Code Intel release identity in addition to checksum validation.

#### Scenario: Valid release bundle
GIVEN an official archive and matching verification bundle
WHEN verification runs
THEN the archive subject digest and approved release identity are verified
AND the installed trust state is `verified`.

#### Scenario: Wrong workflow identity
GIVEN an artifact signed by an identity outside the approved repository/workflow policy
WHEN verification runs
THEN the artifact is rejected
AND activation does not occur.

### Requirement: Verification failure is atomic
#### Scenario: Archive was modified
GIVEN a valid active runtime
AND the candidate archive digest differs from its authenticated release metadata
WHEN upgrade runs
THEN upgrade fails before activation
AND the previous runtime remains active.

### Requirement: Offline installation performs no network access
#### Scenario: Complete air-gapped bundle
GIVEN all required release files exist in a local bundle directory
WHEN `upgrade --bundle-dir ... --offline` runs
THEN no network fetch occurs
AND successful authenticity/integrity validation precedes activation.

### Requirement: Legacy installations remain truthful
#### Scenario: v1.0.11 checksum-only runtime
GIVEN an older runtime has no supported authenticity bundle
WHEN v1.0.12 inspects it
THEN it may report `legacy-checksum`
AND it SHALL NOT report `verified`.

### Requirement: Trust status is diagnosable
#### Scenario: Doctor or verify-install runs
GIVEN a self-contained runtime is installed
WHEN the runtime is inspected
THEN machine-readable output includes version, target, digest state, authenticity state and release identity metadata.
