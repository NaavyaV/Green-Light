#pragma once

// Runs the whole intersection one simulated second at a time. Owns the
// clock: time advances here and nowhere else. Prints nothing.

#include <optional>
#include <string>

#include "control/IController.hpp"
#include "core/Config.hpp"
#include "core/TrafficState.hpp"
#include "signal/SignalController.hpp"
#include "sim/ArrivalGenerator.hpp"
#include "sim/Intersection.hpp"

// What happened during one step.
struct StepResult {
    std::optional<PhaseChange> change;     // signal change, stamped with the new time
    std::optional<std::string> rejection;  // why SafetyRules rejected the controller's decision
};

class Simulator {
public:
    // The controller is owned by the caller and must outlive the Simulator.
    // Throws std::invalid_argument if SafetyRules rejects the Config.
    Simulator(const Config& config, IController& controller);

    // Simulates second time() and advances the clock by 1. May throw
    // SafetyViolation if a phase change breaks a rule (a bug).
    StepResult step();

    const TrafficState& state() const { return state_; }
    int time() const { return time_; }
    SignalStatus signalStatus() const { return signal_.status(); }
    const Intersection& intersection() const { return intersection_; }

private:
    // Fills time, phase, phaseSecondsRemaining and all 12 movements.
    // simulatedSecond is the second just simulated (see the Clock convention).
    void updateState(int simulatedSecond);

    Intersection intersection_;
    ArrivalGenerator arrivals_;
    SignalController signal_;  // owns SafetyRules
    IController& controller_;
    int time_ = 0;
    TrafficState state_;
};
