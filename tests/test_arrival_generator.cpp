// Stage 3 tests: ArrivalGenerator seeding and arrival rates.
// Standard library only: CHECK prints each failure and the program returns
// non-zero if anything failed, which CTest reports as a failed test.

#include <array>
#include <cmath>
#include <iostream>
#include <string>

#include "core/Config.hpp"
#include "core/Types.hpp"
#include "sim/ArrivalGenerator.hpp"

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

// The configured rate for a movement, worked out independently of
// ArrivalGenerator so the test does not reuse the code it is checking.
double expectedRate(Movement m, const Config& config) {
    const char* name = toString(m);
    // Names are like "N_LEFT", "E_THROUGH": the part after "X_" is the turn.
    const std::string turn = std::string(name).substr(2);
    if (turn == "LEFT") return config.leftArrivalRate;
    if (turn == "THROUGH") return config.throughArrivalRate;
    return config.rightArrivalRate;
}

// The same seed gives identical traffic.
void testSameSeedSameOutput() {
    Config config;
    ArrivalGenerator a(config);
    ArrivalGenerator b(config);
    for (int t = 0; t < 1000; ++t) {
        CHECK(a.nextSecond() == b.nextSecond());
    }
}

// Different seeds give different traffic.
void testDifferentSeedsDiffer() {
    Config configA;
    Config configB;
    configB.randomSeed = configA.randomSeed + 1;
    ArrivalGenerator a(configA);
    ArrivalGenerator b(configB);
    int secondsThatDiffer = 0;
    for (int t = 0; t < 1000; ++t) {
        if (a.nextSecond() != b.nextSecond()) {
            ++secondsThatDiffer;
        }
    }
    CHECK(secondsThatDiffer > 0);
}

// Over 100,000 seconds each movement's observed rate is within 0.005 of
// its configured rate, and every count is 0 or 1.
void testObservedRatesMatchConfig() {
    const Config config;
    const int seconds = 100000;
    ArrivalGenerator gen(config);
    std::array<int, kMovementCount> totals{};
    bool allCountsZeroOrOne = true;

    for (int t = 0; t < seconds; ++t) {
        const auto counts = gen.nextSecond();
        for (Movement m : kAllMovements) {
            const int c = counts[toIndex(m)];
            if (c != 0 && c != 1) {
                allCountsZeroOrOne = false;
            }
            totals[toIndex(m)] += c;
        }
    }

    CHECK(allCountsZeroOrOne);
    for (Movement m : kAllMovements) {
        const double observed = static_cast<double>(totals[toIndex(m)]) / seconds;
        const double expected = expectedRate(m, config);
        if (std::fabs(observed - expected) > 0.005) {
            std::cerr << toString(m) << ": observed " << observed << ", expected "
                      << expected << "\n";
        }
        CHECK(std::fabs(observed - expected) <= 0.005);
    }
}

// A rate of 0 never produces a car; a rate of 1 always does.
void testRatesZeroAndOne() {
    Config zero;
    zero.leftArrivalRate = 0.0;
    zero.throughArrivalRate = 0.0;
    zero.rightArrivalRate = 0.0;
    ArrivalGenerator none(zero);

    Config one;
    one.leftArrivalRate = 1.0;
    one.throughArrivalRate = 1.0;
    one.rightArrivalRate = 1.0;
    ArrivalGenerator all(one);

    std::array<int, kMovementCount> zeros{};
    std::array<int, kMovementCount> ones{};
    ones.fill(1);

    for (int t = 0; t < 1000; ++t) {
        CHECK(none.nextSecond() == zeros);
        CHECK(all.nextSecond() == ones);
    }
}

// Every movement rolls once per second even when its rate is 0, so setting
// the left rate to 0 leaves the through and right traffic unchanged.
void testZeroRateDoesNotShiftOtherMovements() {
    Config normal;
    Config noLefts;
    noLefts.leftArrivalRate = 0.0;
    ArrivalGenerator a(normal);
    ArrivalGenerator b(noLefts);

    for (int t = 0; t < 1000; ++t) {
        const auto ca = a.nextSecond();
        const auto cb = b.nextSecond();
        for (Movement m : kAllMovements) {
            if (expectedRate(m, noLefts) == 0.0) {
                CHECK(cb[toIndex(m)] == 0);
            } else {
                CHECK(ca[toIndex(m)] == cb[toIndex(m)]);
            }
        }
    }
}

}  // namespace

int main() {
    testSameSeedSameOutput();
    testDifferentSeedsDiffer();
    testObservedRatesMatchConfig();
    testRatesZeroAndOne();
    testZeroRateDoesNotShiftOtherMovements();

    if (failures == 0) {
        std::cout << "test_arrival_generator: all checks passed\n";
        return 0;
    }
    std::cerr << "test_arrival_generator: " << failures << " check(s) failed\n";
    return 1;
}
