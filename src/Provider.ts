/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ProviderProps {
  name: string;
}

export interface Initializable {
  init: () => Promise<void>;
}

export interface Startable {
  start: () => void;
}

export interface Stoppable {
  stop: () => Promise<void>;
}

type InitializableProvider<S> = IProvider<S> & Initializable;
type StartableProvider<S> = IProvider<S> & Startable;
type StoppableProvider<S> = IProvider<S> & Stoppable;

export const ProviderInitParamsSymbol = Symbol("ProviderInitParams");

function formatInvalidDependencyEntry(dep: unknown): string {
  if (dep === undefined) return "undefined";
  if (dep === null) return "null";
  if (typeof dep === "object") {
    const ctor = (dep as { constructor?: { name?: string } }).constructor?.name;
    return ctor ? `an instance of ${ctor}` : "an object";
  }
  return typeof dep;
}

function assertValidDependencyList(
  definingName: string,
  deps: Provider<any, any>[] | undefined
): void {
  if (deps === undefined || deps.length === 0) return;
  for (let i = 0; i < deps.length; i++) {
    const dep = deps[i];
    if (dep instanceof Provider) continue;
    const circularHint =
      dep === undefined || dep === null
        ? " This usually indicates a circular import: the dependency module has not finished exporting when this provider is defined."
        : "";
    throw new Error(
      `Provider "${definingName}" dependency at index ${i} must be a Provider instance (got ${formatInvalidDependencyEntry(dep)}).${circularHint}`
    );
  }
}

export type ProviderLifecycleOptions<S> =
  | {
      init: (inst: S, params: any) => Promise<void>;
      start?: (inst: S) => void;
      stop?: (inst: S) => Promise<void>;
      reconfigure?: (inst: S, params: any) => Promise<S>;
    }
  | {
      start: (inst: S) => void;
    };

export interface IProvider<S, P = undefined> {
  readonly name: string;
  readonly isReady: boolean;
  readonly whenReady: Promise<void>;
  readonly depsLength: number;
  [ProviderInitParamsSymbol]: P;

  /** Runtime implementation. Access only when the service is ready. */
  impl: S;

  init?: (inst: S) => Promise<void>;
  start?: (inst: S) => void;
  stop?: (inst: S) => Promise<void>;

  define: <S>(
    props: ProviderProps,
    deps?: Provider<any, any>[]
  ) => IProvider<S>;

  /** Type guards */
  isInitializable: () => this is InitializableProvider<S>;
  isStartable: () => this is StartableProvider<S>;
  isStoppable: () => this is StoppableProvider<S>;

  /** Provide runtime implementation of a defined service. */
  provide: (impl: S, options?: ProviderLifecycleOptions<S>) => void;

  on: (event: "ready" | "start" | "stop", callback: () => void) => void;

  /** Set parameters for the provider initialization. */
  withParams: (params: unknown) => IProvider<S, P>;

  reconfigure: (params: unknown) => Promise<IProvider<S, P>>;
}

export class Provider<
  S,
  DepsProviders extends Provider<any, any>[] | undefined = undefined,
