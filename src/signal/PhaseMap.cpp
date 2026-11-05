#include "signal/PhaseMap.hpp"

#include <stdexcept>
#include <string>

std::array<bool, kMovementCount> greenMovements(SignalPhase phase) {
    std::array<bool, kMovementCount> green{};
    auto release = [&green](Movement m) { green[toIndex(m)] = true; };

    // Right turns run with the through movement on the same road.
    switch (phase) {
        case SignalPhase::NS_THROUGH:
            release(Movement::N_THROUGH);
            release(Movement::N_RIGHT);
            release(Movement::S_THROUGH);
            release(Movement::S_RIGHT);
            break;
        case SignalPhase::NS_LEFT:
            release(Movement::N_LEFT);
            release(Movement::S_LEFT);
            break;
        case SignalPhase::EW_THROUGH:
            release(Movement::E_THROUGH);
            release(Movement::E_RIGHT);
            release(Movement::W_THROUGH);
            release(Movement::W_RIGHT);
            break;
        case SignalPhase::EW_LEFT:
            release(Movement::E_LEFT);
            release(Movement::W_LEFT);
            break;
        case SignalPhase::NS_YELLOW:
        case SignalPhase::EW_YELLOW:
        case SignalPhase::ALL_RED:
            break;  // nothing moves
    }
    return green;
}

bool isGreen(SignalPhase phase) {
    switch (phase) {
        case SignalPhase::NS_THROUGH:
        case SignalPhase::NS_LEFT:
        case SignalPhase::EW_THROUGH:
        case SignalPhase::EW_LEFT:
            return true;
        case SignalPhase::NS_YELLOW:
        case SignalPhase::EW_YELLOW:
        case SignalPhase::ALL_RED:
            return false;
    }
    return false;
}

SignalPhase yellowFor(SignalPhase green) {
    switch (green) {
        case SignalPhase::NS_THROUGH:
        case SignalPhase::NS_LEFT:
            return SignalPhase::NS_YELLOW;
        case SignalPhase::EW_THROUGH:
        case SignalPhase::EW_LEFT:
            return SignalPhase::EW_YELLOW;
        default:
            break;
    }
    throw std::logic_error(std::string("yellowFor called with non-green phase ") + toString(green));
}

SignalPhase defaultNextGreen(SignalPhase green) {
    switch (green) {
        case SignalPhase::NS_THROUGH: return SignalPhase::NS_LEFT;
        case SignalPhase::NS_LEFT:    return SignalPhase::EW_THROUGH;
        case SignalPhase::EW_THROUGH: return SignalPhase::EW_LEFT;
        case SignalPhase::EW_LEFT:    return SignalPhase::NS_THROUGH;
        default:
            break;
    }
    throw std::logic_error(std::string("defaultNextGreen called with non-green phase ") +
                           toString(green));
}
