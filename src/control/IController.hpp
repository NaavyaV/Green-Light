#pragma once

// Interface for anything that steers the signal. Once per second during a
// green, the controller looks at the traffic and the signal and returns a
// Decision: Hold, Extend(n) or Transition (optionally naming the next green).

#include "core/TrafficState.hpp"
#include "core/Types.hpp"

class IController {
public:
    virtual ~IController() = default;

    virtual Decision decide(const TrafficState& traffic, const SignalStatus& signal) = 0;
};
