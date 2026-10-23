#pragma once

// Snapshot structs describing the intersection at one moment.

#include "core/Types.hpp"

// One movement's numbers.
struct MovementState {
    int queue = 0;             // cars currently waiting
    double averageWait = 0.0;  // mean seconds waited by the cars still in the queue
    int vehiclesPassed = 0;    // total cars that have left this movement
};

// The full intersection snapshot (what the dashboard will see later).
struct TrafficState {
    int time = 0;
    SignalPhase phase = SignalPhase::NS_THROUGH;
    int phaseSecondsRemaining = 0;  // seconds until the signal changes
    MovementState movements[kMovementCount];  // index with toIndex(Movement)
};

// Internal view of the signal, passed to controllers (not sent to the dashboard).
struct SignalStatus {
    SignalPhase phase = SignalPhase::NS_THROUGH;
    int secondsInPhase = 0;
    int secondsRemaining = 0;  // plannedDuration - secondsInPhase
    int plannedDuration = 0;
};