> implements IProvider<S> {
  readonly whenReady: Promise<void>;
  readonly ready: Promise<void>;

  [ProviderInitParamsSymbol] = undefined;

  private static _registry = new Set<Provider<any, any>>();

  get name(): string {
    return this.props.name;
  }

  get depsLength(): number {
    if (this.dependenciesList === undefined) return 0;
    return this.dependenciesList.length;
  }

  get isReady(): boolean {
    return this.isProviderReady;
  }

  /** True after {@link start} has completed successfully (for idempotent lifecycle orchestration). */
  get hasStarted(): boolean {
    return this.isStarted;
  }

  get dependencies(): DepsProviders | undefined {
    return this.dependenciesList;
  }

  on(event: "ready" | "start" | "stop", callback: () => void): void {
    if (event === "ready") this.readyCallbacks.push(callback);
    else if (event === "start") this.startCallbacks.push(callback);
    else this.stopCallbacks.push(callback);
  }

  static define<S>(props: ProviderProps, deps?: Provider<any, any>[]) {
    assertValidDependencyList(props.name, deps);
    const instance = new Provider<S, typeof deps>(props, deps);
    Provider._registry.add(instance);
    return instance;
  }

  /** Logs current status of all registered providers, grouped by Initialized / Started / Stopped. */
  static printStatus(): void {
    const all = Array.from(Provider._registry);
    const initialized: Provider<any>[] = [];
    const started: Provider<any>[] = [];
    const stopped: Provider<any>[] = [];
    const ignored: Provider<any>[] = [];

    for (let index = 0; index < all.length; index++) {
      const p = all[index];
      if (p.isProviderReady) {
        if (!p.isStarted && !p.isStopped) initialized.push(p);
        else started.push(p);
      } else if (p.isStopped) {
        stopped.push(p);
      } else {
        ignored.push(p);
      }
    }

    if (initialized.length > 0) {
      console.group("Providers: Initialized");
      initialized.forEach(p => console.log(p.name));
      console.groupEnd();
    }
    if (started.length > 0) {
      console.group("Providers: Started");
      started.forEach(p => console.log(p.name));
      console.groupEnd();
    }
    if (stopped.length > 0) {
      console.group("Providers: Stopped");
      stopped.forEach(p => console.log(p.name));
      console.groupEnd();
    }
    if (ignored.length > 0) {
      console.group("Providers: Ignored");
      ignored.forEach(p => console.log(p.name));
      console.groupEnd();
    }
  }

  /**
   * Builds dependency graphs for all registered providers.
   * Each graph contains providers connected through dependency relations.
   */
  static getDependencyGraphs(): Provider<any, any>[][] {
    const providers = Array.from(Provider._registry);
    const indexMap = new Map<Provider<any, any>, number>();

    for (let idx = 0; idx < providers.length; idx++) {
      indexMap.set(providers[idx], idx);
    }

    const adjacency = new Map<Provider<any, any>, Set<Provider<any, any>>>();
    for (const provider of providers) {
      adjacency.set(provider, new Set());
    }

    for (const provider of providers) {
      const dependencies = provider.dependencies as
        Provider<any, any>[] | undefined;
      if (!dependencies) continue;

      for (const dependency of dependencies) {
        if (!Provider._registry.has(dependency)) continue;

        adjacency.get(provider)?.add(dependency);
        adjacency.get(dependency)?.add(provider);
      }
    }

    const visited = new Set<Provider<any, any>>();
    const graphs: Provider<any, any>[][] = [];

    for (const provider of providers) {
      if (visited.has(provider)) continue;

      const component: Provider<any, any>[] = [];
      const stack: Provider<any, any>[] = [provider];

      while (stack.length > 0) {
        const current = stack.pop()!;
        if (visited.has(current)) continue;

        visited.add(current);
        component.push(current);

        const neighbours = adjacency.get(current);
        if (!neighbours) continue;

        for (const neighbour of neighbours) {
          if (!visited.has(neighbour)) stack.push(neighbour);
        }
      }

      component.sort((a, b) => {
        const left = indexMap.get(a) ?? 0;
        const right = indexMap.get(b) ?? 0;
        return left - right;
      });

      graphs.push(component);
    }

    return graphs;
  }

  /**
   * Prints dependency graphs in a readable format showing provider names.
   */
  static printDependencyGraphs(): void {
    const graphs = Provider.getDependencyGraphs();

    if (graphs.length === 0) {
      console.log("Providers: no registered providers");
      return;
    }

    console.group("Provider dependency graphs");
    for (let graphIdx = 0; graphIdx < graphs.length; graphIdx++) {
      const component = graphs[graphIdx];

      if (component.length === 1) {
        console.log(`#${graphIdx + 1} ${component[0].name}`);
        continue;
      }

      console.group(`#${graphIdx + 1} (${component.length})`);
      for (const provider of component) {
        const dependencies =
          (provider.dependencies as Provider<any, any>[] | undefined)
            ?.filter(dependency => Provider._registry.has(dependency))
            .map(dependency => dependency.name) ?? [];

        if (dependencies.length === 0) {
          console.log(`${provider.name} (no deps)`);
        } else {
          console.log(`${provider.name} <- ${dependencies.join(", ")}`);
        }
      }
      console.groupEnd();
    }
    console.groupEnd();
  }

  static reset(): void {
    this._registry.clear();
  }

  define<T>(props: ProviderProps, deps?: Provider<any, any>[]): IProvider<T> {
    return Provider.define<T>(props, deps);
  }

  /** Provide runtime implementation and optional lifecycle hooks (init, start, stop). */
  provide(impl: S, options?: ProviderLifecycleOptions<S>): void {
    this.implementation = impl;
    this.lifecycleOptions = options;
  }

  get impl(): S {
    if (!this.implementation) {
      const error = Error(`Implementation for "${this.name}" is not provided`);
      console.error(error.stack);
      throw error;
    }
    // if (!this.isProviderReady) {
    // 	const error = Error(`Provider "${this.name}" is not ready`);
    // 	console.error(error.stack);
    // 	throw error;
    // }
    return this.implementation;
  }

  async init(): Promise<void> {
    if (this.isInitializing || this.isProviderReady) {
      throw new Error(
        `Provider "${this.name}" init is already in progress or completed`
      );
    }
    if (!this.implementation) {
      throw new Error(`Implementation for "${this.name}" is not provided`);
    }

    this.isInitializing = true;
    try {
      if (
        this.lifecycleOptions &&
        "init" in this.lifecycleOptions &&
        typeof this.lifecycleOptions.init === "function"
      ) {
        await this.lifecycleOptions.init(
          this.implementation,
          this[ProviderInitParamsSymbol]
        );
      } else if (typeof (this.implementation as any)?.init === "function") {
        await (this.implementation as any).init();
      }

      this.markReady();
    } catch (error) {
      this.markBroken(error);
      throw error;
    } finally {
      this.isInitializing = false;
      this.isStopped = false;
    }
  }

  start(): void {
    if (!this.isProviderReady) {
      throw new Error(`Provider "${this.name}" is not ready`);
    }
    if (this.isStarted) {
      throw new Error(`Provider "${this.name}" start was already called`);
    }

    if (
      this.lifecycleOptions &&
      "start" in this.lifecycleOptions &&
      typeof this.lifecycleOptions.start === "function"
    ) {
      this.lifecycleOptions.start(this.implementation);
    } else if (typeof (this.implementation as any)?.start === "function") {
      (this.implementation as any).start();
    }

    this.isStarted = true;
    this.isStopped = false;
    for (const cb of this.startCallbacks) cb();
  }

  async stop(): Promise<void> {
    if (this.isStopped)
      console.warn(`Provider "${this.name}" is already stopped!`);
    if (!this.implementation) {
      throw new Error(`Implementation for "${this.name}" is not provided`);
    }

    if (
      this.lifecycleOptions &&
      "stop" in this.lifecycleOptions &&
      typeof this.lifecycleOptions.stop === "function"
    ) {
      await this.lifecycleOptions.stop(this.implementation);
    } else if (typeof (this.implementation as any)?.stop === "function") {
      await (this.implementation as any).stop();
    }

    this.isInitializing = false;
    this.isStarted = false;
    this.isProviderReady = false;
    this.isStopped = true;
    for (const cb of this.stopCallbacks) cb();
  }

  isInitializable(): this is InitializableProvider<S> {
    if (
      this.lifecycleOptions &&
      "init" in this.lifecycleOptions &&
      typeof this.lifecycleOptions.init === "function"
    )
      return true;
    return typeof (this.implementation as any)?.init === "function";
  }

  isStartable(): this is StartableProvider<S> {
    if (
      this.lifecycleOptions &&
      "start" in this.lifecycleOptions &&
      typeof this.lifecycleOptions.start === "function"
    )
      return true;
    return typeof (this.implementation as any)?.start === "function";
  }

  isStoppable(): this is StoppableProvider<S> {
    if (
      this.lifecycleOptions &&
      "stop" in this.lifecycleOptions &&
      typeof this.lifecycleOptions.stop === "function"
    )
      return true;
    return typeof (this.implementation as any)?.stop === "function";
  }

  withParams(params: unknown): this {
    this[ProviderInitParamsSymbol] = params as any;
    return this;
  }

  async reconfigure(params: unknown): Promise<this> {
    if (
      !this.lifecycleOptions ||
      !("reconfigure" in this.lifecycleOptions) ||
      !this.lifecycleOptions.reconfigure
    ) {
      throw new Error(
        `Provider "${this.name}" does not have "reconfigure" option. It needs to be set via ".provide(inst, options)"`
      );
    }
    this[ProviderInitParamsSymbol] = params as any;
    const reconfigured = await this.lifecycleOptions.reconfigure(
      this.implementation,
      params
    );
    this.implementation = reconfigured;
    return this;
  }

  /*----------  Private  ----------*/

  private implementation!: S;
  private props: ProviderProps;
  private dependenciesList: DepsProviders | undefined;
  private lifecycleOptions?: ProviderLifecycleOptions<S>;
  private markReady!: () => void;
  private markBroken!: (error: unknown) => void;
  private isProviderReady: boolean = false;
  private isInitializing: boolean = false;
  private isStarted: boolean = false;
  private isStopped: boolean = false;
  private readyCallbacks: (() => void)[] = [];
  private startCallbacks: (() => void)[] = [];
  private stopCallbacks: (() => void)[] = [];

  private constructor(props: ProviderProps, deps?: DepsProviders) {
    if (!props.name) throw new Error("Provider name is required");
    this.props = props;
    this.dependenciesList = deps;
    this.whenReady = new Promise((resolve, reject) => {
      this.markReady = () => {
        this.isProviderReady = true;
        for (const cb of this.readyCallbacks) cb();
        resolve();
      };
      this.markBroken = reject;
    });
    this.ready = this.whenReady;
    return;
  }
}
