# AI-Driven Design Thinking — Coding Principles

> Actionable design principles extracted from "The Passionate Programmer" playlist by David Scott Bernstein.
> Written as guidelines for building and reviewing code, especially when collaborating with AI.

---

## I. Forces-First Design

1. **Understand forces before restructuring.** Never refactor for "cleanliness" alone. First ask: *What varies here? Why does each variation exist? What are the independent reasons to change?* Forces dictate structure — aesthetics don't.

2. **Group by reason to change, not by logical similarity.** Code that changes for different reasons (e.g., quarterly business rules vs. monthly promotions) should live in different units, even if it looks related. Variations that live on different "clocks" must be separated.

3. **Design for the forces you can see, not hypothetical ones.** Add the minimal structure required by forces that are actually present. Don't predict the future. If only two stable cases exist, an if-else is fine. Patterns earn their way in when forces demand them.

---

## II. The Open-Closed Principle (In Practice)

4. **Open only where variation exists; closed everywhere else.** Use OCP as a diagnostic, not a decree. It tells you what to design now and what to leave alone. Stop designing when you've addressed the visible forces.

5. **When a new force appears, respond — don't stack.** If requirements shift from single variation to combinations, the needed pattern changes too (e.g., Strategy → Decorator, or Strategy → Template Method). Abandon the old pattern rather than stretching it.

6. **Extension should mean adding a file, not editing existing ones.** The gold standard: a new business requirement = a new file, zero edits to existing code. When your design achieves this, you have resilience.

---

## III. Separation of Decisions from Actions

7. **Factories decide; clients act.** All identity coupling (which concrete type to use) belongs in factories. All behavior/usage coupling belongs in clients. Never mix construction with use in the same function.

8. **Factories instantiate but never call methods on what they create.** A factory's job: create, connect, return. It never executes behavior. Conversely, client code uses objects but never instantiates them directly.

9. **Conditionals in factories are fine — they're the right home for selection logic.** Move if/else and switch statements into factories where they encode business policy. The rest of the code becomes boring and predictable, which is the goal.

10. **Put construction in a factory early, even before patterns emerge.** This is the key move for emergent design. When you later need to introduce an abstraction, you only update the factory — all clients remain untouched. Patterns can then emerge below a stable seam.

---

## IV. Composition Over Inheritance

11. **Never encode "what I do" into "who I am."** Use inheritance for classification (identity), not specialization (behavior). When optional behaviors accumulate as subclasses, class explosion follows: N options = 2^N classes.

12. **Make variation data, not types.** One abstraction per step, assembled into a pipeline (list). Order and cardinality become explicit. Adding a feature = adding a step to the list.

13. **Use the Decorator when behaviors are optional, ordered, and composable.** Decorator varies which behaviors, how many, and their order — dimensions Strategy cannot handle. Constrain decorators through factories to prevent invalid combinations.

14. **Use Chain of Responsibility when decisions must happen at runtime.** If you don't know which rule should win until execution, each handler must decide locally whether to handle, pass, or bail. The factory is boring; the intelligence lives in the nodes.

---

## V. Testability as the Design Compass

15. **Testability is the single best proxy for code quality.** When code is hard to test, it lacks cohesion, has coupling issues, or breaks encapsulation. Don't fix the tests — fix the code they're trying to test.

16. **A unit test tests a unit of behavior, not a unit of code.** Test outcomes, not implementation. Tests should have exactly one reason to fail. If a test can fail for multiple reasons, the code under test isn't cohesive.

17. **Separate responsibilities to collapse the testing space.** 5 responsibilities in one method = 2^5 = 32 tests. 5 separate methods = 5 tests + integration. Cohesion isn't just aesthetics — it's exponential test reduction.

18. **Create seams for every external dependency.** A seam is a substitution point that lets you swap real dependencies for fakes during testing. Constructor injection is the simplest technique: one parameter, one seam, design opens up.

