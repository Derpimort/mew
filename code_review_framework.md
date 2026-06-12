# Code Review Framework

> A diagnostic evaluation framework for human reviewers and AI agents.
> Distilled from David Scott Bernstein's 12-part design thinking series ("The Passionate Programmer").
> Companion: `coding_principles.md` for the full principle set.

---

## Philosophy

This is not a checklist of rules. It is a set of **diagnostic lenses** — each one trained on a specific class of design failure that compounds over time. The goal is not to produce "clean" code. The goal is to produce code that **survives the next requirement without breaking what already works.**

Every dimension below encodes a specific failure mode that Bernstein observed across decades of training developers at top companies. The review questions are designed to reveal whether that failure mode is present — not to enforce a pattern.

**The cardinal rule of this framework: "it depends."** Two stable branches in an if-else are fine. A strategy pattern for two cases that will never grow is theater. The reviewer's job is judgment about when structure earns its cost — not blind enforcement.

---

## How to Use

**For human reviewers:** Walk the diff through each applicable dimension. Not every dimension applies to every change — a CSS fix doesn't need coupling analysis. Score what's relevant. The "Diagnostic Questions" at the end of each section are the fastest path.

**For AI agents:** When reviewing code (PR review, pre-commit, refactor validation), evaluate changed code against each applicable dimension. Output structured verdict using the template at the bottom. Be explicit about which dimensions you skipped and why.

**When to apply:** Pre-commit reviews, PR reviews, post-refactor validation, design audits. NOT during exploratory coding — this is a quality gate, not a speed bump.

---

## Dimension 1: Forces Alignment

### The failure mode this catches

Code gets refactored to look "cleaner" — smaller functions, better names, diffs that look good — but rules that change for different reasons stay coupled together. Six weeks later, simple changes start breaking things. The coupling didn't go away; it became harder to see.

This is the #1 failure mode Bernstein sees with AI-assisted refactoring. The typical prompt "refactor this to be cleaner and more readable" produces exactly this problem.

### What "forces" actually means

Forces are the **reasons code wants to change** — like physics for design. A quarterly customer loyalty program and a monthly temporal promotion aren't just different rules. They live on different "clocks" — different stakeholders, different cadences, different business pressures. That difference in clock speed IS the force. Code that ignores this will couple things that evolve independently, and every change to one will risk breaking the other.

### What to look for in a review

- **Reason-to-change grouping:** Are things that change together grouped together? Are things that change for different reasons separated?
- **Clock speed analysis:** Do all the variations in this unit change at the same cadence (same sprint, same stakeholder, same business event)? If not, they're coupled across force boundaries.
- **Speculative vs. actual forces:** Is the structure responding to pressure that exists right now, or to hypothetical "what if" thinking? Elaborate abstractions built for problems that never happen make the real change harder when it arrives.

### Specific anti-patterns from the source material

| Anti-pattern | What it looks like | Why it's dangerous |
|---|---|---|
| **Cosmetic refactor** | Functions are smaller, names are better, but pricing rules + promotional rules still live in the same unit | The coupling is now harder to see. Looks "clean" so nobody questions it. |
| **Premature abstraction** | Strategy/factory/decorator introduced when only one or two stable cases exist | Adds 10x the code (in Java: 3-4 lines of if-else → ~30 lines of strategy). No benefit until variation actually grows. |
| **Force-blind AI output** | AI refactored for readability but didn't analyze what varies independently | "The diffs look good and tests pass. And yet 6 weeks later, simple changes start breaking things." |

### Diagnostic questions

1. *If requirement X changes tomorrow, how many files do I touch?* One file per independent concern = good.
2. *Can I name the specific force behind each structural decision?* If not, the structure may be cosmetic.
3. *Are we doing just enough to handle visible forces, leaving room to do more later without paying a huge price?*

### The nuanced judgment

