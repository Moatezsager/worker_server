# Implementation Plan - Multi-line Currency and Price Extraction (e.g., الدولار / 10.23)

## User Goal
Support robust extraction of currency rates from multi-line messages where the currency name appears on one line (e.g., `الدولار` or `يورو`) and the price appears on the next line (e.g., `10.23`), as requested by the user and confirmed via clarifying questions.

## Proposed Changes

### 1. Scraper Service (`server/services/scraper.service.ts`)
- Update line-by-line bridging logic (similar to `cashQuote`) to recognize simple multi-line patterns where:
  - Header line contains currency keywords (`الدولار`, `دولار`, `يورو`, `EUR`, `USD`) without numbers.
  - Subsequent line contains a clean numeric price matching `/^\d{1,2}[.,]\d{1,4}$/`.
- Bridge these into a single evaluatable string format (`${header} ${quote}`) so existing regex terms (USD, EUR) match successfully.

### 2. Regression Tests (`tests/regression.cjs`)
- Add test cases covering:
  - `"الدولار\n10.23"`
  - `"يورو\n11.15"`
- Verify that `extractRatesFromText` correctly extracts USD and EUR values from these multi-line messages without errors.

## Verification Plan
- Run `npm test` to verify all regression and integration tests pass.
- Ensure build succeeds with `compile_applet`.
