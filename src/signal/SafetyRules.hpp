#pragma once

// Every safety rule for the signal lives in this one class. SignalController
// asks it before applying any Decision and before every phase change.
//
// - A rejected Decision is treated as Hold, which is always legal because
//   every phase has a plan that runs out by itself.
// - A rejected phase change is a bug, never a decision: it throws SafetyViolation.

#include <array>
#include <stdexcept>
#include <string>
#include <utility>

#include "core/Config.hpp"
#include "core/TrafficState.hpp"
#include "core/Types.hpp"

// The result of a check: accepted, or rejected with a reason.
struct Verdict {
    bool accepted = true;
    std::string reason;  // empty when accepted

    static Verdict accept() { return Verdict{}; }
    static Verdict reject(std::string why) { return Verdict{false, std::move(why)}; }
};

// Thrown when a phase change breaks a rule. This can only happen through a
// bug, so it stops the program instead of being treated as Hold.
class SafetyViolation : public std::logic_error {
public:
    using std::logic_error::logic_error;
};

class SafetyRules {
public:
    explicit SafetyRules(const Config& config);

    // Reviews a controller's Decision against the current signal.
    Verdict reviewDecision(const Decision& decision, const SignalStatus& signal) const;

    // Checks that `from` may end after `secondsInFrom` seconds and be followed by `to`.
    Verdict checkPhaseChange(SignalPhase from, SignalPhase to, int secondsInFrom) const;

    // Like checkPhaseChange, but throws SafetyViolation naming the change and the rule.
    void requireLegalPhaseChange(SignalPhase from, SignalPhase to, int secondsInFrom) const;

    // No NS and EW movements green together, and no left turn green with the
    // opposing through movement.
    static Verdict checkConflictFree(const std::array<bool, kMovementCount>& green);
    static Verdict checkConflictFree(SignalPhase phase);

    // Startup check of every timing and rate in Config.
    static Verdict validateConfig(const Config& config);

private:
    Config config_;
};
