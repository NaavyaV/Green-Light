// Stage 5 tests: SafetyRules and its wiring into SignalController.
// Standard library only: CHECK prints each failure and the program returns
// non-zero if anything failed, which CTest reports as a failed test.

#include <array>
#include <initializer_list>
#include <iostream>
#include <optional>
#include <random>
#include <stdexcept>
#include <string>

#include "core/Config.hpp"
#include "core/TrafficState.hpp"
#include "core/Types.hpp"
#include "signal/PhaseMap.hpp"
#include "signal/SafetyRules.hpp"
#include "signal/SignalController.hpp"

namespace {

int failures = 0;

#define CHECK(cond)                                                           \
    do {                                                                      \
        if (!(cond)) {                                                        \
            std::cerr << __FILE__ << ":" << __LINE__ << ": CHECK failed: "    \
                      << #cond << "\n";                                       \
            ++failures;                                                       \
        }                                                                     \
    } while (0)

using P = SignalPhase;
using M = Movement;

const Config kDefaults;

SignalStatus greenStatus(SignalPhase phase, int secondsInPhase, int plannedDuration) {
    SignalStatus s;
    s.phase = phase;
    s.secondsInPhase = secondsInPhase;
    s.plannedDuration = plannedDuration;
    s.secondsRemaining = plannedDuration - secondsInPhase;
    return s;
}

std::array<bool, kMovementCount> movements(std::initializer_list<Movement> ms) {
    std::array<bool, kMovementCount> g{};
    for (Movement m : ms) g[toIndex(m)] = true;
    return g;
}

// --- Decisions -------------------------------------------------------------

void testHoldAlwaysAccepted() {
    const SafetyRules rules(kDefaults);
    CHECK(rules.reviewDecision(Decision::hold(), greenStatus(P::NS_THROUGH, 0, 20)).accepted);
    CHECK(rules.reviewDecision(Decision::hold(), greenStatus(P::NS_YELLOW, 1, 3)).accepted);
}

void testTransitionMinimumGreen() {
    const SafetyRules rules(kDefaults);
    const Verdict early = rules.reviewDecision(Decision::transition(), greenStatus(P::NS_THROUGH, 9, 20));
    CHECK(!early.accepted);
    CHECK(!early.reason.empty());
    CHECK(rules.reviewDecision(Decision::transition(), greenStatus(P::NS_THROUGH, 10, 20)).accepted);
}

void testExtendMaximumGreen() {
    const SafetyRules rules(kDefaults);
    const SignalStatus s = greenStatus(P::EW_THROUGH, 5, 20);
    CHECK(rules.reviewDecision(Decision::extend(25), s).accepted);   // plan 45: allowed
    CHECK(!rules.reviewDecision(Decision::extend(26), s).accepted);  // plan 46: too long
}

void testExtendMustBePositive() {
    const SafetyRules rules(kDefaults);
    const SignalStatus s = greenStatus(P::EW_THROUGH, 5, 20);
    CHECK(rules.reviewDecision(Decision::extend(1), s).accepted);
    CHECK(!rules.reviewDecision(Decision::extend(0), s).accepted);
    CHECK(!rules.reviewDecision(Decision::extend(-5), s).accepted);
}

void testTransitionNextGreenMustBeAnotherGreen() {
    const SafetyRules rules(kDefaults);
    const SignalStatus s = greenStatus(P::NS_THROUGH, 12, 20);
    CHECK(rules.reviewDecision(Decision::transition(P::EW_THROUGH), s).accepted);
    CHECK(rules.reviewDecision(Decision::transition(P::NS_LEFT), s).accepted);
    CHECK(!rules.reviewDecision(Decision::transition(P::NS_YELLOW), s).accepted);
    CHECK(!rules.reviewDecision(Decision::transition(P::EW_YELLOW), s).accepted);
    CHECK(!rules.reviewDecision(Decision::transition(P::ALL_RED), s).accepted);
    CHECK(!rules.reviewDecision(Decision::transition(P::NS_THROUGH), s).accepted);  // the ending green
}

void testNoDecisionsDuringClearance() {
    const SafetyRules rules(kDefaults);
    CHECK(!rules.reviewDecision(Decision::transition(), greenStatus(P::NS_YELLOW, 1, 3)).accepted);
    CHECK(!rules.reviewDecision(Decision::extend(5), greenStatus(P::ALL_RED, 0, 1)).accepted);
}

// --- Phase changes ---------------------------------------------------------

void testGreenEndsInOwnYellow() {
    const SafetyRules rules(kDefaults);
    CHECK(rules.checkPhaseChange(P::NS_THROUGH, P::NS_YELLOW, 20).accepted);
    CHECK(rules.checkPhaseChange(P::NS_LEFT, P::NS_YELLOW, 10).accepted);
    CHECK(rules.checkPhaseChange(P::EW_LEFT, P::EW_YELLOW, 10).accepted);
    CHECK(!rules.checkPhaseChange(P::NS_THROUGH, P::EW_YELLOW, 20).accepted);  // other axis
    CHECK(!rules.checkPhaseChange(P::NS_THROUGH, P::EW_THROUGH, 20).accepted); // green to green
    CHECK(!rules.checkPhaseChange(P::NS_THROUGH, P::NS_LEFT, 20).accepted);    // green to green
    CHECK(!rules.checkPhaseChange(P::NS_THROUGH, P::ALL_RED, 20).accepted);    // skips yellow
}

void testGreenDurationLimits() {
    const SafetyRules rules(kDefaults);
    CHECK(rules.checkPhaseChange(P::EW_THROUGH, P::EW_YELLOW, 10).accepted);
    CHECK(rules.checkPhaseChange(P::EW_THROUGH, P::EW_YELLOW, 45).accepted);
    CHECK(!rules.checkPhaseChange(P::EW_THROUGH, P::EW_YELLOW, 9).accepted);
    CHECK(!rules.checkPhaseChange(P::EW_THROUGH, P::EW_YELLOW, 46).accepted);
}

void testYellowRules() {
    const SafetyRules rules(kDefaults);
    CHECK(rules.checkPhaseChange(P::NS_YELLOW, P::ALL_RED, 3).accepted);
    CHECK(rules.checkPhaseChange(P::EW_YELLOW, P::ALL_RED, 3).accepted);
    CHECK(!rules.checkPhaseChange(P::NS_YELLOW, P::ALL_RED, 2).accepted);
    CHECK(!rules.checkPhaseChange(P::NS_YELLOW, P::ALL_RED, 4).accepted);
    CHECK(!rules.checkPhaseChange(P::NS_YELLOW, P::NS_LEFT, 3).accepted);  // skips ALL_RED
}

void testAllRedRules() {
    const SafetyRules rules(kDefaults);
    CHECK(rules.checkPhaseChange(P::ALL_RED, P::EW_THROUGH, 1).accepted);
    CHECK(rules.checkPhaseChange(P::ALL_RED, P::NS_LEFT, 1).accepted);
    CHECK(!rules.checkPhaseChange(P::ALL_RED, P::EW_THROUGH, 2).accepted);
    CHECK(!rules.checkPhaseChange(P::ALL_RED, P::NS_YELLOW, 1).accepted);
}

void testIllegalChangeThrows() {
    const SafetyRules rules(kDefaults);
    bool threw = false;
    try {
        rules.requireLegalPhaseChange(P::NS_THROUGH, P::EW_THROUGH, 20);
    } catch (const SafetyViolation& e) {
        threw = true;
        const std::string message = e.what();
        CHECK(message.find("NS_THROUGH -> EW_THROUGH") != std::string::npos);  // names the change
        CHECK(message.find("yellow") != std::string::npos);                    // names the rule
    }
    CHECK(threw);

    bool legalThrew = false;
    try {
        rules.requireLegalPhaseChange(P::NS_THROUGH, P::NS_YELLOW, 20);
    } catch (const SafetyViolation&) {
        legalThrew = true;
    }
    CHECK(!legalThrew);
}

// --- Conflicts -------------------------------------------------------------

void testEveryPhaseConflictFree() {
    const P phases[] = {P::NS_THROUGH, P::NS_LEFT, P::EW_THROUGH, P::EW_LEFT,
                        P::NS_YELLOW, P::EW_YELLOW, P::ALL_RED};
    for (P p : phases) {
        const Verdict v = SafetyRules::checkConflictFree(p);
        if (!v.accepted) std::cerr << "  " << toString(p) << ": " << v.reason << "\n";
        CHECK(v.accepted);
    }
}

void testConflictingSetsRejected() {
    CHECK(!SafetyRules::checkConflictFree(movements({M::N_THROUGH, M::E_THROUGH})).accepted);
    CHECK(!SafetyRules::checkConflictFree(movements({M::S_RIGHT, M::W_LEFT})).accepted);
    CHECK(!SafetyRules::checkConflictFree(movements({M::N_LEFT, M::S_THROUGH})).accepted);
    CHECK(!SafetyRules::checkConflictFree(movements({M::E_LEFT, M::W_THROUGH})).accepted);
    CHECK(SafetyRules::checkConflictFree(movements({M::N_LEFT, M::S_LEFT})).accepted);
    CHECK(SafetyRules::checkConflictFree(movements({M::N_THROUGH, M::N_LEFT})).accepted);
}

// --- Config ----------------------------------------------------------------

void testConfigValidation() {
    CHECK(SafetyRules::validateConfig(kDefaults).accepted);

    Config c = kDefaults;
    c.minGreenSeconds = 25;  // above the through and left defaults (experiment 6)
    const Verdict v = SafetyRules::validateConfig(c);
    CHECK(!v.accepted);
    CHECK(v.reason.find("minGreenSeconds") != std::string::npos);

    c = kDefaults; c.throughGreenSeconds = 50;  CHECK(!SafetyRules::validateConfig(c).accepted);
    c = kDefaults; c.leftGreenSeconds = 5;      CHECK(!SafetyRules::validateConfig(c).accepted);
    c = kDefaults; c.maxGreenSeconds = 5;       CHECK(!SafetyRules::validateConfig(c).accepted);
    c = kDefaults; c.yellowSeconds = 0;         CHECK(!SafetyRules::validateConfig(c).accepted);
    c = kDefaults; c.allRedSeconds = 0;         CHECK(!SafetyRules::validateConfig(c).accepted);
    c = kDefaults; c.throughArrivalRate = 1.5;  CHECK(!SafetyRules::validateConfig(c).accepted);
    c = kDefaults; c.leftArrivalRate = -0.1;    CHECK(!SafetyRules::validateConfig(c).accepted);
    c = kDefaults; c.rightArrivalRate = 2.0;    CHECK(!SafetyRules::validateConfig(c).accepted);
    c = kDefaults; c.departureRate = -1.0;      CHECK(!SafetyRules::validateConfig(c).accepted);

    // Edge values that are allowed.
    c = kDefaults; c.throughArrivalRate = 0.0;  CHECK(SafetyRules::validateConfig(c).accepted);
    c = kDefaults; c.throughArrivalRate = 1.0;  CHECK(SafetyRules::validateConfig(c).accepted);
    c = kDefaults; c.throughGreenSeconds = 45;  CHECK(SafetyRules::validateConfig(c).accepted);
}

void testSignalControllerRefusesBadConfig() {
    Config bad = kDefaults;
    bad.minGreenSeconds = 25;
    bool threw = false;
    try {
        SignalController sc(bad);
    } catch (const std::invalid_argument&) {
        threw = true;
    }
    CHECK(threw);
}

// --- Wiring ----------------------------------------------------------------

// A rejected decision acts as Hold: the outcome says why, and nothing changes.
void testRejectedDecisionActsAsHold() {
    SignalController sc(kDefaults);
    for (int now = 1; now <= 5; ++now) sc.tick(now);
    const SignalStatus before = sc.status();

    const DecisionOutcome early = sc.applyDecision(Decision::transition(), 5);
    CHECK(!early.accepted);
    CHECK(!early.reason.empty());
    CHECK(!early.change);

    const DecisionOutcome tooLong = sc.applyDecision(Decision::extend(100), 5);
    CHECK(!tooLong.accepted);

    const SignalStatus after = sc.status();
    CHECK(after.phase == before.phase);
    CHECK(after.secondsInPhase == before.secondsInPhase);
    CHECK(after.plannedDuration == before.plannedDuration);

    // An accepted decision is applied.
    const DecisionOutcome ok = sc.applyDecision(Decision::extend(5), 5);
    CHECK(ok.accepted);
    CHECK(sc.status().plannedDuration == before.plannedDuration + 5);
}

// --- Fuzz ------------------------------------------------------------------

// Random decisions, legal and illegal, for 10,000 seconds. Whatever the
// controller asks for, the resulting phase sequence must obey every rule.
// The seed is fixed so a failure can be reproduced.
void testFuzzRandomDecisions() {
    constexpr unsigned kFuzzSeed = 20261105;
    constexpr int kSeconds = 10000;
    const P allPhases[] = {P::NS_THROUGH, P::NS_LEFT, P::EW_THROUGH, P::EW_LEFT,
                           P::NS_YELLOW, P::EW_YELLOW, P::ALL_RED};

    std::mt19937 rng(kFuzzSeed);
    std::uniform_int_distribution<int> pickType(0, 2);
    std::uniform_int_distribution<int> pickExtend(-5, 50);
    std::uniform_int_distribution<int> pickNext(0, 7);  // 0-6: a phase, 7: none

    SignalController sc(kDefaults);
    int phaseStart = 0;
    int accepted = 0;
    int rejected = 0;
    int changes = 0;

    try {
        for (int t = 0; t < kSeconds; ++t) {
            const int now = t + 1;
            std::optional<PhaseChange> change = sc.tick(now);

            if (!change && isGreen(sc.phase())) {
                Decision d;
                switch (pickType(rng)) {
                    case 0: d = Decision::hold(); break;
                    case 1: d = Decision::extend(pickExtend(rng)); break;
                    default: {
                        const int n = pickNext(rng);
                        d = n == 7 ? Decision::transition() : Decision::transition(allPhases[n]);
                        break;
                    }
                }
                const DecisionOutcome outcome = sc.applyDecision(d, now);
                (outcome.accepted ? accepted : rejected)++;
                change = outcome.change;
            }

            CHECK(sc.status().secondsRemaining >= 0);
            CHECK(SafetyRules::checkConflictFree(sc.greenMovements()).accepted);

            if (!change) continue;
            ++changes;
            const int lasted = change->atSecond - phaseStart;
            phaseStart = change->atSecond;

            if (isGreen(change->from)) {
                CHECK(lasted >= kDefaults.minGreenSeconds);
                CHECK(lasted <= kDefaults.maxGreenSeconds);
                CHECK(change->to == yellowFor(change->from));
            } else if (change->from == P::ALL_RED) {
                CHECK(lasted == kDefaults.allRedSeconds);
                CHECK(isGreen(change->to));
            } else {
                CHECK(lasted == kDefaults.yellowSeconds);
                CHECK(change->to == P::ALL_RED);
            }
        }
    } catch (const std::exception& e) {
        std::cerr << "  fuzz threw: " << e.what() << "\n";
        ++failures;
    }

    // Make sure the fuzz actually exercised both paths.
    CHECK(accepted > 0);
    CHECK(rejected > 0);
    CHECK(changes > 100);
    std::cout << "fuzz: " << changes << " phase changes, " << accepted << " decisions accepted, "
              << rejected << " rejected\n";
}

}  // namespace

int main() {
    testHoldAlwaysAccepted();
    testTransitionMinimumGreen();
    testExtendMaximumGreen();
    testExtendMustBePositive();
    testTransitionNextGreenMustBeAnotherGreen();
    testNoDecisionsDuringClearance();
    testGreenEndsInOwnYellow();
    testGreenDurationLimits();
    testYellowRules();
    testAllRedRules();
    testIllegalChangeThrows();
    testEveryPhaseConflictFree();
    testConflictingSetsRejected();
    testConfigValidation();
    testSignalControllerRefusesBadConfig();
    testRejectedDecisionActsAsHold();
    testFuzzRandomDecisions();

    if (failures == 0) {
        std::cout << "test_safety_rules: all checks passed\n";
        return 0;
    }
    std::cerr << "test_safety_rules: " << failures << " check(s) failed\n";
    return 1;
}