Simple working code that hasn't encountered meaningful forces yet **is not bad code.** It just hasn't needed structure yet. The mistake is assuming it's bad and adding premature architecture. The opposite mistake is ignoring forces when they're clearly present. The skill is seeing the difference.

| Rating | Meaning |
|---|---|
| **Good** | Variations grouped by independent reason to change. Structure is justified by visible forces. |
| **Acceptable** | Minor coupling between concerns, but forces aren't yet strong enough to warrant splitting. |
| **Needs Work** | Independent concerns tangled in the same unit, OR premature structure without visible forces. |

---

## Dimension 2: Decision/Action Separation

### The failure mode this catches

A function decides what objects it needs, constructs them, and uses them — all in one place. When requirements change, everything funnels through this crossroads. Every new discount rule, shipping policy, or payment method forces edits right here. Testing gets harder because each path is wired to real construction.

### Why this matters structurally

A conditional does two things: it **qualifies** (decides) and then it **acts**. In well-structured code, these are separated. Factories handle the qualification (given these business conditions, what objects should exist?). Clients handle the action (use whatever objects they're given). This separation is what makes code extensible — you add a new discount by changing the factory, not every caller.

### The one rule for factories

**Factories may instantiate objects but must NEVER call methods on them.** Their job: create, connect, return. No behavior calls. Conversely, the rest of the system may USE objects but must NEVER instantiate them directly.

When you separate these two perspectives — creation from usage — testing becomes straightforward in both directions:
- Test factories: give business rules in, verify you got the right objects back.
- Test behavior: inject fakes through the seam, verify the behavior works.

### What to look for in a review

- **Construction + usage tangled:** Does any function both `new` a dependency AND call methods on it?
- **Scattered selection:** Is the same `if type == "X"` conditional duplicated across multiple call sites?
- **Factory discipline:** If factories exist, do they obey the rule (create + return, never call methods)?
- **Client simplicity:** Do clients operate on abstractions without knowing which concrete type they're using?

### Specific anti-patterns

| Anti-pattern | What it looks like | The fix |
|---|---|---|
| **Decision crossroads** | A checkout function that decides discounting, constructs shipping calculator, selects tax strategy, AND runs the charge — all inline | Migrate decisions into a factory. The checkout becomes a boring orchestrator that composes results from collaborators. |
| **Factory that does too much** | A factory that instantiates objects AND then calls methods on them, effectively becoming a god service | Enforce the rule: create, connect, return. Never call. |
| **Type-checking in clients** | Client code uses `isinstance`/`typeof` to branch on concrete types | Client should depend only on the abstraction. Move the branching into a factory. |

### Diagnostic questions

1. *Can I change which concrete implementation is used by editing one place (the factory)?*
2. *Does the factory just create/return, or does it also execute behavior?*
3. *Are conditionals encoding business policy? If so, are they consolidated in a factory or scattered across callers?*

| Rating | Meaning |
|---|---|
| **Good** | Construction in factories/providers, usage through abstractions. The factory rule is observed. |
| **Acceptable** | Some inline construction, but behind a clear boundary and not duplicated. |
| **Needs Work** | Construction and usage tangled. Selection logic scattered across multiple call sites. |

---

## Dimension 3: Coupling Analysis

### The failure mode this catches

A class imports a concrete dependency, instantiates it, and calls methods on it — all in one spot. This creates a "sealed design" that is frozen. You can't test it without hitting the real dependency. You can't substitute behavior. You can't extend it without editing it.

### The four forms of coupling (specific definitions)

These are precise terms, not vague concepts. Each form is identifiable by a concrete test:

1. **Identity coupling** — You know another type exists. Test: if you remove the import/include statement, the code no longer compiles. That's identity coupling.
2. **Interface coupling** — You depend on the exact method signatures of another type. You call specific methods with specific parameter shapes.
3. **Abstract coupling** — You depend on an abstraction (interface/abstract class), not a concrete type. The client is aware of the abstraction but NOT the subtypes below it. This is the *desirable* form.
4. **Concrete coupling** — The client knows the specific concrete subtypes. You can add new subtypes and the client breaks. This is the form to *avoid* in client code.

**The sealed design rule:** When all four forms appear in one spot, the design is sealed — unchangeable, frozen. A seam (via dependency injection) is the counterforce that unseals it. It separates identity coupling (put in the factory) from interface coupling (left in the client).

### What to look for in a review

- **Sealed spots:** Any place that imports, instantiates, AND calls methods on a concrete dependency — that's sealed.
- **Missing seams for externals:** Every external dependency (API client, database, filesystem, network call) should have a substitution point. The class should receive the dependency, not create it.
- **Seam discipline:** Seams should be few and intentional. Don't put them everywhere — only where external boundaries or likely-to-change behaviors demand them.

### The seam test (Bernstein's core diagnostic)

Ask for each external dependency in the changed code: *Can I construct this class without constructing the real external client and hitting the real service?* If the answer is no, a seam is missing.

The fix is usually one parameter: constructor injection. Add the dependency as a constructor parameter with a sensible production default. In tests, pass a fake. This single move often eliminates the need for complicated mocking frameworks entirely.

### Why fakes beat mocks

A fake is a simple implementation you control that records the calls you make. No framework, no patching, no magic. The test is fast, deterministic, and local. The unit test verifies YOUR logic without testing the external service's behavior (you don't need to test Stripe — Stripe tests Stripe).

