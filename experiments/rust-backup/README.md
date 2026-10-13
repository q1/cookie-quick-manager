# Rust backup experiment

This is a dependency-free Rust 1.98.0 Netscape delimiter scanner compiled to
WebAssembly. It is **not included in the extension**. TypeScript retains cookie
validation, identity, JSON/legacy migration, and browser mutations. The scanner
returns a bounded array of UTF-16 offsets in one batch; it does not serialize
cookie objects or call browser APIs. Ill-formed UTF-16 inputs use the reference
parser so a Wasm UTF-8 bridge cannot silently replace their code units.

The loader owns one module per dedicated worker. Rust owns the input/output
buffers; there are no third-party crates or hand-written Rust pointer dereferences.
JS fills an allocated byte view and reads a bounded offset view. Input is capped
at 10 MiB and output at 10,000 rows, matching production limits. Module memory
grows to its high-water mark; terminating a worker releases the instance.

Install the optional experiment toolchain without changing the default toolchain:

```sh
rustup toolchain install 1.98.0 --profile minimal --component rustfmt --target wasm32-unknown-unknown
RUST_LAB_TOOLCHAIN=1.98.0 bun run build:transfer-lab speed
bun run benchmark:transfers -- --browser chromium --output /tmp/chromium.json
bun run benchmark:transfers -- --browser firefox --output /tmp/firefox.json
cargo +1.98.0 test --locked --manifest-path experiments/rust-backup/Cargo.toml
```

The build script accepts `release` (`opt-level=s`), `speed` (`3`), or `small`
(`z`). All profiles use LTO, one codegen unit, stripped symbols, and panic abort.
The experiment preflight rejects a different Rust compiler. If your installed
`stable` is already exactly 1.98.0, the environment override is unnecessary.

Each browser runs 1,022 differential cases, then compares the unchanged core
parser on the UI thread, in a TypeScript worker, and with the Rust scanner in a
worker. JSON retains the TypeScript parser in all cases and is explicitly marked
as not using Rust. All complete previews are compared through canonical hashes;
arrays, warnings, errors, locations, and cookie metadata must match.

No personal data is used. Run benchmarks sequentially without competing builds
or tests. Timings are observations, not CI pass/fail criteria. The optional
experiment CI checks parity and Rust tests but does not change normal extension
build requirements. Build directories and generated Wasm are ignored. The AMO
source archive retains production build inputs; clone Git to run this lab.

See [the results and decision](../../docs/rust-experiment.md).
