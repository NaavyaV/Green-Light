// Stage 2 tests: Intersection queues, departures and wait times.
// Standard library only: CHECK prints each failure and the program returns
// non-zero if anything failed, which CTest reports as a failed test.

#include <array>
#include <iostream>

#include "core/Config.hpp"
#include "core/TrafficState.hpp"
#include "core/Types.hpp"
#include "sim/Intersection.hpp"

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

using Counts = std::array<int, kMovementCount>;
using Greens = std::array<bool, kMovementCount>;

const double kDepartureRate = Config{}.departureRate;  // 0.5

Greens allRed() { return Greens{}; }

Counts arrivalsFor(Movement m, int cars) {
    Counts c{};
    c[toIndex(m)] = cars;
    return c;
}

Greens greenOnly(Movement m) {
    Greens g{};
    g[toIndex(m)] = true;
    return g;
}

// For every movement: initial queue (0) + arrived - departed == queue,
// and no queue is ever negative. Uses a fixed (non-random) traffic pattern
// and alternates which half of the movements is green.
void testConservation() {
    Intersection ix(kDepartureRate);
    for (int t = 0; t < 300; ++t) {
        Counts c{};
        for (Movement m : kAllMovements) {
            c[toIndex(m)] = ((t + static_cast<int>(toIndex(m))) % 3 == 0) ? 1 : 0;
        }
        ix.addArrivals(t, c);

        Greens g{};
        const bool firstHalfGreen = (t / 20) % 2 == 0;
        for (Movement m : kAllMovements) {
            g[toIndex(m)] = (toIndex(m) < kMovementCount / 2) == firstHalfGreen;
        }
        ix.processDepartures(t, g);

        for (Movement m : kAllMovements) {
            CHECK(ix.queueLength(m) >= 0);
            CHECK(ix.totalArrived(m) - ix.totalDeparted(m) == ix.queueLength(m));
        }
    }
}

// 20 green seconds on a long queue release exactly 10 cars at 0.5 cars/s.
void testTwentyGreenSecondsReleaseTen() {
    Intersection ix(kDepartureRate);
    ix.addArrivals(0, arrivalsFor(Movement::N_THROUGH, 50));
    for (int t = 0; t < 20; ++t) {
        ix.processDepartures(t, greenOnly(Movement::N_THROUGH));
    }
    CHECK(ix.totalDeparted(Movement::N_THROUGH) == 10);
    CHECK(ix.queueLength(Movement::N_THROUGH) == 40);
}

// After 10 green seconds on an empty queue, 5 new cars must not all leave
// at once: credit did not build up while the queue was empty.
void testNoCreditOnEmptyQueue() {
    Intersection ix(kDepartureRate);
    const Movement m = Movement::E_LEFT;
    for (int t = 0; t < 10; ++t) {
        ix.processDepartures(t, greenOnly(m));
    }
    ix.addArrivals(10, arrivalsFor(m, 5));

    ix.processDepartures(10, greenOnly(m));
    CHECK(ix.totalDeparted(m) == 0);  // only 0.5 credit so far

    ix.processDepartures(11, greenOnly(m));
    CHECK(ix.totalDeparted(m) == 1);

    ix.processDepartures(12, greenOnly(m));
    ix.processDepartures(13, greenOnly(m));
    CHECK(ix.totalDeparted(m) == 2);  // steady 1 car per 2 seconds
}

// A green that ends with half a credit left must not carry it across red:
// on the next green, the first car leaves after 2 green seconds, not 1.
void testNoCreditCarryOverRed() {
    Intersection ix(kDepartureRate);
    const Movement m = Movement::W_THROUGH;
    ix.addArrivals(0, arrivalsFor(m, 10));

    for (int t = 0; t < 3; ++t) {  // 3 green seconds: 1.5 credit -> 1 car, 0.5 left
        ix.processDepartures(t, greenOnly(m));
    }
    CHECK(ix.totalDeparted(m) == 1);

    for (int t = 3; t < 30; ++t) {  // long red
        ix.processDepartures(t, allRed());
    }
    CHECK(ix.totalDeparted(m) == 1);

    ix.processDepartures(30, greenOnly(m));
    CHECK(ix.totalDeparted(m) == 1);  // would be 2 if the 0.5 had carried over

    ix.processDepartures(31, greenOnly(m));
    CHECK(ix.totalDeparted(m) == 2);
}

