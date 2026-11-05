// Stage 4 tests: PhaseMap, SignalController and FixedTimingController.
// SafetyRules arrives in Stage 5, so decisions here are applied unchecked.
// Standard library only: CHECK prints each failure and the program returns
// non-zero if anything failed, which CTest reports as a failed test.

#include <array>
#include <initializer_list>
#include <iostream>
#include <map>
#include <optional>
#include <utility>
#include <vector>

#include "control/FixedTimingController.hpp"
#include "control/IController.hpp"
#include "core/Config.hpp"
#include "core/TrafficState.hpp"
#include "core/Types.hpp"
#include "signal/PhaseMap.hpp"
#include "signal/SignalController.hpp"

namespace {

int failures = 0;

#define CHECK(cond)                                                           \
    do {                                                                      \
        if (!(cond)) {                                                        \
            std::cerr << __FILE__ << ":" << __LINE__ << ": CHECK failed: "    \
                      << #cond << "\n";                                       \
            ++failures;                                                       \
        }                                                                     \
    } while (0)

using P = SignalPhase;

struct Expected {
    int at;
    SignalPhase from;
    SignalPhase to;
};

// Returns scripted decisions at given times (TrafficState::time), Hold otherwise.
class ScriptedController : public IController {
public:
    explicit ScriptedController(std::map<int, Decision> script) : script_(std::move(script)) {}

