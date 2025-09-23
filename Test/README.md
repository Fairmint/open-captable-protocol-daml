# Open Cap Table Protocol Test Suite

This directory contains tests for all packages in the Open Cap Table Protocol implementation.

Run with `npm run test` from the parent directory.

## Test Requirements

 * `External template choices` should be 100% covered. `External templates` created may be less than 100% due to external dependencies.
   * This requires a test of the `Archive` command which is implicitly available on all templates.
 * When `Optional` fields are included, the test file should include at least 2 separate tests, one with None for all Optional fields and another with Some for all Optional fields.