// A car that has waited 10 seconds gives an averageWait of 10, and
// snapshot reports the same numbers without changing the queues.
void testAverageWaitAndSnapshot() {
    Intersection ix(kDepartureRate);
    const Movement m = Movement::S_RIGHT;
    ix.addArrivals(0, arrivalsFor(m, 1));
    CHECK(ix.averageWait(m, 10) == 10.0);

    TrafficState state;
    ix.snapshot(state, 10);
    const MovementState& ms = state.movements[toIndex(m)];
    CHECK(ms.queue == 1);
    CHECK(ms.averageWait == 10.0);
    CHECK(ms.vehiclesPassed == 0);

    // Empty queues report 0.
    CHECK(state.movements[toIndex(Movement::N_LEFT)].averageWait == 0.0);

    // snapshot only reads: a second call gives the same result.
    TrafficState again;
    ix.snapshot(again, 10);
    CHECK(again.movements[toIndex(m)].queue == 1);
    CHECK(ix.queueLength(m) == 1);
}

// Waits keep growing on red movements: one car arriving at second 0 has
// waited t seconds at second t, and a second car arriving at 4 brings the mean down.
void testWaitsGrowOnRed() {
    Intersection ix(kDepartureRate);
    const Movement m = Movement::N_LEFT;
    ix.addArrivals(0, arrivalsFor(m, 1));
    for (int t = 0; t < 4; ++t) {
        ix.processDepartures(t, allRed());
        CHECK(ix.averageWait(m, t) == static_cast<double>(t));
    }
    ix.addArrivals(4, arrivalsFor(m, 1));
    ix.processDepartures(4, allRed());
    CHECK(ix.averageWait(m, 4) == 2.0);  // (4 + 0) / 2
    ix.processDepartures(5, allRed());
    CHECK(ix.averageWait(m, 5) == 3.0);  // (5 + 1) / 2
}

// With a departure rate of 1.0, a car arriving into an empty queue on green
// leaves in the same second it arrived, so its wait is 0.
void testSameSecondDeparture() {
    Intersection ix(1.0);
    const Movement m = Movement::E_THROUGH;
    ix.addArrivals(5, arrivalsFor(m, 1));
    CHECK(ix.averageWait(m, 5) == 0.0);  // just arrived: waited 0 so far
    ix.processDepartures(5, greenOnly(m));
    CHECK(ix.totalDeparted(m) == 1);  // left at second 5, arrived at 5: wait 0
    CHECK(ix.queueLength(m) == 0);
}

// Cars only leave movements that are green; vehiclesPassed only goes up.
void testOnlyGreenMovementsDepart() {
    Intersection ix(kDepartureRate);
    Counts c{};
    c[toIndex(Movement::N_THROUGH)] = 30;
    c[toIndex(Movement::S_THROUGH)] = 30;
    ix.addArrivals(0, c);

    int lastPassed = 0;
    for (int t = 0; t < 20; ++t) {
        ix.processDepartures(t, greenOnly(Movement::N_THROUGH));
        CHECK(ix.totalDeparted(Movement::N_THROUGH) >= lastPassed);
        lastPassed = ix.totalDeparted(Movement::N_THROUGH);
    }
    CHECK(ix.totalDeparted(Movement::N_THROUGH) == 10);
    CHECK(ix.totalDeparted(Movement::S_THROUGH) == 0);
    CHECK(ix.queueLength(Movement::S_THROUGH) == 30);
}

}  // namespace

int main() {
    testConservation();
    testTwentyGreenSecondsReleaseTen();
    testNoCreditOnEmptyQueue();
    testNoCreditCarryOverRed();
    testAverageWaitAndSnapshot();
    testWaitsGrowOnRed();
    testSameSecondDeparture();
    testOnlyGreenMovementsDepart();

    if (failures == 0) {
        std::cout << "test_intersection: all checks passed\n";
        return 0;
    }
    std::cerr << "test_intersection: " << failures << " check(s) failed\n";
    return 1;
}
