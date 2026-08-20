import assert from "node:assert";
import { afterEach, beforeEach, describe, it, vi } from "vitest";

import {
  Provider,
  ProviderInitParamsSymbol,
  ProviderState,
} from "../src/Provider";
import * as IndexExports from "../src/index";
import {
  LifecycleProvider,
  initInDependencyOrder,
  startInDependencyOrder,
  stopInReverseDependencyOrder,
} from "../src/LifecycleOrchestrator";

describe("Provider", () => {
  beforeEach(() => {
    Provider.reset();
  });

  describe("creation", () => {
    describe("Provider.define", () => {
      it("should create a new instance of Component", () => {
        const component = Provider.define({ name: "test" });
        assert.ok(component);
      });

      it("should set the name of the component", () => {
        const component = Provider.define({ name: "test" });
        assert.strictEqual(component.name, "test");
      });

      it("should throw an error if the name is not provided", () => {
        assert.throws(() => {
          // @ts-expect-error Provider requires to define a name for a module.
          Provider.define({});
        });
      });

      it("should throw when a dependency is undefined (e.g. circular import)", () => {
        assert.throws(
          () => {
            Provider.define({ name: "has-bad-dep" }, [
              undefined as unknown as Provider<unknown>,
            ]);
          },
          (err: unknown) => {
            assert.ok(err instanceof Error);
            assert.match(
              err.message,
              /Provider "has-bad-dep" dependency at index 0 must be a Provider instance/
            );
            assert.match(err.message, /circular import/);
            return true;
          }
        );
      });

      it("should throw when a dependency is null", () => {
        assert.throws(() => {
          Provider.define({ name: "has-null-dep" }, [
            null as unknown as Provider<unknown>,
          ]);
        }, /Provider "has-null-dep" dependency at index 0 must be a Provider instance \(got null\)/);
      });

      it("should throw when a dependency is not a Provider", () => {
        assert.throws(() => {
          Provider.define({ name: "has-plain-dep" }, [
            {} as unknown as Provider<unknown>,
          ]);
        }, /Provider "has-plain-dep" dependency at index 0 must be a Provider instance \(got an instance of Object\)/);
      });

      const wrongTypes = [
        123,
        "str",
        true,
        Symbol("x"),
        () => {},
        new Date(),
        Object.create(null),
      ];

      it("should format primitive and null-prototype dependency error messages", () => {
        for (let i = 0; i < wrongTypes.length; i++) {
          const type = wrongTypes[i];
          const name = "item" + i;
          assert.throws(
            () => {
              Provider.define({ name }, [type as unknown as Provider<unknown>]);
            },
            err =>
              err instanceof Error &&
              err.message.includes(
                "dependency at index 0 must be a Provider instance"
              )
          );
        }
      });

      it("should report depsLength and dependencies correctly", () => {
        const withoutDeps = Provider.define({ name: "without-deps" });
        assert.strictEqual(withoutDeps.depsLength, 0);
        assert.strictEqual(withoutDeps.dependencies, undefined);

        const emptyDeps = Provider.define({ name: "empty-deps" }, []);
        assert.strictEqual(emptyDeps.depsLength, 0);
        assert.deepStrictEqual(emptyDeps.dependencies, []);

        const dep1 = Provider.define({ name: "d1" });
        const dep2 = Provider.define({ name: "d2" });
        const withDeps = Provider.define({ name: "with-deps" }, [dep1, dep2]);
        assert.strictEqual(withDeps.depsLength, 2);
        assert.deepStrictEqual(withDeps.dependencies, [dep1, dep2]);
      });

      it("should support instance define method", () => {
        const parent = Provider.define({ name: "parent" });
        const child = parent.define({ name: "child" });
        assert.ok(child instanceof Provider);
        assert.strictEqual(child.name, "child");
      });

      it("should accept a valid Provider dependency", () => {
        const dep = Provider.define({ name: "valid-dep" });
        const composed = Provider.define({ name: "composed" }, [dep]);
        assert.strictEqual(composed.dependencies?.[0], dep);
      });
    });
  });

  describe("implementation", () => {
    describe("Component.provide", () => {
      it("should provide an implementation for the component", async () => {
        const component = Provider.define({ name: "test" });
        component.bind({});
        await component.init();
        assert.ok(component.impl);
      });
    });

    describe("Component.impl", () => {
      it("should throw an error if the implementation is not provided", () => {
        const component = Provider.define({ name: "test" });
        assert.throws(() => {
          return component.impl;
        });
      });

      it("should allow accessing impl when implementation is provided (even before ready)", () => {
        const component = Provider.define({ name: "test" });
        component.bind({});
        assert.doesNotThrow(() => {
          void component.impl;
        });
      });

      it("should run without error if the implementation is provided", async () => {
        interface Test {
          method: () => void;
        }
        const component = Provider.define<Test>({ name: "test" });
        let called = false;
        component.bind({
          method: () => {
            called = true;
          },
        });
        await component.init();
        assert.doesNotThrow(() => {
          component.impl.method();
        });
        assert.ok(called);
      });

      it("should run without error if an implementation is a function", async () => {
        const component = Provider.define<() => void>({ name: "test" });
        let called = false;
        component.bind(() => {
          called = true;
        });
        await component.init();
        assert.doesNotThrow(() => {
          component.impl();
        });
        assert.ok(called);
      });
    });
  });

  describe("Initialization with dependencies", () => {
    it("should initialize if dependencies are provided", async () => {
      interface Test {
        method: () => void;
      }
      interface SomeService {
        someMethod: () => void;
      }
      const DepsComponent = Provider.define<SomeService>({
        name: "SomeService",
      });
      const SomeFunc = Provider.define<() => void>({ name: "SomeFunc" });
      const depsss = [DepsComponent, SomeFunc];
      const MyComponent = Provider.define<Test>({ name: "test" }, depsss);

      class TestService implements Test {
        depsCompoment = DepsComponent;
        someFunc = SomeFunc;
        method() {
          this.depsCompoment.impl.someMethod();
          this.someFunc.impl();
        }
      }
      let called = false;
      class SomeServiceImpl implements SomeService {
        someMethod() {
          called = true;
        }
      }
      MyComponent.bind(new TestService());
      DepsComponent.bind(new SomeServiceImpl());
      SomeFunc.bind(() => {
        called = true;
      });

      await initInDependencyOrder([DepsComponent, SomeFunc, MyComponent]);

      assert.doesNotThrow(() => {
        MyComponent.impl.method();
      });
      assert.ok(called);
    });

    it("should throw when dependencies are not provided", async () => {
      interface Test {
        method: () => void;
      }
      interface SomeService {
        someMethod: () => void;
      }

      const DepsComponent = Provider.define<SomeService>({
        name: "SomeService",
      });
      const MyComponent = Provider.define<Test>({ name: "test" }, [
        DepsComponent,
      ]);

      class TestService implements Test {
        someLazyComponent = DepsComponent;
        method() {
          this.someLazyComponent.impl.someMethod();
        }
      }
      MyComponent.bind(new TestService());
      await MyComponent.init();

      assert.throws(() => {
        MyComponent.impl.method();
      });
    });

    it("should initialize with initializer and no dependencies", async () => {
      interface Test {
        method: () => void;
      }

      let initialized: () => void;

      const initializerCalled = new Promise<void>(_initialized => {
        initialized = _initialized;
      });

      const MyComponent = Provider.define<Test>({ name: "test" }, []);

      class TestService implements Test {
        method() {}
      }

      MyComponent.bind(new TestService(), {
        init: async () => {
          initialized();
        },
      });

      await MyComponent.init();

      assert.doesNotThrow(() => {
        MyComponent.impl.method();
      });

      await initializerCalled;
    });

    it("should initialize with initializer and dependencies", async () => {
      interface Test {
        method: () => void;
      }
      interface SomeService {
        someMethod: () => void;
      }
      const DepsComponent = Provider.define<SomeService>({
        name: "SomeService",
      });
      const MyComponent = Provider.define<Test>({ name: "test" }, [
        DepsComponent,
      ]);

      class TestService implements Test {
        someLazyComponent = DepsComponent;
        method() {
          this.someLazyComponent.impl.someMethod();
        }
      }
      class SomeServiceImpl implements SomeService {
        someMethod() {}
      }

      MyComponent.bind(new TestService(), { init: async () => {} });
      DepsComponent.bind(new SomeServiceImpl());

      await initInDependencyOrder([MyComponent]);

      assert.doesNotThrow(() => {
        MyComponent.impl.method();
      });
    });

    it("should pass withParams values to init hook and store them on provider", async () => {
      interface Test {
        method: () => number;
      }
      const params = { threshold: 5, mode: "strict" };
      const MyComponent = Provider.define<Test>(
        { name: "init-with-params" },
        []
      );

      class TestService implements Test {
        method() {
          return 1;
        }
      }

      MyComponent.bind(new TestService(), {
        init: async (_inst, initParams) => {
          assert.deepStrictEqual(initParams, params);
        },
      });

      await MyComponent.withParams(params).init();

      assert.deepStrictEqual(MyComponent[ProviderInitParamsSymbol], params);
      assert.strictEqual(MyComponent.impl.method(), 1);
    });

    it("should throw when init throws", async () => {
      interface Test {
        method: () => void;
      }
      const MyComponent = Provider.define<Test>({ name: "test" }, []);

      class TestService implements Test {
        method() {}
      }

      MyComponent.bind(new TestService(), {
        init: async () => {
          throw new Error("some error");
        },
      });

      await assert.rejects(MyComponent.init(), /some error/);
      await assert.rejects(MyComponent.whenReady, /some error/);
    });

    it("should run stop hook on stop()", async () => {
      interface Test {
        method: () => void;
      }

      let stopCalled: () => void;

      const stopCalledPromise = new Promise<void>(resolve => {
        stopCalled = resolve;
      });

      const MyComponent = Provider.define<Test>({ name: "test" }, []);

      class TestService implements Test {
        method() {}
      }

      MyComponent.bind(new TestService(), {
        init: async () => {},
        stop: async () => {
          stopCalled();
        },
      });

      await MyComponent.init();

      assert.doesNotThrow(() => {
        MyComponent.impl.method();
      });

      await MyComponent.stop();

      await stopCalledPromise;
    });

    it("should not throw when stop() is called with no stop hook", async () => {
      interface Test {
        method: () => void;
      }

      const MyComponent = Provider.define<Test>({ name: "test" }, []);

      class TestService implements Test {
        method() {}
      }

      MyComponent.bind(new TestService(), { init: async () => {} });

      await MyComponent.init();

      assert.doesNotThrow(() => {
        MyComponent.impl.method();
      });
      await assert.doesNotReject(MyComponent.stop());
    });

    it("should initialize a cascade of modules", async () => {
      interface Module1 {
        name: "super";
      }
      interface Module2 {
        name: "govn";
      }
      interface Module3 {
        name: "huu";
      }

      const MyModule1 = Provider.define<Module1>({ name: "MyModule1" }, []);
      const MyModule2 = Provider.define<Module2>({ name: "MyModule2" }, [
        MyModule1,
      ]);
      const MyModule3 = Provider.define<Module3>({ name: "MyModule3" }, [
        MyModule2,
      ]);

      class TestService1 implements Module1 {
        name = "super" as const;
      }
      class TestService2 implements Module2 {
        name = "govn" as const;
      }
      class TestService3 implements Module3 {
        name = "huu" as const;
      }

      MyModule3.bind(new TestService3());
      MyModule2.bind(new TestService2());
      MyModule1.bind(new TestService1(), { init: async () => {} });

      await initInDependencyOrder([MyModule3]);
    });
  });

  describe("Lifecycle hooks", () => {
    it("should support start-only implementations", async () => {
      const component = Provider.define({ name: "start-only" });
      let started = false;
      component.bind({
        start: () => {
          started = true;
        },
      });

      await component.init();
      component.start();

      assert.strictEqual(started, true);
    });

    it("should support init + stop implementations", async () => {
      const component = Provider.define({ name: "init-stop" });
      let inited = false;
      let stopped = false;
      component.bind({
        init: async () => {
          inited = true;
        },
        stop: async () => {
          stopped = true;
        },
      });

      await component.init();
      await component.stop();

      assert.strictEqual(inited, true);
      assert.strictEqual(stopped, true);
    });

    it("should support init + start + stop implementations", async () => {
      const component = Provider.define({ name: "all-three" });
      const calls: string[] = [];
      component.bind({
        init: async () => {
          calls.push("init");
        },
        start: () => {
          calls.push("start");
        },
        stop: async () => {
          calls.push("stop");
        },
      });

      await component.init();
      component.start();
      await component.stop();

      assert.deepStrictEqual(calls, ["init", "start", "stop"]);
    });

    it("should throw if init is called twice", async () => {
      const component = Provider.define({ name: "init-once" });
      component.bind({});
      await component.init();
      await assert.rejects(
        component.init(),
        /already in progress or completed/
      );
    });

    it("should throw if init is called concurrently while already in progress", async () => {
      const component = Provider.define({ name: "init-concurrent" });
      let resolveInit!: () => void;
      component.bind(
        {},
        {
          init: () =>
            new Promise(resolve => {
              resolveInit = resolve;
            }),
        }
      );

      const firstInit = component.init();
      await assert.rejects(
        component.init(),
        /Provider "init-concurrent" init is already in progress or completed/
      );

      resolveInit();
      await firstInit;
    });

    it("should throw if init is called before provide", async () => {
      const component = Provider.define({ name: "init-without-provide" });
      await assert.rejects(
        component.init(),
        /Implementation for "init-without-provide" is not provided/
      );
    });

    it("should fallback to direct impl.init, impl.start, and impl.stop methods", async () => {
      const calls: string[] = [];
      const component = Provider.define({ name: "direct-impl-lifecycle" });
      component.bind({
        init: async () => {
          calls.push("impl:init");
        },
        start: () => {
          calls.push("impl:start");
        },
        stop: async () => {
          calls.push("impl:stop");
        },
      });

      await component.init();
      component.start();
      await component.stop();

      assert.deepStrictEqual(calls, ["impl:init", "impl:start", "impl:stop"]);
    });

    it("should throw when start is called before provider is ready", () => {
      const component = Provider.define({ name: "start-not-ready" });
      component.bind({});
      assert.throws(
        () => component.start(),
        /Provider "start-not-ready" is not ready/
      );
    });

    it("should throw when start is called twice", async () => {
      const component = Provider.define({ name: "start-twice" });
      component.bind({});
      await component.init();
      component.start();
      assert.throws(
        () => component.start(),
        /Provider "start-twice" start was already called/
      );
    });

    it("should track hasStarted accurately across lifecycle", async () => {
      const component = Provider.define({ name: "has-started-check" });
      component.bind({});
      assert.strictEqual(component.hasStarted, false);
      await component.init();
      assert.strictEqual(component.hasStarted, false);
      component.start();
      assert.strictEqual(component.hasStarted, true);
      await component.stop();
      assert.strictEqual(component.hasStarted, false);
    });

    it("should throw when stop is called before provide", async () => {
      const component = Provider.define({ name: "stop-without-provide" });
      await assert.rejects(
        component.stop(),
        /Implementation for "stop-without-provide" is not provided/
      );
    });

    it("should warn when stop is called on an already stopped provider", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const component = Provider.define({ name: "stopped-twice" });
        component.bind({});
        await component.init();
        await component.stop();
        await component.stop();

        assert.ok(
          warnSpy.mock.calls.some(
            c => c[0] === 'Provider "stopped-twice" is already stopped!'
          )
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("should expose lifecycle type guards", () => {
      const withStartOnly = Provider.define({ name: "start-only" });
      withStartOnly.bind({}, { start: () => undefined });

      const withInitOption = Provider.define({ name: "with-init-option" });
      withInitOption.bind({}, { init: async () => undefined });

      const withInitAndStopOption = Provider.define({
        name: "with-init-stop-option",
      });
      withInitAndStopOption.bind(
        {},
        { init: async () => undefined, stop: async () => undefined }
      );

      const withDirectImpl = Provider.define({ name: "direct-impl" });
      withDirectImpl.bind({
        init: async () => undefined,
        start: () => undefined,
        stop: async () => undefined,
      });

      const withPlainImpl = Provider.define({ name: "plain-impl" });
      withPlainImpl.bind({});

      assert.strictEqual(withStartOnly.isInitializable(), false);
      assert.strictEqual(withStartOnly.isStartable(), true);
      assert.strictEqual(withStartOnly.isStoppable(), false);

      assert.strictEqual(withInitOption.isInitializable(), true);
      assert.strictEqual(withInitOption.isStartable(), false);
      assert.strictEqual(withInitOption.isStoppable(), false);

      assert.strictEqual(withInitAndStopOption.isInitializable(), true);
      assert.strictEqual(withInitAndStopOption.isStartable(), false);
      assert.strictEqual(withInitAndStopOption.isStoppable(), true);

      assert.strictEqual(withDirectImpl.isInitializable(), true);
      assert.strictEqual(withDirectImpl.isStartable(), true);
      assert.strictEqual(withDirectImpl.isStoppable(), true);

      assert.strictEqual(withPlainImpl.isInitializable(), false);
      assert.strictEqual(withPlainImpl.isStartable(), false);
      assert.strictEqual(withPlainImpl.isStoppable(), false);
    });
  });

  describe("reconfigure", () => {
    it("should throw when reconfigure hook is not provided", async () => {
      const component = Provider.define<{ id: number }>({
        name: "reconf-missing",
      });
      component.bind({ id: 1 }, { init: async () => {} });
      await component.init();
      await assert.rejects(
        component.reconfigure({ foo: "bar" }),
        /does not have "reconfigure" option/
      );
    });

    it("should replace impl with the returned instance and return the provider", async () => {
      interface S {
        value: string;
      }
      const component = Provider.define<S>({ name: "reconf-success" });
      const first: S = { value: "a" };
      const second: S = { value: "b" };
      component.bind(first, {
        init: async () => {},
        reconfigure: async inst => {
          assert.strictEqual(inst, first);
          return second;
        },
      });
      await component.init();
      assert.strictEqual(component.impl, first);
      const out = await component.reconfigure(null);
      assert.strictEqual(out, component);
      assert.strictEqual(component.impl, second);
      assert.strictEqual(component.impl.value, "b");
    });

    it("should pass params to reconfigure and store them on the provider", async () => {
      const component = Provider.define<{ n: number }>({
        name: "reconf-params",
      });
      component.bind(
        { n: 0 },
        {
          init: async () => {},
          reconfigure: async (_inst, params) => {
            assert.deepStrictEqual(params, { x: 1 });
            return { n: (params as { x: number }).x };
          },
        }
      );
      await component.init();
      await component.reconfigure({ x: 1 });
      assert.deepStrictEqual(component[ProviderInitParamsSymbol], { x: 1 });
      assert.strictEqual(component.impl.n, 1);
    });

    it("should reject when reconfigure hook rejects", async () => {
      const component = Provider.define<{ k: boolean }>({
        name: "reconf-reject",
      });
      const original: { k: boolean } = { k: false };
      component.bind(original, {
        init: async () => {},
        reconfigure: async () => {
          throw new Error("reconf failed");
        },
      });
      await component.init();
      await assert.rejects(component.reconfigure({}), /reconf failed/);
      assert.strictEqual(component.impl, original);
    });
  });

  describe("Callbacks (on)", () => {
    it('should call "ready" callbacks when init completes', async () => {
      const component = Provider.define({ name: "ready-cb" });
      const calls: string[] = [];
      component.on("ready", () => {
        calls.push("ready");
      });
      component.bind({}, { init: async () => undefined });

      await component.init();

      assert.deepStrictEqual(calls, ["ready"]);
    });

    it('should call multiple "ready" callbacks in registration order', async () => {
      const component = Provider.define({ name: "ready-multi" });
      const calls: string[] = [];
      component.on("ready", () => {
        calls.push("a");
      });
      component.on("ready", () => {
        calls.push("b");
      });
      component.bind({}, { init: async () => undefined });

      await component.init();

      assert.deepStrictEqual(calls, ["a", "b"]);
    });

    it('should call "start" callbacks when start() is invoked', async () => {
      const component = Provider.define({ name: "start-cb" });
      const calls: string[] = [];
      component.on("start", () => {
        calls.push("start");
      });
      component.bind(
        {},
        { init: async () => undefined, start: () => undefined }
      );

      await component.init();
      component.start();

      assert.deepStrictEqual(calls, ["start"]);
    });

    it('should call "stop" callbacks when stop() completes', async () => {
      const component = Provider.define({ name: "stop-cb" });
      const calls: string[] = [];
      component.on("stop", () => {
        calls.push("stop");
      });
      component.bind(
        {},
        { init: async () => undefined, stop: async () => undefined }
      );

      await component.init();
      await component.stop();

      assert.deepStrictEqual(calls, ["stop"]);
    });

    it("should invoke ready, start, and stop callbacks in lifecycle order", async () => {
      const component = Provider.define({ name: "all-events" });
      const calls: string[] = [];
      component.on("ready", () => {
        calls.push("ready");
      });
      component.on("start", () => {
        calls.push("start");
      });
      component.on("stop", () => {
        calls.push("stop");
      });
      component.bind({
        init: async () => undefined,
        start: () => undefined,
        stop: async () => undefined,
      });

      await component.init();
      component.start();
      await component.stop();

      assert.deepStrictEqual(calls, ["ready", "start", "stop"]);
    });
  });

  describe("Lifecycle orchestrator", () => {
    it("should init/start/stop in dependency order", async () => {
      const calls: string[] = [];
      const moduleA = Provider.define({ name: "A" });
      const moduleB = Provider.define({ name: "B" }, [moduleA]);
      const moduleC = Provider.define({ name: "C" }, [moduleB]);

      moduleA.bind({
        init: async () => {
          calls.push("A:init");
        },
        start: () => {
          calls.push("A:start");
        },
        stop: async () => {
          calls.push("A:stop");
        },
      });
      moduleB.bind({
        init: async () => {
          calls.push("B:init");
        },
        start: () => {
          calls.push("B:start");
        },
        stop: async () => {
          calls.push("B:stop");
        },
      });
      moduleC.bind({
        init: async () => {
          calls.push("C:init");
        },
        start: () => {
          calls.push("C:start");
        },
        stop: async () => {
          calls.push("C:stop");
        },
      });

      await initInDependencyOrder([moduleC]);
      startInDependencyOrder([moduleC]);
      await stopInReverseDependencyOrder([moduleC]);

      assert.deepStrictEqual(calls, [
        "A:init",
        "B:init",
        "C:init",
        "A:start",
        "B:start",
        "C:start",
        "C:stop",
        "B:stop",
        "A:stop",
      ]);
    });

    it("should throw when dependency cycle exists", async () => {
      const providerA: LifecycleProvider<number> = {
        name: "A",
        dependencies: [],
        impl: undefined as unknown as number,
      };
      const providerB: LifecycleProvider<number> = {
        name: "B",
        dependencies: [providerA],
        impl: undefined as unknown as number,
      };
      providerA.dependencies = [providerB];

      await assert.rejects(
        initInDependencyOrder([providerA]),
        /cycle detected/
      );
    });
  });

  describe("Registry and Dependency Graphs", () => {
    afterEach(() => {
      Provider.reset();
    });

    it("Provider.reset clears the registry", () => {
      Provider.reset();
      Provider.define({ name: "to-reset" });
      assert.strictEqual(Provider.getDependencyGraphs().length, 1);
      Provider.reset();
      assert.deepStrictEqual(Provider.getDependencyGraphs(), []);
    });

    it("Provider.printStatus handles empty registry without output", () => {
      const groupSpy = vi.spyOn(console, "group").mockImplementation(() => {});
      const groupEndSpy = vi
        .spyOn(console, "groupEnd")
        .mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        Provider.reset();
        Provider.printStatus();
        assert.strictEqual(groupSpy.mock.calls.length, 0);
        assert.strictEqual(logSpy.mock.calls.length, 0);
        assert.strictEqual(groupEndSpy.mock.calls.length, 0);
      } finally {
        groupSpy.mockRestore();
        groupEndSpy.mockRestore();
        logSpy.mockRestore();
      }
    });

    it("Provider.printStatus groups providers by Initialized, Started, Stopped, Ignored", async () => {
      const groupSpy = vi.spyOn(console, "group").mockImplementation(() => {});
      const groupEndSpy = vi
        .spyOn(console, "groupEnd")
        .mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        Provider.reset();

        const pInitialized = Provider.define({ name: "P_Init" });
        pInitialized.bind({});
        await pInitialized.init();

        const pStarted = Provider.define({ name: "P_Start" });
        pStarted.bind({});
        await pStarted.init();
        pStarted.start();

        const pStopped = Provider.define({ name: "P_Stop" });
        pStopped.bind({});
        await pStopped.init();
        await pStopped.stop();

        Provider.define({ name: "P_Ignored" });

        Provider.printStatus();

        const groups = groupSpy.mock.calls.map(c => c[0]);
        assert.ok(groups.includes("Providers: Initialized"));
        assert.ok(groups.includes("Providers: Started"));
        assert.ok(groups.includes("Providers: Stopped"));
        assert.ok(groups.includes("Providers: Ignored"));

        const logs = logSpy.mock.calls.map(c => c[0]);
        assert.ok(logs.includes("P_Init"));
        assert.ok(logs.includes("P_Start"));
        assert.ok(logs.includes("P_Stop"));
        assert.ok(logs.includes("P_Ignored"));

        assert.strictEqual(groupEndSpy.mock.calls.length, 4);
      } finally {
        groupSpy.mockRestore();
        groupEndSpy.mockRestore();
        logSpy.mockRestore();
      }
    });

    it("Provider.getDependencyGraphs partitions and sorts connected components", () => {
      Provider.reset();

      const depA = Provider.define({ name: "DepA" });
      const rootA = Provider.define({ name: "RootA" }, [depA]);

      const depB = Provider.define({ name: "DepB" });
      const rootB = Provider.define({ name: "RootB" }, [depB]);

      const single = Provider.define({ name: "Single" });

      const graphs = Provider.getDependencyGraphs();

      assert.strictEqual(graphs.length, 3);
      assert.deepStrictEqual(graphs[0], [depA, rootA]);
      assert.deepStrictEqual(graphs[1], [depB, rootB]);
      assert.deepStrictEqual(graphs[2], [single]);
    });

    it("Provider.getDependencyGraphs handles diamond/multi-path graphs with duplicate stack entries", () => {
      Provider.reset();

      const d = Provider.define({ name: "D" });
      const b = Provider.define({ name: "B" }, [d]);
      const c = Provider.define({ name: "C" }, [d]);
      const a = Provider.define({ name: "A" }, [b, c]);

      const graphs = Provider.getDependencyGraphs();
      assert.strictEqual(graphs.length, 1);
      assert.deepStrictEqual(graphs[0], [d, b, c, a]);
    });

    it("Provider.getDependencyGraphs handles missing adjacency entry during traversal", () => {
      Provider.reset();
      Provider.define({ name: "P1" });
      Provider.define({ name: "P2" });

      const origGet = Map.prototype.get;
      let adjacencyBuilt = false;
      let returnedUndefined = false;

      const getSpy = vi
        .spyOn(Map.prototype, "get")
        .mockImplementation(function (
          this: Map<unknown, unknown>,
          key: unknown
        ) {
          const val = origGet.call(this, key);
          if (val instanceof Set && adjacencyBuilt && !returnedUndefined) {
            returnedUndefined = true;
            return undefined;
          }
          return val;
        });

      try {
        adjacencyBuilt = true;
        const graphs = Provider.getDependencyGraphs();
        assert.strictEqual(graphs.length, 2);
        assert.ok(returnedUndefined);
      } finally {
        getSpy.mockRestore();
      }
    });

    it("Provider.getDependencyGraphs handles missing indexMap entries during sort", () => {
      Provider.reset();
      const p1 = Provider.define({ name: "P1" });
      const p2 = Provider.define({ name: "P2" }, [p1]);

      const origGet = Map.prototype.get;

      const getSpy = vi
        .spyOn(Map.prototype, "get")
        .mockImplementation(function (
          this: Map<unknown, unknown>,
          key: unknown
        ) {
          const val = origGet.call(this, key);
          if (typeof val === "number" && (key === p1 || key === p2)) {
            return undefined;
          }
          return val;
        });

      try {
        const graphs = Provider.getDependencyGraphs();
        assert.strictEqual(graphs.length, 1);
        assert.strictEqual(graphs[0].length, 2);
      } finally {
        getSpy.mockRestore();
      }
    });

    it("Provider.getDependencyGraphs ignores dependencies not present in registry", () => {
      const unregisteredDep = Provider.define({ name: "Unregistered" });
      Provider.reset();

      const newProvider = Provider.define({ name: "Registered" }, [
        unregisteredDep,
      ]);

      const graphs = Provider.getDependencyGraphs();
      assert.strictEqual(graphs.length, 1);
      assert.deepStrictEqual(graphs[0], [newProvider]);
    });

    it("Provider.printDependencyGraphs handles empty, single, and multi-node graphs", () => {
      const groupSpy = vi.spyOn(console, "group").mockImplementation(() => {});
      const groupEndSpy = vi
        .spyOn(console, "groupEnd")
        .mockImplementation(() => {});
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        Provider.reset();
        Provider.printDependencyGraphs();
        assert.ok(
          logSpy.mock.calls.some(
            c => c[0] === "Providers: no registered providers"
          )
        );

        logSpy.mockClear();
        groupSpy.mockClear();
        groupEndSpy.mockClear();

        Provider.define({ name: "Alone" });
        Provider.printDependencyGraphs();

        assert.ok(
          groupSpy.mock.calls.some(c => c[0] === "Provider dependency graphs")
        );
        assert.ok(logSpy.mock.calls.some(c => c[0] === "#1 Alone"));

        logSpy.mockClear();
        groupSpy.mockClear();
        groupEndSpy.mockClear();

        Provider.reset();
        const base = Provider.define({ name: "Base" });
        const middle = Provider.define({ name: "Middle" }, [base]);
        Provider.define({ name: "Top" }, [middle]);

        Provider.printDependencyGraphs();

        assert.ok(
          groupSpy.mock.calls.some(c => c[0] === "Provider dependency graphs")
        );
        assert.ok(groupSpy.mock.calls.some(c => c[0] === "#1 (3)"));
        assert.ok(logSpy.mock.calls.some(c => c[0] === "Base (no deps)"));
        assert.ok(logSpy.mock.calls.some(c => c[0] === "Middle <- Base"));
        assert.ok(logSpy.mock.calls.some(c => c[0] === "Top <- Middle"));
      } finally {
        groupSpy.mockRestore();
        groupEndSpy.mockRestore();
        logSpy.mockRestore();
      }
    });
  });

  describe("index exports", () => {
    it("exports all expected symbols from root index", () => {
      assert.strictEqual(IndexExports.Provider, Provider);
      assert.strictEqual(IndexExports.ProviderState, ProviderState);
      assert.strictEqual(
        IndexExports.ProviderInitParamsSymbol,
        ProviderInitParamsSymbol
      );
      assert.strictEqual(
        IndexExports.initInDependencyOrder,
        initInDependencyOrder
      );
      assert.strictEqual(
        IndexExports.startInDependencyOrder,
        startInDependencyOrder
      );
      assert.strictEqual(
        IndexExports.stopInReverseDependencyOrder,
        stopInReverseDependencyOrder
      );
    });
  });
});