### Diagnostic questions

1. *Can I test this unit without hitting the network, database, or filesystem?*
2. *If I look at a sealed spot, can I add one constructor parameter to unseal it?*
3. *Are seams few and intentional, or scattered everywhere?*

| Rating | Meaning |
|---|---|
| **Good** | Abstract coupling in clients, identity coupling in factories, seams for all externals. Fakes over mocks. |
| **Acceptable** | Some concrete coupling but isolated to boundaries. Seams exist for critical externals. |
| **Needs Work** | Sealed designs. No way to substitute dependencies. Tests require real network/DB. |

---

## Dimension 4: Cohesion & Testability

### The failure mode this catches

A method validates the cart, selects discount policies, calculates shipping, applies VIP rules, and computes tax in a single pass. It's "not a unit — it's a small department." Tests for this method check 5+ things and assert 10 different outcomes. When a test fails, you don't learn anything — you just debug.

This creates **fear of changing code** and is why developers say "tests slow us down." It's not a testing problem. It's a cohesion problem. The test is the symptom; the code is the disease.

### The exponential math that makes this urgent

This isn't aesthetic — it's exponential:
- 5 responsibilities in one method: the paths can interact in unexpected ways. To validate all combinations = 2^5 = **32 tests**.
- 5 responsibilities in 5 separate, encapsulated methods: 5 tests + integration tests. **5 tests instead of 32.**

### The key insight: test friction reveals design problems

When tests are hard to write, the issue is not that you need better testing tools or more mocking. The issue is that the code lacks cohesion, has coupling issues, or breaks encapsulation. **Improving testability improves code quality because they reflect the same underlying properties:**

- Cohesion ↑ → Testability ↑
- Coupling ↓ → Testability ↑
- Encapsulation ↑ → Testability ↑

Testability is the single best proxy for code quality because it surfaces problems in all three properties simultaneously.

### What a good unit test looks like

A unit test tests a **unit of behavior**, not a unit of code. It should:
- Assert ONE behavior / ONE outcome
- Have exactly ONE reason to fail — the reason you intended
- Not break when implementation changes (only when behavior changes)
- Not retest other units' responsibilities (checkout tests don't retest discount policy — they verify composition)

### The refactor move when cohesion is low

Don't reach for mocks and patching. Treat the cause, not the symptom:
1. Identify the behaviors hiding inside the bloated method.
2. Migrate each decision into its own cohesive object (DiscountPolicy, ShippingCalculator, TaxCalculator).
3. Make the original method an orchestrator that composes results from collaborators.
4. Now each collaborator is independently testable with one-reason-to-fail tests.
5. The orchestrator test verifies composition, not policy.

