#pragma once

// Every tunable number in the engine. Components receive a Config (or the
// values they need) instead of reading globals, so tests can pass modified
// copies and main can override the seed.

#include <cstdint>

struct Config {
    // Signal timing, in seconds
    int yellowSeconds = 3;         // length of every yellow phase
    int allRedSeconds = 1;         // length of every ALL_RED phase
    int minGreenSeconds = 10;      // a green may not end before this
    int maxGreenSeconds = 45;      // a green may never run longer than this
    int throughGreenSeconds = 20;  // default plan for NS_THROUGH and EW_THROUGH
    int leftGreenSeconds = 10;     // default plan for NS_LEFT and EW_LEFT

    // Traffic, in cars per second per movement
    double throughArrivalRate = 0.10;  // chance a car arrives on a through movement each second
    double leftArrivalRate = 0.04;     // chance a car arrives on a left movement each second
    double rightArrivalRate = 0.05;    // chance a car arrives on a right movement each second
    double departureRate = 0.5;        // cars leaving a green movement per second

    // Randomness
    std::uint32_t randomSeed = 42;  // seed for the arrival generator
};
