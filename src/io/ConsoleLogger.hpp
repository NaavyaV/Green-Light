#pragma once

// Prints the simulation as text: one status line per simulated second, plus
// a line for every signal change and every rejected decision.
//
//   TIME 40s | EW_THROUGH | NS Queue: 14 | EW Queue: 9 | Avg Wait: 6.2s | Passed: 31
//   [58s] SIGNAL: EW_THROUGH -> EW_YELLOW
//   [5s] REJECTED: Transition rejected: green has run 5s, under the minimum green of 10s

#include <ostream>
#include <string>

#include "core/TrafficState.hpp"
#include "signal/SignalController.hpp"

class ConsoleLogger {
public:
    // Writes to `out` (normally std::cout), which must outlive the logger.
    explicit ConsoleLogger(std::ostream& out);

    // The status line for the current state.
    void logSecond(const TrafficState& state);

    // One line per signal change, stamped with the second the new phase starts.
    void logSignalChange(const PhaseChange& change);

    // One line per decision SafetyRules rejected, for debugging controllers.
    void logRejection(int time, const std::string& reason);

private:
    std::ostream& out_;
};
