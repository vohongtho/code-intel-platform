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
The installer SHALL leave the active runtime and trust metadata unchanged when authenticity, integrity, archive safety, extraction, or post-extraction validation fails.

#### Scenario: Archive was modified
GIVEN a valid active runtime
AND the candidate archive digest differs from its authenticated release metadata
WHEN upgrade runs
THEN upgrade fails before activation
AND the previous runtime remains active.

### Requirement: Offline installation performs no network access
Offline installation SHALL resolve all required verification and runtime material from the explicit bundle directory and SHALL perform no network fetch.

#### Scenario: Complete air-gapped bundle
GIVEN all required release files exist in a local bundle directory
WHEN `upgrade --bundle-dir ... --offline` runs
THEN no network fetch occurs
AND successful authenticity/integrity validation precedes activation.

### Requirement: Legacy installations remain truthful
The system SHALL distinguish checksum-only legacy installations from authenticity-verified installations without retroactively upgrading their trust state.

#### Scenario: v1.0.11 checksum-only runtime
GIVEN an older runtime has no supported authenticity bundle
WHEN v1.0.12 inspects it
THEN it may report `legacy-checksum`
AND it SHALL NOT report `verified`.

### Requirement: Trust status is diagnosable
Runtime diagnostics SHALL expose bounded machine-readable integrity and authenticity state, including the verified release identity when available.

#### Scenario: Doctor or verify-install runs
GIVEN a self-contained runtime is installed
WHEN the runtime is inspected
THEN machine-readable output includes version, target, digest state, authenticity state and release identity metadata.

### Requirement: Archive entries are validated before extraction
The installer SHALL reject absolute paths, parent traversal, unsafe links, excessive entry counts or sizes, and extraction-root escapes before unpacking a runtime archive.

#### Scenario: Archive contains a parent-traversal entry
GIVEN a candidate runtime archive contains an entry whose normalized path escapes its extraction root
WHEN upgrade validation runs
THEN the archive is rejected before extraction
AND the active runtime and trust metadata remain unchanged.
