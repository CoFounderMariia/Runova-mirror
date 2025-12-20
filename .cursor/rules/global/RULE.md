GLOBAL RULE — DO NOT VIOLATE

This project has a stable response contract.

DO NOT:
- change response formatting
- change frontend rendering logic
- change JSON keys or response structure
- rename or remove fields used by the UI
- modify product recommendation response logic
- modify Q&A response logic

These layers are considered FINAL and WORKING.

ONLY allowed changes:
- internal async logic
- polling flow
- task lifecycle handling
- backend control flow
- timeout / retry behavior

If a fix is needed, it must preserve the existing response schema exactly.
---
alwaysApply: true
---
