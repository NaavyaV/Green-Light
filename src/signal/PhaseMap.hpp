#pragma once

// Facts about the signal phases: which movements each phase releases, and
// how the phases follow each other. Shared by SignalController and SafetyRules.

#include <array>

#include "core/Types.hpp"

// Movements released by a phase, indexed with toIndex(). Yellow and
// ALL_RED release nothing.
std::array<bool, kMovementCount> greenMovements(SignalPhase phase);

// True for the four green phases (NS_THROUGH, NS_LEFT, EW_THROUGH, EW_LEFT).
bool isGreen(SignalPhase phase);

// The yellow of a green's own road axis: NS greens -> NS_YELLOW, EW greens -> EW_YELLOW.
// Only valid for green phases.
SignalPhase yellowFor(SignalPhase green);

// A green's default successor in the fixed order
// NS_THROUGH -> NS_LEFT -> EW_THROUGH -> EW_LEFT -> NS_THROUGH.
// Only valid for green phases.
SignalPhase defaultNextGreen(SignalPhase green);
