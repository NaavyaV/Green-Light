#pragma once

// Fixed timing: the fixed schedule is simply SignalController's default
// plan, so this controller never changes anything. It always holds, and it
// knows nothing about queues.

#include "control/IController.hpp"

class FixedTimingController : public IController {
public:
    Decision decide(const TrafficState& traffic, const SignalStatus& signal) override;
};
