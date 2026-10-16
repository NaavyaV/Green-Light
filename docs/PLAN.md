# Green Light: Milestone 1 Build Plan

**Owner:** Sanjit (C++ engine)\
**Last updated:** October 15, 2026\
**How to use:** Export this document as Markdown and save it in the repo as `docs/PLAN.md`. It is self-contained: everything the implementing agent needs is here.

## How this plan works

Milestone 1 is built in seven stages, after a quick check of the repo layout (Stage 0). Each stage is one focused Claude Code session that ends at a stopping point where you test and review before moving on. Claude Code should never start the next stage on its own.

The loop for every stage:

1. Tell Claude Code which stage to do, for example: read `docs/PLAN.md` and do Stage 3 only. Ask for a short plan first. Read the plan and fix scope problems (extra files, extra features) before any code exists. This is your first checkpoint.
2. Let it write the code.
3. Run the stage's test yourself.
4. Review the changes with the stage's checklist. `git diff` shows exactly what changed.
5. Commit with the suggested message, then move to the next stage.

## Project briefing for the implementing agent

Green Light is a real-time adaptive traffic signal system. A Python model predicts traffic, a C++ engine turns predictions into safe signal decisions, and a React dashboard shows the intersection. You are implementing the **C++ engine**, one stage at a time. In Milestone 1 it is a standalone simulator and fixed-timing signal controller: no ML, no sockets, no UI.

The engine simulates a four-way intersection once per simulated second, operates the signals safely, and maintains the data the rest of the system will consume later. It never predicts traffic itself.

**The 12 movements** (N/S/E/W × Left/Through/Right), in this order: N\_LEFT, N\_THROUGH, N\_RIGHT, S\_LEFT, S\_THROUGH, S\_RIGHT, E\_LEFT, E\_THROUGH, E\_RIGHT, W\_LEFT, W\_THROUGH, W\_RIGHT. For each movement the engine tracks queue length, vehicle arrivals, vehicle departures and wait time.

**The 7 signal phases:** NS\_THROUGH, NS\_LEFT, EW\_THROUGH, EW\_LEFT, NS\_YELLOW, EW\_YELLOW, ALL\_RED.

**Movements released by each phase.** Right turns run with the through movement on the same road. Yellow and all-red release nothing, and vehicles pass only on green.

- NS\_THROUGH: N\_THROUGH, N\_RIGHT, S\_THROUGH, S\_RIGHT
- NS\_LEFT: N\_LEFT, S\_LEFT
- EW\_THROUGH: E\_THROUGH, E\_RIGHT, W\_THROUGH, W\_RIGHT
- EW\_LEFT: E\_LEFT, W\_LEFT

**How signal timing works**

- Every phase runs on a plan. `SignalController` owns the current phase, the seconds spent in it and its planned duration. Seconds remaining is the planned duration minus the seconds spent, and that is the `phaseSecondsRemaining` in `TrafficState`.
- A green starts with its default length from `Config` (20 seconds for through phases, 10 for left phases). Yellow is 3 seconds and all-red is 1 second.
- When a phase's plan runs out, the phase ends by itself: a green goes to the yellow of its own road axis, a yellow goes to ALL\_RED, and ALL\_RED goes to the pending next green. Because plans always run out, no phase can overrun, and the maximum green is enforced by never letting a plan exceed it.
- Each green's default next green is its successor in the fixed order NS\_THROUGH, NS\_LEFT, EW\_THROUGH, EW\_LEFT, then back to NS\_THROUGH. A Transition can name a different next green for that one change, but never the green that is ending. Once that green has run, its own default successor applies.
- The controller makes a decision once per second, only while a green is active. Hold keeps the plan. Extend(n) adds n seconds to the plan, never past the maximum green. Transition ends the green now (not before the minimum green) and may name a different next green. Yellow and all-red ignore decisions.
- `Decision` (a type of Hold, Extend or Transition, the seconds to add for Extend, and an optional next green for Transition) is defined in `core/Types.hpp`, so `signal/` and `control/` both depend only on `core/`.
- Fixed timing is simply the default plan, so `FixedTimingController` always returns Hold. The adaptive controller in Milestone 3 steers by extending or cutting short a plan and by choosing the next green.
- `SafetyRules` reviews every decision. An illegal one is rejected with a reason and treated as Hold, which is always legal because plans expire on their own. If an automatic phase change ever fails the safety check, that is a bug: the program stops with a clear error and never treats it as Hold.

