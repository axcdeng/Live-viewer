---
description: How to update the WordPress header (AI rule)
---

# WordPress Header Versioning Workflow

## IMPORTANT RULE
**Never modify `src/data/headerData.js` directly when asked to change the header.**

## Workflow

1. When the user asks for header changes:
   - Create a new header version in Admin > Header Management section
   - Or specify the exact data for a new version

2. Wait for explicit confirmation:
   - User must click "Show to all users" in Admin page
   - This copies a prompt with the new header data

3. Only then update `src/data/headerData.js`:
   - Apply the exact data from the copied prompt
   - Update the `lastUpdated` field

## Exception
If user explicitly says "update the live header directly" or similar urgent phrasing, proceed with direct modification.
