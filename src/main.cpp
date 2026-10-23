// Entry point. Stage 1: prints the movements and the config values.
// The simulation loop arrives in later stages.

#include <iostream>

#include "core/Config.hpp"
#include "core/Types.hpp"

int main() {
    const Config config;

    std::cout << "Movements:\n";
    for (Movement m : kAllMovements) {
        std::cout << "  " << toIndex(m) << ": " << toString(m) << "\n";
    }

    std::cout << "\nConfig:\n"
              << "  yellowSeconds:       " << config.yellowSeconds << "\n"
              << "  allRedSeconds:       " << config.allRedSeconds << "\n"
              << "  minGreenSeconds:     " << config.minGreenSeconds << "\n"
              << "  maxGreenSeconds:     " << config.maxGreenSeconds << "\n"
              << "  throughGreenSeconds: " << config.throughGreenSeconds << "\n"
              << "  leftGreenSeconds:    " << config.leftGreenSeconds << "\n"
              << "  throughArrivalRate:  " << config.throughArrivalRate << "\n"
              << "  leftArrivalRate:     " << config.leftArrivalRate << "\n"
              << "  rightArrivalRate:    " << config.rightArrivalRate << "\n"
              << "  departureRate:       " << config.departureRate << "\n"
              << "  randomSeed:          " << config.randomSeed << "\n";

    return 0;
}