**Decided values** (all of them live in `core/Config.hpp`):

- Yellow 3 seconds, all-red 1 second
- Minimum green 10 seconds, maximum green 45 seconds
- Fixed green length: 20 seconds for through phases, 10 seconds for left phases
- Arrival rates, in cars per second per movement: 0.10 through, 0.04 left, 0.05 right
- Departure rate: 0.5 cars per second per movement while green
- A random seed

`Config` is a struct whose members default to these values (for example `int yellowSeconds = 3;`). Components receive a `Config` (or the values they need) rather than reading globals, so tests can build a modified or invalid `Config` and `main` can override the seed.

**Data structures**

```cpp
struct MovementState {
    int queue;
    double averageWait;
    int vehiclesPassed;
};

struct TrafficState {
    int time;
    SignalPhase phase;
    int phaseSecondsRemaining;  // seconds until the signal changes
    MovementState movements[12];
};

// Internal view of the signal, passed to controllers (not sent to the dashboard)
struct SignalStatus {
    SignalPhase phase;
    int secondsInPhase;
    int secondsRemaining;
    int plannedDuration;
};

// Not used in Milestone 1
struct Prediction {
    double predictedArrivals[12];  // expected total cars over the horizon
    int horizonSeconds;            // 30
};
```

**Conventions**

- **Clock.** `time` is the number of seconds simulated so far, starting at 0. `step()` simulates second `time` and then adds 1 to it; everything inside the step (arrivals, departures, waits) uses the second being simulated. A phase change at the end of a step is stamped with the new `time`, which is the second the new phase starts, so NS\_THROUGH covers seconds 0 to 19 and its change is stamped 20. `TrafficState.time` and the console lines use the new `time`.
- Queues are first in, first out. Each waiting car is stored as its arrival second.
- A car that arrives and leaves in the same second has waited 0 seconds. A car's wait is its departure second minus its arrival second.
- `averageWait` for a movement is the mean of (the second just simulated minus arrival second) over the cars still in its queue after that second's departures, so a car that has just arrived counts as 0. An empty queue gives 0.
- Departures use a credit accumulator: while a green movement has cars waiting, it earns credit at the departure rate (0.5 per second) and one car leaves each time the credit reaches 1. Credit resets to 0 whenever the movement is not green or its queue is empty.
- Arrivals and departures are tracked per movement as running totals inside `Intersection` (with getters), not in `TrafficState`. `vehiclesPassed` equals total departures.
- Console output uses the plain ASCII arrow `->` so it prints correctly on any console.

**File layout.** Its files may already exist as empty stubs. `.hpp/.cpp` means a header/source pair; everything in `core/` and `control/IController.hpp` is header-only.

```
green-light-engine/
├── CMakeLists.txt
├── README.md
├── src/
│   ├── main.cpp                  # entry point: builds the sim, runs the 1s loop
│   ├── core/
│   │   ├── Types.hpp             # Movement enum (12), SignalPhase enum, Decision
│   │   ├── TrafficState.hpp      # MovementState, TrafficState, SignalStatus
│   │   ├── Prediction.hpp        # Prediction struct
│   │   └── Config.hpp            # min/max green, yellow, all-red, arrival rates
│   ├── sim/
│   │   ├── Simulator.hpp/.cpp    # per-second tick loop, owns the clock
│   │   ├── Intersection.hpp/.cpp # 12 queues: arrivals, departures, wait times
│   │   └── ArrivalGenerator.hpp/.cpp  # fake random arrivals
│   ├── signal/
│   │   ├── PhaseMap.hpp/.cpp     # which movements are green in each phase
│   │   ├── SafetyRules.hpp/.cpp  # min/max green, yellow, all-red, no conflicts
│   │   └── SignalController.hpp/.cpp  # phase state machine + timers
│   ├── io/
│   │   ├── ConsoleLogger.hpp/.cpp     # per-second line + signal-change lines
│   │   ├── Serializer.hpp/.cpp        # TrafficState <-> JSON (later)
│   │   └── SocketServer.hpp/.cpp      # socket to the Python service (later)
│   └── control/
│       ├── IController.hpp       # interface: pick hold / extend / transition
│       ├── FixedTimingController.hpp/.cpp  # now: fixed schedule
│       └── PredictiveController.hpp/.cpp   # later: uses the ML Prediction
└── tests/
    ├── test_intersection.cpp         # Stage 2: queues, departures, wait times
    ├── test_arrival_generator.cpp    # Stage 3: seeding and arrival rates
    ├── test_signal_controller.cpp    # Stage 4: fixed schedule, Extend, Transition
    ├── test_safety_rules.cpp         # Stage 5: conflicting greens, min/max green, clearances
    └── test_simulator.cpp            # Stage 6: full-run invariants
```

