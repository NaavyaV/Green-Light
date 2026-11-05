#include "signal/SignalController.hpp"

#include "signal/PhaseMap.hpp"

#include <stdexcept>

SignalController::SignalController(const Config& config) : config_(config), rules_(config) {
    // A bad Config must never run: every plan relies on these values.
    const Verdict valid = SafetyRules::validateConfig(config);
    if (!valid.accepted) {
        throw std::invalid_argument(valid.reason);
    }

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

DecisionOutcome SignalController::applyDecision(const Decision& decision, int now) {
    DecisionOutcome outcome;

    // SafetyRules decides whether the decision is legal (including that
    // yellow and ALL_RED take no decisions). A rejection changes nothing.
    const Verdict verdict = rules_.reviewDecision(decision, status());
    if (!verdict.accepted) {
        outcome.accepted = false;
        outcome.reason = verdict.reason;
        return outcome;
    }

    switch (decision.type) {
        case DecisionType::Hold:
            break;
        case DecisionType::Extend:
            plannedDuration_ += decision.extendSeconds;
            break;
        case DecisionType::Transition:
            // The named next green applies to this one change only; once it
            // starts, enterPhase resets the pending green to its default successor.
            if (decision.nextGreen) {
                pendingNextGreen_ = *decision.nextGreen;
            }
            outcome.change = enterPhase(yellowFor(phase_), now);
            break;
    }
    return outcome;
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
    // Every phase change, automatic or from a Transition, passes through here.
    rules_.requireLegalPhaseChange(phase_, next, secondsInPhase_);

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
