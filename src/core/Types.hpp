#pragma once

// Shared enums and the Decision type used across the engine.

#include <array>
#include <cstddef>
#include <optional>

// The 12 movements, in the order fixed by the plan. Use toIndex() to index
// per-movement arrays; never index them with raw numbers.
enum class Movement {
    N_LEFT,
    N_THROUGH,
    N_RIGHT,
    S_LEFT,
    S_THROUGH,
    S_RIGHT,
    E_LEFT,
    E_THROUGH,
    E_RIGHT,
    W_LEFT,
    W_THROUGH,
    W_RIGHT,
};

constexpr std::size_t kMovementCount = 12;

// Every movement in order, for looping: for (Movement m : kAllMovements) { ... }
constexpr std::array<Movement, kMovementCount> kAllMovements = {
    Movement::N_LEFT, Movement::N_THROUGH, Movement::N_RIGHT,
    Movement::S_LEFT, Movement::S_THROUGH, Movement::S_RIGHT,
    Movement::E_LEFT, Movement::E_THROUGH, Movement::E_RIGHT,
    Movement::W_LEFT, Movement::W_THROUGH, Movement::W_RIGHT,
};

// Position of a movement in per-movement arrays.
constexpr std::size_t toIndex(Movement m) {
    return static_cast<std::size_t>(m);
}

// The 7 signal phases. The first four are greens; the rest release nothing.
enum class SignalPhase {
    NS_THROUGH,
    NS_LEFT,
    EW_THROUGH,
    EW_LEFT,
    NS_YELLOW,
    EW_YELLOW,
    ALL_RED,
};

// What a controller asks the signal to do during a green.
enum class DecisionType {
    Hold,        // keep the current plan
    Extend,      // add extendSeconds to the plan
    Transition,  // end the green now, optionally choosing the next green
};

struct Decision {
    DecisionType type = DecisionType::Hold;
    int extendSeconds = 0;                  // used only by Extend
    std::optional<SignalPhase> nextGreen;   // used only by Transition; empty = default successor

    static Decision hold() { return Decision{}; }

    static Decision extend(int seconds) {
        Decision d;
        d.type = DecisionType::Extend;
        d.extendSeconds = seconds;
        return d;
    }

    static Decision transition(std::optional<SignalPhase> next = std::nullopt) {
        Decision d;
        d.type = DecisionType::Transition;
        d.nextGreen = next;
        return d;
    }
};

inline const char* toString(Movement m) {
    switch (m) {
        case Movement::N_LEFT:    return "N_LEFT";
        case Movement::N_THROUGH: return "N_THROUGH";
        case Movement::N_RIGHT:   return "N_RIGHT";
        case Movement::S_LEFT:    return "S_LEFT";
        case Movement::S_THROUGH: return "S_THROUGH";
        case Movement::S_RIGHT:   return "S_RIGHT";
        case Movement::E_LEFT:    return "E_LEFT";
        case Movement::E_THROUGH: return "E_THROUGH";
        case Movement::E_RIGHT:   return "E_RIGHT";
        case Movement::W_LEFT:    return "W_LEFT";
        case Movement::W_THROUGH: return "W_THROUGH";
        case Movement::W_RIGHT:   return "W_RIGHT";
    }
    return "UNKNOWN";
}

inline const char* toString(SignalPhase p) {
    switch (p) {
        case SignalPhase::NS_THROUGH: return "NS_THROUGH";
        case SignalPhase::NS_LEFT:    return "NS_LEFT";
        case SignalPhase::EW_THROUGH: return "EW_THROUGH";
        case SignalPhase::EW_LEFT:    return "EW_LEFT";
        case SignalPhase::NS_YELLOW:  return "NS_YELLOW";
        case SignalPhase::EW_YELLOW:  return "EW_YELLOW";
        case SignalPhase::ALL_RED:    return "ALL_RED";
    }
    return "UNKNOWN";
}

inline const char* toString(DecisionType t) {
    switch (t) {
        case DecisionType::Hold:       return "Hold";
        case DecisionType::Extend:     return "Extend";
        case DecisionType::Transition: return "Transition";
    }
    return "UNKNOWN";
}