**Console output** (built in Stage 7): one line per simulated second, plus a line for every signal change. The numbers below are illustrative; the format is exact.

```
TIME 40s | EW_THROUGH | NS Queue: 14 | EW Queue: 9 | Avg Wait: 6.2s | Passed: 31
[58s] SIGNAL: EW_THROUGH -> EW_YELLOW
```

**Not part of Milestone 1.** Sockets, JSON, the Python service, the dashboard, `Prediction` handling and `PredictiveController`. The files for these (`Serializer`, `SocketServer`, `Prediction.hpp`, `PredictiveController`) may exist as empty stubs; leave them empty.

## Stage 0: Verify the repo

The repository already exists and Claude Code has read it, so this stage checks the layout before any code is written.

1. **Export this document** as Markdown and save it in the repo as `docs/PLAN.md`. It is self-contained, so it is the only file the implementing agent needs. Re-export it whenever you change the plan.
2. **Create `CLAUDE.md`** at the repo root with one instruction: read `docs/PLAN.md` first and follow its ground rules. Claude Code reads `CLAUDE.md` automatically at the start of every session.
3. **Run the layout check** below. Claude Code reports; it changes nothing.
4. **Review its report**, fix anything missing or misplaced, and commit.

**Prompt for Claude Code: layout check**

```
Read CLAUDE.md and docs/PLAN.md. The Project briefing in docs/PLAN.md lists the file layout. Check the repository against that layout and report only. Change nothing.
1. List every file and folder in the layout and mark each as present, missing or misplaced.
2. For every .hpp/.cpp pair, confirm both files exist with matching names. Header-only by design: everything in core/ and control/IController.hpp.
3. List anything in the repo that the layout does not mention.
4. Confirm CMakeLists.txt is at the repo root and that tests/ has the test files listed in the layout (they may be missing or empty until their stage).
5. Say whether each existing file is an empty stub or already contains code.
Give me a table, then a list of the fixes you would make. Wait for my approval before changing anything.
```

**Review checklist**

- The report matches what you see in the folders yourself.
- Every name matches the Project briefing exactly, including capitalization (`SafetyRules`, not `Safety_Rules`).
- Every `.hpp/.cpp` pair has both files. The header-only files are everything in `core/` and `control/IController.hpp`.
- Nothing is in the wrong folder, and there are no stray files. Build output belongs in `build/`, which should be in `.gitignore`.
- Existing files are empty stubs, or you know what code they already contain.

**Commit message:** Add project layout

**Ground rules** (the implementing agent follows these at all times)

- This is the Green Light C++ engine. Read all of `docs/PLAN.md` before doing anything; it is the single source of truth.
- Use C++17 and CMake. Standard library only in Milestone 1: no JSON or socket libraries yet.
- Compile with `-Wall -Wextra -Wpedantic` and keep the build free of warnings.
- Follow the file layout in the Project briefing. Its files may already exist as empty stubs; only fill in the files for the current stage. Any stage may also edit `CMakeLists.txt` to add its source files and register its test with CTest.
- Dependencies run one way: `core/` includes nothing from the other folders; `signal/` and `control/` include only `core/` (and `signal/` never includes `control/`); `sim/` and `io/` may include the others.
- Every tunable number lives in `core/Config.hpp`. No magic numbers anywhere else.
- Randomness always uses a seeded generator. Never use `rand()` or a clock-based seed.
- Index movements with the Movement enum, never with raw numbers.
- Keep the code simple, and comment anything non-obvious. The owner (Sanjit) must understand and extend all of it.
- Never implement work from a later stage or a later milestone.
- Never weaken or delete a failing test to make it pass. Explain the failure first.
- At the end of each stage, stop and report: files changed, assumptions made that this plan does not cover, and how to run the test.

## Reviewing Claude Code's work

