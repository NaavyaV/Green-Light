#include "control/FixedTimingController.hpp"

Decision FixedTimingController::decide(const TrafficState& /*traffic*/,
                                       const SignalStatus& /*signal*/) {
    return Decision::hold();
}
