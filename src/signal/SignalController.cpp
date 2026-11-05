#include "signal/SignalController.hpp"

#include "signal/PhaseMap.hpp"

SignalController::SignalController(const Config& config) : config_(config) {
    phase_ = SignalPhase::NS_THROUGH;
    secondsInPhase_ = 0;
    plannedDuration_ = defaultDuration(phase_);
    pendingNextGreen_ = defaultNextGreen(phase_);
}

std::optional<PhaseChange> SignalController::tick(int now) {
    ++secondsInPhase_;
    if (secondsInPhase_ < plannedDuration_) {
        return std::nullopt;
    }

    // The plan has run out: the phase ends by itself.
    if (isGreen(phase_)) {
        return enterPhase(yellowFor(phase_), now);
    }
    if (phase_ == SignalPhase::ALL_RED) {
        return enterPhase(pendingNextGreen_, now);
    }
    return enterPhase(SignalPhase::ALL_RED, now);  // a yellow
}

std::optional<PhaseChange> SignalController::applyDecision(const Decision& decision, int now) {
    if (!isGreen(phase_)) {
        return std::nullopt;  // yellow and ALL_RED ignore decisions
    }

    switch (decision.type) {
        case DecisionType::Hold:
            return std::nullopt;
        case DecisionType::Extend:
            plannedDuration_ += decision.extendSeconds;
            return std::nullopt;
        case DecisionType::Transition:
            // The named next green applies to this one change only; once it
            // starts, enterPhase resets the pending green to its default successor.
            if (decision.nextGreen) {
                pendingNextGreen_ = *decision.nextGreen;
            }
            return enterPhase(yellowFor(phase_), now);
    }
    return std::nullopt;
}

SignalStatus SignalController::status() const {
    SignalStatus s;
    s.phase = phase_;
    s.secondsInPhase = secondsInPhase_;
    s.plannedDuration = plannedDuration_;
    s.secondsRemaining = plannedDuration_ - secondsInPhase_;
    return s;
}

std::array<bool, kMovementCount> SignalController::greenMovements() const {
    return ::greenMovements(phase_);
}

PhaseChange SignalController::enterPhase(SignalPhase next, int now) {
    const PhaseChange change{now, phase_, next};
    phase_ = next;
    secondsInPhase_ = 0;
    plannedDuration_ = defaultDuration(next);
    if (isGreen(next)) {
        pendingNextGreen_ = defaultNextGreen(next);
    }
    return change;
}

int SignalController::defaultDuration(SignalPhase phase) const {
    switch (phase) {
        case SignalPhase::NS_THROUGH:
        case SignalPhase::EW_THROUGH:
            return config_.throughGreenSeconds;
        case SignalPhase::NS_LEFT:
        case SignalPhase::EW_LEFT:
            return config_.leftGreenSeconds;
        case SignalPhase::NS_YELLOW:
        case SignalPhase::EW_YELLOW:
            return config_.yellowSeconds;
        case SignalPhase::ALL_RED:
            return config_.allRedSeconds;
    }
    return config_.allRedSeconds;
}
