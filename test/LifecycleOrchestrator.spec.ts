import assert from "node:assert";
import { afterEach, describe, it } from "vitest";

import { Provider } from "../src/Provider";
import {
  type LifecycleProvider,
  initInDependencyOrder,
  startInDependencyOrder,
  stopInReverseDependencyOrder,
} from "../src/LifecycleOrchestrator";

describe("LifecycleOrchestrator", () => {
  function createProvider(
    overrides: Partial<LifecycleProvider<number>> & { name: string }
  ): LifecycleProvider<number> {
    return {
      dependencies: [],
      impl: 1,
      ...overrides,
    };
  }

  describe("initInDependencyOrder", () => {
    it("initializes providers in topological order", async () => {
      const calls: string[] = [];
      const providerA = createProvider({
        name: "A",
        init: async () => {
          calls.push("A:init");
        },
      });
      const providerB = createProvider({
        name: "B",
        dependencies: [providerA],
        init: async () => {
          calls.push("B:init");
        },
      });
      const providerC = createProvider({
        name: "C",
        dependencies: [providerB],
        init: async () => {
          calls.push("C:init");
        },
      });

      await initInDependencyOrder([providerC]);

      assert.deepStrictEqual(calls, ["A:init", "B:init", "C:init"]);
    });

    it("visits each provider once even if listed multiple times", async () => {
      const calls: string[] = [];
      const providerShared = createProvider({
        name: "Shared",
        init: async () => {
          calls.push("Shared:init");
        },
      });
      const providerConsumerA = createProvider({
        name: "ConsumerA",
        dependencies: [providerShared],
        init: async () => {
          calls.push("ConsumerA:init");
        },
      });
      const providerConsumerB = createProvider({
        name: "ConsumerB",
        dependencies: [providerShared],
        init: async () => {
          calls.push("ConsumerB:init");
        },
      });

      await initInDependencyOrder([
        providerShared,
        providerConsumerA,
        providerConsumerB,
      ]);

      assert.deepStrictEqual(calls, [
        "Shared:init",
        "ConsumerA:init",
        "ConsumerB:init",
      ]);
    });

    it("throws when a dependency cycle exists", async () => {
      const providerA = createProvider({ name: "A" });
      const providerB = createProvider({
        name: "B",
        dependencies: [providerA],
      });
      providerA.dependencies = [providerB];

      await assert.rejects(
        initInDependencyOrder([providerA]),
        /Lifecycle dependency cycle detected/
      );
    });

    it("throws when a dependency slot is undefined (e.g. circular import)", async () => {
      const bad = createProvider({
        name: "Bad",
        dependencies: [undefined as unknown as LifecycleProvider<number>],
        init: async () => {},
      });

      await assert.rejects(initInDependencyOrder([bad]), (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(
          err.message,
          /LifecycleProvider "Bad" dependency at index 0 is undefined/
        );
        assert.match(err.message, /circular import/);
        return true;
      });
    });

    it("throws when a dependency slot is null", async () => {
      const bad = createProvider({
        name: "BadNull",
        dependencies: [null as unknown as LifecycleProvider<number>],
        init: async () => {},
      });

      await assert.rejects(
        initInDependencyOrder([bad]),
        /LifecycleProvider "BadNull" dependency at index 0 is null/
      );
    });

    it("rejects invalid dependency entries in startInDependencyOrder", () => {
      const bad = createProvider({
        name: "BadStart",
        dependencies: [undefined as unknown as LifecycleProvider<number>],
        start: () => {},
      });

      assert.throws(
        () => startInDependencyOrder([bad]),
        /LifecycleProvider "BadStart" dependency at index 0 is undefined/
      );
    });

    it("rejects invalid dependency entries in stopInReverseDependencyOrder", async () => {
      const bad = createProvider({
        name: "BadStop",
        dependencies: [undefined as unknown as LifecycleProvider<number>],
        stop: async () => {},
      });

      await assert.rejects(
        stopInReverseDependencyOrder([bad]),
        /LifecycleProvider "BadStop" dependency at index 0 is undefined/
      );
    });
  });

  describe("two dependency graphs with a common Provider", () => {
    afterEach(() => {
      Provider.reset();
    });

    it("inits the shared dependency only once when orchestrating each graph root in sequence", async () => {
      let sharedInitCount = 0;
      let root1InitCount = 0;
      let root2InitCount = 0;

      const Shared = Provider.define<{ k: number }>({
        name: "orch-shared-init",
      });
      const Root1 = Provider.define<{ k: number }>({ name: "orch-root1" }, [
        Shared,
      ]);
      const Root2 = Provider.define<{ k: number }>({ name: "orch-root2" }, [
        Shared,
      ]);

      Shared.provide(
        { k: 0 },
        {
          init: async () => {
            sharedInitCount++;
          },
        }
      );
      Root1.provide(
        { k: 1 },
        {
          init: async () => {
            root1InitCount++;
          },
        }
      );
      Root2.provide(
        { k: 2 },
        {
          init: async () => {
            root2InitCount++;
          },
        }
      );

      await initInDependencyOrder([Root1]);
      assert.strictEqual(sharedInitCount, 1);
      assert.strictEqual(root1InitCount, 1);
      assert.strictEqual(root2InitCount, 0);

      await initInDependencyOrder([Root2]);
      assert.strictEqual(
        sharedInitCount,
        1,
        "shared provider init should be skipped on second graph"
      );
      assert.strictEqual(root1InitCount, 1);
      assert.strictEqual(root2InitCount, 1);

      assert.strictEqual(Shared.isReady, true);
      assert.strictEqual(Root1.isReady, true);
      assert.strictEqual(Root2.isReady, true);
    });

    it("starts the shared dependency only once when orchestrating each graph root in sequence", async () => {
      let sharedStartCount = 0;
      let root1StartCount = 0;
      let root2StartCount = 0;

      const Shared = Provider.define<{ k: number }>({
        name: "orch-shared-start",
      });
      const Root1 = Provider.define<{ k: number }>(
        { name: "orch-root1-start" },
        [Shared]
      );
      const Root2 = Provider.define<{ k: number }>(
        { name: "orch-root2-start" },
        [Shared]
      );

      Shared.provide(
        { k: 0 },
        {
          init: async () => {},
          start: () => {
            sharedStartCount++;
          },
        }
      );
      Root1.provide(
        { k: 1 },
        {
          init: async () => {},
          start: () => {
            root1StartCount++;
          },
        }
      );
      Root2.provide(
        { k: 2 },
        {
          init: async () => {},
          start: () => {
            root2StartCount++;
          },
        }
      );

      await initInDependencyOrder([Root1]);
      await initInDependencyOrder([Root2]);
      startInDependencyOrder([Root1]);

      assert.strictEqual(sharedStartCount, 1);
      assert.strictEqual(root1StartCount, 1);
      assert.strictEqual(root2StartCount, 0);

      startInDependencyOrder([Root2]);
      assert.strictEqual(
        sharedStartCount,
        1,
        "shared provider start should be skipped on second graph"
      );
      assert.strictEqual(root1StartCount, 1);
      assert.strictEqual(root2StartCount, 1);

      assert.strictEqual(Shared.hasStarted, true);
      assert.strictEqual(Root1.hasStarted, true);
      assert.strictEqual(Root2.hasStarted, true);
    });
  });

  describe("startInDependencyOrder", () => {
    it("starts providers in dependency order", () => {
      const calls: string[] = [];
      const providerA = createProvider({
        name: "A",
        start: () => {
          calls.push("A:start");
        },
      });
      const providerB = createProvider({
        name: "B",
        dependencies: [providerA],
        start: () => {
          calls.push("B:start");
        },
      });
      const providerC = createProvider({
        name: "C",
        dependencies: [providerB],
        start: () => {
          calls.push("C:start");
        },
      });

      startInDependencyOrder([providerC]);

      assert.deepStrictEqual(calls, ["A:start", "B:start", "C:start"]);
    });

    it("should start separate graphs independently", () => {
      const calls: string[] = [];
      const providerA = createProvider({
        name: "A",
        start: () => {
          calls.push("A:start");
        },
      });
      const providerB = createProvider({
        name: "B",
        dependencies: [providerA],
        start: () => {
          calls.push("B:start");
        },
      });
      const providerC = createProvider({
        name: "C",
        start: () => {
          calls.push("C:start");
        },
      });

      startInDependencyOrder([providerB]);

      assert.deepStrictEqual(calls, ["A:start", "B:start"]);

      startInDependencyOrder([providerC]);

      assert.deepStrictEqual(calls, ["A:start", "B:start", "C:start"]);
    });
  });

  describe("stopInReverseDependencyOrder", () => {
    it("stops providers in reverse dependency order", async () => {
      const calls: string[] = [];
      const providerA = createProvider({
        name: "A",
        stop: async () => {
          calls.push("A:stop");
        },
      });
      const providerB = createProvider({
        name: "B",
        dependencies: [providerA],
        stop: async () => {
          calls.push("B:stop");
        },
      });
      const providerC = createProvider({
        name: "C",
        dependencies: [providerB],
        stop: async () => {
          calls.push("C:stop");
        },
      });

      await stopInReverseDependencyOrder([providerC]);

      assert.deepStrictEqual(calls, ["C:stop", "B:stop", "A:stop"]);
    });

    it("skips lifecycle hooks that are not implemented", async () => {
      const calls: string[] = [];
      const providerA = createProvider({ name: "A" });
      const providerB = createProvider({
        name: "B",
        dependencies: [providerA],
        stop: async () => {
          calls.push("B:stop");
        },
      });

      await stopInReverseDependencyOrder([providerB]);

      assert.deepStrictEqual(calls, ["B:stop"]);
    });
  });
});
