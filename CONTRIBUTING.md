# Contributing

Thanks for helping. Some ground rules:

1. **Run the checks before you open a pull request:** `npm test` and `npm run check`. CI runs both.
2. **Keep `src/core/` free of Electron.** It must run and be tested in plain Node.
3. **Treat changes to `crypto.js`, `store.js` or the verification standard as security changes.** Explain the reasoning in the PR, add tests, and don't weaken any parameter in docs/SPEC.md.
4. **Don't add network calls** beyond the existing RPC and the opt-in wording check. If you need one, propose it in an issue first.
5. **Keep the wording digest identical to ImmuPact's `src/lib/pdfContent.js`.** If you change it, bump `STANDARD_VERSION`.
6. **Licence.** By contributing, you agree that your contribution is licensed under Apache-2.0 (section 5 of the License).

UI text should be plain language. The verdict wording is deliberate: say "not the anchored file", never "fake" or "not the signed original".
