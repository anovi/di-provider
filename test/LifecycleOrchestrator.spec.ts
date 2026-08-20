import { afterEach, assert, describe, expect, it, vi } from "vitest";

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

      await expect(initInDependencyOrder([providerA])).rejects.toThrow(
        /Lifecycle dependency cycle detected/
      );
    });

    it("throws when a dependency slot is undefined (e.g. circular import)", async () => {
      const bad = createProvider({
        name: "Bad",
        dependencies: [undefined as unknown as LifecycleProvider<number>],
        init: async () => {},
      });

      await expect(initInDependencyOrder([bad])).rejects.toThrow(
        /LifecycleProvider "Bad" dependency at index 0 is undefined[\s\S]*circular import/
      );
    });

    it("throws when a dependency slot is null", async () => {
      const bad = createProvider({
        name: "BadNull",
        dependencies: [null as unknown as LifecycleProvider<number>],
        init: async () => {},
      });

      await expect(initInDependencyOrder([bad])).rejects.toThrow(
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

      await expect(stopInReverseDependencyOrder([bad])).rejects.toThrow(
        /LifecycleProvider "BadStop" dependency at index 0 is undefined/
      );
    });

    it("skips providers that do not have an init hook", async () => {
      const calls: string[] = [];
      const providerA = createProvider({ name: "A" });
      const providerB = createProvider({
        name: "B",
        dependencies: [providerA],
        init: async () => {
          calls.push("B:init");
        },
      });

      await initInDependencyOrder([providerB]);

      assert.deepStrictEqual(calls, ["B:init"]);
    });

    it("logs progress when logs is true", async () => {
      const groupSpy = vi.spyOn(console, "group").mockImplementation(() => {});
      const groupEndSpy = vi
        .spyOn(console, "groupEnd")
        .mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        const providerA = createProvider({
          name: "A",
          init: async () => {},
        });
        const providerB = createProvider({
          name: "B",
          dependencies: [providerA],
          init: async () => {},
        });

        await initInDependencyOrder([providerB], true);

        assert.strictEqual(groupSpy.mock.calls[0]?.[0], "B");
        assert.ok(logSpy.mock.calls.some(c => c[0] === "Init of: A"));
        assert.ok(logSpy.mock.calls.some(c => c[0] === "Init of: B"));
        assert.strictEqual(groupEndSpy.mock.calls.length, 1);
      } finally {
        groupSpy.mockRestore();
        groupEndSpy.mockRestore();
        logSpy.mockRestore();
      }
    });

    it("logs skip when provider is already ready and multiple roots are used", async () => {
      const groupSpy = vi.spyOn(console, "group").mockImplementation(() => {});
      const groupEndSpy = vi
        .spyOn(console, "groupEnd")
        .mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        const providerA = Object.assign(
          createProvider({
            name: "A",
            init: async () => {},
          }),
          { isReady: true }
        );
        const providerB = createProvider({
          name: "B",
          init: async () => {},
        });

        await initInDependencyOrder([providerA, providerB], true);

        assert.strictEqual(groupSpy.mock.calls[0]?.[0], "A, B");
        assert.ok(
          logSpy.mock.calls.some(c => c[0] === "Skip init (already ready): A")
        );
        assert.ok(logSpy.mock.calls.some(c => c[0] === "Init of: B"));
      } finally {
        groupSpy.mockRestore();
        groupEndSpy.mockRestore();
        logSpy.mockRestore();
      }
    });

    it("logs group name as Lifecycle when empty list of providers is given", async () => {
      const groupSpy = vi.spyOn(console, "group").mockImplementation(() => {});
      const groupEndSpy = vi
        .spyOn(console, "groupEnd")
        .mockImplementation(() => {});

      try {
        await initInDependencyOrder([], true);
        assert.strictEqual(groupSpy.mock.calls[0]?.[0], "Lifecycle");
      } finally {
        groupSpy.mockRestore();
        groupEndSpy.mockRestore();
      }
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

      Shared.bind(
        { k: 0 },
        {
          init: async () => {
            sharedInitCount++;
          },
        }
      );
      Root1.bind(
        { k: 1 },
        {
          init: async () => {
            root1InitCount++;
          },
        }
      );
      Root2.bind(
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

      Shared.bind(
        { k: 0 },
        {
          init: async () => {},
          start: () => {
            sharedStartCount++;
          },
        }
      );
      Root1.bind(
        { k: 1 },
        {
          init: async () => {},
          start: () => {
            root1StartCount++;
          },
        }
      );
      Root2.bind(
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

    it("skips providers that do not have a start hook", () => {
      const calls: string[] = [];
      const providerA = createProvider({ name: "A" });
      const providerB = createProvider({
        name: "B",
        dependencies: [providerA],
        start: () => {
          calls.push("B:start");
        },
      });

      startInDependencyOrder([providerB]);

      assert.deepStrictEqual(calls, ["B:start"]);
    });

    it("logs group name as Lifecycle when empty list of providers is given to start", () => {
      const groupSpy = vi.spyOn(console, "group").mockImplementation(() => {});
      const groupEndSpy = vi
        .spyOn(console, "groupEnd")
        .mockImplementation(() => {});

      try {
        startInDependencyOrder([], true);
        assert.strictEqual(groupSpy.mock.calls[0]?.[0], "Lifecycle");
      } finally {
        groupSpy.mockRestore();
        groupEndSpy.mockRestore();
      }
    });

    it("logs progress and skips already started providers when logs is true", () => {
      const groupSpy = vi.spyOn(console, "group").mockImplementation(() => {});
      const groupEndSpy = vi
        .spyOn(console, "groupEnd")
        .mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        const providerA = Object.assign(
          createProvider({
            name: "A",
            start: () => {},
          }),
          { hasStarted: true }
        );
        const providerB = createProvider({
          name: "B",
          start: () => {},
        });

        startInDependencyOrder([providerA, providerB], true);

        assert.strictEqual(groupSpy.mock.calls[0]?.[0], "A, B");
        assert.ok(
          logSpy.mock.calls.some(
            c => c[0] === "Skip start (already started): A"
          )
        );
        assert.ok(logSpy.mock.calls.some(c => c[0] === "Starting: B"));
        assert.strictEqual(groupEndSpy.mock.calls.length, 1);
      } finally {
        groupSpy.mockRestore();
        groupEndSpy.mockRestore();
        logSpy.mockRestore();
      }
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

    it("logs progress when logs is true", async () => {
      const groupSpy = vi.spyOn(console, "group").mockImplementation(() => {});
      const groupEndSpy = vi
        .spyOn(console, "groupEnd")
        .mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        const providerA = createProvider({
          name: "A",
          stop: async () => {},
        });
        const providerB = createProvider({
          name: "B",
          dependencies: [providerA],
          stop: async () => {},
        });

        await stopInReverseDependencyOrder([providerB], true);

        assert.strictEqual(groupSpy.mock.calls[0]?.[0], "B");
        assert.ok(logSpy.mock.calls.some(c => c[0] === "Stopping: B"));
        assert.ok(logSpy.mock.calls.some(c => c[0] === "Stopping: A"));
        assert.strictEqual(groupEndSpy.mock.calls.length, 1);
      } finally {
        groupSpy.mockRestore();
        groupEndSpy.mockRestore();
        logSpy.mockRestore();
      }
    });

    it("logs group name as Lifecycle when empty list is given to stop", async () => {
      const groupSpy = vi.spyOn(console, "group").mockImplementation(() => {});
      const groupEndSpy = vi
        .spyOn(console, "groupEnd")
        .mockImplementation(() => {});

      try {
        await stopInReverseDependencyOrder([], true);
        assert.strictEqual(groupSpy.mock.calls[0]?.[0], "Lifecycle");
      } finally {
        groupSpy.mockRestore();
        groupEndSpy.mockRestore();
      }
    });

    it("logs multiple roots when given to stop", async () => {
      const groupSpy = vi.spyOn(console, "group").mockImplementation(() => {});
      const groupEndSpy = vi
        .spyOn(console, "groupEnd")
        .mockImplementation(() => {});

      try {
        const providerA = createProvider({ name: "A", stop: async () => {} });
        const providerB = createProvider({ name: "B", stop: async () => {} });
        await stopInReverseDependencyOrder([providerA, providerB], true);
        assert.strictEqual(groupSpy.mock.calls[0]?.[0], "A, B");
      } finally {
        groupSpy.mockRestore();
        groupEndSpy.mockRestore();
      }
    });
  });
});
