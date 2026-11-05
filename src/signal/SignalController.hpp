#pragma once

// The signal's state machine. Every phase runs on a plan (planned duration);
// when the plan runs out, the phase ends by itself:
//   green -> its own yellow -> ALL_RED -> pending next green.
// Nothing outside this class can set the phase directly. SignalController
// keeps no clock of its own: callers pass `now`, the second a new phase
// would start, which is used to stamp phase changes.

#include <array>
#include <optional>

#include "core/Config.hpp"
#include "core/TrafficState.hpp"
#include "core/Types.hpp"

struct PhaseChange {
    int atSecond;      // the second the new phase starts
    SignalPhase from;
    SignalPhase to;
};

class SignalController {
public:
    // Starts in NS_THROUGH at 0 seconds, with its default plan.
    explicit SignalController(const Config& config);

    // Advances the current phase by one second. If its plan has run out,
    // moves to the next phase and returns the change.
    std::optional<PhaseChange> tick(int now);

    // Carries out a controller's Decision. Only acts during a green;
    // yellow and ALL_RED ignore decisions. Returns the change if the
    // decision ended the green.
    std::optional<PhaseChange> applyDecision(const Decision& decision, int now);

    SignalStatus status() const;
    SignalPhase phase() const { return phase_; }

    // Movements released by the current phase.
    std::array<bool, kMovementCount> greenMovements() const;

private:
    // Switches to `next`, giving it its default plan, and returns the change.
    PhaseChange enterPhase(SignalPhase next, int now);

    // Default plan length for a phase, from Config.
    int defaultDuration(SignalPhase phase) const;

    Config config_;
    SignalPhase phase_ = SignalPhase::NS_THROUGH;
    int secondsInPhase_ = 0;
    int plannedDuration_ = 0;
    SignalPhase pendingNextGreen_ = SignalPhase::NS_LEFT;  // green that follows the next ALL_RED
};
