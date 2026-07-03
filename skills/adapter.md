# Skill: adapter

**Trigger:** integrating any external vendor — payment, SMS, WhatsApp, maps, POS (Foodics), LLM
provider, shipping.

**Pattern: contract → adapter → registry.**
1. **Contract.** Define a provider-neutral interface in the owning module (e.g. `PaymentProvider`,
   `SmsProvider`, `MessagingProvider`, `PosProvider`, `InferenceProvider`). The core depends only on
   this interface.
2. **Adapter.** Implement the interface for one vendor in its own file. Vendor SDK imports live
   ONLY here. Normalize webhooks to internal events; verify signatures inside the adapter.
3. **Registry.** Register adapters via DI; selection is config-driven so a vendor swap is a config
   change, not a core edit.

**Rules:** core never imports a vendor SDK (enforced by `scripts/fitness/gateway-check.sh` for LLMs)
· one adapter = one vendor · money/state effects from a vendor callback are dangerous (load
`dangerous-code`) · keep the `PosProvider` contract present from day one so Foodics (R3) is a clean
adapter, not a refactor.
