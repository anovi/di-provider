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

export const ProviderState = {
  IDLE: "idle",
  INITIALIZING: "initializing",
  READY: "ready",
  STARTED: "started",
  STOPPED: "stopped",
} as const;

export type ProviderState = (typeof ProviderState)[keyof typeof ProviderState];

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
  /** Unique identifier or name of the provider. */
  readonly name: string;
  /** True if the provider has completed initialization and is ready for use. */
  readonly isReady: boolean;
  /** Promise that resolves when the provider has been successfully initialized. */
  readonly whenReady: Promise<void>;
  /** Number of direct dependencies declared for this provider. */
  readonly depsLength: number;
  /** True after start has completed successfully. */
  readonly hasStarted: boolean;
  /** Direct dependencies declared for this provider. */
  readonly dependencies?: IProvider<any, any>[] | undefined;
  /** Initialization parameters stored on the provider symbol. */
  [ProviderInitParamsSymbol]: P;

  /**
   * Runtime implementation.
   * @throws Error if accessed before implementation is bound.
   */
  impl: S;

  /** Initializes the provider and its implementation. */
  init?: (inst: S) => Promise<void>;
  /** Starts the provider after initialization. */
  start?: (inst: S) => void;
  /** Stops the provider and executes teardown hooks. */
  stop?: (inst: S) => Promise<void>;

  /**
   * Defines and registers a new Provider instance.
   * @param props Configuration properties containing the provider name
   * @param deps Optional array of Provider instances this provider depends on
   */
  define: <S>(
    props: ProviderProps,
    deps?: Provider<any, any>[]
  ) => IProvider<S>;

  /** Checks whether the provider defines an `init` lifecycle hook. */
  isInitializable: () => this is InitializableProvider<S>;
  /** Checks whether the provider defines a `start` lifecycle hook. */
  isStartable: () => this is StartableProvider<S>;
  /** Checks whether the provider defines a `stop` lifecycle hook. */
  isStoppable: () => this is StoppableProvider<S>;

  /**
   * Binds the runtime implementation and optional lifecycle hooks to this provider.
   * @param impl The concrete service implementation
   * @param options Optional lifecycle hooks (`init`, `start`, `stop`, `reconfigure`)
   */
  bind: (impl: S, options?: ProviderLifecycleOptions<S>) => void;

  /**
   * Registers a callback listener for provider lifecycle events.
   * @param event Lifecycle event name (`"ready"`, `"start"`, or `"stop"`)
   * @param callback Function to invoke when the event occurs
   */
  on: (event: "ready" | "start" | "stop", callback: () => void) => void;

  /**
   * Sets parameters to be passed to the provider's `init` hook.
   * @param params Initialization parameters
   */
  withParams: (params: unknown) => IProvider<S, P>;

  /**
   * Dynamically reconfigures the provider implementation using its configured `reconfigure` hook.
   * @param params Reconfiguration parameters
   */
  reconfigure: (params: unknown) => Promise<IProvider<S, P>>;
}

export class Provider<
  S,
  DepsProviders extends Provider<any, any>[] | undefined = undefined,