    Decision decide(const TrafficState& traffic, const SignalStatus& /*signal*/) override {
        auto it = script_.find(traffic.time);
        return it == script_.end() ? Decision::hold() : it->second;
    }

private:
    std::map<int, Decision> script_;
};

// Runs `seconds` steps the way the Simulator will: the signal advances one
// second; if that did not change the phase and a green is showing, the
// controller decides and the decision is applied. `now` is the second the
// next phase would start (the Clock convention). Also checks that
// secondsRemaining == plannedDuration - secondsInPhase after every step.
std::vector<PhaseChange> run(SignalController& sc, IController& controller, int seconds) {
    std::vector<PhaseChange> changes;
    for (int t = 0; t < seconds; ++t) {
        const int now = t + 1;
        std::optional<PhaseChange> change = sc.tick(now);
        if (!change && isGreen(sc.phase())) {
            TrafficState traffic;
            traffic.time = now;
            change = sc.applyDecision(controller.decide(traffic, sc.status()), now);
        }
        if (change) {
            changes.push_back(*change);
        }

        const SignalStatus s = sc.status();
        CHECK(s.secondsRemaining == s.plannedDuration - s.secondsInPhase);
        CHECK(s.secondsRemaining >= 0);
    }
    return changes;
}

// Compares the first expected.size() changes, printing any mismatch.
void checkChanges(const std::vector<PhaseChange>& actual, const std::vector<Expected>& expected) {
    CHECK(actual.size() >= expected.size());
    for (std::size_t i = 0; i < expected.size() && i < actual.size(); ++i) {
        const PhaseChange& a = actual[i];
        const Expected& e = expected[i];
        if (a.atSecond != e.at || a.from != e.from || a.to != e.to) {
            std::cerr << "  change " << i << ": got " << a.atSecond << ": " << toString(a.from)
                      << " -> " << toString(a.to) << ", expected " << e.at << ": "
                      << toString(e.from) << " -> " << toString(e.to) << "\n";
            ++failures;
        }
    }
}

// The plan's expected transitions for one fixed cycle, shifted by `offset` seconds.
std::vector<Expected> fixedCycle(int offset) {
    return {
        {20 + offset, P::NS_THROUGH, P::NS_YELLOW},
        {23 + offset, P::NS_YELLOW, P::ALL_RED},
        {24 + offset, P::ALL_RED, P::NS_LEFT},
        {34 + offset, P::NS_LEFT, P::NS_YELLOW},
        {37 + offset, P::NS_YELLOW, P::ALL_RED},
        {38 + offset, P::ALL_RED, P::EW_THROUGH},
        {58 + offset, P::EW_THROUGH, P::EW_YELLOW},
        {61 + offset, P::EW_YELLOW, P::ALL_RED},
        {62 + offset, P::ALL_RED, P::EW_LEFT},
        {72 + offset, P::EW_LEFT, P::EW_YELLOW},
        {75 + offset, P::EW_YELLOW, P::ALL_RED},
        {76 + offset, P::ALL_RED, P::NS_THROUGH},
    };
}

// Two full fixed cycles land on exactly the plan's transition seconds.
void testTwoFixedCycles() {
    SignalController sc{Config{}};
    FixedTimingController fixed;
    const auto changes = run(sc, fixed, 2 * 76);

    std::vector<Expected> expected = fixedCycle(0);
    const std::vector<Expected> second = fixedCycle(76);
    expected.insert(expected.end(), second.begin(), second.end());

    CHECK(changes.size() == expected.size());
    checkChanges(changes, expected);
}

// FixedTimingController always holds.
void testFixedControllerAlwaysHolds() {
    FixedTimingController fixed;
    TrafficState traffic;
    SignalStatus signal;
    for (int t = 0; t < 100; ++t) {
        traffic.time = t;
        CHECK(fixed.decide(traffic, signal).type == DecisionType::Hold);
    }
}

// Extend(5) during NS_THROUGH delays its end from 20 to 25, and the rest
// of the cycle shifts by 5.
void testExtendDelaysTransition() {
    SignalController sc{Config{}};
    ScriptedController ctl({{5, Decision::extend(5)}});
    const auto changes = run(sc, ctl, 76 + 5);
    checkChanges(changes, fixedCycle(5));
}

// A Transition with NS_THROUGH at 12 seconds ends it at 12, not 20.
void testEarlyTransition() {
    SignalController sc{Config{}};
    ScriptedController ctl({{12, Decision::transition()}});
    const auto changes = run(sc, ctl, 20);
    checkChanges(changes, {
        {12, P::NS_THROUGH, P::NS_YELLOW},
        {15, P::NS_YELLOW, P::ALL_RED},
        {16, P::ALL_RED, P::NS_LEFT},
    });
}

// Transition(EW_THROUGH) from NS_THROUGH runs EW_THROUGH next, and the
// green after it follows EW_THROUGH's own default successor (EW_LEFT).
void testTransitionNamesNextGreen() {
    SignalController sc{Config{}};
    ScriptedController ctl({{12, Decision::transition(P::EW_THROUGH)}});
    const auto changes = run(sc, ctl, 45);
    checkChanges(changes, {
        {12, P::NS_THROUGH, P::NS_YELLOW},
        {15, P::NS_YELLOW, P::ALL_RED},
        {16, P::ALL_RED, P::EW_THROUGH},
        {36, P::EW_THROUGH, P::EW_YELLOW},
        {39, P::EW_YELLOW, P::ALL_RED},
        {40, P::ALL_RED, P::EW_LEFT},
    });
}

// Yellow and ALL_RED ignore decisions.
void testClearancesIgnoreDecisions() {
    SignalController sc{Config{}};
    for (int now = 1; now <= 20; ++now) {
        sc.tick(now);
    }
    CHECK(sc.phase() == P::NS_YELLOW);
    const SignalStatus before = sc.status();

    CHECK(!sc.applyDecision(Decision::transition(P::EW_THROUGH), 20));
    CHECK(!sc.applyDecision(Decision::extend(10), 20));
    const SignalStatus after = sc.status();
    CHECK(after.phase == before.phase);
    CHECK(after.plannedDuration == before.plannedDuration);
    CHECK(after.secondsInPhase == before.secondsInPhase);

    for (int now = 21; now <= 23; ++now) {
        sc.tick(now);
    }
    CHECK(sc.phase() == P::ALL_RED);
    CHECK(!sc.applyDecision(Decision::transition(P::EW_THROUGH), 23));
    CHECK(sc.status().plannedDuration == Config{}.allRedSeconds);

    // The ignored Transition did not change the pending green: NS_LEFT follows.
    sc.tick(24);
    CHECK(sc.phase() == P::NS_LEFT);
}

// PhaseMap matches the Project briefing's table exactly.
void testPhaseMapTable() {
    auto expect = [](std::initializer_list<Movement> ms) {
        std::array<bool, kMovementCount> g{};
        for (Movement m : ms) g[toIndex(m)] = true;
        return g;
    };
    using M = Movement;
    CHECK(greenMovements(P::NS_THROUGH) ==
          expect({M::N_THROUGH, M::N_RIGHT, M::S_THROUGH, M::S_RIGHT}));
    CHECK(greenMovements(P::NS_LEFT) == expect({M::N_LEFT, M::S_LEFT}));
    CHECK(greenMovements(P::EW_THROUGH) ==
          expect({M::E_THROUGH, M::E_RIGHT, M::W_THROUGH, M::W_RIGHT}));
    CHECK(greenMovements(P::EW_LEFT) == expect({M::E_LEFT, M::W_LEFT}));
    CHECK(greenMovements(P::NS_YELLOW) == expect({}));
    CHECK(greenMovements(P::EW_YELLOW) == expect({}));
    CHECK(greenMovements(P::ALL_RED) == expect({}));
}

// No phase releases NS and EW movements together.
void testNoPhaseMixesAxes() {
    const P phases[] = {P::NS_THROUGH, P::NS_LEFT, P::EW_THROUGH, P::EW_LEFT,
                        P::NS_YELLOW, P::EW_YELLOW, P::ALL_RED};
    for (P p : phases) {
        bool anyNS = false;
        bool anyEW = false;
        const auto g = greenMovements(p);
        for (Movement m : kAllMovements) {
            if (!g[toIndex(m)]) continue;
            const char road = toString(m)[0];  // 'N', 'S', 'E' or 'W'
            if (road == 'N' || road == 'S') anyNS = true;
            if (road == 'E' || road == 'W') anyEW = true;
        }
        CHECK(!(anyNS && anyEW));
    }
}

// The phase-order helpers.
void testPhaseOrderHelpers() {
    CHECK(isGreen(P::NS_THROUGH) && isGreen(P::NS_LEFT));
    CHECK(isGreen(P::EW_THROUGH) && isGreen(P::EW_LEFT));
    CHECK(!isGreen(P::NS_YELLOW) && !isGreen(P::EW_YELLOW) && !isGreen(P::ALL_RED));

    CHECK(yellowFor(P::NS_THROUGH) == P::NS_YELLOW);
    CHECK(yellowFor(P::NS_LEFT) == P::NS_YELLOW);
    CHECK(yellowFor(P::EW_THROUGH) == P::EW_YELLOW);
    CHECK(yellowFor(P::EW_LEFT) == P::EW_YELLOW);

    CHECK(defaultNextGreen(P::NS_THROUGH) == P::NS_LEFT);
    CHECK(defaultNextGreen(P::NS_LEFT) == P::EW_THROUGH);
    CHECK(defaultNextGreen(P::EW_THROUGH) == P::EW_LEFT);
    CHECK(defaultNextGreen(P::EW_LEFT) == P::NS_THROUGH);
}

}  // namespace

int main() {
    testTwoFixedCycles();
    testFixedControllerAlwaysHolds();
    testExtendDelaysTransition();
    testEarlyTransition();
    testTransitionNamesNextGreen();
    testClearancesIgnoreDecisions();
    testPhaseMapTable();
    testNoPhaseMixesAxes();
    testPhaseOrderHelpers();

    if (failures == 0) {
        std::cout << "test_signal_controller: all checks passed\n";
        return 0;
    }
    std::cerr << "test_signal_controller: " << failures << " check(s) failed\n";
    return 1;
}