### Diagnostic questions

1. *If this test fails, do I know exactly what broke without debugging?*
2. *Can I describe what this function does without using the word "and"?*
3. *How many tests would I need to cover all paths? If > 10, the code is probably doing too many jobs.*
4. *Are tests verifying behavior (outcomes) or implementation (internal calls)?*

| Rating | Meaning |
|---|---|
| **Good** | Each unit has one job. Tests have one reason to fail. Orchestrators delegate, don't own policy. |
| **Acceptable** | Mild bundling, but responsibilities are at least conceptually separable. Test count is manageable. |
| **Needs Work** | God functions/classes. Tests assert many unrelated things. Mocking/patching required to test basic logic. |

---

## Dimension 5: Variation Modeling

### The failure mode this catches

Every new option (logging, fraud check, retry, validation) gets added as a new subclass. It feels neat at first — one requirement, one class. But each optional behavior creates a new branch, and branches **multiply, they don't add.** Five optional behaviors = 2^5 = 32 subclasses. This is class explosion, and it is a signal that variation is being encoded in identity.

### The root cause: confusing two uses of inheritance

Inheritance has two legitimate uses, and confusing them causes class explosion:

| Use | Root | Depth | Purpose |
|---|---|---|---|
| **Classification** (identity) | Concrete class at root | Can be deep | Organizing a taxonomy — "who I am" |
| **Behavioral abstraction** | Abstract class or interface at root | Shallow | Defining interchangeable behaviors — "what I do" |

Class explosion happens when you encode "what I do" into "who I am." You end up with `PaymentProcessorWithLoggingAndFraudAndRetry` — the options BECOME the identity. Once that happens, OO layers collapse into procedural linear flow.

### The progression of warning signs

1. **First dimension of variation:** fine. One new feature, one new class.
2. **Second dimension:** tolerable. Combinations start appearing.
3. **Third dimension:** teams start saying "don't touch that." This is the signal.

### The replacement move: variation as data

You don't throw away OO — you relocate the variation:

1. One abstraction per step (validate, log, fraud-check, charge — each is a "step").
2. Build a pipeline: just a list of steps. Sequence and cardinality are explicit.
3. The pipeline is boring on purpose — it just loops.
4. Adding a feature = adding a step to the list. Don't edit the pipeline.

This preserves polymorphism but makes it shallow. Variation lives in the list, not in subclass names.

### Why this matters for AI-generated code

"The naive AI prompt is 'add feature X' and AI will often add it as a new conditional or a new subclass. AI is eager but it's not wise yet. It optimizes locally unless you constrain it. Your design is the constraint." When variation is data, you give AI a safe move: add a step, write a test, don't touch the pipeline.

### Diagnostic questions

1. *If I add a new optional behavior, do I add ONE step/class, or does existing code multiply?*
2. *Is inheritance being used for classification (identity) or behavior specialization? If behavior, is it shallow with an abstract root?*
3. *Are there subclass names that describe combinations of options? That's the class explosion signal.*

| Rating | Meaning |
|---|---|
| **Good** | Variation is data. Behaviors compose via pipelines/decorators. Adding a feature = adding a step. |
| **Acceptable** | Some inheritance for variation, but bounded to one or two dimensions. |
| **Needs Work** | Class explosion. Optional behaviors encoded as types. Subclass tree is growing exponentially. |

---

## Dimension 6: Pattern Fitness

### The failure mode this catches

Developers learn patterns as recipes and look for places to apply them. Someone says "discounts" and immediately they think "strategy." But if there's one variation with two branches, no volatility, and no pressure — adding strategy is theater. It doesn't buy anything. Worse, when forces change (e.g., from atomic variation to structured variation), developers cling to the old pattern instead of replacing it.

### Pattern-force matching (the specific knowledge)

Each pattern responds to a specific type of force. Using the wrong pattern for the force creates unnecessary complexity or inadequate structure:

| Force type | Signal you see in code | Correct pattern | Wrong pattern (common mistake) |
|---|---|---|---|
| **Atomic independent variation** — one behavior varies, each variant evolves separately | Growing identity coupling; processor knows every discount type | **Strategy** | Template Method (too rigid for atomic change) |
| **Optional, ordered, composable behaviors** — varying which, how many, and in what order | Class explosion from combinations; need to add/remove/reorder steps | **Decorator** (as pipeline) | Deep inheritance ("this + a little more" subclasses) |
| **Runtime selection** — you don't know which rule wins until execution | Routing logic hardcoded in callers; validators that need to short-circuit or branch | **Chain of Responsibility** | Decorator (wrong decision ownership) |
| **Structured variation** — steps change together as a set, same overall algorithm | Same template, different internal steps; variations always swap as a complete set | **Template Method** | Strategy (too much atomic flexibility for set-based change) |
| **Family coherence** — behaviors must travel together; invalid combos are dangerous | Currency + shipping + packing slip must match per country; strategy allows illegal mixes | **Abstract Factory** | Naked strategies (mix-and-match produces policy violations, not crashes) |

### The critical Decorator vs Chain of Responsibility distinction

These look identical in UML (both are chains/lists), but their intent is completely different:

- **Decorator:** Each layer ALWAYS participates. Additive. The factory is where all hard decisions happen — runtime is totally predictable.
- **Chain of Responsibility:** Each node CHOOSES whether to handle, pass, bail, or continue. Decisions are deferred to runtime. The factory is intentionally boring.

**The diagnostic:** "Watch where the if-statement lives. That's where the design is telling you what it really is." If decisions are all in the factory → decorator. If decisions are in the nodes → chain.

### When to abandon a pattern

"The real skill isn't applying patterns. It's the ability to abandon them when they no longer fit." When forces change, you often need a different pattern entirely. The anti-move is stacking patterns or extending them awkwardly. The right move is: delete, simplify, realign to the new forces.

**Passing tests doesn't mean the design is right.** Tests tell you behavior is correct. Patterns tell you structure is right. You can have green tests and a design that won't survive the next requirement.

### Diagnostic questions

1. *Can I name the specific force this pattern responds to?* If not, it may be theater.
2. *If I inlined this pattern (removed it, put the logic back inline), would the code get worse or better?* If simpler is better, the pattern wasn't earned.
3. *Has the nature of variation changed since this pattern was introduced?* If so, does the pattern still match the current forces?
4. *For chain-like structures: where do the decisions live — in the factory (decorator) or in the nodes (chain)?*

| Rating | Meaning |
|---|---|
| **Good** | Pattern matches forces. Code is simpler/safer because of it. Pattern could be named and justified on the spot. |
| **Acceptable** | Slight over-engineering, but the pattern isn't actively harmful and the force is plausibly emerging. |
| **Needs Work** | Pattern applied without justifying force. Wrong pattern for the variation type. Stacked/legacy patterns that should have been replaced. |

---

## Dimension 7: Coherence & Domain Safety

### The failure mode this catches

Strategies compose mechanically but not semantically. You can assemble combinations that compile and run but make no business sense. In an e-commerce system doing international sales, strategy lets you mix Japan's currency with US shipping and Germany's packing slip. Each strategy is valid on its own. Together, they're a policy violation.

**This is the most dangerous class of bug** because it doesn't crash — it produces wrong business outcomes. Tests don't catch it because each individual part passes. It's only when you bring them all together that the invalid assumptions surface.

### When to flag this in review

- Multiple strategies/behaviors are composed and the domain has "families" that must travel together
- There's no mechanism preventing illegal combinations (no abstract factory, no validation at assembly time)
- Unit tests pass for individual components, but no integration test verifies that the *combination* is valid
- The system can represent states the business never intended

### The fix: constrain flexibility at construction time