- Read the diff, not just the summary.
- Ask at the end of every stage: what assumptions did you make that are not in this plan? Write the answers down; they may belong in this plan.
- Watch for scope creep: sockets, threads, JSON, extra classes, or files from a later stage.
- Watch for weakened tests. If a test fails, ask why before anything gets changed.
- If a piece of code is clever or hard to follow, ask for a simpler version. You will extend all of this in Milestones 2 and 3.
- For extra safety on the bigger stages, open a fresh Claude Code session and ask it to review the diff against the spec.
- Commit after every passing stage so you can roll back.

## Stage 1: Skeleton and core types

**Goal:** A project that builds and runs, with every shared type and constant defined.

**Files:** `CMakeLists.txt`, `README.md`, `src/main.cpp`, `src/core/Types.hpp`, `src/core/TrafficState.hpp`, `src/core/Config.hpp`

**Prompt for Claude Code**

```
Read CLAUDE.md and docs/PLAN.md. Do Stage 1 only: the CMake skeleton and core types.
Fill in these files (some may already exist as empty stubs): CMakeLists.txt, README.md, src/main.cpp, src/core/Types.hpp, src/core/TrafficState.hpp, src/core/Config.hpp.
- Types.hpp: an enum Movement with the 12 movements in the order given in the Project briefing; an enum SignalPhase with the 7 phases; the Decision type (a type of Hold, Extend or Transition, the seconds to add for Extend, and an optional next green for Transition); functions that convert the enums to strings.
- TrafficState.hpp: MovementState, TrafficState and SignalStatus exactly as in the Project briefing's data structures, including phaseSecondsRemaining.
- Config.hpp: a struct Config whose members default to every tunable number from the Project briefing's decided values: yellow, all-red, minimum green, maximum green, through green, left green, the three arrival rates, the departure rate, and a random seed. It is a struct, not constexpr globals, so later stages can pass modified copies.
- CMake must be ready to add test executables with CTest in later stages.
- main.cpp just prints the 12 movement names and the config values.
Give me a short plan first. Do not touch any other files.
```

**Test**

- Build from scratch (`cmake` then `cmake --build`) with no warnings.
- Run the program and read its output.

**Review checklist**

- The 12 movements are in the right order and the names match the names in the Project briefing.
- There are exactly 7 phases.
- `Config.hpp` has every number above, each with a comment saying what it is.
- `TrafficState` includes `phaseSecondsRemaining`.
- CMake sets C++17 and the warning flags.
- No extra files were created.

**Commit message:** Add project skeleton and core types

## Stage 2: Intersection (queues, departures, waits)

**Goal:** The 12 queues work correctly on their own, with no lights and no randomness involved.

**Files:** `src/sim/Intersection.hpp/.cpp`, `tests/test_intersection.cpp`

**Decided:** `averageWait` is the average time the cars currently waiting have waited, with 0 for an empty queue. The other conventions (first in first out, same-second arrivals and departures, the departure credit, running totals) are in the Project briefing.

**Prompt for Claude Code**

```
Do Stage 2 only: sim/Intersection.hpp/.cpp and tests/test_intersection.cpp, registered with CTest.
Follow the Conventions in the Project briefing. Intersection owns the 12 queues.
- Each waiting car is stored as its arrival second, and queues are first in, first out.
- addArrivals(time, counts[12]) adds cars to the queues.
- processDepartures(time, greenMovements) lets cars leave only from the movements given as green, using the credit accumulator from the Conventions: while a green movement has cars waiting, it earns credit at the departure rate and one car leaves each time credit reaches 1; credit resets to 0 whenever the movement is not green or its queue is empty. The departure rate is passed in (from Config), so tests can change it.
- averageWait(movement, time) follows the Conventions.
- Running totals of arrivals and departures for each movement, with getters. These are internal and are not part of TrafficState.
- snapshot(TrafficState&, simulatedSecond) fills queue, averageWait and vehiclesPassed for all 12 movements, where vehiclesPassed equals the departure total. averageWait uses simulatedSecond (the second just simulated), not TrafficState.time, which is already the next second.
No randomness in this class. Give me a short plan first.
Tests must cover: initial queue plus total arrived minus total departed equals the queue for every movement; queues never go negative; 20 green seconds with a long queue release exactly 10 cars; credit does not pile up on an empty queue (after 10 empty green seconds, adding 5 cars must not release them all at once); credit does not carry over a red period (after a green that ends with half a credit left, a long red, then a new green, the first car leaves after 2 green seconds, not 1); a car that waits 10 seconds gives an averageWait of 10; waits keep growing on red movements; with the departure rate set to 1.0, a car arriving into an empty queue on green leaves in the same second with a wait of 0.
```

