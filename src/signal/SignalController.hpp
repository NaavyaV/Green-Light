#pragma once

// The signal's state machine. Every phase runs on a plan (planned duration);
// when the plan runs out, the phase ends by itself:
//   green -> its own yellow -> ALL_RED -> pending next green.
// Nothing outside this class can set the phase directly, and every Decision
// and every phase change is checked by SafetyRules first. SignalController
// keeps no clock of its own: callers pass `now`, the second a new phase
// would start, which is used to stamp phase changes.

#include <array>
#include <optional>
#include <string>

#include "core/Config.hpp"
#include "core/TrafficState.hpp"
#include "core/Types.hpp"
#include "signal/SafetyRules.hpp"

struct PhaseChange {
    int atSecond;      // the second the new phase starts
    SignalPhase from;
    SignalPhase to;
};

// What happened to a Decision passed to applyDecision.
struct DecisionOutcome {
    bool accepted = true;
    std::string reason;                // why it was rejected; empty when accepted
    std::optional<PhaseChange> change; // set if the decision ended the green
};

class SignalController {
public:
    // Starts in NS_THROUGH at 0 seconds, with its default plan.
    // Throws std::invalid_argument if SafetyRules rejects the Config.
    explicit SignalController(const Config& config);

    // Advances the current phase by one second. If its plan has run out,
    // moves to the next phase and returns the change.
    // Throws SafetyViolation if that change breaks a rule (a bug).
    std::optional<PhaseChange> tick(int now);

    // Reviews a controller's Decision with SafetyRules and carries it out
    // only if accepted. A rejected decision changes nothing (acts as Hold),
    // and the outcome carries the reason.
    DecisionOutcome applyDecision(const Decision& decision, int now);

    SignalStatus status() const;
    SignalPhase phase() const { return phase_; }

    // Movements released by the current phase.
    std::array<bool, kMovementCount> greenMovements() const;

private:
    // Switches to `next`, giving it its default plan, and returns the change.
    // SafetyRules checks the change first; an illegal one throws SafetyViolation.
    PhaseChange enterPhase(SignalPhase next, int now);

    // Default plan length for a phase, from Config.
    int defaultDuration(SignalPhase phase) const;

    Config config_;
    SafetyRules rules_;
    SignalPhase phase_ = SignalPhase::NS_THROUGH;
    int secondsInPhase_ = 0;
    int plannedDuration_ = 0;
    SignalPhase pendingNextGreen_ = SignalPhase::NS_LEFT;  // green that follows the next ALL_RED
};
