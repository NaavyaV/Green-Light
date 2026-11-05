// Stage 6 tests: the Simulator running everything together.
// Standard library only: CHECK prints each failure and the program returns
// non-zero if anything failed, which CTest reports as a failed test.

#include <array>
#include <iostream>
#include <vector>

#include "control/FixedTimingController.hpp"
#include "control/IController.hpp"
#include "core/Config.hpp"
#include "core/TrafficState.hpp"
#include "core/Types.hpp"
#include "signal/PhaseMap.hpp"
#include "sim/Simulator.hpp"

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

// The Stage 4 transition list for one fixed cycle, shifted by `offset` seconds.
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

bool sameState(const TrafficState& a, const TrafficState& b) {
    if (a.time != b.time || a.phase != b.phase ||
        a.phaseSecondsRemaining != b.phaseSecondsRemaining) {
        return false;
    }
    for (Movement m : kAllMovements) {
        const MovementState& x = a.movements[toIndex(m)];
        const MovementState& y = b.movements[toIndex(m)];
        if (x.queue != y.queue || x.averageWait != y.averageWait ||
            x.vehiclesPassed != y.vehiclesPassed) {
            return false;
        }
    }
    return true;
}

TrafficState runFor(const Config& config, int seconds) {
    FixedTimingController fixed;
    Simulator sim(config, fixed);
    for (int i = 0; i < seconds; ++i) sim.step();
    return sim.state();
}

// The state is valid before the first step.
void testInitialState() {
    FixedTimingController fixed;
    const Config config;
    Simulator sim(config, fixed);
    const TrafficState& s = sim.state();
    CHECK(sim.time() == 0);
    CHECK(s.time == 0);
    CHECK(s.phase == P::NS_THROUGH);
    CHECK(s.phaseSecondsRemaining == config.throughGreenSeconds);
    for (Movement m : kAllMovements) {
        CHECK(s.movements[toIndex(m)].queue == 0);
        CHECK(s.movements[toIndex(m)].averageWait == 0.0);
        CHECK(s.movements[toIndex(m)].vehiclesPassed == 0);
    }
}

// One hour with the fixed controller: every invariant holds at every step.
// `report` prints the largest queue seen per movement.
void testOneHourInvariants(const Config& config, bool report) {
    constexpr int kSeconds = 3600;
    FixedTimingController fixed;
    Simulator sim(config, fixed);

    std::vector<PhaseChange> changes;
    std::array<int, kMovementCount> lastPassed{};
    std::array<int, kMovementCount> largestQueue{};

    for (int i = 0; i < kSeconds; ++i) {
        const int timeBefore = sim.time();
        const auto greenThisSecond = greenMovements(sim.state().phase);
        std::array<int, kMovementCount> departedBefore{};
        for (Movement m : kAllMovements) {
            departedBefore[toIndex(m)] = sim.intersection().totalDeparted(m);
        }

        const StepResult result = sim.step();
        const TrafficState& s = sim.state();
        const Intersection& ix = sim.intersection();

        // Time goes up by exactly 1, and TrafficState agrees.
        CHECK(sim.time() == timeBefore + 1);
        CHECK(s.time == sim.time());

        // phaseSecondsRemaining is never negative and matches the plan.
        CHECK(s.phaseSecondsRemaining >= 0);
        CHECK(s.phaseSecondsRemaining == sim.signalStatus().secondsRemaining);
        CHECK(s.phase == sim.signalStatus().phase);

        // The fixed controller only ever holds, so nothing is rejected.
        CHECK(!result.rejection);

        for (Movement m : kAllMovements) {
            const int i_m = static_cast<int>(toIndex(m));
            const MovementState& ms = s.movements[i_m];

            // Initial queue (0) + arrived - departed == queue, and TrafficState matches.
            CHECK(ix.totalArrived(m) - ix.totalDeparted(m) == ix.queueLength(m));
            CHECK(ms.queue == ix.queueLength(m));
            CHECK(ms.vehiclesPassed == ix.totalDeparted(m));

            CHECK(ms.queue >= 0);
            CHECK(ms.vehiclesPassed >= lastPassed[i_m]);
            lastPassed[i_m] = ms.vehiclesPassed;

            // Cars only leave movements that were green during this second.
            if (ix.totalDeparted(m) > departedBefore[i_m]) {
                CHECK(greenThisSecond[i_m]);
            }

            if (ms.queue > largestQueue[i_m]) largestQueue[i_m] = ms.queue;
        }

        if (result.change) {
            // Stamped with the new time: the second the new phase starts.
            CHECK(result.change->atSecond == sim.time());
            changes.push_back(*result.change);
        }
    }

    // The first two cycles land on exactly the Stage 4 transition seconds.
    std::vector<Expected> expected = fixedCycle(0);
    const std::vector<Expected> second = fixedCycle(76);
    expected.insert(expected.end(), second.begin(), second.end());
    CHECK(changes.size() >= expected.size());
    for (std::size_t i = 0; i < expected.size() && i < changes.size(); ++i) {
        const PhaseChange& a = changes[i];
        const Expected& e = expected[i];
        if (a.atSecond != e.at || a.from != e.from || a.to != e.to) {
            std::cerr << "  change " << i << ": got " << a.atSecond << ": " << toString(a.from)
                      << " -> " << toString(a.to) << ", expected " << e.at << ": "
                      << toString(e.from) << " -> " << toString(e.to) << "\n";
            ++failures;
        }
    }

    if (!report) return;

    // Report: if these keep climbing over longer runs, arrivals outpace departures.
    std::cout << "Largest queue over " << kSeconds << "s:\n";
    for (Movement m : kAllMovements) {
        std::cout << "  " << toString(m) << ": " << largestQueue[toIndex(m)] << "\n";
    }
}