**Test:** run `ctest` and read the output; all tests should pass.

**Review checklist**

- Cars are stored with arrival times, and the wait math matches the convention Claude Code stated.
- Read the credit accumulator line by line. It is the trickiest logic in this stage.
- Cars can only leave movements that were passed in as green.
- `vehiclesPassed` only ever goes up.
- All rates come from `Config`, and there is no randomness here.
- `snapshot` only reads; it never changes the queues.

**Commit message:** Add Intersection with queues, departures and waits

## Stage 3: ArrivalGenerator

**Goal:** Reproducible fake traffic at the rates you chose.

**Files:** `src/sim/ArrivalGenerator.hpp/.cpp`, a test for it

**Prompt for Claude Code**

```
Do Stage 3 only: sim/ArrivalGenerator.hpp/.cpp and tests/test_arrival_generator.cpp, registered with CTest.
Each simulated second, for each of the 12 movements, roll once: a car arrives with probability equal to that movement's rate in Config (0.10 through, 0.04 left, 0.05 right). Return the arrivals for the second as 12 counts.
Use std::mt19937 seeded from Config, never rand() or the clock, so the same seed always gives the same traffic.
Give me a short plan first. Tests: the same seed gives identical output; different seeds differ; over 100,000 seconds each movement's observed rate is within 0.005 of its configured rate.
```

**Test:** run `ctest`.

**Review checklist**

- The generator is seeded from `Config`.
- The rates come from `Config`, and through, left and right each use the right one.
- Output is indexed with the Movement enum.
- No global state and no `rand()`.

**Commit message:** Add seeded ArrivalGenerator

## Stage 4: Signals and fixed timing

**Goal:** The lights cycle through the full 76-second fixed schedule.

**Files:** `src/signal/PhaseMap.hpp/.cpp`, `src/signal/SignalController.hpp/.cpp`, `src/control/IController.hpp`, `src/control/FixedTimingController.hpp/.cpp`

**Prompt for Claude Code**

```
Do Stage 4 only: signal/PhaseMap, signal/SignalController, control/IController, control/FixedTimingController.
- PhaseMap: which movements are green in each phase (the table in the Project briefing). Yellow and all-red release nothing.
- SignalController owns the current phase, secondsInPhase, plannedDuration and the pending next green. Every phase runs on a plan: a green starts with its default length from Config (20s through, 10s left), yellow is 3s and all-red is 1s. Seconds remaining = plannedDuration - secondsInPhase. tick() advances one second, and when the plan runs out the phase ends by itself: a green goes to the yellow of its own road axis, a yellow goes to ALL_RED, and ALL_RED goes to the pending next green. Each green's default next green is its successor in the fixed order NS_THROUGH, NS_LEFT, EW_THROUGH, EW_LEFT, then back to NS_THROUGH.
- SignalController.applyDecision() carries out a Decision, but only during a green: Hold changes nothing; Extend(n) adds n seconds to the plan; Transition ends the green now and may name a different next green, but never the green that is ending. That choice applies to that one change only, and the green that then runs uses its own default successor. Yellow and all-red ignore decisions. Nothing outside SignalController can set the phase directly.
- SignalController reports each phase change stamped with the second the new phase starts (see the Clock convention in the Project briefing).
- SignalStatus and Decision are defined in Stage 1, in core/. SignalController can report a SignalStatus.
- IController: decide(const TrafficState&, const SignalStatus&) returns a Decision.
- FixedTimingController: always returns Hold. The fixed schedule is simply the default plan.
Give me a short plan first. Add tests in tests/test_signal_controller.cpp, registered with CTest, that: run two full cycles and check the exact transition seconds; show that Extend delays a transition; show that an early Transition brings it forward; and show that a Transition naming a different next green runs that green next, with the green after it following its own default successor. SafetyRules comes in Stage 5, so these tests apply decisions without safety checks.
```

**Expected transitions** (starting in NS\_THROUGH at second 0):

- 20: NS\_THROUGH → NS\_YELLOW
- 23: NS\_YELLOW → ALL\_RED
- 24: ALL\_RED → NS\_LEFT
- 34: NS\_LEFT → NS\_YELLOW
- 37: NS\_YELLOW → ALL\_RED
- 38: ALL\_RED → EW\_THROUGH
- 58: EW\_THROUGH → EW\_YELLOW
- 61: EW\_YELLOW → ALL\_RED
- 62: ALL\_RED → EW\_LEFT
- 72: EW\_LEFT → EW\_YELLOW
- 75: EW\_YELLOW → ALL\_RED
- 76: ALL\_RED → NS\_THROUGH, and the cycle repeats from there

