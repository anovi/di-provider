import assert from "node:assert";
import { describe, it } from "vitest";

import { Provider, ProviderInitParamsSymbol } from "../src/Provider";
import {
  LifecycleProvider,
  initInDependencyOrder,
  startInDependencyOrder,
  stopInReverseDependencyOrder,
} from "../src/LifecycleOrchestrator";

describe("Component @buiding-blocks", () => {
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
        }, /Provider "has-plain-dep" dependency at index 0 must be a Provider instance/);
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
        component.provide({});
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
        component.provide({});
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
        component.provide({
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
        component.provide(() => {
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
      MyComponent.provide(new TestService());
      DepsComponent.provide(new SomeServiceImpl());
      SomeFunc.provide(() => {
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
      MyComponent.provide(new TestService());
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

      MyComponent.provide(new TestService(), {
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

      MyComponent.provide(new TestService(), { init: async () => {} });
      DepsComponent.provide(new SomeServiceImpl());

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

      MyComponent.provide(new TestService(), {
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

      MyComponent.provide(new TestService(), {
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

      MyComponent.provide(new TestService(), {
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

      MyComponent.provide(new TestService(), { init: async () => {} });

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

      MyModule3.provide(new TestService3());
      MyModule2.provide(new TestService2());
      MyModule1.provide(new TestService1(), { init: async () => {} });

      await initInDependencyOrder([MyModule3]);
    });
  });

  describe("Lifecycle hooks", () => {
    it("should support start-only implementations", async () => {
      const component = Provider.define({ name: "start-only" });
      let started = false;
      component.provide({
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
      component.provide({
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
      component.provide({
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
      component.provide({});
      await component.init();
      await assert.rejects(
        component.init(),
        /already in progress or completed/
      );
    });

    it("should expose lifecycle type guards", () => {
      const withStartOnly = Provider.define({ name: "start-only" });
      withStartOnly.provide({}, { start: () => undefined });

      const withInitOption = Provider.define({ name: "with-init-option" });
      withInitOption.provide({}, { init: async () => undefined });

      const withStop = Provider.define({ name: "impl-stop" });
      withStop.provide({ stop: async () => undefined });

      assert.strictEqual(withStartOnly.isInitializable(), false);
      assert.strictEqual(withStartOnly.isStartable(), true);
      assert.strictEqual(withStartOnly.isStoppable(), false);

      assert.strictEqual(withInitOption.isInitializable(), true);
      assert.strictEqual(withInitOption.isStartable(), false);

      assert.strictEqual(withStop.isStoppable(), true);
    });
  });

  describe("reconfigure", () => {
    it("should throw when reconfigure hook is not provided", async () => {
      const component = Provider.define<{ id: number }>({
        name: "reconf-missing",
      });
      component.provide({ id: 1 }, { init: async () => {} });
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
      component.provide(first, {
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
      component.provide(
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
      component.provide(original, {
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
      component.provide({}, { init: async () => undefined });

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
      component.provide({}, { init: async () => undefined });

      await component.init();

      assert.deepStrictEqual(calls, ["a", "b"]);
    });

    it('should call "start" callbacks when start() is invoked', async () => {
      const component = Provider.define({ name: "start-cb" });
      const calls: string[] = [];
      component.on("start", () => {
        calls.push("start");
      });
      component.provide(
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
      component.provide(
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
      component.provide({
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

      moduleA.provide({
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
      moduleB.provide({
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
      moduleC.provide({
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
});
