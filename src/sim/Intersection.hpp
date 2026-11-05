#pragma once

// The 12 queues of the intersection: arrivals, departures and wait times.
// No lights and no randomness live here: the caller says which cars arrive
// and which movements are green.

#include <array>
#include <deque>

#include "core/TrafficState.hpp"
#include "core/Types.hpp"

class Intersection {
public:
    // departureRate: cars per second that leave a green movement (Config::departureRate).
    explicit Intersection(double departureRate);

    // Adds counts[m] cars to each movement's queue, all arriving at second `time`.
    void addArrivals(int time, const std::array<int, kMovementCount>& counts);

    // Lets cars leave the movements marked green, using the departure credit
    // (see the Conventions in docs/PLAN.md). Red movements lose any credit.
    void processDepartures(int time, const std::array<bool, kMovementCount>& green);

    // Mean of (time - arrival second) over the cars still waiting; 0 if empty.
    double averageWait(Movement m, int time) const;

    int queueLength(Movement m) const;
    int totalArrived(Movement m) const;
    int totalDeparted(Movement m) const;

    // Fills queue, averageWait and vehiclesPassed for all 12 movements.
    // simulatedSecond is the second just simulated (not TrafficState::time,
    // which is already the next second). Read-only.
    void snapshot(TrafficState& state, int simulatedSecond) const;

private:
    struct MovementQueue {
        std::deque<int> arrivalSeconds;  // one entry per waiting car, oldest first
        double credit = 0.0;             // fractional departures earned so far
        int totalArrived = 0;
        int totalDeparted = 0;
    };

    const MovementQueue& queueFor(Movement m) const { return queues_[toIndex(m)]; }

    double departureRate_;
    std::array<MovementQueue, kMovementCount> queues_;
};
