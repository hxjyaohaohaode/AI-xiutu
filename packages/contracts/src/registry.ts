import { z } from 'zod';
import { resourceKinds } from './protocol.js';

const identifier = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/)
  .max(100);
export const capabilitySchema = z
  .object({
    id: identifier,
    label: z.string().min(1).max(120),
    implementation: z.enum(['implemented', 'adapter-required', 'contract-only']),
    execution: z.enum(['browser', 'worker', 'api', 'external']),
    permission: z.enum(['local', 'read', 'comment', 'edit', 'admin', 'operator']),
    inputs: z.array(z.enum(resourceKinds)).max(12),
    outputs: z.array(z.enum(resourceKinds)).max(12),
    requires: z.array(identifier).max(16),
    confirmation: z.enum(['none', 'preview', 'explicit']),
    persistence: z.enum(['device', 'revision', 'transaction', 'candidate']),
    limitations: z.array(z.string().min(1).max(500)).max(16),
  })
  .strict();
export type Capability = z.infer<typeof capabilitySchema>;
export const moduleManifestSchema = z
  .object({
    protocolVersion: z.literal(1),
    id: identifier,
    label: z.string().min(1).max(120),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    dependsOn: z.array(identifier).max(32),
    capabilities: z.array(capabilitySchema).min(1).max(100),
  })
  .strict();
export type ModuleManifest = z.infer<typeof moduleManifestSchema>;
export interface RuntimeGate {
  available: boolean;
  reason: string | null;
}
export interface ResolvedCapability extends Capability {
  runtime: 'available' | 'unconfigured' | 'unsupported';
  reason: string | null;
}

/** Metadata only: never evaluates downloaded code, URLs, or browser privileges.
 * Server ACL and per-operation validation remain authoritative. */
export class ModuleRegistry {
  private readonly entries = new Map<string, ModuleManifest>();
  private sealed = false;
  register(raw: unknown): this {
    if (this.sealed) throw new Error('Registry is sealed');
    const module = moduleManifestSchema.parse(raw);
    if (this.entries.has(module.id)) throw new Error(`Duplicate module: ${module.id}`);
    const known = new Set(
      [...this.entries.values()].flatMap((item) => item.capabilities.map((cap) => cap.id)),
    );
    for (const capability of module.capabilities) {
      if (!capability.id.startsWith(`${module.id}.`))
        throw new Error('Capability must use its module namespace');
      if (known.has(capability.id)) throw new Error(`Duplicate capability: ${capability.id}`);
      known.add(capability.id);
    }
    if (new Set(module.dependsOn).size !== module.dependsOn.length)
      throw new Error('Duplicate module dependency');
    this.entries.set(module.id, module);
    return this;
  }
  seal(): this {
    const seen = new Set<string>();
    const visiting = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) throw new Error(`Cyclic module dependency: ${id}`);
      if (seen.has(id)) return;
      const module = this.entries.get(id);
      if (!module) throw new Error(`Missing module dependency: ${id}`);
      visiting.add(id);
      module.dependsOn.forEach(visit);
      visiting.delete(id);
      seen.add(id);
    };
    [...this.entries.keys()].forEach(visit);
    this.sealed = true;
    return this;
  }
  list(): ModuleManifest[] {
    return structuredClone([...this.entries.values()]);
  }
  capability(id: string): Capability | undefined {
    for (const module of this.entries.values()) {
      const found = module.capabilities.find((item) => item.id === id);
      if (found) return structuredClone(found);
    }
    return undefined;
  }
  resolve(id: string, gates: Readonly<Record<string, RuntimeGate>> = {}): ResolvedCapability {
    if (!this.sealed) throw new Error('Registry must be sealed before runtime discovery');
    const capability = this.capability(id);
    if (!capability) throw new Error(`Unknown capability: ${id}`);
    if (capability.implementation === 'contract-only')
      return { ...capability, runtime: 'unsupported', reason: '已定义扩展契约，尚无执行器' };
    const unavailable = capability.requires.find((gate) => !gates[gate]?.available);
    if (unavailable)
      return {
        ...capability,
        runtime: 'unconfigured',
        reason: gates[unavailable]?.reason ?? `尚未配置 ${unavailable}`,
      };
    if (capability.implementation === 'adapter-required' && !capability.requires.length)
      return { ...capability, runtime: 'unconfigured', reason: '需要经过验收的算法适配器' };
    return { ...capability, runtime: 'available', reason: null };
  }
  discover(gates: Readonly<Record<string, RuntimeGate>> = {}) {
    return this.list().map((module) => ({
      ...module,
      capabilities: module.capabilities.map((cap) => this.resolve(cap.id, gates)),
    }));
  }
}
