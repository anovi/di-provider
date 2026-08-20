# di-provider

A lightweight, isomorphic Dependency Injection (DI) container and lifecycle orchestrator for TypeScript and JavaScript applications.

## Features

- **Explicit Dependency Graph**: Declare services and dependencies explicitly to make application architecture visible and maintainable.
- **Decoupled Definition & Implementation**: Define service interfaces and dependency relationships upfront, supplying concrete implementations or mocks later.
- **Deterministic Lifecycle Orchestration**: Coordinate multi-stage service lifecycles (`init`, `start`, `stop`) across entire dependency trees in strict topological order.
- **Fail-Fast Cycle Detection**: Identify circular dependencies and uninitialized imports at definition and orchestration time to prevent runtime deadlocks.
- **Idempotent Lifecycle Execution**: Safely orchestrate complex graphs with shared dependencies without duplicate initialization or startup calls.
- **Runtime Swapping & Testability**: Easily substitute production services with mock implementations or test doubles without touching consumer code.
- **Configurability & Dynamic Reconfiguration**: Pass runtime parameters to initialization hooks via `withParams` and dynamically update service instances with `reconfigure`.
- **Introspection & Debugging Tools**: Inspect registered provider graphs and lifecycle states directly in the console with built-in visualization utilities.

## Package Highlights

- **Isomorphic**: Runs in Node.js, browsers, and edge runtimes.
- **Zero Dependencies**: Lightweight implementation with no external runtime dependencies.
- **Type-Safe**: Written in TypeScript with bundled type definitions (`.d.ts`).
- **Dual Package**: Provides both ESM (`import`) and CommonJS (`require`) exports.

## Installation

```bash
npm install di-provider
```

## Core Concepts

### 1. `Provider`

A `Provider` represents a managed service in your dependency graph. It separates the definition of a service (its name, interface, and dependencies) from its runtime implementation and lifecycle.

#### Defining a Provider

Use `Provider.define<T>(props, deps?)` to create a service:

```ts
import { Provider } from "di-provider";

export interface DatabaseService {
  query(sql: string): Promise<any[]>;
}

export const DatabaseProvider = Provider.define<DatabaseService>({
  name: "DatabaseService",
});

export interface UserService {
  getUser(id: string): Promise<any>;
}

export const UserServiceProvider = Provider.define<UserService>(
  { name: "UserService" },
  // Declaring dependencies explicitly
  // guarantees the initialization order
  [DatabaseProvider]
);
```

#### Binding an Implementation

Bind a runtime instance to the provider via `.bind(instance, options?)`. Lifecycle hooks (`init`, `start`, `stop`, `reconfigure`) can be passed via options or implemented directly on the instance:

```ts
class PostgresDatabaseService implements DatabaseService {
  async query(sql: string) {
    /* ... */
  }
}

DatabaseProvider.bind(new PostgresDatabaseService(), {
  init: async (inst, params) => {
    // Async initialization (e.g., connect to database)
  },
  start: inst => {
    // Synchronous post-init start hook (e.g., begin listeners/jobs)
  },
  stop: async inst => {
    // Async teardown hook (e.g., close connections)
  },
  reconfigure: async (inst, params) => {
    // Optional runtime reconfiguration hook
    return inst;
  },
});
```

#### Accessing the Implementation

Once bound, consumer services access the runtime instance via `.impl`:

```ts
class AppUserService implements UserService {
  // Typed provider
  private db = DatabaseProvider;

  async getUser(id: string) {
    // Access db implementation
    return this.db.impl.query(`SELECT * FROM users WHERE id = '${id}'`);
  }
}

UserServiceProvider.bind(new AppUserService());
```

#### Parameterization & Reconfiguration

Providers can receive initialization arguments via `.withParams(params)` and be reconfigured dynamically at runtime:

```ts
DatabaseProvider.withParams({ host: "localhost", port: 5432 });

// Reconfigure at runtime (calls the provider's `reconfigure` hook)
await DatabaseProvider.reconfigure({ host: "remote-db", port: 5432 });
```

#### Lifecycle Events & Debugging

- **Event Listeners**: Subscribe to lifecycle transitions using `provider.on("ready" | "start" | "stop", callback)`.
- **Introspection**:
  - `Provider.printStatus()`: Logs status of all registered providers (Initialized, Started, Stopped, Ignored).
  - `Provider.printDependencyGraphs()`: Visualizes connected provider dependency graphs in the console.
  - `Provider.reset()`: Clears the global registry (useful in test suites).