// Two runs with the same seed end in identical states; a different seed differs.
void testSameSeedSameEnd() {
    const Config config;
    CHECK(sameState(runFor(config, 3600), runFor(config, 3600)));

    Config other = config;
    other.randomSeed = config.randomSeed + 1;
    CHECK(!sameState(runFor(config, 3600), runFor(other, 3600)));
}

// Always asks to end the green.
class AlwaysTransition : public IController {
public:
    Decision decide(const TrafficState&, const SignalStatus&) override {
        return Decision::transition();
    }
};

// Step 6 goes through SafetyRules: early Transitions are rejected and
// reported, and every green lasts exactly the minimum.
void testRejectionsReported() {
    AlwaysTransition eager;
    const Config config;
    Simulator sim(config, eager);

    int rejections = 0;
    int greenStart = 0;
    int greensChecked = 0;
    for (int i = 0; i < 600; ++i) {
        const StepResult r = sim.step();
        if (r.rejection) {
            ++rejections;
            CHECK(!r.rejection->empty());
        }
        if (r.change) {
            if (isGreen(r.change->from)) {
                CHECK(r.change->atSecond - greenStart == config.minGreenSeconds);
                ++greensChecked;
            }
            if (isGreen(r.change->to)) {
                greenStart = r.change->atSecond;
            }
        }
    }
    CHECK(greensChecked > 10);
    // Each green rejects its first (minGreen - 1) asks; the 10th second is accepted.
    // The run may stop part-way through one more green, adding up to that many again.
    const int perGreen = config.minGreenSeconds - 1;
    CHECK(rejections >= greensChecked * perGreen);
    CHECK(rejections <= (greensChecked + 1) * perGreen);
}

}  // namespace

int main() {
    testInitialState();
    testOneHourInvariants(Config{}, true);

    // Again with one car per green second. At 0.5 cars/s a car needs two
    // green seconds of credit, which can hide departures that use the wrong
    // second's phase; at 1.0 any such departure shows up immediately.
    Config fastDepartures;
    fastDepartures.departureRate = 1.0;
    testOneHourInvariants(fastDepartures, false);
    testSameSeedSameEnd();
    testRejectionsReported();

    if (failures == 0) {
        std::cout << "test_simulator: all checks passed\n";
        return 0;
    }
    std::cerr << "test_simulator: " << failures << " check(s) failed\n";
    return 1;
}
