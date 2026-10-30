// Reproducible finite-horizon comparison; no performance threshold is asserted.
#include "engine/TrafficEngine.hpp"
#include <iomanip>
#include <iostream>
int main() {
    using namespace greenlight;
    std::cout << "seed,controller,arrivals,departures,final_queue,queued_vehicle_seconds,clearance_seconds,mean_departed_wait\n";
    for (unsigned seed : {42, 7, 123}) {
        SimulationConfig f, r; f.seed = r.seed = seed; r.controller = ControllerMode::Reactive;
        Simulator fixed(f), reactive(r);
        unsigned fixed_clearance = 0, reactive_clearance = 0;
        for (unsigned t = 0; t < 300; ++t) {
            const auto& a = fixed.step(); const auto& b = reactive.step();
            fixed_clearance += a.stage != SignalStage::Green;
            reactive_clearance += b.stage != SignalStage::Green;
            for (std::size_t i = 0; i < movement_count; ++i) {
                if (a.movements[i].arrivals != b.movements[i].arrivals) {
                    std::cerr << "Arrival stream mismatch\n"; return 1;
                }
            }
        }
        auto print = [&](const char* name, const TrafficState& s, unsigned clearance) {
            std::uint64_t arrivals = 0, wait = 0;
            for (const auto& m : s.movements) { arrivals += m.total_arrivals; wait += m.queued_vehicle_seconds; }
            std::cout << seed << ',' << name << ',' << arrivals << ',' << s.throughput() << ','
                      << s.total_queue() << ',' << wait << ',' << clearance << ','
                      << std::fixed << std::setprecision(6) << s.mean_departed_wait() << '\n';
        };
        print("fixed", fixed.state(), fixed_clearance);
        print("reactive", reactive.state(), reactive_clearance);
    }
}