> implements IProvider<S> {
  /** When provider is initialized  */
  readonly whenReady: Promise<void>;

  [ProviderInitParamsSymbol] = undefined;

  /** Unique identifier or name of the provider. */
  get name(): string {
    return this.props.name;
  }

  /** Number of direct dependencies declared for this provider. */
  get depsLength(): number {
    if (this.dependenciesList === undefined) return 0;
    return this.dependenciesList.length;
  }

  /** True if the provider has completed initialization and is ready for use. */
  get isReady(): boolean {
    return (
      this.state === ProviderState.READY || this.state === ProviderState.STARTED
    );
  }

  /** True after {@link start} has completed successfully. */
  get hasStarted(): boolean {
    return this.state === ProviderState.STARTED;
  }

  /** Direct dependencies declared for this provider. */
  get dependencies(): DepsProviders | undefined {
    return this.dependenciesList;
  }

  /**
   * Registers a callback listener for provider lifecycle events.
   * @param event Lifecycle event name (`"ready"`, `"start"`, or `"stop"`)
   * @param callback Function to invoke when the event occurs
   */
  on(event: "ready" | "start" | "stop", callback: () => void): void {
    if (event === "ready") (this.readyCallbacks ??= []).push(callback);
    else if (event === "start") (this.startCallbacks ??= []).push(callback);
    else (this.stopCallbacks ??= []).push(callback);
  }

  /**
   * Defines and registers a new Provider with explicit dependencies.
   * @param props Configuration properties containing the provider name
   * @param deps Optional array of Provider instances this provider depends on
   * @returns A new Provider instance
   */
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
      if (p.state === ProviderState.READY) {
        initialized.push(p);
      } else if (p.state === ProviderState.STARTED) {
        started.push(p);
      } else if (p.state === ProviderState.STOPPED) {
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

  /** Clears the global registry of providers. */
  static reset(): void {
    this._registry.clear();
  }

  /**
   * Defines and registers a new Provider with explicit dependencies.
   * @param props Configuration properties containing the provider name
   * @param deps Optional array of Provider instances this provider depends on
   * @returns A new Provider instance
   */
  define<T>(props: ProviderProps, deps?: Provider<any, any>[]): IProvider<T> {
    return Provider.define<T>(props, deps);
  }

  /**
   * Binds the runtime implementation and optional lifecycle hooks for this provider.
   * @param impl The concrete service implementation
   * @param options Optional lifecycle hooks (`init`, `start`, `stop`, `reconfigure`)
   */
  bind(impl: S, options?: ProviderLifecycleOptions<S>): void {
    this.implementation = impl;
    this.lifecycleOptions = options;
  }

  /**
   * Accesses the runtime implementation.
   * @throws Error if the implementation has not been bound yet.
   */
  get impl(): S {
    if (!this.implementation) {
      const error = Error(`Implementation for "${this.name}" is not provided`);
      console.error(error.stack);
      throw error;
    }
    return this.implementation;
  }

  /**
   * Initializes the provider and its implementation, marking it as ready.
   * @throws Error if init is already in progress, already completed, or if implementation is missing.
   */
  async init(): Promise<void> {
    if (this.state === ProviderState.INITIALIZING || this.isReady) {
      throw new Error(
        `Provider "${this.name}" init is already in progress or completed`
      );
    }
    if (!this.implementation) {
      throw new Error(`Implementation for "${this.name}" is not provided`);
    }

    this.state = ProviderState.INITIALIZING;
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
      this.state = ProviderState.IDLE;
      this.markBroken(error);
      throw error;
    }
  }

  /**
   * Starts the provider after it has been initialized.
   * @throws Error if the provider is not ready or already started.
   */
  start(): void {
    if (!this.isReady) {
      throw new Error(`Provider "${this.name}" is not ready`);
    }
    if (this.state === ProviderState.STARTED) {
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

    this.state = ProviderState.STARTED;
    if (this.startCallbacks) {
      for (const cb of this.startCallbacks) cb();
    }
  }

  /**
   * Stops the provider and executes teardown hooks.
   * @throws Error if the implementation is not provided.
   */
  async stop(): Promise<void> {
    if (this.state === ProviderState.STOPPED) {
      console.warn(`Provider "${this.name}" is already stopped!`);
    }
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

    this.state = ProviderState.STOPPED;
    if (this.stopCallbacks) {
      for (const cb of this.stopCallbacks) cb();
    }
  }

  /**
   * Checks whether the provider defines an `init` lifecycle hook.
   */
  isInitializable(): this is InitializableProvider<S> {
    if (
      this.lifecycleOptions &&
      "init" in this.lifecycleOptions &&
      typeof this.lifecycleOptions.init === "function"
    )
      return true;
    return typeof (this.implementation as any)?.init === "function";
  }

  /**
   * Checks whether the provider defines a `start` lifecycle hook.
   */
  isStartable(): this is StartableProvider<S> {
    if (
      this.lifecycleOptions &&
      "start" in this.lifecycleOptions &&
      typeof this.lifecycleOptions.start === "function"
    )
      return true;
    return typeof (this.implementation as any)?.start === "function";
  }

  /**
   * Checks whether the provider defines a `stop` lifecycle hook.
   */
  isStoppable(): this is StoppableProvider<S> {
    if (
      this.lifecycleOptions &&
      "stop" in this.lifecycleOptions &&
      typeof this.lifecycleOptions.stop === "function"
    )
      return true;
    return typeof (this.implementation as any)?.stop === "function";
  }

  /**
   * Sets parameters to be passed to the provider's `init` hook.
   * @param params Initialization parameters
   * @returns The provider instance
   */
  withParams(params: unknown): this {
    this[ProviderInitParamsSymbol] = params as any;
    return this;
  }

  /**
   * Dynamically reconfigures the provider implementation using its configured `reconfigure` hook.
   * @param params Reconfiguration parameters
   * @returns The updated provider instance
   * @throws Error if the provider does not have a `reconfigure` lifecycle option.
   */
  async reconfigure(params: unknown): Promise<this> {
    if (
      !this.lifecycleOptions ||
      !("reconfigure" in this.lifecycleOptions) ||
      !this.lifecycleOptions.reconfigure
    ) {
      throw new Error(
        `Provider "${this.name}" does not have "reconfigure" option. It needs to be set via ".bind(inst, options)"`
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

  private static _registry = new Set<Provider<any, any>>();

  private implementation!: S;
  private props: ProviderProps;
  private dependenciesList: DepsProviders | undefined;
  private lifecycleOptions?: ProviderLifecycleOptions<S>;
  private markReady!: () => void;
  private markBroken!: (error: unknown) => void;
  private state: ProviderState = ProviderState.IDLE;
  private readyCallbacks?: (() => void)[];
  private startCallbacks?: (() => void)[];
  private stopCallbacks?: (() => void)[];

  private constructor(props: ProviderProps, deps?: DepsProviders) {
    if (!props.name) throw new Error("Provider name is required");
    this.props = props;
    this.dependenciesList = deps;
    this.whenReady = new Promise((resolve, reject) => {
      this.markReady = () => {
        this.state = ProviderState.READY;
        if (this.readyCallbacks) {
          for (const cb of this.readyCallbacks) cb();
        }
        resolve();
      };
      this.markBroken = reject;
    });
    return;
  }
}
