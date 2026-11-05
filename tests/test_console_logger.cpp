// Stage 7 tests: the exact ConsoleLogger line formats.
// Standard library only: CHECK prints each failure and the program returns
// non-zero if anything failed, which CTest reports as a failed test.

#include <iostream>
#include <sstream>
#include <string>

#include "core/TrafficState.hpp"
#include "core/Types.hpp"
#include "io/ConsoleLogger.hpp"
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

void checkLine(const std::string& actual, const std::string& expected) {
    if (actual != expected) {
        std::cerr << "  got:      \"" << actual << "\"\n"
                  << "  expected: \"" << expected << "\"\n";
        ++failures;
    }
}

void setMovement(TrafficState& s, Movement m, int queue, double averageWait, int passed) {
    MovementState& ms = s.movements[toIndex(m)];
    ms.queue = queue;
    ms.averageWait = averageWait;
    ms.vehiclesPassed = passed;
}

// NS and EW queues are summed per road, Avg Wait is the average over all
// waiting cars (weighted by queue), and Passed is the total.
void testStatusLine() {
    TrafficState s;
    s.time = 40;
    s.phase = SignalPhase::EW_THROUGH;
    s.phaseSecondsRemaining = 18;
    setMovement(s, Movement::N_THROUGH, 8, 5.0, 10);
    setMovement(s, Movement::S_LEFT, 6, 8.0, 3);
    setMovement(s, Movement::E_THROUGH, 5, 4.0, 12);
    setMovement(s, Movement::W_RIGHT, 4, 9.0, 6);
    // Total wait: 8*5 + 6*8 + 5*4 + 4*9 = 144 over 23 cars = 6.26... -> 6.3

    std::ostringstream out;
    ConsoleLogger logger(out);
    logger.logSecond(s);
    checkLine(out.str(),
              "TIME 40s | EW_THROUGH | NS Queue: 14 | EW Queue: 9 | Avg Wait: 6.3s | Passed: 31\n");
}

// An empty intersection shows a wait of 0.0, not NaN.
void testEmptyIntersection() {
    TrafficState s;
    s.time = 1;
    s.phase = SignalPhase::NS_THROUGH;

    std::ostringstream out;
    ConsoleLogger logger(out);
    logger.logSecond(s);
    checkLine(out.str(),
              "TIME 1s | NS_THROUGH | NS Queue: 0 | EW Queue: 0 | Avg Wait: 0.0s | Passed: 0\n");
}

// Avg Wait weights each car equally: one movement with 1 car waiting 10s and
// another with 9 cars waiting 0s average 1.0s, not (10 + 0) / 2 = 5.0s.
void testAverageWaitWeightsByCar() {
    TrafficState s;
    s.time = 10;
    s.phase = SignalPhase::ALL_RED;
    setMovement(s, Movement::N_LEFT, 1, 10.0, 0);
    setMovement(s, Movement::E_LEFT, 9, 0.0, 0);

    std::ostringstream out;
    ConsoleLogger logger(out);
    logger.logSecond(s);
    checkLine(out.str(),
              "TIME 10s | ALL_RED | NS Queue: 1 | EW Queue: 9 | Avg Wait: 1.0s | Passed: 0\n");
}

void testSignalChangeLine() {
    std::ostringstream out;
    ConsoleLogger logger(out);
    logger.logSignalChange(PhaseChange{58, SignalPhase::EW_THROUGH, SignalPhase::EW_YELLOW});
    checkLine(out.str(), "[58s] SIGNAL: EW_THROUGH -> EW_YELLOW\n");
}

void testRejectionLine() {
    std::ostringstream out;
    ConsoleLogger logger(out);
    logger.logRejection(5, "Transition rejected: too early");
    checkLine(out.str(), "[5s] REJECTED: Transition rejected: too early\n");
}

// The logger's number formatting does not change the stream it writes to.
void testDoesNotChangeStreamFormatting() {
    TrafficState s;
    std::ostringstream out;
    ConsoleLogger logger(out);
    logger.logSecond(s);
    out.str("");
    out << 2.25;
    CHECK(out.str() == "2.25");
}

}  // namespace

int main() {
    testStatusLine();
    testEmptyIntersection();
    testAverageWaitWeightsByCar();
    testSignalChangeLine();
    testRejectionLine();
    testDoesNotChangeStreamFormatting();

    if (failures == 0) {
        std::cout << "test_console_logger: all checks passed\n";
        return 0;
    }
    std::cerr << "test_console_logger: " << failures << " check(s) failed\n";
    return 1;
}
