#include "io/ConsoleLogger.hpp"

#include <iomanip>
#include <sstream>

namespace {

bool isNorthSouth(Movement m) {
    switch (m) {
        case Movement::N_LEFT:
        case Movement::N_THROUGH:
        case Movement::N_RIGHT:
        case Movement::S_LEFT:
        case Movement::S_THROUGH:
        case Movement::S_RIGHT:
            return true;
        default:
            return false;
    }
}

}  // namespace

ConsoleLogger::ConsoleLogger(std::ostream& out) : out_(out) {}

void ConsoleLogger::logSecond(const TrafficState& state) {
    int nsQueue = 0;
    int ewQueue = 0;
    int passed = 0;
    double totalWait = 0.0;  // summed over every waiting car

    for (Movement m : kAllMovements) {
        const MovementState& ms = state.movements[toIndex(m)];
        if (isNorthSouth(m)) {
            nsQueue += ms.queue;
        } else {
            ewQueue += ms.queue;
        }
        passed += ms.vehiclesPassed;
        // averageWait is per movement, so weight it by that movement's queue
        // to get the average over all waiting cars.
        totalWait += ms.averageWait * ms.queue;
    }

    const int waiting = nsQueue + ewQueue;
    const double avgWait = waiting > 0 ? totalWait / waiting : 0.0;

    // Format into a local stream so the precision setting never leaks into out_.
    std::ostringstream line;
    line << "TIME " << state.time << "s | " << toString(state.phase)
         << " | NS Queue: " << nsQueue << " | EW Queue: " << ewQueue
         << " | Avg Wait: " << std::fixed << std::setprecision(1) << avgWait
         << "s | Passed: " << passed << "\n";
    out_ << line.str();
}

void ConsoleLogger::logSignalChange(const PhaseChange& change) {
    out_ << "[" << change.atSecond << "s] SIGNAL: " << toString(change.from) << " -> "
         << toString(change.to) << "\n";
}

void ConsoleLogger::logRejection(int time, const std::string& reason) {
    out_ << "[" << time << "s] REJECTED: " << reason << "\n";
}