Abstract factory doesn't replace strategy — it organizes it. You don't pick individual behaviors; you pick a valid set. The factory enforces invariants at construction time. Invalid combinations become impossible rather than merely untested.

**The trade-off:** More types, harder to navigate. In exchange, you remove an entire class of bugs and make extensibility safer. Most senior developers take this trade.

### Diagnostic questions

1. *Can this code assemble a combination of behaviors that would be a business policy violation?*
2. *Are there "families" of behaviors that must stay coherent (e.g., per-country, per-tier, per-plan)?*
3. *Is there a test — or better, a structural constraint — that prevents invalid assembly?*

| Rating | Meaning |
|---|---|
| **Good** | Valid combinations are enforced at construction time. Invalid states are structurally impossible. |
| **Acceptable** | Combinations are constrained by convention or integration tests, not by structure. |
| **Needs Work** | Arbitrary mix-and-match possible. No validation of business coherence at assembly time. |

---

## Dimension 8: Openness & Emergent Design Readiness

### The failure mode this catches

Two opposite failures:
1. **Over-design:** Elaborate abstractions, factories, decorators, configuration — all built before any real force appeared. When the real change arrives, the design is rigid in all the wrong places.
2. **Under-design:** No structure at all. Every new feature requires editing a central blob. Change is demolition.

### The emergent design progression

Bernstein teaches a specific progression that avoids both extremes:

1. **Start inline.** One function, one rule, if-else is fine. This is not reckless — it's disciplined simplicity when forces are absent.
2. **When a second variation appears:** Extract into a class with a `process` method. Move construction into a tiny factory. You now have one place that knows what to build. But DO NOT make it abstract yet.
3. **When independent variation appears** (each variant evolves separately): NOW promote the concrete class to abstract. Add subclasses (strategy). Update the factory. Clients don't change.

**The key move:** Put construction in a factory early (step 2), even before patterns emerge. This costs 30 seconds. It lets you later refactor concrete → abstract by updating ONLY the factory. All clients immediately benefit from the new variation without any edits. This is what makes emergent design safe.

### What "open-closed" actually means in practice

It's a diagnostic, not a principle to blindly apply:
- **Open** only where variations actually exist right now
- **Closed** everywhere else
- It tells you what to design now, what to leave alone, and when to stop designing

The gold standard: a new business requirement = add one file, touch nothing else.

### Diagnostic questions

1. *What would the next likely requirement look like as a diff?* If "add a file" → good. If "edit 6 files" → not open where it should be.
2. *Is there structure here that doesn't respond to any visible force?* That's premature design.
3. *Is construction already in a factory, so we could introduce an abstraction later without breaking clients?*
4. *If we needed to evolve this from concrete to abstract tomorrow, how big is the blast radius?*

| Rating | Meaning |
|---|---|
| **Good** | Extension = new file, core untouched. Construction already in factory for future evolution. |
| **Acceptable** | Extension requires minor factory/config edits. Structure matches current forces without over-anticipating. |
| **Needs Work** | Either: over-designed with no justifying forces, OR under-designed with no seams for clearly volatile areas. |

---

## Dimension 9: AI-Specific Review Concerns

### Why this dimension exists

AI-generated code has specific, predictable failure modes that Bernstein observed and documented. These aren't hypothetical — they're patterns that show up consistently when AI writes production code.

### AI-specific failure modes to check for

| Failure mode | What to look for | Why it happens |
|---|---|---|
| **Procedural wrapping** | "Same logic, new syntax" — procedural code wrapped in a class statement. Describes steps, not roles. No model of the domain. | AI defaults to procedural code unless given a model. It will happily write procedural code forever. |
| **Cosmetic refactoring** | Code looks cleaner but independent concerns are still coupled. Names are better but the coupling is now harder to see. | AI optimizes for readability, not for forces. "Refactor to be cleaner" misses the structural problem. |
| **Eager subclassing** | AI adds feature X as a new conditional or a new subclass. Locally correct, but creates class explosion over time. | AI optimizes locally. It doesn't see the exponential cost of encoding behavior in identity. |
| **Silent business rule changes** | AI modifies a fundamental business rule that had nothing to do with the current task. No test fails because there isn't one for that rule. | AI lacks judgment about blast radius. It will "improve" adjacent code that should be left alone. |
| **Missing seams** | AI produces code that works but is untestable — classes create their own dependencies with no substitution point. | AI doesn't value testability as a design constraint unless told to. |

