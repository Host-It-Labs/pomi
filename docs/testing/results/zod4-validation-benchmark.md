# Zod 4 validation benchmark

The benchmark compares object and array validation in the Zod 3 compatibility
export bundled with Zod 4.5.4 against the production Zod 4 runtime. It
alternates runtime order between samples to reduce ordering bias. Run it with
`pnpm benchmark:zod-validation`.

On 2026-09-02, Node 22.22.0 on Apple Silicon, 40 samples of 100,000 successful
validations produced:

| Case   | Zod 3 median | Zod 4 median | Median speedup | p95 speedup |
| ------ | -----------: | -----------: | -------------: | ----------: |
| Object |     26.51 ms |      2.49 ms |        10.64 x |      9.90 x |
| Array  |    221.25 ms |     26.19 ms |         8.45 x |      8.54 x |

CI and production target Node 26; rerun the committed benchmark after runtime
upgrades to keep the comparison representative.
