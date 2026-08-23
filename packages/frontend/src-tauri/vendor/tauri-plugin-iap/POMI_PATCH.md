# Pomi macOS account-token patch

This directory vendors Choochmeque `tauri-plugin-iap` 0.9.1 from crates.io
(upstream commit `187f530f163814787584bab441ef8e1b92e234d0`). Pomi keeps the
upstream implementation intact except for forwarding `appAccountToken` through
the macOS Rust-to-Swift bridge and supplying it to StoreKit 2.

Pomi purchases subscriptions before account authentication. The server-issued
checkout UUID must therefore appear in StoreKit's signed transaction so the
backend can bind the receipt to the account that claims it. Upstream 0.9.1
supports this on iOS but drops the option on macOS.

Remove the Cargo patch and this vendored copy after the upstream macOS bridge
forwards `PurchaseOptions.app_account_token` to
`Product.PurchaseOption.appAccountToken`.