**Test:** run `ctest`, and compare the test's transition list with the one above.

**Review checklist**

- The `PhaseMap` table matches the Project briefing exactly, with right turns riding the through phase.
- In no phase are NS and EW movements green together.
- Every phase has a plan, and plans expire on their own: a green goes to its own yellow, a yellow to ALL\_RED, ALL\_RED to the pending next green.
- The default next green is the successor of the green that just ran, and an override affects one change only.
- `SignalController` has no public way to set the phase directly.
- `FixedTimingController` always returns Hold; the schedule lives in `Config` and `SignalController`.
- `IController` is a pure interface that receives `TrafficState` and `SignalStatus`; `Decision` and `SignalStatus` live in `core/`.
- The transition seconds match the list above, stamped with the second the new phase starts.

**Commit message:** Add PhaseMap, SignalController and fixed-timing controller

## Stage 5: SafetyRules

**Goal:** No decision, from any controller, can produce an unsafe signal.

**Files:** `src/signal/SafetyRules.hpp/.cpp`, `tests/test_safety_rules.cpp`, plus wiring into `SignalController`

**Prompt for Claude Code**

```
Do Stage 5 only: signal/SafetyRules and tests/test_safety_rules.cpp.
SafetyRules reviews every Decision before SignalController applies it, and returns accept or reject with a reason. A rejected decision is treated as Hold, which is always legal because every phase has a plan that runs out by itself. SafetyRules also checks every phase change SignalController makes, automatic ones included, for the legal order.
Rules:
- Transition is rejected before the minimum green time (10s) has passed.
- Extend is rejected if it would push the plan past the maximum green (45s), so a green can never run longer than the maximum.
- A Transition may only name a green phase as the next green, and never the green that is ending. Controllers never choose yellow or all-red.
- A green always ends in the yellow of its own road axis, a yellow lasts exactly 3s and goes to ALL_RED, ALL_RED lasts exactly 1s and goes to a green, and a green never goes straight to another green.
- No phase may release conflicting movements. NS and EW movements are never green together, and a left turn never runs with the opposing through movement.
- At startup Config is validated: each default green length must be between the minimum and maximum green, and yellow and all-red must be positive. If not, the program refuses to start and prints a clear message.
- If SafetyRules ever rejects an automatic phase change, that is a bug, not a decision. Throw a clear error naming the change and the rule; main catches it, prints it and exits with a non-zero code. Never treat it as Hold.
All the rules live in this one class. Wire SignalController so it applies a decision only after SafetyRules approves it.
Give me a short plan first. Tests: each rule has a case that must be rejected and a case that must be accepted; every phase in PhaseMap is conflict-free; a bad Config is refused; SafetyRules' phase-change check raises the error when called directly with an illegal change (for example NS_THROUGH -> EW_THROUGH), with no test-only hooks added to SignalController; and a seeded fuzz test feeds random decisions (including illegal ones) for 10,000 seconds and asserts that every green lasts between 10 and 45 seconds, every yellow exactly 3, every all-red exactly 1, the phase order is always green, own yellow, ALL_RED, green, and no conflicting movements are ever green together.
```

**Test:** run `ctest`.

**Review checklist**

- All the rules live in `SafetyRules`, not copied into other classes.
- Rejections come with a clear reason, and a rejected decision acts as Hold.
- There is no way around the check: `SignalController` cannot change phase without it.
- Nothing can hold a phase past its plan. Confirm that plans always expire and that a plan can never exceed the maximum green.
- A failed check on an automatic phase change stops the program with a clear error; it is never treated as Hold.
- The fuzz test is seeded, so a failure can be reproduced, and it includes illegal decisions.
- Each rule has both an accept test and a reject test, and the bad-`Config` test exists.

**Commit message:** Add SafetyRules and fuzz tests

## Stage 6: Simulator

**Goal:** Everything runs together, one simulated second at a time, in the order the spec defines.

**Files:** `src/sim/Simulator.hpp/.cpp`, a test for it

**Prompt for Claude Code**

