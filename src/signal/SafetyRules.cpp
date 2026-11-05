#include "signal/SafetyRules.hpp"

#include "signal/PhaseMap.hpp"

namespace {

std::string changeName(SignalPhase from, SignalPhase to) {
    return std::string(toString(from)) + " -> " + toString(to);
}

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

// Each left turn and the through movement coming the opposite way.
struct LeftAndOpposingThrough {
    Movement left;
    Movement opposingThrough;
};

constexpr LeftAndOpposingThrough kOpposingPairs[] = {
    {Movement::N_LEFT, Movement::S_THROUGH},
    {Movement::S_LEFT, Movement::N_THROUGH},
    {Movement::E_LEFT, Movement::W_THROUGH},
    {Movement::W_LEFT, Movement::E_THROUGH},
};

bool isRate(double r) { return r >= 0.0 && r <= 1.0; }

}  // namespace

SafetyRules::SafetyRules(const Config& config) : config_(config) {}

Verdict SafetyRules::reviewDecision(const Decision& decision, const SignalStatus& signal) const {
    if (decision.type == DecisionType::Hold) {
        return Verdict::accept();
    }
    if (!isGreen(signal.phase)) {
        return Verdict::reject(std::string(toString(decision.type)) +
                               " rejected: decisions are ignored during clearance (" +
                               toString(signal.phase) + ")");
    }

    if (decision.type == DecisionType::Extend) {
        if (decision.extendSeconds <= 0) {
            return Verdict::reject("Extend rejected: seconds must be positive, got " +
                                   std::to_string(decision.extendSeconds));
        }
        const int newPlan = signal.plannedDuration + decision.extendSeconds;
        if (newPlan > config_.maxGreenSeconds) {
            return Verdict::reject("Extend rejected: plan would be " + std::to_string(newPlan) +
                                   "s, over the maximum green of " +
                                   std::to_string(config_.maxGreenSeconds) + "s");
        }
        return Verdict::accept();
    }

    // Transition
    if (signal.secondsInPhase < config_.minGreenSeconds) {
        return Verdict::reject("Transition rejected: green has run " +
                               std::to_string(signal.secondsInPhase) +
                               "s, under the minimum green of " +
                               std::to_string(config_.minGreenSeconds) + "s");
    }
    if (decision.nextGreen) {
        const SignalPhase next = *decision.nextGreen;
        if (!isGreen(next)) {
            return Verdict::reject(std::string("Transition rejected: next green must be a green "
                                               "phase, got ") + toString(next));
        }
        if (next == signal.phase) {
            return Verdict::reject(std::string("Transition rejected: next green cannot be the "
                                               "green that is ending (") + toString(next) + ")");
        }
    }
    return Verdict::accept();
}

Verdict SafetyRules::checkPhaseChange(SignalPhase from, SignalPhase to, int secondsInFrom) const {
    const std::string change = changeName(from, to);

    if (isGreen(from)) {
        if (to != yellowFor(from)) {
            return Verdict::reject(change + ": a green must end in the yellow of its own road axis");
        }
        if (secondsInFrom < config_.minGreenSeconds) {
            return Verdict::reject(change + ": green lasted " + std::to_string(secondsInFrom) +
                                   "s, under the minimum of " +
                                   std::to_string(config_.minGreenSeconds) + "s");
        }
        if (secondsInFrom > config_.maxGreenSeconds) {
            return Verdict::reject(change + ": green lasted " + std::to_string(secondsInFrom) +
                                   "s, over the maximum of " +
                                   std::to_string(config_.maxGreenSeconds) + "s");
        }
    } else if (from == SignalPhase::ALL_RED) {
        if (!isGreen(to)) {
            return Verdict::reject(change + ": ALL_RED must be followed by a green");
        }
        if (secondsInFrom != config_.allRedSeconds) {
            return Verdict::reject(change + ": ALL_RED lasted " + std::to_string(secondsInFrom) +
                                   "s, must be exactly " + std::to_string(config_.allRedSeconds) +
                                   "s");
        }
    } else {  // a yellow
        if (to != SignalPhase::ALL_RED) {
            return Verdict::reject(change + ": a yellow must be followed by ALL_RED");
        }
        if (secondsInFrom != config_.yellowSeconds) {
            return Verdict::reject(change + ": yellow lasted " + std::to_string(secondsInFrom) +
                                   "s, must be exactly " + std::to_string(config_.yellowSeconds) +
                                   "s");
        }
    }

    const Verdict conflicts = checkConflictFree(to);
    if (!conflicts.accepted) {
        return Verdict::reject(change + ": " + conflicts.reason);
    }
    return Verdict::accept();
}

void SafetyRules::requireLegalPhaseChange(SignalPhase from, SignalPhase to,
                                          int secondsInFrom) const {
    const Verdict v = checkPhaseChange(from, to, secondsInFrom);
    if (!v.accepted) {
        throw SafetyViolation("Safety violation (bug): " + v.reason);
    }
}

Verdict SafetyRules::checkConflictFree(const std::array<bool, kMovementCount>& green) {
    bool anyNorthSouth = false;
    bool anyEastWest = false;
    for (Movement m : kAllMovements) {
        if (!green[toIndex(m)]) continue;
        if (isNorthSouth(m)) {
            anyNorthSouth = true;
        } else {
            anyEastWest = true;
        }
    }
    if (anyNorthSouth && anyEastWest) {
        return Verdict::reject("NS and EW movements are green together");
    }

    for (const auto& pair : kOpposingPairs) {
        if (green[toIndex(pair.left)] && green[toIndex(pair.opposingThrough)]) {
            return Verdict::reject(std::string(toString(pair.left)) +
                                   " is green with the opposing " +
                                   toString(pair.opposingThrough));
        }
    }
    return Verdict::accept();
}

Verdict SafetyRules::checkConflictFree(SignalPhase phase) {
    return checkConflictFree(greenMovements(phase));
}

Verdict SafetyRules::validateConfig(const Config& c) {
    auto bad = [](const std::string& why) { return Verdict::reject("Invalid Config: " + why); };

    if (c.yellowSeconds <= 0) return bad("yellowSeconds must be positive");
    if (c.allRedSeconds <= 0) return bad("allRedSeconds must be positive");
    if (c.minGreenSeconds > c.maxGreenSeconds) {
        return bad("minGreenSeconds (" + std::to_string(c.minGreenSeconds) +
                   ") is above maxGreenSeconds (" + std::to_string(c.maxGreenSeconds) + ")");
    }
    auto checkGreen = [&](const char* name, int seconds) {
        if (seconds < c.minGreenSeconds || seconds > c.maxGreenSeconds) {
            return bad(std::string(name) + " (" + std::to_string(seconds) +
                       ") must be between minGreenSeconds (" + std::to_string(c.minGreenSeconds) +
                       ") and maxGreenSeconds (" + std::to_string(c.maxGreenSeconds) + ")");
        }
        return Verdict::accept();
    };
    if (Verdict v = checkGreen("throughGreenSeconds", c.throughGreenSeconds); !v.accepted) return v;
    if (Verdict v = checkGreen("leftGreenSeconds", c.leftGreenSeconds); !v.accepted) return v;

    if (!isRate(c.throughArrivalRate)) return bad("throughArrivalRate must be between 0 and 1");
    if (!isRate(c.leftArrivalRate)) return bad("leftArrivalRate must be between 0 and 1");
    if (!isRate(c.rightArrivalRate)) return bad("rightArrivalRate must be between 0 and 1");
    if (c.departureRate < 0.0) return bad("departureRate must not be negative");

    return Verdict::accept();
}
