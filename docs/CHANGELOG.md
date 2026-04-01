# Changelog

## 2026-04-01

### Fixed

- Fixed local workspace bootstrap failures caused by legacy `agent_memory_documents` rows missing the new memory lifecycle columns.
- Reordered agent workspace schema migration so missing columns are added before indexes that depend on them are created.
- Added bootstrap error detail surfacing in the chat shell so local initialization failures now show the concrete error chain instead of only a generic retry message.

### Improved

- Replaced the previous 8-second hard failure path with soft-timeout messaging plus a longer hard timeout for slow local workspace initialization.
- Added regression coverage for async timeout handling, bootstrap error formatting, and legacy workspace schema migration ordering.
