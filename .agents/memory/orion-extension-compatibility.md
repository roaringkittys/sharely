---
name: Orion extension compatibility
description: Compatibility constraints for Sharely's Orion Browser extension packaging.
---
Orion accepts the Groupy-derived MV3 package shape: a root-level manifest, `action.default_popup`, `background.service_worker`, and root-level assets. Preserve those manifest and archive conventions when changing functionality.

**Why:** The earlier MV2-based Sharely package was rejected by Orion, while the Groupy-derived MV3 archive imported successfully.

**How to apply:** Make functionality changes inside the existing root-level package and validate the ZIP after each isolated migration step; do not switch back to MV2 or introduce a wrapper directory.