### The safety net

"AI can write code faster than you can verify it. Dependency injection makes verification cheaper." The non-negotiable baseline for AI-assisted development:

1. Every external dependency has a seam (constructor injection).
2. Every new business rule has a test with one reason to fail.
3. AI changes don't silently modify adjacent business rules.
4. Design structure constrains AI's move set (when variation is data, the only safe move for AI is "add a step").

### Diagnostic questions

1. *Did AI produce procedural code wrapped in a class, or a genuine model with roles and interactions?*
2. *Did AI touch any code adjacent to the requested change? If so, did it change behavior or just structure?*
3. *Is the output testable without real external services?*
4. *Does the design constrain what AI can do to safe moves (add a step, add a strategy, add a family)?*

| Rating | Meaning |
|---|---|
| **Good** | AI output follows the existing design's structure. New code has seams. Adjacent code untouched or behavior-preserved. |
| **Acceptable** | AI output is procedural but the domain is stable (procedural is fine for stable steps). Minor adjacent cleanups that don't change behavior. |
| **Needs Work** | AI produced sealed/untestable code. Adjacent business rules silently modified. Class explosion introduced. |

---

## Scoring Template

Use this for structured review output. **Omit dimensions that don't apply** — state which you skipped and why. A CSS-only change might only need Dimensions 4 and 8. A new business rule pipeline needs all of them.

```markdown
## Code Review: [description of change]

**Scope:** [What dimensions are relevant to this change and why]

| Dimension | Rating | Notes |
|---|---|---|
| 1. Forces Alignment | Good / Acceptable / Needs Work | ... |
| 2. Decision/Action Separation | Good / Acceptable / Needs Work | ... |
| 3. Coupling Analysis | Good / Acceptable / Needs Work | ... |
| 4. Cohesion & Testability | Good / Acceptable / Needs Work | ... |
| 5. Variation Modeling | Good / Acceptable / Needs Work | ... |
| 6. Pattern Fitness | Good / Acceptable / Needs Work | ... |
| 7. Coherence & Domain Safety | Good / Acceptable / Needs Work | ... |
| 8. Openness & Emergent Design | Good / Acceptable / Needs Work | ... |
| 9. AI-Specific Concerns | Good / Acceptable / Needs Work | ... |

### Strengths
- ...

### Action Items (ordered by severity)
1. [Needs Work items — must fix before merge]
2. [Acceptable items — suggested improvements]

### Verdict
Approve / Approve with suggestions / Request changes

### Trade-off Acknowledgment
[Explicitly note any trade-offs the code makes and whether they're justified by the forces present.
"This adds indirection via factory, which is justified because discount rules are growing independently."
OR "This keeps things inline, which is fine because there's only one stable case."]
```

---

## Quick Reference: The Five Diagnostic Questions

These five questions, derived from the deepest insights across all 12 videos, cover roughly 80% of review concerns. When time is short, use these:

1. **Forces:** *What varies here, and are those variations separated by reason to change? Or did we just make it "look cleaner"?*

2. **Seams:** *Can I construct and test this class without the real database / API / filesystem? If not, where's the missing one-parameter fix?*

3. **Cohesion:** *If the test for this code fails, do I know exactly which behavior broke — or do I just start debugging?*

4. **Extension:** *What does the next likely feature requirement look like as a diff? "Add a file" = good. "Edit 6 files" = bad.*

5. **Judgment:** *Is every piece of structure here justified by a force I can name? Or is any of it theater — patterns applied without pressure?*
