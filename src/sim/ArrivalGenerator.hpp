#pragma once

// Fake, reproducible traffic. Each simulated second, every movement rolls
// once and a car arrives with probability equal to that movement's rate.
// The same seed always gives the same traffic.

#include <array>
#include <random>

#include "core/Config.hpp"
#include "core/Types.hpp"

class ArrivalGenerator {
public:
    // Seeds from config.randomSeed and takes the left/through/right rates from config.
    explicit ArrivalGenerator(const Config& config);

    // Arrivals for one simulated second: 0 or 1 car per movement, indexed with toIndex().
    std::array<int, kMovementCount> nextSecond();

private:
    std::mt19937 rng_;
    std::array<double, kMovementCount> rates_;
};