---

### 2. `LifecycleOrchestrator`

The orchestrator executes lifecycle stages across your provider graph deterministically based on topological sorting.

- `initInDependencyOrder(providers, logs?)`: Asynchronously initializes providers in dependency order (dependencies initialize before dependents). Skips providers that are already ready.
- `startInDependencyOrder(providers, logs?)`: Synchronously starts providers in dependency order. Skips providers already started.
- `stopInReverseDependencyOrder(providers, logs?)`: Asynchronously stops providers in reverse dependency order (dependents stop before their dependencies).

#### Cycle Detection & Safety

The orchestrator automatically validates dependency graphs and fails fast with descriptive errors if:

- A dependency cycle is detected (e.g., `A -> B -> A`).
- A dependency slot is `null` or `undefined` (often indicating a circular ES module import).

---

## Examples

### Complete Application Setup

```text
Dependency Graph:

     ┌────────────────┐
     │ ConfigProvider │ <─────────┐
     └───────▲────────┘           │
             │                    │
     ┌───────┴──────────┐         │
     │ DatabaseProvider │         │
     └───────▲──────────┘         │
             │                    │
     ┌───────┴────────────┐       │
     │   ServerProvider   ├───────┘
     └────────────────────┘

Lifecycle Execution Order:
- init / start : ConfigProvider ──> DatabaseProvider ──> ServerProvider
- stop         : ServerProvider ──> DatabaseProvider ──> ConfigProvider
```

#### 1. Define Providers

```ts
import {
  Provider,
  initInDependencyOrder,
  startInDependencyOrder,
  stopInReverseDependencyOrder,
} from "di-provider";

interface Config {
  port: number;
}
interface Database {
  connect: () => Promise<void>;
  close: () => Promise<void>;
}
interface Server {
  listen: () => void;
}

const ConfigProvider = Provider.define<Config>({ name: "Config" });

const DatabaseProvider = Provider.define<Database>({ name: "Database" }, [
  ConfigProvider,
]);

const ServerProvider = Provider.define<Server>({ name: "Server" }, [
  DatabaseProvider,
  ConfigProvider,
]);
```

#### 2. Bind Implementations

```ts
ConfigProvider.bind({ port: 3000 });

DatabaseProvider.bind(
  {
    connect: async () => console.log("DB connected"),
    close: async () => console.log("DB closed"),
  },
  {
    init: async inst => inst.connect(),
    stop: async inst => inst.close(),
  }
);

ServerProvider.bind(
  {
    listen: () => {
      console.log(
        `Server listening on port ${ConfigProvider.impl.port}`
      ),
    }
  },
  {
    start: inst => inst.listen(),
  }
);
```

#### 3. Orchestrate Lifecycle

```ts
async function bootstrap() {
  // Pass root provider(s); dependencies are resolved automatically
  await initInDependencyOrder([ServerProvider], true);
  startInDependencyOrder([ServerProvider], true);

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    await stopInReverseDependencyOrder([ServerProvider], true);
    process.exit(0);
  });
}

bootstrap();
```

### Swapping Implementations in Tests

Because service definitions are decoupled from implementations, mocking dependencies in unit tests is straightforward:

```ts
import { describe, it, beforeEach } from "vitest";
import { Provider, initInDependencyOrder } from "di-provider";
import { DatabaseProvider, UserServiceProvider } from "./services";

describe("UserService", () => {
  beforeEach(() => {
    Provider.reset();
  });

  it("works with mock database", async () => {
    // Bind a mock implementation without touching UserService code
    DatabaseProvider.bind({
      query: async () => [{ id: "1", name: "Alice" }],
    });

    UserServiceProvider.bind(new AppUserService());

    await initInDependencyOrder([UserServiceProvider]);

    const user = await UserServiceProvider.impl.getUser("1");
    expect(user.name).toBe("Alice");
  });
});
```

## Development

- `npm run build` - Builds ESM and CJS bundles to `dist/` with bundled TypeScript definitions
- `npm test` - Runs test suite via Vitest
- `npm run test:coverage` - Runs test suite with code coverage
- `npm run lint` - Lints source files via ESLint
- `npm run format` - Formats codebase via Prettier

## License

[MIT](LICENSE)
