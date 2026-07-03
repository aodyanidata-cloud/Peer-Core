/**
 * AdapterRegistry — the "registry" in contract → adapter → registry. Adapters for
 * one contract (SmsProvider, PosProvider, …) register by name; selection is by
 * config, so swapping a vendor is a config change, never a core edit.
 */
export class AdapterRegistry<T> {
  private readonly adapters = new Map<string, T>();

  register(name: string, adapter: T): this {
    if (this.adapters.has(name)) {
      throw new Error(`adapter already registered: ${name}`);
    }
    this.adapters.set(name, adapter);
    return this;
  }

  get(name: string): T {
    const adapter = this.adapters.get(name);
    if (!adapter) {
      throw new Error(`no adapter registered as '${name}'`);
    }
    return adapter;
  }

  has(name: string): boolean {
    return this.adapters.has(name);
  }

  names(): string[] {
    return [...this.adapters.keys()];
  }
}
