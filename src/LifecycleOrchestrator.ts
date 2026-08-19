import { ProviderInitParamsSymbol } from "./Provider";

type ProviderDependency<I> = {
  name: string;
  dependencies?: ProviderDependency<I>[];
  impl: I;
};

type ProviderLifecycle<I> = {
  init?: (inst: I) => Promise<void>;
  start?: (inst: I) => void;
  stop?: (inst: I) => Promise<void>;
};

export type ProviderWithParams = {
  [ProviderInitParamsSymbol]?: unknown;
};

export type LifecycleProvider<I> = ProviderDependency<I> &
  ProviderLifecycle<I> &
  ProviderWithParams;

function getDependencies<I>(
  provider: LifecycleProvider<I>
): LifecycleProvider<I>[] {
  const raw = provider.dependencies ?? [];
  for (let i = 0; i < raw.length; i++) {
    const dep = raw[i];
    if (dep == null) {
      const kind = dep === null ? "null" : "undefined";
      throw new Error(
        `LifecycleProvider "${provider.name}" dependency at index ${i} is ${kind}. ` +
          "This usually indicates a circular import: the dependency was not initialized when this provider graph was built."
      );
    }
  }
  return raw as LifecycleProvider<I>[];
}

/** Provider instances from {@link Provider} expose `isReady` after successful init. */
function isLifecycleProviderAlreadyReady<I>(
  provider: LifecycleProvider<I>
): boolean {
  return (
    "isReady" in provider && (provider as { isReady: boolean }).isReady === true
  );
}

/** Provider instances from {@link Provider} expose `hasStarted` after {@link Provider.start}. */
function isLifecycleProviderAlreadyStarted<I>(
  provider: LifecycleProvider<I>
): boolean {
  return (
    "hasStarted" in provider &&
    (provider as { hasStarted: boolean }).hasStarted === true
  );
}

/** Providers in the list that are not a dependency of any other provider in the list. */
function getRootProviders<I>(
  providers: LifecycleProvider<I>[]
): LifecycleProvider<I>[] {
  return providers.filter(
    p => !providers.some(q => q !== p && getDependencies(q).includes(p))
  );
}

function getGroupName<I>(providers: LifecycleProvider<I>[]): string {
  const roots = getRootProviders(providers);
  if (roots.length === 0) return "Lifecycle";
  if (roots.length === 1) return roots[0].name;
  return roots.map(r => r.name).join(", ");
}

function topologicalSort<I>(
  providers: LifecycleProvider<I>[]
): LifecycleProvider<I>[] {
  const ordered: LifecycleProvider<I>[] = [];
  const visiting = new Set<LifecycleProvider<I>>();
  const visited = new Set<LifecycleProvider<I>>();

  const visit = (provider: LifecycleProvider<I>) => {
    if (visited.has(provider)) return;
    if (visiting.has(provider)) {
      throw new Error(
        `Lifecycle dependency cycle detected at "${provider.name}"`
      );
    }

    visiting.add(provider);
    for (const dependency of getDependencies(provider)) {
      visit(dependency);
    }
    visiting.delete(provider);

    visited.add(provider);
    ordered.push(provider);
  };

  for (const provider of providers) {
    visit(provider);
  }

  return ordered;
}

export async function initInDependencyOrder<I>(
  providers: LifecycleProvider<I>[],
  logs?: boolean
): Promise<void> {
  const ordered = topologicalSort(providers);
  if (logs) console.group(getGroupName(providers));
  try {
    for (const provider of ordered) {
      if (provider.init) {
        if (isLifecycleProviderAlreadyReady(provider)) {
          if (logs) console.log(`Skip init (already ready): ${provider.name}`);
          continue;
        }
        if (logs) console.log(`Init of: ${provider.name}`);
        await provider.init(provider.impl);
      }
    }
  } finally {
    if (logs) console.groupEnd();
  }
}

export function startInDependencyOrder<I>(
  providers: LifecycleProvider<I>[],
  logs?: boolean
): void {
  const ordered = topologicalSort(providers);
  if (logs) console.group(getGroupName(providers));
  try {
    for (const provider of ordered) {
      if (provider.start) {
        if (isLifecycleProviderAlreadyStarted(provider)) {
          if (logs)
            console.log(`Skip start (already started): ${provider.name}`);
          continue;
        }
        if (logs) console.log(`Starting: ${provider.name}`);
        provider.start(provider.impl);
      }
    }
  } finally {
    if (logs) console.groupEnd();
  }
}

export async function stopInReverseDependencyOrder<I>(
  providers: LifecycleProvider<I>[],
  logs?: boolean
): Promise<void> {
  const ordered = topologicalSort(providers);
  const groupName = getGroupName(providers);
  if (logs) console.group(groupName);
  try {
    for (const provider of ordered.reverse()) {
      if (provider.stop) {
        if (logs) console.log(`Stopping: ${provider.name}`);
        await provider.stop(provider.impl);
      }
    }
  } finally {
    if (logs) console.groupEnd();
  }
}
