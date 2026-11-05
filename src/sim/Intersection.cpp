#include "sim/Intersection.hpp"

namespace {
// Rates like 0.1 do not add up to exactly 1.0 in floating point
// (0.1 added ten times is 0.9999...), so "credit reached 1" allows this
// much rounding error. It is a numerical tolerance, not a tunable setting.
constexpr double kCreditTolerance = 1e-9;
}  // namespace

Intersection::Intersection(double departureRate) : departureRate_(departureRate) {}

void Intersection::addArrivals(int time, const std::array<int, kMovementCount>& counts) {
    for (Movement m : kAllMovements) {
        MovementQueue& q = queues_[toIndex(m)];
        for (int i = 0; i < counts[toIndex(m)]; ++i) {
            q.arrivalSeconds.push_back(time);
            ++q.totalArrived;
        }
    }
}

void Intersection::processDepartures([[maybe_unused]] int time,
                                     const std::array<bool, kMovementCount>& green) {
    for (Movement m : kAllMovements) {
        MovementQueue& q = queues_[toIndex(m)];

        // Credit is only earned while the movement is green and has cars
        // waiting. Otherwise it resets, so it can never pile up on an empty
        // queue or carry across a red period.
        if (!green[toIndex(m)] || q.arrivalSeconds.empty()) {
            q.credit = 0.0;
            continue;
        }

        q.credit += departureRate_;

        // One car leaves for each whole unit of credit.
        while (q.credit >= 1.0 - kCreditTolerance && !q.arrivalSeconds.empty()) {
            q.arrivalSeconds.pop_front();
            ++q.totalDeparted;
            q.credit -= 1.0;
        }

        if (q.arrivalSeconds.empty()) {
            q.credit = 0.0;
        }
    }
}

double Intersection::averageWait(Movement m, int time) const {
    const MovementQueue& q = queueFor(m);
    if (q.arrivalSeconds.empty()) {
        return 0.0;
    }
    double totalWait = 0.0;
    for (int arrival : q.arrivalSeconds) {
        totalWait += time - arrival;
    }
    return totalWait / static_cast<double>(q.arrivalSeconds.size());
}

int Intersection::queueLength(Movement m) const {
    return static_cast<int>(queueFor(m).arrivalSeconds.size());
}

int Intersection::totalArrived(Movement m) const {
    return queueFor(m).totalArrived;
}

int Intersection::totalDeparted(Movement m) const {
    return queueFor(m).totalDeparted;
}

void Intersection::snapshot(TrafficState& state, int simulatedSecond) const {
    for (Movement m : kAllMovements) {
        MovementState& ms = state.movements[toIndex(m)];
        ms.queue = queueLength(m);
        ms.averageWait = averageWait(m, simulatedSecond);
        ms.vehiclesPassed = totalDeparted(m);
    }
}