```
Do Stage 6 only: sim/Simulator.hpp/.cpp and tests/test_simulator.cpp, registered with CTest.
Follow the Conventions in the Project briefing, especially the Clock. Simulator wires together Intersection, ArrivalGenerator, SignalController, SafetyRules and the controller. step() runs one simulated second in exactly this order:
1. Generate arrivals
2. Add them to the queues
3. Let vehicles on green movements pass (using the current phase)
4. Update queues and wait times
5. Update the signal timer: SignalController advances one second
6. Change the signal if necessary: if the plan has run out, the phase ends by itself; otherwise, during a green, the controller decides, SafetyRules reviews the decision and SignalController applies it
7. Update TrafficState (time, phase, phaseSecondsRemaining, all 12 movements)
step() reports any signal change that happened. The Simulator prints nothing. The constructor fills in the initial TrafficState (time 0, NS_THROUGH, its full plan remaining, empty queues), so the state is valid before the first step().
Give me a short plan first. Tests: run 3600 simulated seconds with no printing and assert: for every movement, initial queue plus total arrived minus total departed equals its queue (use Intersection's running totals); no queue is ever negative; vehiclesPassed never decreases; time goes up by exactly 1 each step; phaseSecondsRemaining is never negative and matches the plan; cars only leave movements that are green; signal changes are stamped with the new time and, over the first two cycles, land on exactly the transition seconds listed in Stage 4; two runs with the same seed end in identical states.
```

**Test:** run `ctest`. Also have the test report the largest queue seen for each movement. If those numbers keep climbing over a long run, the arrival and departure rates are mismatched.

**Review checklist**

- The seven steps happen in exactly the order given in the prompt.
- Time advances in one place only.
- `Simulator` does not repeat logic that belongs to `Intersection` or `SignalController`.
- `TrafficState` is built from those pieces, not tracked separately.
- `phaseSecondsRemaining` matches the plan and is never negative.
- Nothing is printed.

**Commit message:** Add Simulator

## Stage 7: Console output and final run

**Goal:** The program prints what the Project briefing asks for, and passes the Milestone 1 definition of done.

**Files:** `src/io/ConsoleLogger.hpp/.cpp`, the final `src/main.cpp`, an updated `README.md`

**Prompt for Claude Code**

```
Do Stage 7 only: io/ConsoleLogger.hpp/.cpp and the final main.cpp.
- One line per simulated second, using the new time from the Clock convention. Format (numbers illustrative): TIME 40s | EW_THROUGH | NS Queue: 14 | EW Queue: 9 | Avg Wait: 6.2s | Passed: 31
  NS Queue is the sum of the N_ and S_ movements, EW Queue the sum of the E_ and W_ movements, Avg Wait the average over all waiting cars, and Passed the total so far.
- One extra line for every signal change, stamped with the second the new phase starts: [58s] SIGNAL: EW_THROUGH -> EW_YELLOW
  Use the plain ASCII arrow -> so it prints correctly on any console.
- main validates Config through SafetyRules before starting, and refuses to run with a clear message if it is invalid.
- main runs the simulator for a number of seconds given on the command line (default 120), with an optional seed argument.
- Update README.md with how to build, run and test.
Give me a short plan first.
```

**Test: experiments to run yourself**

1. Run it. Check the line format against the console example in the Project briefing, and that every signal-change line lands on the transition seconds listed in Stage 4.
2. Set all arrival rates in `Config.hpp` to 0. Queues should drain to 0 and `Passed` should stop growing.
3. Set the through-movement arrival rates to 0.5. Queues should grow steadily, which shows the numbers are calculated and not scripted.
4. Change the through green length from 20 to 15 seconds. The transitions should shift to match.
5. Change the seed. The traffic should differ, but the safety behavior should not.
6. Set the minimum green above a default green length. The program should refuse to start and print a clear message about the setting.

**Definition of done** (tick each one off)

- The program builds from scratch with CMake and runs.
- It prints one status line per simulated second, plus a line for every signal change.
- Queues, wait times and vehicles passed are calculated from the simulation, not scripted.
- Two conflicting directions are never green at the same time.
- Every green respects the minimum and maximum green time.
- Every phase change goes through yellow and then all-red.
- A full TrafficState with all 12 movements is up to date every second.

**Commit message:** Add console output and finish Milestone 1

## After Milestone 1

- Mark Milestone 1 as done in the milestones doc and add a progress log entry.
- Tag the commit (for example `v0.1`).
- Milestone 2 starts with sign-off on the JSON contract from the Python and dashboard teammates.