19. **Prefer fakes over mocks.** A fake is a simple implementation you control that records calls. It's faster, more deterministic, and easier to reason about than framework-based mocks. Tests become boring — and boring is good.

---

## VI. The Four Forms of Coupling

20. **Know the four forms and manage them deliberately.**
    - **Identity coupling** — you know another type exists (import/include).
    - **Interface coupling** — you depend on method signatures.
    - **Abstract coupling** — you depend on an abstraction (good).
    - **Concrete coupling** — you know the specific subtypes (avoid).

21. **When all four forms appear in one spot, the design is sealed.** A seam (via DI) is the counterforce that unseals it. Separate identity coupling (factory) from interface coupling (client) to create flexibility.

---

## VII. Pattern Recognition, Not Pattern Application

22. **Patterns are signals, not recipes.** They live in the problem as responses to forces. If the force isn't present, applying the pattern is theater. Learn to see forces first, then recognize which pattern they demand.

23. **Use commonality/variability analysis.** For any new structure, ask: *How is this the same as what I know? How is it different?* Find what varies, isolate it, find commonalities. Your abstraction should be the home for the variation.

24. **Match the pattern to the force:**
    - **Strategy** — atomic variation; one behavior varies independently.
    - **Decorator** — optional, ordered, composable behaviors; cardinality varies.
    - **Chain of Responsibility** — runtime selection; handlers decide locally.
    - **Template Method** — structured variation; steps change together as a set.
    - **Abstract Factory** — families of related objects that must stay coherent.

25. **Be willing to abandon a pattern when forces change.** The real skill isn't applying patterns — it's letting go of them when they no longer fit. Delete, simplify, realign to the current forces.

---

## VIII. Emergent Design

26. **Emergent design is a compass, not the absence of design.** Start simple, let structure emerge as forces appear. This only works with tests and refactoring skills — without them, emergent design creates legacy code.

27. **Follow the progression: simple → extract → abstract.**
    1. Start with inline code (if-else is fine).
    2. When a second variation appears, extract into a class with a factory.
    3. When independent variation appears, promote to an abstract strategy.
    Each step is justified by actual forces, not speculation.

28. **Evaluate designs by virtues, not by pattern count.** The compass is: *simplicity, extensibility, testability.* Ask: What's more cohesive? Better encapsulated? More independently verifiable? These qualities tell you which direction to steer.

---

## IX. Working with AI

29. **AI amplifies your judgment — make sure it's good judgment.** AI will happily write procedural code forever unless you give it a model. When you provide structure, AI discovers the same insights you would. Your job is directing AI toward the right design, not just accepting its output.

30. **Don't ask AI for "cleaner code" — ask it to reveal forces.** Prompts like "What varies here? Why? Group by reason to change" produce better designs than "Refactor this to be more readable."

31. **Use tests as a safety net for AI-generated changes.** AI can accidentally change fundamental business rules that have nothing to do with the current task. A good automated test suite is table stakes for AI-assisted development — it's how you know AI didn't silently break something.

32. **AI performs better with clean seams.** When architecture has clean substitution points, dependency injection, and factory-based construction, AI can make changes within bounded contexts without cascading side effects.

33. **Design is the constraint that makes AI safe.** AI can write code faster than you can verify it. Dependency injection, factories, and cohesive units make verification cheaper. Your architecture is what keeps AI-generated code trustworthy and changeable.

---

## X. Core Maxims

- *Architecture is always about trade-offs. The question is whether you're paying interest now or later.*
- *Refactoring without understanding forces is rearranging furniture to fix a cracked foundation.*
- *Testability is not a feature. It's a reflection of your design clarity.*
- *Patterns don't solve problems. They stabilize the problem.*
- *Factories are where systems admit what they believe about identity.*
- *The cost of changing code is 5x the cost of building it. Design for change.*
- *Code is read 10x more than it's written. Optimize for the reader.*
- *The right amount of flexibility: enough to handle known forces, no more.*
