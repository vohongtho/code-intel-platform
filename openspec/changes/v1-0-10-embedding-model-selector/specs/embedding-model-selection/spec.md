# Capability: Embedding model selection

## ADDED Requirements

### Requirement: Backend-authoritative model catalog

The system SHALL expose only embedding models registered and supported by the backend runtime.

#### Scenario: Settings loads supported models

GIVEN an authenticated viewer opens Embeddings Settings
WHEN the Web client requests `GET /api/v1/embeddings/models`
THEN the server returns canonical model descriptors
AND identifies exactly one default model
AND does not initialize or download an embedding model.

### Requirement: Model is selected from a pull-down

The Embeddings Model setting SHALL be rendered as an accessible pull-down or combobox rather than an arbitrary text input.

#### Scenario: Administrator selects a model

GIVEN the catalog contains an available model
WHEN an administrator selects it
THEN the configuration stores the descriptor's canonical ID
AND the administrator cannot submit an arbitrary unregistered value.

#### Scenario: Read-only user views the selection

GIVEN the current user cannot edit global settings
WHEN the Embeddings section is displayed
THEN the selected model and descriptor metadata are visible
AND the control is disabled.

### Requirement: Runtime uses the selected descriptor

The embedding runtime SHALL load the selected registered model and derive its dimension and fingerprint from the same descriptor.

#### Scenario: Selected model is used

GIVEN a supported model is saved in configuration
WHEN embeddings are generated
THEN that canonical model ID is passed to the feature-extraction pipeline
AND the output dimension is checked against the descriptor
AND metadata records the same model ID and dimension.

#### Scenario: Model changes

GIVEN vectors were built with model A
AND configuration is changed to model B
WHEN rebuild planning compares fingerprints
THEN the existing vectors are considered incompatible
AND a new vector build is required before publication.

### Requirement: Unsupported legacy values are recoverable

The Settings page SHALL not crash or silently replace an unknown persisted model.

#### Scenario: Unknown legacy model

GIVEN persisted configuration contains a model absent from the catalog
WHEN Settings loads
THEN the current value is displayed as unsupported legacy configuration
AND the administrator is prompted to choose a supported model
AND the system does not silently run a different model under that value.

### Requirement: Unavailable models cannot be enabled

A known but unavailable model SHALL not be accepted for enabled embeddings.

#### Scenario: Optional runtime dependency is unavailable

GIVEN the catalog knows a model but its runtime dependency is unavailable
WHEN Settings renders the option
THEN the option is visible but disabled with a reason
AND server validation rejects enabling embeddings with that model.
